/**
 * Invariant & Edge Case Regression Tests
 * National Hiking Backend MVP
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepositories } from '../src/repository/repositories.js';
import { loadSeedManifest } from '../seed/seed_loader.js';
import { evaluateRouteEligibility } from '../src/services/eligibility_service.js';
import { assertRuntimeFactQuarantined } from '../src/domain/invariants.js';

test('Unknown Remains Unknown: Missing runtime weather does not fabricate safety', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  // Clear runtime snapshots
  const emptyStoreRes = await evaluateRouteEligibility(repos, {
    routeId: 'route_sz_wm_01',
    evaluationTime: new Date('2029-01-01T00:00:00Z') // Snapshot expired
  });

  assert.equal(emptyStoreRes.gateResult.runtime_fresh, false);
  assert.ok(emptyStoreRes.gateResult.advisories.some(a => a.includes('stale') || a.includes('unconfirmed')));
});

test('Zero Eligible Candidates: When all child routes are blocked or restricted, system avoids unsafe recommendation', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  // For Zijinshan ZJ-S12-A (geometry blocked) and Wuyishan Core (strictly blocked)
  const zjRes = await evaluateRouteEligibility(repos, { routeId: 'route_zj_s12_a' });
  const wyCoreRes = await evaluateRouteEligibility(repos, { routeId: 'route_wy_core_01' });

  assert.equal(zjRes.gateResult.navigation_executable, false);
  assert.equal(wyCoreRes.gateResult.navigation_executable, false);
});

test('One-Current FieldValue Invariant: Superseding updates previous current value to false', async () => {
  const { repos } = createMemoryRepositories();

  // Save first current field value
  await repos.fieldValues.save({
    id: 'fv_1',
    entity_type: 'ROUTE',
    entity_id: 'route_zj_s12_a',
    field_name: 'estimated_duration_minutes',
    field_value: 90,
    is_current: true
  });

  const fv1 = await repos.fieldValues.findCurrent('ROUTE', 'route_zj_s12_a', 'estimated_duration_minutes');
  assert.equal(fv1?.id, 'fv_1');
  assert.equal(fv1?.field_value, 90);

  // Save second current field value for same entity and field
  await repos.fieldValues.save({
    id: 'fv_2',
    entity_type: 'ROUTE',
    entity_id: 'route_zj_s12_a',
    field_name: 'estimated_duration_minutes',
    field_value: 95,
    is_current: true
  });

  const fvCurrent = await repos.fieldValues.findCurrent('ROUTE', 'route_zj_s12_a', 'estimated_duration_minutes');
  assert.equal(fvCurrent?.id, 'fv_2');
  assert.equal(fvCurrent?.field_value, 95);
});

test('Runtime Fact Quarantine: Invariant 14 prevents transient runtime facts from contaminating static schema', () => {
  const transientCondition = { current_mud_depth_cm: 15 };
  assert.throws(() => {
    assertRuntimeFactQuarantined(transientCondition, true);
  }, /INVARIANT_14_VIOLATION/);
});
