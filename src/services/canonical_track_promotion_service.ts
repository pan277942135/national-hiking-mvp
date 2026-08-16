import type { Pool, PoolClient } from 'pg';
import { evaluateGeometryConsensusReadiness } from './geometry_consensus_service.js';

export interface PromoteCanonicalTrackInput {
  routeId: string;
  selectedSourceRawTrackId: string;
  editorId: string;
  rationale: string;
}

export interface PromoteCanonicalTrackResult {
  routeId: string;
  canonicalTrackId: string;
  canonicalTrackVersion: number;
  routeVersion: number;
  previousRouteState: string;
  routeState: 'STATIC_PUBLISHABLE' | 'RULE_BLOCKED';
  selectedSourceRawTrackId: string;
  distanceMeters: number;
  elevationGainMeters: null;
  consensusState: 'READY_FOR_EDITORIAL_CANONICALIZATION';
  geometryPolicy: 'DIRECT_ACCEPTED_RAW_COPY_NO_AVERAGING';
  autoPromoted: false;
  editorId: string;
  promotedAt: string;
}

interface LockedRouteRow {
  route_id: string;
  route_state: string;
  version: number;
  active_canonical_track_id: string | null;
}

interface AcceptedSourceRow {
  raw_track_id: string;
  provenance_class: string;
  recorded_execution: boolean;
  geometry_gate_state: string;
  assignment_state: string;
  qa: Record<string, unknown>;
  distance_m: number;
}

