import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  evaluateGeometryConsensusReadiness,
  type GeometryConsensusMode,
  type GeometryConsensusReadiness
} from './geometry_consensus_service.js';

export interface ActivateCanonicalTrackInput {
  routeId: string;
  sourceRawTrackId: string;
  reviewerId: string;
  /** Public activation is always FIRST_PARTY_PUBLIC. RAW_INDEPENDENT is rejected. */
  consensusMode?: GeometryConsensusMode;
  /** Explicit editorial rationale; required for any successful activation. */
  reviewNote?: string;
}

export interface ActivateCanonicalTrackResult {
  canonicalTrackId: string;
  routeId: string;
  sourceRawTrackId: string;
  canonicalTrackVersion: number;
  routeVersion: number;
  previousRouteState: string;
  routeState: 'STATIC_PUBLISHABLE' | 'RULE_BLOCKED';
  distanceMeters: number;
  elevationGainMeters: null;
  readiness: GeometryConsensusReadiness;
  geometryDerivation: 'COPY_APPROVED_RAW_TRACK_NO_AVERAGING';
  dependencyRowsResolved: number;
  autoPromoted: false;
  legalClearanceInferred: false;
  runtimeStateInferred: false;
}

function requireNonEmpty(label: string, value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw new Error(`${label} is required for editorial canonicalization`);
  return trimmed;
}

