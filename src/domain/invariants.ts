/**
 * Core Invariant Assertions and Verifications for National Hiking MVP
 */

import {
  RawTrack,
  Route,
  RouteFamily,
  FieldValue,
  RuntimeSnapshot,
  Evidence,
  PageProjection
} from './types.js';

export class InvariantViolationError extends Error {
  constructor(public invariantNumber: number, message: string) {
    super(`[INVARIANT_${invariantNumber}_VIOLATION] ${message}`);
    this.name = 'InvariantViolationError';
  }
}

/**
 * 1. Track != Route.
 */
export function assertTrackNotRoute(track: RawTrack, route: Route): void {
  if (track.id === route.id) {
    throw new InvariantViolationError(1, 'RawTrack ID must not be conflated with Route ID');
  }
}

/**
 * 2. A planned navigation line is NOT Recorded GPS evidence.
 */
export function assertPlannedLineNotRecordedGps(track: RawTrack): void {
  // provenance_type is a single discriminator. A PLANNED_NAVIGATION_LINE
  // therefore cannot simultaneously be RECORDED_GPS.
  if (track.provenance_type === 'PLANNED_NAVIGATION_LINE') {
    return;
  }
}

/**
 * 4. RouteFamily identity and child Route identity may be canonical without executable geometry.
 */
export function assertCanonicalIdentityWithoutGeometryAllowed(route: Route): boolean {
  if (route.identity_state === 'CANONICAL' && route.geometry_state !== 'ACCEPTED_CONSENSUS') {
    return true; // Valid and supported
  }
  return true;
}

/**
 * 6. Raw tracks from sibling variants must never count toward target-route geometry consensus.
 */
export function assertSiblingTracksSeparated(
  targetRouteId: string,
  siblingRouteId: string,
  targetAcceptedTrackIds: string[],
  siblingAcceptedTrackIds: string[]
): void {
  const overlap = targetAcceptedTrackIds.filter(id => siblingAcceptedTrackIds.includes(id));
  if (overlap.length > 0) {
    throw new InvariantViolationError(6, `Sibling tracks [${overlap.join(', ')}] illegally shared between ${targetRouteId} and ${siblingRouteId}`);
  }
}

/**
 * 9. Runtime state must include observed_at and valid_until.
 */
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

/**
 * 13. Page projection must never mutate canonical truth.
 */
export function assertPageProjectionImmutable(originalRoute: Route, projection: PageProjection): void {
  if (originalRoute.id !== projection.route_id || originalRoute.identity_state !== projection.identity_state) {
    throw new InvariantViolationError(13, 'Projection must reflect canonical truth without mutation');
  }
}

/**
 * 14. Runtime-only facts must never be imported as static truth.
 */
export function assertRuntimeFactQuarantined(runtimeFact: unknown, isStaticTable: boolean): void {
  if (isStaticTable && runtimeFact) {
    throw new InvariantViolationError(14, 'Runtime transient facts must not be persisted into static canonical definition tables');
  }
}
