import type { Pool } from 'pg';

export type GeometryConsensusMode = 'RAW_INDEPENDENT' | 'FIRST_PARTY_PUBLIC';
export type GeometryConsensusReadinessState =
  | 'INSUFFICIENT_EVIDENCE'
  | 'INSUFFICIENT_INDEPENDENT_ACTORS'
  | 'INCOMPATIBLE_CLUSTER'
  | 'READY_FOR_EDITORIAL_CANONICALIZATION';

export interface GeometryConsensusThresholds {
  minIndependentExecutions: number;
  minDistinctActors: number;
  maxPairHausdorffMeters: number;
  minPairOverlapWithin30m: number;
  minPairLengthRatio: number;
}

export interface GeometryPairCompatibility {
  trackA: string;
  trackB: string;
  hausdorffMeters: number;
  overlapWithin30m: number;
  lengthRatio: number;
  compatible: boolean;
}

export interface GeometryConsensusReadiness {
  routeId: string;
  mode: GeometryConsensusMode;
  state: GeometryConsensusReadinessState;
  independentExecutionCount: number;
  distinctActorCount: number;
  acceptedRawTrackIds: string[];
  pairCompatibility: GeometryPairCompatibility[];
  thresholds: GeometryConsensusThresholds;
  reasonCodes: string[];
  editorialActionRequired: true;
  autoPromoted: false;
  evaluatedAt: string;
}

export const DEFAULT_GEOMETRY_CONSENSUS_THRESHOLDS: GeometryConsensusThresholds = {
  minIndependentExecutions: 2,
  minDistinctActors: 2,
  maxPairHausdorffMeters: 70,
  minPairOverlapWithin30m: 0.70,
  minPairLengthRatio: 0.75
};

/**
 * Evaluates whether already FULL_ROUTE_QA-gated child-route evidence is ready
 * for an editor to consider canonicalization. It does NOT create CanonicalTrack,
 * mutate Route, or infer legality/open status.
 *
 * The pairwise 30m overlap and Hausdorff calculation uses EPSG:3857 as an MVP
 * local-distance approximation; it is a readiness diagnostic, not canonical
 * route length/elevation computation. The thresholds remain explicit/configurable.
 */
