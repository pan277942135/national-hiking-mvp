/**
 * Eligibility Service for National Hiking Backend MVP.
 * Coordinates hard-gate checks without mutating canonical Route truth.
 */

import { Repositories } from '../repository/repositories.js';
import { evaluateHardGate } from '../domain/hard_gate.js';
import { PublicationGateResult, Route, Area, Rule } from '../domain/types.js';

export interface RouteEligibilityQuery {
  routeId: string;
  userHasPositiveAuth?: boolean;
  evaluationTime?: Date;
}

function dedupeRules(rules: Rule[]): Rule[] {
  const byId = new Map<string, Rule>();
  for (const rule of rules) byId.set(rule.id, rule);
  return [...byId.values()];
}

export async function evaluateRouteEligibility(
  repos: Repositories,
  query: RouteEligibilityQuery
): Promise<{
  route: Route;
  area: Area;
  gateResult: PublicationGateResult;
}> {
  const route = await repos.routes.findById(query.routeId);
  if (!route) throw new Error(`Route not found: ${query.routeId}`);

  const family = await repos.routeFamilies.findById(route.family_id);
  if (!family) throw new Error(`RouteFamily not found for route ${route.id}`);

  const area = await repos.areas.findById(family.area_id);
  if (!area) throw new Error(`Area not found for route family ${family.id}`);

  const assignments = await repos.assignments.findByRouteId(route.id);
  const tracks = await repos.rawTracks.listAll();
  const areaRules = await repos.rules.findByAreaId(area.id);
  const routeRules = await repos.rules.findByRouteId(route.id);
  const allRules = dedupeRules([...areaRules, ...routeRules]);
  const legalScopes = await repos.legalScopes.findByAreaId(area.id);
  const latestSnapshot = (await repos.runtimeSnapshots.findLatestForRoute(route.id)) ||
                         (await repos.runtimeSnapshots.findLatestForArea(area.id)) ||
                         undefined;

  const gateResult = evaluateHardGate({
    area,
    route,
    assignments,
    tracks,
    rules: allRules,
    legalScopes,
    latestSnapshot,
    userHasPositiveAuth: query.userHasPositiveAuth,
    currentTime: query.evaluationTime
  });

  // Gate results are derived audit history only; canonical Route is untouched.
  await repos.gateResults.save(gateResult);

  return { route, area, gateResult };
}
