import type { Pool, PoolClient } from 'pg';

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
  /**
   * Maximum number of actor/execution pairs where neither actor nor independent
   * execution key is reused. FIRST_PARTY_PUBLIC gates on this value, not merely
   * on aggregate actor count.
   */
  independentActorExecutionPairCount: number;
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

type ConsensusQueryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

interface ActorExecutionEvidence {
  actor_hash: string;
  raw_track_id: string;
  independence_key: string;
}

/**
 * Maximum bipartite matching between actor hashes and independent execution
 * keys. This prevents two actors attached to the same RawTrack/execution from
 * masquerading as two independent public executions, while still allowing a
 * repeated actor to support multiple days without increasing the public count.
 */
function maximumIndependentActorExecutionPairs(rows: ActorExecutionEvidence[]): number {
  const actorToExecutions = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = actorToExecutions.get(row.actor_hash) ?? new Set<string>();
    set.add(row.independence_key);
    actorToExecutions.set(row.actor_hash, set);
  }

  const executionToActor = new Map<string, string>();
  const actors = [...actorToExecutions.keys()].sort();

  const tryAssign = (actor: string, visitedExecutions: Set<string>): boolean => {
    const executions = [...(actorToExecutions.get(actor) ?? [])].sort();
    for (const execution of executions) {
      if (visitedExecutions.has(execution)) continue;
      visitedExecutions.add(execution);
      const currentActor = executionToActor.get(execution);
      if (!currentActor || tryAssign(currentActor, visitedExecutions)) {
        executionToActor.set(execution, actor);
        return true;
      }
    }
    return false;
  };

  let matches = 0;
  for (const actor of actors) {
    if (tryAssign(actor, new Set<string>())) matches += 1;
  }
  return matches;
}

/**
 * Evaluates whether already FULL_ROUTE_QA-gated child-route evidence is ready
 * for an editor to consider canonicalization. It does NOT create CanonicalTrack,
 * mutate Route, or infer legality/open status.
 *
 * Accepting a PoolClient allows the exact same readiness contract to be
 * re-evaluated inside a SERIALIZABLE editorial activation transaction.
 *
 * The pairwise 30m overlap and Hausdorff calculation uses EPSG:3857 as an MVP
 * local-distance approximation; it is a readiness diagnostic, not canonical
 * route length/elevation computation. The thresholds remain explicit/configurable.
 */
export async function evaluateGeometryConsensusReadiness(
  pool: ConsensusQueryable,
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

  const actorEvidence = await pool.query<ActorExecutionEvidence>(
    `SELECT DISTINCT
            act.actor_hash,
            act.raw_track_id,
            COALESCE(rta.independent_provenance_key, rta.raw_track_id) AS independence_key
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
        AND t.provenance_class IN ('RECORDED_GPS', 'RECORDED_GPS_MERGED')
      ORDER BY act.actor_hash, independence_key`,
    [routeId]
  );
  const distinctActorCount = new Set(actorEvidence.rows.map(row => row.actor_hash)).size;
  const independentActorExecutionPairCount = maximumIndependentActorExecutionPairs(actorEvidence.rows);

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
  } else if (
    mode === 'FIRST_PARTY_PUBLIC' &&
    independentActorExecutionPairCount < thresholds.minDistinctActors
  ) {
    state = 'INSUFFICIENT_INDEPENDENT_ACTORS';
    reasonCodes.push(
      `INDEPENDENT_ACTOR_EXECUTION_PAIRS_${independentActorExecutionPairCount}_OF_${thresholds.minDistinctActors}`
    );
    reasonCodes.push(`DISTINCT_ACTORS_OBSERVED_${distinctActorCount}`);
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
    independentActorExecutionPairCount,
    acceptedRawTrackIds,
    pairCompatibility,
    thresholds,
    reasonCodes,
    editorialActionRequired: true,
    autoPromoted: false,
    evaluatedAt: new Date().toISOString()
  };
}
