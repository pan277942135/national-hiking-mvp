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
  consensusMode?: GeometryConsensusMode;
  reviewNote?: string;
}

export interface ActivateCanonicalTrackResult {
  canonicalTrackId: string;
  routeId: string;
  sourceRawTrackId: string;
  canonicalTrackVersion: number;
  routeVersion: number;
  routeState: string;
  distanceMeters: number;
  elevationGainMeters: null;
  readiness: GeometryConsensusReadiness;
  autoPromoted: false;
  legalClearanceInferred: false;
}

async function insertCanonicalTrack(
  client: PoolClient,
  input: ActivateCanonicalTrackInput,
  readiness: GeometryConsensusReadiness
): Promise<ActivateCanonicalTrackResult> {
  if (!input.reviewerId.trim()) throw new Error('reviewerId is required for editorial canonicalization');
  if (readiness.state !== 'READY_FOR_EDITORIAL_CANONICALIZATION') {
    throw new Error(`Geometry consensus is not ready for canonicalization: ${readiness.state}`);
  }
  if (!readiness.acceptedRawTrackIds.includes(input.sourceRawTrackId)) {
    throw new Error('sourceRawTrackId must be one of the consensus-accepted child-route RawTracks');
  }

  const routeResult = await client.query<{
    route_id: string;
    route_state: string;
    version: number;
  }>(
    `SELECT route_id, route_state, version
       FROM route
      WHERE route_id = $1
      FOR UPDATE`,
    [input.routeId]
  );
  const route = routeResult.rows[0];
  if (!route) throw new Error(`Route not found: ${input.routeId}`);

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

  const qa = {
    canonicalization_policy: 'EDITOR_SELECTED_ACCEPTED_RAW_TRACK_V1',
    geometry_derivation: 'COPY_APPROVED_RAW_TRACK_NO_AVERAGING',
    source_raw_track_id: input.sourceRawTrackId,
    reviewer_id: input.reviewerId,
    review_note: input.reviewNote ?? null,
    consensus_mode: readiness.mode,
    consensus_evaluated_at: readiness.evaluatedAt,
    consensus_reason_codes: readiness.reasonCodes,
    independent_execution_count: readiness.independentExecutionCount,
    distinct_actor_count: readiness.distinctActorCount,
    accepted_raw_track_ids: readiness.acceptedRawTrackIds,
    pair_compatibility: readiness.pairCompatibility,
    legal_clearance_inferred: false,
    runtime_state_inferred: false
  };

  const inserted = await client.query<{
    distance_m: number;
  }>(
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

  // Geometry approval resolves GEOMETRY_BLOCKED, but it does not prove current
  // legal clearance or runtime safety. Therefore this transaction never sets
  // EXECUTABLE automatically. Existing RULE_BLOCKED state is preserved.
  const nextRouteState = route.route_state === 'GEOMETRY_BLOCKED' || route.route_state === 'IDENTITY_ONLY'
    ? 'STATIC_PUBLISHABLE'
    : route.route_state;
  const routeVersion = route.version + 1;

  await client.query(
    `UPDATE route
        SET active_canonical_track_id = $2,
            route_state = $3::route_state_enum,
            version = $4
      WHERE route_id = $1`,
    [input.routeId, canonicalTrackId, nextRouteState, routeVersion]
  );

  return {
    canonicalTrackId,
    routeId: input.routeId,
    sourceRawTrackId: input.sourceRawTrackId,
    canonicalTrackVersion,
    routeVersion,
    routeState: nextRouteState,
    distanceMeters,
    elevationGainMeters: null,
    readiness,
    autoPromoted: false,
    legalClearanceInferred: false
  };
}

/**
 * Explicit editorial action only. Consensus readiness is evaluated first, then
 * rechecked under a transaction before an exact accepted RawTrack geometry is
 * copied into CanonicalTrack. No clustering/averaging creates a new line.
 */
export async function activateCanonicalTrackFromAcceptedRaw(
  pool: Pool,
  input: ActivateCanonicalTrackInput
): Promise<ActivateCanonicalTrackResult> {
  const readiness = await evaluateGeometryConsensusReadiness(pool, input.routeId, {
    mode: input.consensusMode ?? 'FIRST_PARTY_PUBLIC'
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
