/**
 * Core invariant assertions for the National Hiking MVP.
 *
 * These checks protect canonical semantics. Adapter/display labels must never
 * weaken the persisted domain contract.
 */

import {
  RawTrack,
  Route,
  RuntimeSnapshot,
  PageProjection,
  RawTrackRouteAssignment
} from './types.js';

export class InvariantViolationError extends Error {
  constructor(public invariantNumber: number, message: string) {
    super(`[INVARIANT_${invariantNumber}_VIOLATION] ${message}`);
    this.name = 'InvariantViolationError';
  }
}

/** 1. Track != Route. */
export function assertTrackNotRoute(track: RawTrack, route: Route): void {
  if (track.id === route.id) {
    throw new InvariantViolationError(1, 'RawTrack ID must not be conflated with Route ID');
  }
}

/**
 * 2. A planned navigation line is never Recorded GPS execution evidence.
 */
export function assertPlannedLineNotRecordedGps(track: RawTrack): void {
  const recordedExecution = track.recorded_execution;
  if (track.provenance_type === 'PLANNED_NAVIGATION_LINE' && recordedExecution === true) {
    throw new InvariantViolationError(
      2,
      'PLANNED_NAVIGATION_LINE cannot contribute Recorded GPS execution evidence'
    );
  }
}

/** 6. Sibling variants must never share accepted evidence into target consensus. */
export function assertSiblingTracksSeparated(
  targetRouteId: string,
  siblingRouteId: string,
  targetAcceptedTrackIds: string[],
  siblingAcceptedTrackIds: string[]
): void {
  const overlap = targetAcceptedTrackIds.filter(id => siblingAcceptedTrackIds.includes(id));
  if (overlap.length > 0) {
    throw new InvariantViolationError(
      6,
      `Sibling tracks [${overlap.join(', ')}] illegally shared between ${targetRouteId} and ${siblingRouteId}`
    );
  }
}

/**
 * 7. Public child-route geometry consensus defaults to >=2 independent
 * TARGET_ACCEPTED recorded executions for the same child route.
 */
export function countIndependentTargetRecordedExecutions(
  routeId: string,
  assignments: RawTrackRouteAssignment[],
  tracks: RawTrack[]
): number {
  const keys = new Set<string>();

  for (const assignment of assignments) {
    if (assignment.route_id !== routeId) continue;

    const state = assignment.assignment_state;
    const accepted = state ? state === 'TARGET_ACCEPTED' : assignment.match_status === 'ACCEPTED';
    if (!accepted) continue;

    const track = tracks.find(t => t.id === assignment.track_id);
    if (!track) continue;
    if (!['RECORDED_GPS', 'RECORDED_GPS_MERGED'].includes(track.provenance_type)) continue;
    if (track.recorded_execution === false) continue;

    keys.add(assignment.independent_provenance_key || track.id);
  }

  return keys.size;
}

/** 9. Runtime state must include a valid observed_at / valid_until interval. */
export function assertRuntimeSnapshotValidity(snapshot: RuntimeSnapshot): void {
  if (!snapshot.observed_at || !snapshot.valid_until) {
    throw new InvariantViolationError(9, 'Runtime snapshot must include both observed_at and valid_until');
  }
  const observed = new Date(snapshot.observed_at).getTime();
  const validUntil = new Date(snapshot.valid_until).getTime();
  if (isNaN(observed) || isNaN(validUntil) || validUntil < observed) {
    throw new InvariantViolationError(9, 'valid_until must be greater than or equal to observed_at');
  }
}

/** 13. Page projection is read-only with respect to canonical truth. */
export function assertPageProjectionImmutable(originalRoute: Route, projection: PageProjection): void {
  if (originalRoute.id !== projection.route_id || originalRoute.identity_state !== projection.identity_state) {
    throw new InvariantViolationError(13, 'Projection must reflect canonical truth without mutation');
  }
}

/** 14. Runtime-only facts must not be imported as static canonical truth. */
export function assertRuntimeFactQuarantined(runtimeFact: unknown, isStaticTable: boolean): void {
  if (isStaticTable && runtimeFact) {
    throw new InvariantViolationError(14, 'Runtime transient facts must not be persisted into static canonical definition tables');
  }
}
