/**
 * Page Projection Service for National Hiking Backend MVP
 * Invariant 13: Page projection must NEVER mutate canonical truth.
 *
 * Geometry-derived display fields are published only when child-route geometry
 * has accepted consensus. Canonical identity may still publish independently.
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

  const geometryMetricsPublishable =
    route.geometry_state === 'ACCEPTED_CONSENSUS' &&
    gateResult.geometry_consensus_valid;

  const hashPayload = `${route.id}:${route.variant_code}:${route.geometry_state}:${gateResult.gate_status}:${gateResult.navigation_executable}:${geometryMetricsPublishable}`;
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
    // Distance/elevation/duration derived from unapproved geometry must never be
    // projected as route facts. Identity and semantic content remain publishable.
    distance_meters: geometryMetricsPublishable ? route.distance_meters : undefined,
    elevation_gain_meters: geometryMetricsPublishable ? route.elevation_gain_meters : undefined,
    estimated_duration_minutes: geometryMetricsPublishable ? route.estimated_duration_minutes : undefined,
    reasons: gateResult.reasons,
    advisories: gateResult.advisories,
    runtime_freshness_status: freshnessStatus,
    latest_snapshot: snapshot ? (snapshot as unknown as Record<string, unknown>) : undefined,
    read_only_hash: readOnlyHash,
    projected_at: new Date().toISOString()
  };

  assertPageProjectionImmutable(route, projection);

  await repos.pageProjections.save(projection);
  return projection;
}
