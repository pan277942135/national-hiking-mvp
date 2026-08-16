import crypto from 'node:crypto';
import type { Pool } from 'pg';

export interface RecordFirstPartyActivityInput {
  actorHash: string;
  rawTrackId: string;
  recordedAt: string;
  routeId?: string;
  assignmentState?: 'TARGET_ACCEPTED' | 'TARGET_REJECTED' | 'SIBLING_ACCEPTED' | 'CONTROL_ONLY';
  /**
   * Optional assertion from the caller. Route-linked Activity truth is derived
   * from raw_track_route_assignment; a conflicting value is rejected.
   */
  geometryGateState?: string;
  integrityState?: 'PASS' | 'REVIEW' | 'REJECT';
  deviceClass?: string;
  gpsAccuracyMedianM?: number;
  gpsAccuracyP90M?: number;
  metadata?: Record<string, unknown>;
}

export interface RecordFirstPartyActivityResult {
  activityId: string;
  rawTrackId: string;
  routeId?: string;
  assignmentState?: string;
  geometryGateState?: string;
  actorHash: string;
  created: boolean;
}

function assertActorHash(actorHash: string): void {
  if (!actorHash || actorHash.length < 16) {
    throw new Error('actorHash must be a stable privacy-preserving hash, not a raw user identifier');
  }
}

export function hashActorId(rawActorId: string, salt: string): string {
  if (!rawActorId || !salt) throw new Error('rawActorId and salt are required');
  return crypto.createHmac('sha256', salt).update(rawActorId).digest('hex');
}

export async function recordFirstPartyActivity(
  pool: Pool,
  input: RecordFirstPartyActivityInput
): Promise<RecordFirstPartyActivityResult> {
  assertActorHash(input.actorHash);
  const recordedAt = new Date(input.recordedAt);
  if (Number.isNaN(recordedAt.getTime())) throw new Error('recordedAt must be a valid timestamp');

  const rawTrack = await pool.query<{
    provenance_class: string;
    recorded_execution: boolean;
  }>(
    `SELECT provenance_class, recorded_execution
       FROM raw_track WHERE raw_track_id = $1`,
    [input.rawTrackId]
  );
  const track = rawTrack.rows[0];
  if (!track) throw new Error(`RawTrack not found: ${input.rawTrackId}`);
  if (!track.recorded_execution || !['RECORDED_GPS', 'RECORDED_GPS_MERGED'].includes(track.provenance_class)) {
    throw new Error('First-party Activity requires a recorded execution RawTrack');
  }

  let derivedAssignmentState: RecordFirstPartyActivityInput['assignmentState'];
  let derivedGeometryGateState: string | undefined;

  if (input.routeId) {
    const route = await pool.query(`SELECT route_id FROM route WHERE route_id = $1`, [input.routeId]);
    if (!route.rows[0]) throw new Error(`Route not found: ${input.routeId}`);
    if (!input.assignmentState) {
      throw new Error('routeId requires assignmentState');
    }

    const rawAssignment = await pool.query<{
      assignment_state: RecordFirstPartyActivityInput['assignmentState'] | 'UNCLASSIFIED';
      geometry_gate_state: string;
    }>(
      `SELECT assignment_state, geometry_gate_state
         FROM raw_track_route_assignment
        WHERE raw_track_id = $1 AND route_id = $2`,
      [input.rawTrackId, input.routeId]
    );
    const gateTruth = rawAssignment.rows[0];
    if (!gateTruth) {
      throw new Error(
        'Route-linked First-party Activity requires a prior RawTrack geometry-gate assignment for the same route'
      );
    }
    if (gateTruth.assignment_state === 'UNCLASSIFIED' || gateTruth.assignment_state !== input.assignmentState) {
      throw new Error(
        `Activity assignment ${input.assignmentState} conflicts with RawTrack gate truth ${gateTruth.assignment_state}`
      );
    }
    if (
      input.assignmentState === 'TARGET_ACCEPTED' &&
      (gateTruth.assignment_state !== 'TARGET_ACCEPTED' || gateTruth.geometry_gate_state !== 'PASS')
    ) {
      throw new Error(
        'First-party TARGET_ACCEPTED requires a prior spatial RawTrack TARGET_ACCEPTED/PASS assignment'
      );
    }
    if (input.geometryGateState && input.geometryGateState !== gateTruth.geometry_gate_state) {
      throw new Error(
        `Caller geometryGateState ${input.geometryGateState} conflicts with persisted RawTrack gate ${gateTruth.geometry_gate_state}`
      );
    }

    derivedAssignmentState = input.assignmentState;
    derivedGeometryGateState = gateTruth.geometry_gate_state;
  } else if (input.assignmentState || input.geometryGateState) {
    throw new Error('assignmentState/geometryGateState require routeId');
  }

  const naturalKey = `${input.actorHash}:${input.rawTrackId}:${recordedAt.toISOString()}`;
  const activityId = `ACT-${crypto.createHash('sha256').update(naturalKey).digest('hex').slice(0, 20).toUpperCase()}`;

  const existing = await pool.query(`SELECT activity_id FROM activity WHERE activity_id = $1`, [activityId]);
  if (!existing.rows[0]) {
    await pool.query(
      `INSERT INTO activity (
         activity_id, actor_hash, raw_track_id, source, recorded_at,
         device_class, gps_accuracy_median_m, gps_accuracy_p90_m,
         integrity_state, metadata
       ) VALUES ($1, $2, $3, 'FIRST_PARTY_ACTIVITY', $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        activityId,
        input.actorHash,
        input.rawTrackId,
        recordedAt.toISOString(),
        input.deviceClass ?? null,
        input.gpsAccuracyMedianM ?? null,
        input.gpsAccuracyP90M ?? null,
        input.integrityState ?? 'PASS',
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }

  if (input.routeId && derivedAssignmentState && derivedGeometryGateState) {
    await pool.query(
      `INSERT INTO activity_route_assignment (
         activity_id, route_id, assignment_state, geometry_gate_state, qa
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (activity_id, route_id) DO UPDATE SET
         assignment_state = EXCLUDED.assignment_state,
         geometry_gate_state = EXCLUDED.geometry_gate_state,
         qa = EXCLUDED.qa,
         assigned_at = now()`,
      [
        activityId,
        input.routeId,
        derivedAssignmentState,
        derivedGeometryGateState,
        JSON.stringify({
          source_raw_track_id: input.rawTrackId,
          assignment_derived_from_raw_track_gate: true
        })
      ]
    );
  }

  return {
    activityId,
    rawTrackId: input.rawTrackId,
    routeId: input.routeId,
    assignmentState: derivedAssignmentState,
    geometryGateState: derivedGeometryGateState,
    actorHash: input.actorHash,
    created: !existing.rows[0]
  };
}