function requireEditorialText(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required for editorial canonicalization`);
  return trimmed;
}

async function lockRoute(client: PoolClient, routeId: string): Promise<LockedRouteRow> {
  const result = await client.query<LockedRouteRow>(
    `SELECT route_id, route_state, version, active_canonical_track_id
       FROM route
      WHERE route_id = $1
      FOR UPDATE`,
    [routeId]
  );
  const route = result.rows[0];
  if (!route) throw new Error(`Route not found: ${routeId}`);
  return route;
}

async function loadAcceptedSource(
  client: PoolClient,
  routeId: string,
  rawTrackId: string
): Promise<AcceptedSourceRow> {
  const result = await client.query<AcceptedSourceRow>(
    `SELECT t.raw_track_id,
            t.provenance_class,
            t.recorded_execution,
            a.geometry_gate_state,
            a.assignment_state,
            a.qa,
            ST_Length(t.geometry::geography)::float8 AS distance_m
       FROM raw_track t
       JOIN raw_track_route_assignment a
         ON a.raw_track_id = t.raw_track_id
      WHERE t.raw_track_id = $1
        AND a.route_id = $2`,
    [rawTrackId, routeId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`RawTrack ${rawTrackId} is not assigned to Route ${routeId}`);
  return row;
}

/**
 * Explicit editorial transition from compatible FULL_ROUTE_QA evidence to an
 * active CanonicalTrack.
 *
 * Hard guarantees:
 * - never runs unless FIRST_PARTY_PUBLIC consensus is READY;
 * - selected geometry must be one of the readiness evaluator's independent
 *   accepted raw executions for the SAME child Route;
 * - selected RawTrack must still be TARGET_ACCEPTED + PASS + FULL_ROUTE_QA;
 * - geometry is copied verbatim from one accepted RawTrack; no averaging,
 *   shortest-path construction, POI stitching or sibling blending;
 * - creates a versioned CanonicalTrack + single RouteSegment and activates it;
 * - never changes Rule/LegalScope/runtime truth and never marks a Route
 *   EXECUTABLE merely because geometry became canonical;
 * - RULE_BLOCKED remains RULE_BLOCKED; otherwise the post-geometry state is
 *   STATIC_PUBLISHABLE pending the independent legal/runtime eligibility layer.
 */
export async function promoteCanonicalTrackEditorially(
  pool: Pool,
  input: PromoteCanonicalTrackInput
): Promise<PromoteCanonicalTrackResult> {
  const editorId = requireEditorialText('editorId', input.editorId);
  const rationale = requireEditorialText('rationale', input.rationale);
  const client = await pool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const route = await lockRoute(client, input.routeId);

    if (route.active_canonical_track_id) {
      throw new Error(
        `Route ${input.routeId} already has active CanonicalTrack ${route.active_canonical_track_id}; use a separate revision workflow`
      );
    }
    if (route.route_state === 'EXECUTABLE') {
      throw new Error(
        `Route ${input.routeId} is already EXECUTABLE; initial canonicalization service cannot revise executable geometry`
      );
    }

    const readiness = await evaluateGeometryConsensusReadiness(client, input.routeId, {
      mode: 'FIRST_PARTY_PUBLIC'
    });
    if (readiness.state !== 'READY_FOR_EDITORIAL_CANONICALIZATION') {
      throw new Error(
        `Geometry consensus is ${readiness.state}; editorial canonicalization requires READY_FOR_EDITORIAL_CANONICALIZATION`
      );
    }
    if (!readiness.acceptedRawTrackIds.includes(input.selectedSourceRawTrackId)) {
      throw new Error(
        `Selected RawTrack ${input.selectedSourceRawTrackId} is not an independent accepted source in the current readiness set`
      );
    }

    const source = await loadAcceptedSource(client, input.routeId, input.selectedSourceRawTrackId);
    const purpose = typeof source.qa === 'object' && source.qa
      ? String((source.qa as Record<string, unknown>).purpose ?? '')
      : '';
    if (
      source.assignment_state !== 'TARGET_ACCEPTED' ||
      source.geometry_gate_state !== 'PASS' ||
      purpose !== 'FULL_ROUTE_QA' ||
      !source.recorded_execution ||
      !['RECORDED_GPS', 'RECORDED_GPS_MERGED'].includes(source.provenance_class)
    ) {
      throw new Error(
        `Selected RawTrack ${input.selectedSourceRawTrackId} no longer satisfies TARGET_ACCEPTED FULL_ROUTE_QA recorded-execution requirements`
      );
    }

    const versionResult = await client.query<{ next_version: number }>(
      `SELECT COALESCE(MAX(version), 0)::int + 1 AS next_version
         FROM canonical_track
        WHERE route_id = $1`,
      [input.routeId]
    );
    const canonicalTrackVersion = Number(versionResult.rows[0]?.next_version ?? 1);
    const canonicalTrackId = `CT-${input.routeId}-V${canonicalTrackVersion}`;
    const promotedAt = new Date().toISOString();
    const qa = {
      promotion_policy: 'DIRECT_ACCEPTED_RAW_COPY_NO_AVERAGING',
      selected_source_raw_track_id: input.selectedSourceRawTrackId,
      selected_source_provenance_class: source.provenance_class,
      editor_id: editorId,
      editor_rationale: rationale,
      promoted_at: promotedAt,
      consensus_snapshot: {
        mode: readiness.mode,
        state: readiness.state,
        independent_execution_count: readiness.independentExecutionCount,
        distinct_actor_count: readiness.distinctActorCount,
        accepted_raw_track_ids: readiness.acceptedRawTrackIds,
        pair_compatibility: readiness.pairCompatibility,
        thresholds: readiness.thresholds,
        reason_codes: readiness.reasonCodes,
        evaluated_at: readiness.evaluatedAt
      }
    };

    await client.query(
      `INSERT INTO canonical_track (
         canonical_track_id, route_id, geometry, distance_m,
         elevation_gain_m, qa, version
       )
       SELECT $1, $2, geometry, ST_Length(geometry::geography), NULL, $3::jsonb, $4
         FROM raw_track
        WHERE raw_track_id = $5`,
      [
        canonicalTrackId,
        input.routeId,
        JSON.stringify(qa),
        canonicalTrackVersion,
        input.selectedSourceRawTrackId
      ]
    );

    await client.query(
      `INSERT INTO route_segment (
         route_segment_id, route_id, canonical_track_id, segment_index, geometry
       )
       SELECT $1, $2, $3, 0, geometry
         FROM canonical_track
        WHERE canonical_track_id = $3`,
      [`SEG-${input.routeId}-V${canonicalTrackVersion}-0`, input.routeId, canonicalTrackId]
    );

    const routeState: PromoteCanonicalTrackResult['routeState'] =
      route.route_state === 'RULE_BLOCKED' ? 'RULE_BLOCKED' : 'STATIC_PUBLISHABLE';
    const routeVersion = route.version + 1;
    await client.query(
      `UPDATE route
          SET active_canonical_track_id = $1,
              route_state = $2::route_state_enum,
              version = $3
        WHERE route_id = $4`,
      [canonicalTrackId, routeState, routeVersion, input.routeId]
    );

    await client.query(
      `UPDATE dependency
          SET state = 'RESOLVED',
              stop_status = 'RESOLVED',
              resolved_at = now(),
              metadata = metadata || jsonb_build_object(
                'resolved_by_canonical_track_id', $1,
                'resolved_by_editor_id', $2,
                'resolved_at', $3
              )
        WHERE entity_type = 'route'
          AND entity_id = $4
          AND dependency_class = 'ROUTE_COVERAGE'
          AND field_key = 'canonical_geometry'
          AND state <> 'RESOLVED'`,
      [canonicalTrackId, editorId, promotedAt, input.routeId]
    );

    await client.query('COMMIT');
    return {
      routeId: input.routeId,
      canonicalTrackId,
      canonicalTrackVersion,
      routeVersion,
      previousRouteState: route.route_state,
      routeState,
      selectedSourceRawTrackId: input.selectedSourceRawTrackId,
      distanceMeters: Number(source.distance_m),
      elevationGainMeters: null,
      consensusState: 'READY_FOR_EDITORIAL_CANONICALIZATION',
      geometryPolicy: 'DIRECT_ACCEPTED_RAW_COPY_NO_AVERAGING',
      autoPromoted: false,
      editorId,
      promotedAt
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
