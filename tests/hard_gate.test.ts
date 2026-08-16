/**
 * Hard Gate & Domain Invariant Regression Tests
 * National Hiking Backend MVP
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepositories } from '../src/repository/repositories.js';
import { loadSeedManifest } from '../seed/seed_loader.js';
import { evaluateRouteEligibility } from '../src/services/eligibility_service.js';
import { processTrackUpload } from '../src/services/track_service.js';
import { projectRoutePage } from '../src/services/page_projection_service.js';
import { loadAndValidateMigrations } from '../src/migration_runner.js';
import {
  assertTrackNotRoute,
  assertSiblingTracksSeparated,
  assertPageProjectionImmutable,
  assertRuntimeSnapshotValidity
} from '../src/domain/invariants.js';

test('Migration Suite: Validates 0001 through 0010 sequentially and checks invariants', () => {
  const result = loadAndValidateMigrations();
  assert.equal(result.valid, true, `Migrations must be valid: ${result.errors.join(', ')}`);
  assert.equal(result.migrationsFound.length, 10, 'Must have exactly 10 migrations');
  assert.equal(result.invariantsVerified.orderedSequentially, true);
  assert.equal(result.invariantsVerified.foreignKeysDeclared, true);
  assert.equal(result.invariantsVerified.oneCurrentFieldValueInvariant, true);
  assert.equal(result.invariantsVerified.provenanceModelsPresent, true);
  assert.equal(result.invariantsVerified.runtimeSnapshotValidityCheck, true);
});

test('Seed Idempotency: Second identical seed run produces zero mutations', async () => {
  const { repos } = createMemoryRepositories();
  const run1 = await loadSeedManifest(repos);
  assert.ok(run1.mutationsCreated > 0, 'First run should create entities');

  const run2 = await loadSeedManifest(repos);
  assert.equal(run2.mutationsCreated, 0, 'Second identical run must create 0 mutations');
  assert.equal(run2.mutationsUpdated, 0, 'Second identical run must update 0 mutations');
});

test('Zijinshan Regression State: ZJ-S12-A geometry missing => navigation disabled (GEOMETRY_BLOCKED)', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  const res = await evaluateRouteEligibility(repos, { routeId: 'route_zj_s12_a' });
  assert.equal(res.route.identity_state, 'CANONICAL');
  assert.equal(res.route.geometry_state, 'GEOMETRY_BLOCKED');
  assert.equal(res.gateResult.gate_status, 'GEOMETRY_BLOCKED');
  assert.equal(res.gateResult.navigation_executable, false);
  assert.ok(res.gateResult.reasons.some(r => r.includes('GEOMETRY_BLOCKED')));
});

test('Planned Line Invariant: KML planned line is CONTROL_ONLY and does NOT promote route', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  const kmlUpload = await processTrackUpload(repos, {
    format: 'KML',
    payload: '<kml><Placemark><LineString><coordinates>118.8,32.0 118.9,32.1</coordinates></LineString></Placemark></kml>',
    fileName: 'planned_trail.kml'
  });

  assert.equal(kmlUpload.provenanceType, 'PLANNED_NAVIGATION_LINE');

  // Verify track is distinct from Route (Invariant 1)
  const route = await repos.routes.findById('route_zj_s12_a');
  assert.ok(route);
  assertTrackNotRoute(kmlUpload.track, route);

  // Still GEOMETRY_BLOCKED
  const res = await evaluateRouteEligibility(repos, { routeId: 'route_zj_s12_a' });
  assert.equal(res.gateResult.navigation_executable, false);
});

test('Sibling Isolation: Sibling variant B (ZJ-S12-B) geometry does NOT promote target route (ZJ-S12-A)', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  const routeA = await repos.routes.findById('route_zj_s12_a');
  const routeB = await repos.routes.findById('route_zj_s12_b');
  assert.ok(routeA && routeB);

  const assignA = await repos.assignments.findByRouteId(routeA.id);
  const assignB = await repos.assignments.findByRouteId(routeB.id);

  const acceptedA = assignA.filter(a => a.match_status === 'ACCEPTED').map(a => a.track_id);
  const acceptedB = assignB.filter(a => a.match_status === 'ACCEPTED').map(a => a.track_id);

  assert.equal(acceptedA.length, 0, 'Target route A has 0 accepted GPS tracks');
  assert.ok(acceptedB.length > 0, 'Sibling route B has accepted GPS tracks');

  // Assert invariant check passes (no overlap)
  assertSiblingTracksSeparated(routeA.id, routeB.id, acceptedA, acceptedB);

  const resA = await evaluateRouteEligibility(repos, { routeId: routeA.id });
  assert.equal(resA.gateResult.gate_status, 'GEOMETRY_BLOCKED');
  assert.equal(resA.gateResult.navigation_executable, false);
});

test('Alpine Runtime Invariant: Stale runtime snapshot forces RUNTIME_DATA_REQUIRED on alpine routes', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  // Wugongshan has stale snapshot (from 2026-08-15) and evaluation is in 2026-08-16
  const res = await evaluateRouteEligibility(repos, {
    routeId: 'route_wg_alp_01',
    evaluationTime: new Date('2026-08-16T12:00:00.000Z')
  });

  assert.equal(res.gateResult.gate_status, 'RUNTIME_DATA_REQUIRED');
  assert.equal(res.gateResult.navigation_executable, false);
  assert.ok(res.gateResult.reasons.some(r => r.includes('RUNTIME_DATA_STALE')));
});

test('Protected Core Zone: Wuyishan Core Zone results in strict BLOCK', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  const res = await evaluateRouteEligibility(repos, { routeId: 'route_wy_core_01' });
  assert.equal(res.gateResult.gate_status, 'BLOCK');
  assert.equal(res.gateResult.navigation_executable, false);
  assert.ok(res.gateResult.reasons.some(r => r.includes('CORE_PROTECTED_ZONE')));
});

test('Positive Authorization Invariant: Missing permit demotes route to DISCOVERY_ONLY', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  // Without authorization
  const unauthRes = await evaluateRouteEligibility(repos, {
    routeId: 'route_wy_buffer_01',
    userHasPositiveAuth: false
  });
  assert.equal(unauthRes.gateResult.gate_status, 'DISCOVERY_ONLY');
  assert.equal(unauthRes.gateResult.navigation_executable, false);
  assert.ok(unauthRes.gateResult.reasons.some(r => r.includes('POSITIVE_AUTHORIZATION')));

  // With positive authorization
  const authRes = await evaluateRouteEligibility(repos, {
    routeId: 'route_wy_buffer_01',
    userHasPositiveAuth: true
  });
  assert.equal(authRes.gateResult.gate_status, 'ELIGIBLE');
  assert.equal(authRes.gateResult.navigation_executable, true);
});

test('Hard Closure: Active hard closure produces NO_RECOMMENDATION', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  await repos.rules.save({
    id: 'temp_closure_sz',
    area_id: 'area_suzhou_western',
    route_id: 'route_sz_wm_01',
    rule_type: 'HARD_CLOSURE',
    is_blocking: true,
    requires_positive_auth: false,
    title: 'Typhoon emergency trail closure'
  });

  const res = await evaluateRouteEligibility(repos, { routeId: 'route_sz_wm_01' });
  assert.equal(res.gateResult.gate_status, 'NO_RECOMMENDATION');
  assert.equal(res.gateResult.navigation_executable, false);
});

test('Page Projection Invariant: Read projection must never mutate canonical truth', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  const routeBefore = await repos.routes.findById('route_zj_s12_a');
  assert.ok(routeBefore);

  const projection = await projectRoutePage(repos, 'route_zj_s12_a');
  const routeAfter = await repos.routes.findById('route_zj_s12_a');
  assert.ok(routeAfter);

  assert.equal(routeBefore.identity_state, routeAfter.identity_state);
  assert.equal(routeBefore.geometry_state, routeAfter.geometry_state);
  assertPageProjectionImmutable(routeAfter, projection);
});

test('Track Upload Isolation: POST /tracks creates RawTrack only and NEVER creates or mutates Route', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  const routesBeforeCount = (await repos.routes.listAll()).length;

  const res = await processTrackUpload(repos, {
    format: 'GPX',
    payload: '<gpx version="1.1"><trk><name>New Hike</name><trkseg><trkpt lat="32.1" lon="118.8"><time>2026-08-16T08:00:00Z</time></trkpt></trkseg></trk></gpx>'
  });

  const routesAfterCount = (await repos.routes.listAll()).length;
  assert.equal(routesBeforeCount, routesAfterCount, 'Routes count must remain unchanged');
  assert.ok(res.track.id);
  assert.equal(res.isDuplicate, false);
});