export async function evaluateGeometryConsensusReadiness(
  pool: Pool,
  routeId: string,
  options?: {
    mode?: GeometryConsensusMode;
    thresholds?: Partial<GeometryConsensusThresholds>;
  }
): Promise<GeometryConsensusReadiness> {
  const mode = options?.mode ?? 'FIRST_PARTY_PUBLIC';
  const thresholds: GeometryConsensusThresholds = {
    ...DEFAULT_GEOMETRY_CONSENSUS_THRESHOLDS,
    ...(options?.thresholds ?? {})
  };

  const route = await pool.query(`SELECT route_id FROM route WHERE route_id = $1`, [routeId]);
  if (!route.rows[0]) throw new Error(`Route not found: ${routeId}`);

  const accepted = await pool.query<{
    raw_track_id: string;
    independence_key: string;
  }>(
    `SELECT a.raw_track_id,
            COALESCE(a.independent_provenance_key, a.raw_track_id) AS independence_key
       FROM raw_track_route_assignment a
       JOIN raw_track t ON t.raw_track_id = a.raw_track_id
      WHERE a.route_id = $1
        AND a.assignment_state = 'TARGET_ACCEPTED'
        AND a.geometry_gate_state = 'PASS'
        AND a.qa->>'purpose' = 'FULL_ROUTE_QA'
        AND t.recorded_execution = true
        AND t.provenance_class IN ('RECORDED_GPS', 'RECORDED_GPS_MERGED')
      ORDER BY a.raw_track_id`,
    [routeId]
  );

  const independent = new Map<string, string>();
  for (const row of accepted.rows) {
    if (!independent.has(row.independence_key)) independent.set(row.independence_key, row.raw_track_id);
  }
  const acceptedRawTrackIds = [...independent.values()];
  const independentExecutionCount = acceptedRawTrackIds.length;

  const actors = await pool.query<{ actor_hash: string }>(
    `SELECT DISTINCT act.actor_hash
       FROM activity_route_assignment ara
       JOIN activity act ON act.activity_id = ara.activity_id
       JOIN raw_track_route_assignment rta
         ON rta.raw_track_id = act.raw_track_id
        AND rta.route_id = ara.route_id
       JOIN raw_track t ON t.raw_track_id = act.raw_track_id
      WHERE ara.route_id = $1
        AND ara.assignment_state = 'TARGET_ACCEPTED'
        AND ara.geometry_gate_state = 'PASS'
        AND act.integrity_state = 'PASS'
        AND rta.assignment_state = 'TARGET_ACCEPTED'
        AND rta.geometry_gate_state = 'PASS'
        AND rta.qa->>'purpose' = 'FULL_ROUTE_QA'
        AND t.recorded_execution = true
        AND t.provenance_class IN ('RECORDED_GPS', 'RECORDED_GPS_MERGED')`,
    [routeId]
  );
  const distinctActorCount = actors.rows.length;

  const pairCompatibility: GeometryPairCompatibility[] = [];
  for (let i = 0; i < acceptedRawTrackIds.length; i++) {
    for (let j = i + 1; j < acceptedRawTrackIds.length; j++) {
      const trackA = acceptedRawTrackIds[i];
      const trackB = acceptedRawTrackIds[j];
      const pair = await pool.query<{
        hausdorff_m: number;
        overlap_a: number;
        overlap_b: number;
        length_ratio: number;
      }>(
        `WITH lines AS (
           SELECT
             ST_Transform(a.geometry, 3857) AS a3857,
             ST_Transform(b.geometry, 3857) AS b3857
           FROM raw_track a
           CROSS JOIN raw_track b
           WHERE a.raw_track_id = $1 AND b.raw_track_id = $2
         ), metrics AS (
           SELECT
             ST_HausdorffDistance(a3857, b3857)::float8 AS hausdorff_m,
             CASE WHEN ST_Length(a3857) = 0 THEN 0 ELSE
               ST_Length(ST_Intersection(a3857, ST_Buffer(b3857, 30))) / ST_Length(a3857)
             END::float8 AS overlap_a,
             CASE WHEN ST_Length(b3857) = 0 THEN 0 ELSE
               ST_Length(ST_Intersection(b3857, ST_Buffer(a3857, 30))) / ST_Length(b3857)
             END::float8 AS overlap_b,
             CASE WHEN GREATEST(ST_Length(a3857), ST_Length(b3857)) = 0 THEN 0 ELSE
               LEAST(ST_Length(a3857), ST_Length(b3857)) /
               GREATEST(ST_Length(a3857), ST_Length(b3857))
             END::float8 AS length_ratio
           FROM lines
         )
         SELECT hausdorff_m, overlap_a, overlap_b, length_ratio FROM metrics`,
        [trackA, trackB]
      );
      const row = pair.rows[0];
      if (!row) throw new Error(`Unable to compare RawTracks ${trackA} and ${trackB}`);
      const overlapWithin30m = Math.min(Number(row.overlap_a), Number(row.overlap_b));
      const hausdorffMeters = Number(row.hausdorff_m);
      const lengthRatio = Number(row.length_ratio);
      const compatible =
        hausdorffMeters <= thresholds.maxPairHausdorffMeters &&
        overlapWithin30m >= thresholds.minPairOverlapWithin30m &&
        lengthRatio >= thresholds.minPairLengthRatio;
      pairCompatibility.push({
        trackA,
        trackB,
        hausdorffMeters,
        overlapWithin30m,
        lengthRatio,
        compatible
      });
    }
  }

  const reasonCodes: string[] = [];
  let state: GeometryConsensusReadinessState;

  if (independentExecutionCount < thresholds.minIndependentExecutions) {
    state = 'INSUFFICIENT_EVIDENCE';
    reasonCodes.push(
      `INDEPENDENT_EXECUTIONS_${independentExecutionCount}_OF_${thresholds.minIndependentExecutions}`
    );
  } else if (mode === 'FIRST_PARTY_PUBLIC' && distinctActorCount < thresholds.minDistinctActors) {
    state = 'INSUFFICIENT_INDEPENDENT_ACTORS';
    reasonCodes.push(`DISTINCT_ACTORS_${distinctActorCount}_OF_${thresholds.minDistinctActors}`);
  } else if (pairCompatibility.some(pair => !pair.compatible)) {
    state = 'INCOMPATIBLE_CLUSTER';
    reasonCodes.push('PAIRWISE_GEOMETRY_COMPATIBILITY_FAILED');
  } else {
    state = 'READY_FOR_EDITORIAL_CANONICALIZATION';
    reasonCodes.push('CONSENSUS_THRESHOLDS_SATISFIED_REVIEW_REQUIRED');
  }

  return {
    routeId,
    mode,
    state,
    independentExecutionCount,
    distinctActorCount,
    acceptedRawTrackIds,
    pairCompatibility,
    thresholds,
    reasonCodes,
    editorialActionRequired: true,
    autoPromoted: false,
    evaluatedAt: new Date().toISOString()
  };
}
