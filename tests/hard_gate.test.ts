/**
 * Canonical hard-gate and provenance regression tests.
 *
 * UI demo seed is explicitly synthetic. Tests that require accepted geometry
 * construct their own synthetic executions; production seed truth is validated
 * separately under db/.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createMemoryRepositories } from '../src/repository/repositories.js';
import { loadSeedManifest } from '../seed/seed_loader.js';
import { evaluateRouteEligibility } from '../src/services/eligibility_service.js';
import { processTrackUpload, detectProvenance } from '../src/services/track_service.js';
import { projectRoutePage } from '../src/services/page_projection_service.js';
import { CANONICAL_MIGRATION_ORDER, loadAndValidateMigrations } from '../src/migration_runner.js';
import {
  assertTrackNotRoute,
  assertSiblingTracksSeparated,
  assertPageProjectionImmutable,
  assertPlannedLineNotRecordedGps
} from '../src/domain/invariants.js';
import { RawTrack } from '../src/domain/types.js';

function recordedGpx(name: string, offset = 0): string {
  return `<gpx version="1.1"><trk><name>${name}</name><trkseg>` +
    `<trkpt lat="32.100${offset}" lon="118.800${offset}"><time>2026-08-16T08:00:00Z</time></trkpt>` +
    `<trkpt lat="32.101${offset}" lon="118.801${offset}"><time>2026-08-16T08:01:00Z</time></trkpt>` +
    `</trkseg></trk></gpx>`;
}

test('Canonical migration suite uses exact db/migrations 0001-0010 chain', () => {
  const result = loadAndValidateMigrations();
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.deepEqual(result.migrationsFound.map(m => m.name), [...CANONICAL_MIGRATION_ORDER]);
  assert.equal(result.invariantsVerified.oneCurrentFieldValueInvariant, true);
  assert.equal(result.invariantsVerified.provenanceModelsPresent, true);
  assert.equal(result.invariantsVerified.runtimeSnapshotValidityCheck, true);
  assert.equal(result.invariantsVerified.protectedAreaModelPresent, true);
  assert.equal(result.invariantsVerified.routeFamilyVariantModelPresent, true);
  assert.equal(result.invariantsVerified.firstPartyActivityModelPresent, true);
});

test('Production seed does not contain synthetic sibling GPS or runtime demo truth', () => {
  const production = fs.readFileSync(path.join(process.cwd(), 'db', 'four_area_seed_manifest_v0_2.json'), 'utf8');
  assert.equal(production.includes('track_zj_sibling_b_gps'), false);
  assert.equal(production.includes('snap_sz_01_fresh'), false);
  assert.ok(production.includes('ZJ-S12-A'));
  assert.ok(production.includes('NO_STATIC_VALUE'));
});

test('UI demo seed declares UI_DEMO_ONLY and remains idempotent', async () => {
  const { repos } = createMemoryRepositories();
  const run1 = await loadSeedManifest(repos);
  const run2 = await loadSeedManifest(repos);
  assert.equal(run1.dataClassification, 'UI_DEMO_ONLY');
  assert.ok(run1.mutationsCreated > 0);
  assert.equal(run2.mutationsCreated, 0);
  assert.equal(run2.mutationsUpdated, 0);
});

test('ZJ-S12-A identity is canonical while geometry stays blocked', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);
  const res = await evaluateRouteEligibility(repos, { routeId: 'route_zj_s12_a' });
  assert.equal(res.route.identity_state, 'CANONICAL');
  assert.equal(res.route.geometry_state, 'GEOMETRY_BLOCKED');
  assert.equal(res.gateResult.gate_status, 'GEOMETRY_BLOCKED');
  assert.equal(res.gateResult.navigation_executable, false);
});

test('Evidence-backed S12 QA fixture preserves exact measured candidate distances', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 's12_evidence_summary.json'), 'utf8'));
  const byId = new Map(fixture.candidates.map((c: any) => [c.candidate_id, c]));
  assert.deepEqual(byId.get('42160328'), {
    candidate_id: '42160328', a01_m: 815.5, a02_m: 1437.9, a03_m: 1573.6,
    gate: 'NOT_S12_CORE', decision: 'REJECT_AS_S12_RAW'
  });
  assert.deepEqual(byId.get('45517618'), {
    candidate_id: '45517618', a01_m: 1453.7, a02_m: 1639.5, a03_m: 1596.0,
    gate: 'NOT_S12_CORE', decision: 'REJECT_AS_S12_RAW'
  });
  assert.deepEqual(byId.get('52046317'), {
    candidate_id: '52046317', a01_m: 37.2, a02_m: 380.7, a03_m: 610.8,
    gate: 'NOT_S12_CORE', decision: 'REJECT_AS_S12_RAW'
  });
  assert.equal(fixture.planned_control.provenance, 'PLANNED_NAVIGATION_LINE');
  assert.equal(fixture.planned_control.recorded_execution_contribution, 0);
});

test('Untimestamped GPX track geometry remains GEOMETRY_LINE_UNKNOWN', () => {
  const payload = '<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.1" lon="1.1"/></trkseg></trk></gpx>';
  assert.equal(detectProvenance(payload, 'GPX'), 'GEOMETRY_LINE_UNKNOWN');
});

test('Client declaration cannot upgrade untimestamped GPX into Recorded GPS', () => {
  const payload = '<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.1" lon="1.1"/></trkseg></trk></gpx>';
  assert.equal(detectProvenance(payload, 'GPX', 'RECORDED_GPS'), 'GEOMETRY_LINE_UNKNOWN');
});

test('Timestamped GPX can classify as RECORDED_GPS', () => {
  assert.equal(detectProvenance(recordedGpx('recorded'), 'GPX'), 'RECORDED_GPS');
});

test('KML LineString without execution timestamps is PLANNED_NAVIGATION_LINE', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);
  const result = await processTrackUpload(repos, {
    format: 'KML',
    payload: '<kml><Placemark><LineString><coordinates>118.8,32.0 118.9,32.1</coordinates></LineString></Placemark></kml>',
    fileName: 'planned.kml'
  });
  assert.equal(result.provenanceType, 'PLANNED_NAVIGATION_LINE');
  const route = await repos.routes.findById('route_zj_s12_a');
  assert.ok(route);
  assertTrackNotRoute(result.track, route);
});

test('Planned line marked recorded_execution is rejected by invariant', () => {
  const track = {
    id: 'planned_bad', sha256: 'x'.repeat(64), format: 'KML',
    provenance_type: 'PLANNED_NAVIGATION_LINE', point_count: 2,
    raw_payload: '<kml/>', recorded_execution: true
  } as RawTrack & { recorded_execution: boolean };
  assert.throws(() => assertPlannedLineNotRecordedGps(track), /INVARIANT_2_VIOLATION/);
});

test('GeoJSON/FIT are rejected by canonical track ingestion contract', async () => {
  const { repos } = createMemoryRepositories();
  await assert.rejects(
    processTrackUpload(repos, { format: 'GEOJSON', payload: '{"type":"LineString","coordinates":[]}' }),
    /Only GPX and KML are accepted/
  );
});

test('One accepted recorded execution is insufficient for public geometry consensus', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);
  await repos.routes.save({
    id: 'route_consensus_one', family_id: 'rf_zj_s12', variant_code: 'TEST-ONE', name: 'Synthetic one-track test',
    identity_state: 'CANONICAL', geometry_state: 'ACCEPTED_CONSENSUS'
  });
  const t1 = await processTrackUpload(repos, { format: 'GPX', payload: recordedGpx('one') });
  await repos.assignments.save({ id: 'a_one', track_id: t1.track.id, route_id: 'route_consensus_one', match_status: 'ACCEPTED' });
  const res = await evaluateRouteEligibility(repos, { routeId: 'route_consensus_one' });
  assert.equal(res.gateResult.geometry_consensus_valid, false);
  assert.equal(res.gateResult.gate_status, 'GEOMETRY_BLOCKED');
  assert.ok(res.gateResult.reasons.some(r => r.includes('1/2')));
});

test('Two independent accepted recorded executions can satisfy child-route geometry consensus', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);
  await repos.routes.save({
    id: 'route_consensus_two', family_id: 'rf_zj_s12', variant_code: 'TEST-TWO', name: 'Synthetic two-track test',
    identity_state: 'CANONICAL', geometry_state: 'ACCEPTED_CONSENSUS'
  });
  const t1 = await processTrackUpload(repos, { format: 'GPX', payload: recordedGpx('first', 1) });
  const t2 = await processTrackUpload(repos, { format: 'GPX', payload: recordedGpx('second', 2) });
  await repos.assignments.save({ id: 'a_two_1', track_id: t1.track.id, route_id: 'route_consensus_two', match_status: 'ACCEPTED' });
  await repos.assignments.save({ id: 'a_two_2', track_id: t2.track.id, route_id: 'route_consensus_two', match_status: 'ACCEPTED' });
  const res = await evaluateRouteEligibility(repos, { routeId: 'route_consensus_two' });
  assert.equal(res.gateResult.geometry_consensus_valid, true);
  assert.equal(res.gateResult.gate_status, 'ELIGIBLE');
  assert.equal(res.gateResult.navigation_executable, true);
});

test('Sibling accepted geometry never promotes target child route', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);
  const routeA = await repos.routes.findById('route_zj_s12_a');
  assert.ok(routeA);
  const targetAccepted = (await repos.assignments.findByRouteId(routeA.id))
    .filter(a => a.match_status === 'ACCEPTED').map(a => a.track_id);
  const syntheticSiblingTrack = await processTrackUpload(repos, { format: 'GPX', payload: recordedGpx('sibling', 3) });
  const siblingAccepted = [syntheticSiblingTrack.track.id];
  assertSiblingTracksSeparated(routeA.id, 'SYNTHETIC_SIBLING_ROUTE', targetAccepted, siblingAccepted);
  const res = await evaluateRouteEligibility(repos, { routeId: routeA.id });
  assert.equal(res.gateResult.gate_status, 'GEOMETRY_BLOCKED');
});

test('Protected-area BLOCK is driven by explicit Rule, not route naming heuristics', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  // Existing Wuyishan core demo route has an explicit HARD_CLOSURE rule.
  const explicit = await evaluateRouteEligibility(repos, { routeId: 'route_wy_core_01' });
  assert.equal(explicit.gateResult.gate_status, 'BLOCK');
  assert.ok(explicit.gateResult.reasons.includes('EXPLICIT_PROTECTED_AREA_HARD_RULE'));

  // A Zijinshan route whose name contains 核心 must not be legal-blocked from its name.
  await repos.routes.save({
    id: 'route_name_core_only', family_id: 'rf_zj_s12', variant_code: 'CORE-NAME-ONLY', name: '核心字样测试路线',
    identity_state: 'CANONICAL', geometry_state: 'GEOMETRY_BLOCKED'
  });
  const nameOnly = await evaluateRouteEligibility(repos, { routeId: 'route_name_core_only' });
  assert.notEqual(nameOnly.gateResult.gate_status, 'BLOCK');
});

test('Positive authorization cannot bypass insufficient geometry evidence', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);
  const unauth = await evaluateRouteEligibility(repos, { routeId: 'route_wy_buffer_01', userHasPositiveAuth: false });
  assert.equal(unauth.gateResult.gate_status, 'DISCOVERY_ONLY');
  const auth = await evaluateRouteEligibility(repos, { routeId: 'route_wy_buffer_01', userHasPositiveAuth: true });
  assert.equal(auth.gateResult.gate_status, 'GEOMETRY_BLOCKED');
  assert.equal(auth.gateResult.navigation_executable, false);
});

test('Stale critical alpine runtime requires refresh once geometry gate is satisfied', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);
  // UI demo already has one accepted WG track; add an independent second test execution.
  const second = await processTrackUpload(repos, { format: 'GPX', payload: recordedGpx('wg-second', 4) });
  await repos.assignments.save({ id: 'wg_second', track_id: second.track.id, route_id: 'route_wg_alp_01', match_status: 'ACCEPTED' });
  const res = await evaluateRouteEligibility(repos, {
    routeId: 'route_wg_alp_01', evaluationTime: new Date('2026-08-16T12:00:00.000Z')
  });
  assert.equal(res.gateResult.geometry_consensus_valid, true);
  assert.equal(res.gateResult.gate_status, 'RUNTIME_DATA_REQUIRED');
  assert.equal(res.gateResult.navigation_executable, false);
});

test('Hard closure produces NO_RECOMMENDATION for ordinary Area', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);
  await repos.rules.save({
    id: 'temp_closure_zj', area_id: 'area_zijinshan', route_id: 'route_zj_s12_a',
    rule_type: 'HARD_CLOSURE', is_blocking: true, requires_positive_auth: false,
    title: 'Temporary explicit closure fixture'
  });
  const res = await evaluateRouteEligibility(repos, { routeId: 'route_zj_s12_a' });
  assert.equal(res.gateResult.gate_status, 'NO_RECOMMENDATION');
  assert.equal(res.gateResult.navigation_executable, false);
});

test('Page projection is read-only with respect to canonical route state', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);
  const before = await repos.routes.findById('route_zj_s12_a');
  assert.ok(before);
  const projection = await projectRoutePage(repos, 'route_zj_s12_a');
  const after = await repos.routes.findById('route_zj_s12_a');
  assert.ok(after);
  assert.deepEqual(after, before);
  assertPageProjectionImmutable(after, projection);
});

test('Track upload creates RawTrack only and never creates Route', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);
  const before = (await repos.routes.listAll()).length;
  const result = await processTrackUpload(repos, { format: 'GPX', payload: recordedGpx('isolated-upload', 5) });
  assert.equal(result.isDuplicate, false);
  assert.equal((await repos.routes.listAll()).length, before);
});
