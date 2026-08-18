import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const seedPath = path.join(process.cwd(), 'seed', 'zijinshan_catalog_v1.json');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as Record<string, any>;

function allRecords() {
  return [
    ...(seed.access_points || []),
    ...(seed.parking || []),
    ...(seed.pois || [])
  ];
}

test('Zijinshan catalog seed: only targets Zijinshan and contains expected first-batch entities', () => {
  assert.equal(seed.area_id, 'area_zijinshan');
  assert.equal(seed.access_points.length, 4);
  assert.equal(seed.parking.length, 4);
  assert.equal(seed.pois.length, 3);
});

test('Zijinshan catalog seed: no first-batch entity is prematurely canonical', () => {
  for (const record of allRecords()) {
    assert.notEqual(record.catalog_state, 'CANONICAL', `${record.id} must remain evidence-gated`);
    assert.equal(record.catalog_state, 'SUPPORTED');
  }
});

test('Zijinshan catalog seed: unknown coordinates remain null pairs', () => {
  for (const record of allRecords()) {
    assert.equal(record.latitude ?? null, null, `${record.id} latitude must remain unknown`);
    assert.equal(record.longitude ?? null, null, `${record.id} longitude must remain unknown`);
  }
});

test('Zijinshan catalog seed: dynamic facts are absent from static catalog payload', () => {
  const forbidden = new Set(seed.policy.dynamic_facts_forbidden_in_static_catalog || []);
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assert.equal(forbidden.has(key), false, `Forbidden dynamic field found: ${key}`);
      walk(child);
    }
  };
  walk(allRecords());
});

test('Zijinshan catalog seed: parking relations only reference seeded access points', () => {
  const accessIds = new Set(seed.access_points.map((record: Record<string, unknown>) => record.id));
  for (const parking of seed.parking) {
    if (parking.related_access_point_id) {
      assert.equal(accessIds.has(parking.related_access_point_id), true);
    }
  }
});
