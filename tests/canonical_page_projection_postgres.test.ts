import test from 'node:test';
import assert from 'node:assert/strict';
import { getPgPool } from '../src/config/database.js';
import { runDatabaseMigrations } from '../src/migration_runner.js';
import { seedCanonicalDatabase } from '../db/canonical_seed_runner.js';
import {
  buildCanonicalRoutePageProjection,
  projectAndPersistCanonicalRoutePage
} from '../src/services/canonical_page_projection_service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.PGHOST);

async function resetAndSeed(): Promise<void> {
  const pool = getPgPool();
  assert.ok(pool);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
  const migration = await runDatabaseMigrations();
  assert.equal(migration.success, true, migration.message);
  const seed = await seedCanonicalDatabase();
  assert.equal(seed.success, true, seed.message);
}

test('S12 canonical identity publishes while blocked geometry fields stay hidden', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  const pool = getPgPool();
  assert.ok(pool);

  const before = await pool.query<{
    identity_state: string;
    route_state: string;
    active_canonical_track_id: string | null;
    version: number;
  }>(
    `SELECT identity_state, route_state, active_canonical_track_id, version
       FROM route WHERE route_id = 'ZJ-S12-A'`
  );

  const projection = await projectAndPersistCanonicalRoutePage(pool, 'ZJ-S12-A');
  assert.equal(projection.identity_state, 'CANONICAL');
  assert.equal(projection.route_state, 'GEOMETRY_BLOCKED');
  assert.equal(projection.geometry.state, 'GEOMETRY_BLOCKED');
  assert.equal(projection.geometry.active_canonical_track_id, null);
  assert.equal(projection.geometry.map_download_visible, false);
  assert.equal(projection.geometry.navigation_visible, false);
  assert.equal(projection.geometry.distance_meters, null);
  assert.equal(projection.geometry.elevation_gain_meters, null);
  assert.ok(projection.reason_codes.includes('NO_ACTIVE_CANONICAL_TRACK'));
  assert.ok(projection.reason_codes.includes('CHILD_ROUTE_GEOMETRY_BLOCKED'));
  assert.ok(projection.dependencies.some(d => d.dependency_id === 'DEP-ZJ-S12'));

  const persisted = await pool.query<{
    canonical_version: number;
    gate_state: string;
    payload: { route_id?: string };
  }>(
    `SELECT canonical_version, gate_state, payload
       FROM page_projection_state
      WHERE entity_type = 'route'
        AND entity_id = 'ZJ-S12-A'
        AND projection_type = 'ROUTE_PUBLIC_PAGE_V1'`
  );
  assert.equal(persisted.rows.length, 1);
  assert.equal(persisted.rows[0]?.gate_state, 'GEOMETRY_BLOCKED');
  assert.equal(persisted.rows[0]?.payload?.route_id, 'ZJ-S12-A');

  const after = await pool.query<{
    identity_state: string;
    route_state: string;
    active_canonical_track_id: string | null;
    version: number;
  }>(
    `SELECT identity_state, route_state, active_canonical_track_id, version
       FROM route WHERE route_id = 'ZJ-S12-A'`
  );
  assert.deepEqual(after.rows[0], before.rows[0], 'page projection must not mutate canonical Route truth');
});

test('EXECUTABLE route state alone cannot expose navigation without an active CanonicalTrack', { skip: !hasDatabase }, async () => {
  const pool = getPgPool();
  assert.ok(pool);

  const projection = await buildCanonicalRoutePageProjection(pool, 'ROUTE-NJ-ZJ-001');
  assert.equal(projection.route_state, 'EXECUTABLE');
  assert.equal(projection.geometry.state, 'CANONICAL_ASSET_MISSING');
  assert.equal(projection.geometry.active_canonical_track_id, null);
  assert.equal(projection.geometry.map_download_visible, false);
  assert.equal(projection.geometry.navigation_visible, false);
  assert.equal(projection.geometry.distance_meters, null);
  assert.ok(projection.reason_codes.includes('NO_ACTIVE_CANONICAL_TRACK'));
});

test('Approved active CanonicalTrack is the only source of public geometry metrics', { skip: !hasDatabase }, async () => {
  const pool = getPgPool();
  assert.ok(pool);

  const routeId = 'CI-PAGE-APPROVED';
  const canonicalTrackId = 'CI-PAGE-TRACK-V1';
  await pool.query(
    `INSERT INTO route (
       route_id, route_family_id, area_id, canonical_name,
       identity_state, route_state, version
     ) VALUES ($1, 'ZJ-S12-RF', 'AREA-NJ-ZIJINSHAN', 'CI approved page route',
               'CANONICAL', 'EXECUTABLE', 1)
     ON CONFLICT (route_id) DO NOTHING`,
    [routeId]
  );
  await pool.query(
    `INSERT INTO canonical_track (
       canonical_track_id, route_id, geometry, distance_m,
       elevation_gain_m, qa, version
     ) VALUES (
       $1, $2,
       ST_GeomFromText('LINESTRING(118.8515 32.0441,118.8554 32.0518,118.8542 32.0556)', 4326),
       4321, 210, '{"editorial":"approved","ci_fixture":true}'::jsonb, 1
     )
     ON CONFLICT (canonical_track_id) DO NOTHING`,
    [canonicalTrackId, routeId]
  );
  await pool.query(
    `UPDATE route SET active_canonical_track_id = $1 WHERE route_id = $2`,
    [canonicalTrackId, routeId]
  );

  const projection = await buildCanonicalRoutePageProjection(pool, routeId);
  assert.equal(projection.geometry.state, 'CANONICAL_TRACK_ACTIVE');
  assert.equal(projection.geometry.active_canonical_track_id, canonicalTrackId);
  assert.equal(projection.geometry.map_download_visible, true);
  assert.equal(projection.geometry.navigation_visible, true);
  assert.equal(projection.geometry.distance_meters, 4321);
  assert.equal(projection.geometry.elevation_gain_meters, 210);
  assert.deepEqual(projection.reason_codes, []);
});
