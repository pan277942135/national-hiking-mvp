/**
 * Page Projection Service for National Hiking Backend MVP
 * Invariant 13: Page projection must NEVER mutate canonical truth.
 */

import crypto from 'node:crypto';
import { Repositories } from '../repository/repositories.js';
import { evaluateRouteEligibility } from './eligibility_service.js';
import { PageProjection } from '../domain/types.js';
import { assertPageProjectionImmutable } from '../domain/invariants.js';

export async function projectRoutePage(
  repos: Repositories,
  routeId: string,
  userHasPositiveAuth?: boolean
): Promise<PageProjection> {
  const { route, area, gateResult } = await evaluateRouteEligibility(repos, {
    routeId,
    userHasPositiveAuth
  });

  const family = await repos.routeFamilies.findById(route.family_id);
  const snapshot = await repos.runtimeSnapshots.findLatestForRoute(route.id);

  let freshnessStatus: 'FRESH' | 'STALE' | 'UNKNOWN' = 'UNKNOWN';
  if (snapshot) {
    freshnessStatus = new Date(snapshot.valid_until) >= new Date() ? 'FRESH' : 'STALE';
  }

  const hashPayload = `${route.id}:${route.variant_code}:${route.geometry_state}:${gateResult.gate_status}:${gateResult.navigation_executable}`;
  const readOnlyHash = crypto.createHash('sha256').update(hashPayload).digest('hex').substring(0, 16);

  const projection: PageProjection = {
    route_id: route.id,
    area_id: area.id,
    family_id: family ? family.id : '',
    canonical_name: route.name,
    family_name: family ? family.name : '',
    area_name: area.name,
    variant_code: route.variant_code,
    identity_state: route.identity_state,
    geometry_state: route.geometry_state,
    gate_status: gateResult.gate_status,
    navigation_allowed: gateResult.navigation_executable,
    distance_meters: route.distance_meters,
    elevation_gain_meters: route.elevation_gain_meters,
    estimated_duration_minutes: route.estimated_duration_minutes,
    reasons: gateResult.reasons,
    advisories: gateResult.advisories,
    runtime_freshness_status: freshnessStatus,
    latest_snapshot: snapshot ? (snapshot as any) : undefined,
    read_only_hash: readOnlyHash,
    projected_at: new Date().toISOString()
  };

  // Verify Invariant 13: Page projection must never mutate canonical truth
  assertPageProjectionImmutable(route, projection);

  await repos.pageProjections.save(projection);
  return projection;
}
