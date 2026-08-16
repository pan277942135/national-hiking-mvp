import type { Pool } from 'pg';

export interface GeometryGateAnchor {
  anchorId: string;
  label: string;
  longitude: number;
  latitude: number;
  strongMaxMeters?: number;
  nearMaxMeters?: number;
}

export interface GeometryGateProfile {
  profileId: string;
  routeId: string;
  profileVersion: number;
  purpose: 'CORE_QA' | 'FULL_ROUTE_QA';
  anchors: GeometryGateAnchor[];
  requireDirection?: 'FORWARD' | 'REVERSE' | 'EITHER';
  /**
   * Distance class required for this profile to pass spatial QA.
   * TARGET_ACCEPTED is additionally restricted to FULL_ROUTE_QA profiles.
   */
  acceptanceClass?: 'STRONG' | 'NEAR';
}

export type AnchorHitClass = 'STRONG' | 'NEAR' | 'MISS';

export interface GeometryGateAnchorResult {
  anchorId: string;
  label: string;
  distanceMeters: number;
  lineFraction: number;
  hitClass: AnchorHitClass;
}

export type GeometryGateAssignmentState =
  | 'TARGET_ACCEPTED'
  | 'TARGET_REJECTED'
  | 'CONTROL_ONLY'
  | 'UNCLASSIFIED';

export interface GeometryGateResult {
  profileId: string;
  profileVersion: number;
  profilePurpose: GeometryGateProfile['purpose'];
  routeId: string;
  rawTrackId: string;
  provenanceClass: string;
  recordedExecution: boolean;
  gateState: 'PASS' | 'FAIL' | 'CONTROL_ONLY' | 'UNCLASSIFIED';
  assignmentState: GeometryGateAssignmentState;
  directionClass: 'FORWARD' | 'REVERSE' | 'NON_MONOTONIC' | 'UNKNOWN';
  anchors: GeometryGateAnchorResult[];
  reasonCodes: string[];
  evaluatedAt: string;
}

/**
 * Historical S12 core anchors. This profile validates only the A01→A03 core
 * corridor. It is intentionally CORE_QA, so even a perfect spatial pass can
 * never become TARGET_ACCEPTED for the full S12-A child route.
 */
export const S12_CORE_QA_PROFILE_V1: GeometryGateProfile = {
  profileId: 'ZJ-S12-A-CORE-QA-V1',
  routeId: 'ZJ-S12-A',
  profileVersion: 1,
  purpose: 'CORE_QA',
  requireDirection: 'FORWARD',
  acceptanceClass: 'STRONG',
  anchors: [
    {
      anchorId: 'A01',
      label: '陵园新村邮局旧址',
      latitude: 32.04416944444444,
      longitude: 118.8515861111111,
      strongMaxMeters: 120,
      nearMaxMeters: 250
    },
    {
      anchorId: 'A02',
      label: '南京地震科学馆',
      latitude: 32.05183,
      longitude: 118.85542,
      strongMaxMeters: 120,
      nearMaxMeters: 250
    },
    {
      anchorId: 'A03',
      label: '流徽榭',
      latitude: 32.0555861,
      longitude: 118.8542,
      strongMaxMeters: 120,
      nearMaxMeters: 250
    }
  ]
};

function classifyAnchor(distanceMeters: number, anchor: GeometryGateAnchor): AnchorHitClass {
  const strong = anchor.strongMaxMeters ?? 120;
  const near = anchor.nearMaxMeters ?? 250;
  if (distanceMeters <= strong) return 'STRONG';
  if (distanceMeters <= near) return 'NEAR';
  return 'MISS';
}

function directionFromFractions(fractions: number[]): GeometryGateResult['directionClass'] {
  if (fractions.length < 2) return 'UNKNOWN';
  const forward = fractions.every((v, i) => i === 0 || v > fractions[i - 1]);
  if (forward) return 'FORWARD';
  const reverse = fractions.every((v, i) => i === 0 || v < fractions[i - 1]);
  if (reverse) return 'REVERSE';
  return 'NON_MONOTONIC';
}

function profileAcceptsDirection(
  required: GeometryGateProfile['requireDirection'],
  actual: GeometryGateResult['directionClass']
): boolean {
  if (!required || required === 'EITHER') return actual === 'FORWARD' || actual === 'REVERSE';
  return required === actual;
}

function classAccepted(hit: AnchorHitClass, acceptance: 'STRONG' | 'NEAR'): boolean {
  if (acceptance === 'STRONG') return hit === 'STRONG';
  return hit === 'STRONG' || hit === 'NEAR';
}

/**
 * Spatial QA only. It never constructs route geometry and never mutates Route.
 * Distances and anchor order are evaluated against the persisted RawTrack line
 * using PostGIS; no route names, POI stitching, or popularity signals are used.
 */
