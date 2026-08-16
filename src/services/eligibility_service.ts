/**
 * Eligibility Service for National Hiking Backend MVP
 * Coordinates hard gate checks for Route candidates and generates publication determinations.
 */

import { Repositories } from '../repository/repositories.js';
import { evaluateHardGate } from '../domain/hard_gate.js';
import { PublicationGateResult, Route, Area } from '../domain/types.js';

export interface RouteEligibilityQuery {
  routeId: string;
  userHasPositiveAuth?: boolean;
  evaluationTime?: Date;
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
  if (!route) {
    throw new Error(`Route not found: ${query.routeId}`);
  }

  const family = await repos.routeFamilies.findById(route.family_id);
  if (!family) {
    throw new Error(`RouteFamily not found for route ${route.id}`);
  }

  const area = await repos.areas.findById(family.area_id);
  if (!area) {
    throw new Error(`Area not found for route family ${family.id}`);
  }

  const assignments = await repos.assignments.findByRouteId(route.id);
  const tracks = await repos.rawTracks.listAll();
  const rules = await repos.rules.findByAreaId(area.id);
  const routeRules = await repos.rules.findByRouteId(route.id);
  const allRules = [...rules, ...routeRules];
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

  // Save the evaluation history without mutating the canonical Route definition
  await repos.gateResults.save(gateResult);

  return {
    route,
    area,
    gateResult
  };
}