async function insertCanonicalTrack(
  client: PoolClient,
  input: ActivateCanonicalTrackInput,
  readiness: GeometryConsensusReadiness
): Promise<ActivateCanonicalTrackResult> {
  if (readiness.state !== 'READY_FOR_EDITORIAL_CANONICALIZATION') {
    throw new Error(`Geometry consensus is not ready for canonicalization: ${readiness.state}`);
  }
  if (readiness.mode !== 'FIRST_PARTY_PUBLIC') {
    throw new Error('Public CanonicalTrack activation requires FIRST_PARTY_PUBLIC consensus');
  }
  if (!readiness.acceptedRawTrackIds.includes(input.sourceRawTrackId)) {
    throw new Error('sourceRawTrackId must be one of the consensus-accepted child-route RawTracks');
  }

  const reviewerId = requireNonEmpty('reviewerId', input.reviewerId);
  const reviewNote = requireNonEmpty('reviewNote', input.reviewNote);

  const routeResult = await client.query<{
    route_id: string;
    route_state: string;
    version: number;
    active_canonical_track_id: string | null;
  }>(
    `SELECT route_id, route_state, version, active_canonical_track_id
       FROM route
      WHERE route_id = $1
      FOR UPDATE`,
    [input.routeId]
  );
  const route = routeResult.rows[0];
  if (!route) throw new Error(`Route not found: ${input.routeId}`);

  if (route.active_canonical_track_id) {
    throw new Error(
      `Route ${input.routeId} already has active CanonicalTrack ${route.active_canonical_track_id}; use a separate revision workflow`
    );
  }
  if (route.route_state === 'EXECUTABLE') {
    throw new Error(
      `Route ${input.routeId} is already EXECUTABLE; initial activation cannot revise executable geometry`
    );
  }
  if (!['GEOMETRY_BLOCKED', 'IDENTITY_ONLY', 'STATIC_PUBLISHABLE', 'RULE_BLOCKED'].includes(route.route_state)) {
    throw new Error(`Route state ${route.route_state} is not eligible for initial CanonicalTrack activation`);
  }

  const sourceResult = await client.query<{
    raw_track_id: string;
    provenance_class: string;
    recorded_execution: boolean;
    purpose: string | null;
    assignment_state: string;
    geometry_gate_state: string;
  }>(
    `SELECT t.raw_track_id, t.provenance_class, t.recorded_execution,
            a.qa->>'purpose' AS purpose,
            a.assignment_state, a.geometry_gate_state
       FROM raw_track t
       JOIN raw_track_route_assignment a
         ON a.raw_track_id = t.raw_track_id
        AND a.route_id = $2
      WHERE t.raw_track_id = $1`,
    [input.sourceRawTrackId, input.routeId]
  );
  const source = sourceResult.rows[0];
  if (!source) throw new Error('Selected RawTrack has no assignment to the target child Route');
  if (
    source.assignment_state !== 'TARGET_ACCEPTED' ||
    source.geometry_gate_state !== 'PASS' ||
    source.purpose !== 'FULL_ROUTE_QA' ||
    !source.recorded_execution ||
    !['RECORDED_GPS', 'RECORDED_GPS_MERGED'].includes(source.provenance_class)
  ) {
    throw new Error('Selected RawTrack is not an accepted FULL_ROUTE_QA recorded execution');
  }

  const versionResult = await client.query<{ next_version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM canonical_track
      WHERE route_id = $1`,
    [input.routeId]
  );
  const canonicalTrackVersion = Number(versionResult.rows[0]?.next_version ?? 1);
  const canonicalTrackId = `CT-${crypto
    .createHash('sha256')
    .update(`${input.routeId}:${canonicalTrackVersion}:${input.sourceRawTrackId}`)
    .digest('hex')
    .slice(0, 20)
    .toUpperCase()}`;
  const activatedAt = new Date().toISOString();

  const qa = {
    canonicalization_policy: 'EDITOR_SELECTED_ACCEPTED_RAW_TRACK_V1',
    geometry_derivation: 'COPY_APPROVED_RAW_TRACK_NO_AVERAGING',
    source_raw_track_id: input.sourceRawTrackId,
    reviewer_id: reviewerId,
    review_note: reviewNote,
    activated_at: activatedAt,
    consensus_mode: readiness.mode,
    consensus_evaluated_at: readiness.evaluatedAt,
    consensus_reason_codes: readiness.reasonCodes,
    independent_execution_count: readiness.independentExecutionCount,
    distinct_actor_count: readiness.distinctActorCount,
    independent_actor_execution_pair_count: readiness.independentActorExecutionPairCount,
    accepted_raw_track_ids: readiness.acceptedRawTrackIds,
    pair_compatibility: readiness.pairCompatibility,
    thresholds: readiness.thresholds,
    legal_clearance_inferred: false,
    runtime_state_inferred: false
  };

  const inserted = await client.query<{ distance_m: number }>(
    `INSERT INTO canonical_track (
       canonical_track_id, route_id, geometry, distance_m,
       elevation_gain_m, qa, version
     )
     SELECT $1, $2, geometry,
            ST_Length(geometry::geography),
            NULL,
            $3::jsonb,
            $4
       FROM raw_track
      WHERE raw_track_id = $5
     RETURNING distance_m::float8 AS distance_m`,
    [canonicalTrackId, input.routeId, JSON.stringify(qa), canonicalTrackVersion, input.sourceRawTrackId]
  );
  const distanceMeters = Number(inserted.rows[0]?.distance_m ?? 0);

  // Keep RouteSegment materialized from exactly the same approved geometry.
  // This is intentionally a one-segment baseline, not a segmentation algorithm.
  await client.query(
    `INSERT INTO route_segment (
       route_segment_id, route_id, canonical_track_id, segment_index, geometry
     )
     SELECT $1, $2, $3, 0, geometry
       FROM canonical_track
      WHERE canonical_track_id = $3`,
    [`SEG-${canonicalTrackId}-000`, input.routeId, canonicalTrackId]
  );

  // Geometry approval resolves GEOMETRY_BLOCKED, but it does not prove current
  // legal clearance or runtime safety. Therefore this transaction never sets
  // EXECUTABLE automatically. Existing RULE_BLOCKED state is preserved.
  const nextRouteState: ActivateCanonicalTrackResult['routeState'] =
    route.route_state === 'RULE_BLOCKED' ? 'RULE_BLOCKED' : 'STATIC_PUBLISHABLE';
  const routeVersion = route.version + 1;

  await client.query(
    `UPDATE route
        SET active_canonical_track_id = $2,
            route_state = $3::route_state_enum,
            version = $4
      WHERE route_id = $1`,
    [input.routeId, canonicalTrackId, nextRouteState, routeVersion]
  );

  // A route-coverage dependency is geometry-specific. Resolve it only after the
  // editor activates a CanonicalTrack; other legal/runtime dependencies remain.
  const dependencyResolution = await client.query(
    `UPDATE dependency
        SET state = 'RESOLVED',
            stop_status = 'RESOLVED',
            resolved_at = now(),
            metadata = metadata || jsonb_build_object(
              'resolved_by_canonical_track_id', $2,
              'resolved_by_reviewer_id', $3,
              'resolved_at', $4
            )
      WHERE entity_type = 'route'
        AND entity_id = $1
        AND dependency_class = 'ROUTE_COVERAGE'
        AND field_key = 'canonical_geometry'
        AND state <> 'RESOLVED'`,
    [input.routeId, canonicalTrackId, reviewerId, activatedAt]
  );

  return {
    canonicalTrackId,
    routeId: input.routeId,
    sourceRawTrackId: input.sourceRawTrackId,
    canonicalTrackVersion,
    routeVersion,
    previousRouteState: route.route_state,
    routeState: nextRouteState,
    distanceMeters,
    elevationGainMeters: null,
    readiness,
    geometryDerivation: 'COPY_APPROVED_RAW_TRACK_NO_AVERAGING',
    dependencyRowsResolved: dependencyResolution.rowCount ?? 0,
    autoPromoted: false,
    legalClearanceInferred: false,
    runtimeStateInferred: false
  };
}

/**
 * Explicit editorial action only.
 *
 * The consensus predicate is evaluated inside the same SERIALIZABLE transaction
 * that creates CanonicalTrack and updates Route. This removes a time-of-check /
 * time-of-use window between readiness and activation. PostgreSQL SSI will
 * abort a conflicting concurrent evidence mutation rather than allow activation
 * from a stale consensus snapshot.
 *
 * Public activation always uses FIRST_PARTY_PUBLIC consensus: >=2 independent
 * accepted FULL_ROUTE_QA executions, with >=2 independent actor↔execution pairs,
 * and pairwise-compatible geometry. RAW_INDEPENDENT may be useful as a diagnostic
 * mode elsewhere, but it cannot activate public canonical geometry.
 *
 * The selected geometry is copied exactly from one approved RawTrack. No
 * clustering/averaging constructs a new navigation line.
 */
export async function activateCanonicalTrackFromAcceptedRaw(
  pool: Pool,
  input: ActivateCanonicalTrackInput
): Promise<ActivateCanonicalTrackResult> {
  if (input.consensusMode && input.consensusMode !== 'FIRST_PARTY_PUBLIC') {
    throw new Error('Public CanonicalTrack activation requires FIRST_PARTY_PUBLIC consensus');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    // Serialize editorial activation for the child Route before evaluating the
    // consensus predicate. Readiness itself is then derived through this client.
    const lockedRoute = await client.query(
      'SELECT route_id FROM route WHERE route_id = $1 FOR UPDATE',
      [input.routeId]
    );
    if (!lockedRoute.rows[0]) throw new Error(`Route not found: ${input.routeId}`);

    const readiness = await evaluateGeometryConsensusReadiness(client, input.routeId, {
      mode: 'FIRST_PARTY_PUBLIC'
    });
    const result = await insertCanonicalTrack(client, input, readiness);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