export async function evaluateRawTrackGeometryGate(
  pool: Pool,
  rawTrackId: string,
  profile: GeometryGateProfile
): Promise<GeometryGateResult> {
  if (profile.anchors.length === 0) throw new Error('GeometryGateProfile requires at least one anchor');

  const trackResult = await pool.query<{
    provenance_class: string;
    recorded_execution: boolean;
  }>(
    `SELECT provenance_class, recorded_execution
       FROM raw_track
      WHERE raw_track_id = $1`,
    [rawTrackId]
  );
  const track = trackResult.rows[0];
  if (!track) throw new Error(`RawTrack not found: ${rawTrackId}`);

  const anchorResults: GeometryGateAnchorResult[] = [];
  for (const anchor of profile.anchors) {
    const spatial = await pool.query<{ distance_m: number; line_fraction: number }>(
      `SELECT
         ST_DistanceSphere(
           geometry,
           ST_SetSRID(ST_MakePoint($2, $3), 4326)
         )::float8 AS distance_m,
         ST_LineLocatePoint(
           geometry,
           ST_SetSRID(ST_MakePoint($2, $3), 4326)
         )::float8 AS line_fraction
       FROM raw_track
       WHERE raw_track_id = $1`,
      [rawTrackId, anchor.longitude, anchor.latitude]
    );
    const row = spatial.rows[0];
    if (!row) throw new Error(`RawTrack geometry missing: ${rawTrackId}`);
    const distanceMeters = Number(row.distance_m);
    const lineFraction = Number(row.line_fraction);
    anchorResults.push({
      anchorId: anchor.anchorId,
      label: anchor.label,
      distanceMeters,
      lineFraction,
      hitClass: classifyAnchor(distanceMeters, anchor)
    });
  }

  const directionClass = directionFromFractions(anchorResults.map(a => a.lineFraction));
  const reasonCodes: string[] = [];
  const acceptance = profile.acceptanceClass ?? 'STRONG';
  const allAnchorsAccepted = anchorResults.every(a => classAccepted(a.hitClass, acceptance));
  const directionAccepted = profileAcceptsDirection(profile.requireDirection, directionClass);

  if (!allAnchorsAccepted) {
    for (const anchor of anchorResults.filter(a => !classAccepted(a.hitClass, acceptance))) {
      reasonCodes.push(`ANCHOR_${anchor.anchorId}_${anchor.hitClass}`);
    }
  }
  if (!directionAccepted) reasonCodes.push(`DIRECTION_${directionClass}`);

  let gateState: GeometryGateResult['gateState'];
  let assignmentState: GeometryGateAssignmentState;

  if (track.provenance_class === 'PLANNED_NAVIGATION_LINE') {
    gateState = 'CONTROL_ONLY';
    assignmentState = 'CONTROL_ONLY';
    reasonCodes.push('PLANNED_NAVIGATION_LINE_CONTROL_ONLY');
  } else if (
    !track.recorded_execution ||
    !['RECORDED_GPS', 'RECORDED_GPS_MERGED'].includes(track.provenance_class)
  ) {
    gateState = 'UNCLASSIFIED';
    assignmentState = 'UNCLASSIFIED';
    reasonCodes.push('NOT_RECORDED_EXECUTION');
  } else if (allAnchorsAccepted && directionAccepted && profile.purpose === 'FULL_ROUTE_QA') {
    gateState = 'PASS';
    assignmentState = 'TARGET_ACCEPTED';
    reasonCodes.push('FULL_ROUTE_SPATIAL_PROFILE_PASS');
  } else if (allAnchorsAccepted && directionAccepted && profile.purpose === 'CORE_QA') {
    gateState = 'PASS';
    assignmentState = 'UNCLASSIFIED';
    reasonCodes.push('CORE_QA_PASS_NOT_FULL_ROUTE_ACCEPTANCE');
  } else {
    gateState = 'FAIL';
    assignmentState = profile.purpose === 'FULL_ROUTE_QA' ? 'TARGET_REJECTED' : 'UNCLASSIFIED';
    reasonCodes.push(
      profile.purpose === 'FULL_ROUTE_QA' ? 'FULL_ROUTE_SPATIAL_PROFILE_FAIL' : 'CORE_QA_FAIL_DIAGNOSTIC_ONLY'
    );
  }

  return {
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    profilePurpose: profile.purpose,
    routeId: profile.routeId,
    rawTrackId,
    provenanceClass: track.provenance_class,
    recordedExecution: track.recorded_execution,
    gateState,
    assignmentState,
    directionClass,
    anchors: anchorResults,
    reasonCodes,
    evaluatedAt: new Date().toISOString()
  };
}

/**
 * The only public helper that may derive TARGET_ACCEPTED from spatial QA.
 * Assignment state is computed from the gate result, never accepted from the caller.
 */
export async function evaluateAndAssignCanonicalRawTrack(
  pool: Pool,
  input: {
    rawTrackId: string;
    routeId: string;
    profile: GeometryGateProfile;
    independentProvenanceKey?: string;
  }
): Promise<GeometryGateResult> {
  if (input.profile.routeId !== input.routeId) {
    throw new Error(
      `GeometryGateProfile ${input.profile.profileId} belongs to ${input.profile.routeId}, not ${input.routeId}`
    );
  }

  const route = await pool.query(`SELECT route_id FROM route WHERE route_id = $1`, [input.routeId]);
  if (!route.rows[0]) throw new Error(`Route not found: ${input.routeId}`);

  const result = await evaluateRawTrackGeometryGate(pool, input.rawTrackId, input.profile);
  await pool.query(
    `INSERT INTO raw_track_route_assignment (
       raw_track_id, route_id, assignment_state, geometry_gate_state,
       direction_class, independent_provenance_key, qa
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (raw_track_id, route_id) DO UPDATE SET
       assignment_state = EXCLUDED.assignment_state,
       geometry_gate_state = EXCLUDED.geometry_gate_state,
       direction_class = EXCLUDED.direction_class,
       independent_provenance_key = EXCLUDED.independent_provenance_key,
       qa = EXCLUDED.qa,
       assigned_at = now()`,
    [
      input.rawTrackId,
      input.routeId,
      result.assignmentState,
      result.gateState,
      result.directionClass,
      input.independentProvenanceKey ?? null,
      JSON.stringify({
        geometry_gate_profile_id: result.profileId,
        geometry_gate_profile_version: result.profileVersion,
        purpose: result.profilePurpose,
        reason_codes: result.reasonCodes,
        anchors: result.anchors,
        evaluated_at: result.evaluatedAt
      })
    ]
  );
  return result;
}
