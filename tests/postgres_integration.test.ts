import test from 'node:test';
import assert from 'node:assert/strict';
import { getPgPool } from '../src/config/database.js';
import { runDatabaseMigrations } from '../src/migration_runner.js';
import { seedCanonicalDatabase } from '../db/canonical_seed_runner.js';
import { CanonicalPostgresRepository } from '../src/repository/postgres/canonical_postgres.js';

const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.PGHOST);

async function resetCanonicalTables(): Promise<void> {
  const pool = getPgPool();
  assert.ok(pool, 'PostgreSQL pool must exist for DB integration tests');
  // CI uses a fresh service container, but keeping the test deterministic makes
  // reruns safe on the same ephemeral database.
  await pool.query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO public;
  `);
}

test('Canonical PostGIS vertical slice: migrate -> seed -> repository replay', { skip: !hasDatabase }, async () => {
  const pool = getPgPool();
  assert.ok(pool);

  await resetCanonicalTables();

  const migration = await runDatabaseMigrations();
  assert.equal(migration.success, true, migration.message);
  assert.equal(migration.mode, 'LIVE_DB');
  assert.equal(migration.applied.length, 10);

  const postgis = await pool.query<{ version: string }>('SELECT postgis_version() AS version');
  assert.match(postgis.rows[0]?.version ?? '', /^3\./);

  const seed = await seedCanonicalDatabase();
  assert.equal(seed.success, true);
  assert.equal(seed.mode, 'LIVE_DB');
  assert.equal(seed.areas, 4);
  assert.equal(seed.routes, 4);
  assert.equal(seed.fieldValues, 10, 'SF-004 is runtime-only and must not be imported as static truth');
  assert.deepEqual(seed.skippedRuntimeOnlyFieldValues, ['SF-004']);

  const repo = new CanonicalPostgresRepository(pool);
  const migrations = await repo.getAppliedMigrationNames();
  assert.equal(migrations.length, 10);
  assert.deepEqual(migrations, [
    '0001_extensions_enums.sql',
    '0002_core_entities.sql',
    '0003_evidence_promotion.sql',
    '0004_route_track.sql',
    '0005_legal_rule_protected.sql',
    '0006_runtime_overnight.sql',
    '0007_gate_projection.sql',
    '0008_indexes_constraints.sql',
    '0009_routefamily_variant_geometry.sql',
    '0010_first_party_activity.sql'
  ]);

  const areas = await repo.listAreas();
  assert.equal(areas.length, 4);
  assert.equal(areas.find(a => a.area_id === 'AREA-NJ-ZIJINSHAN')?.canonical_name, '紫金山');

  const families = await repo.listRouteFamilies('AREA-NJ-ZIJINSHAN');
  assert.equal(families.length, 1);
  assert.equal(families[0]?.route_family_id, 'ZJ-S12-RF');

  const s12 = await repo.findRoute('ZJ-S12-A');
  assert.ok(s12);
  assert.equal(s12.identity_state, 'CANONICAL');
  assert.equal(s12.route_state, 'GEOMETRY_BLOCKED');
  assert.equal(s12.active_canonical_track_id, null);

  const nightState = await repo.getCurrentFieldValue(
    'area',
    'AREA-NJ-ZIJINSHAN',
    'night_legal_access_state'
  );
  assert.ok(nightState);
  assert.equal(nightState.state, 'LEGITIMATE_UNKNOWN');
  assert.equal(nightState.value, 'UNKNOWN');

  const runtimeLeak = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM field_value
      WHERE field_value_id = 'SF-004' OR state = 'RUNTIME_ONLY'`
  );
  assert.equal(Number(runtimeLeak.rows[0]?.count ?? 0), 0);

  const deps = await repo.listDependenciesForEntity('route', 'ZJ-S12-A');
  assert.equal(deps.length, 1);
  assert.equal(deps[0]?.dependency_id, 'DEP-ZJ-S12');
  assert.equal(deps[0]?.stop_status, 'SOURCE_SWITCH');
  assert.match(deps[0]?.reopen_trigger ?? '', /2 independent accepted Recorded GPS executions/);

  // The canonical production seed must not fabricate S12 RawTrack/Activity
  // evidence. Geometry remains a legitimate external dependency until real
  // evidence is ingested.
  assert.equal((await repo.listRawAssignments('ZJ-S12-A')).length, 0);
  assert.equal(await repo.countIndependentAcceptedRawExecutions('ZJ-S12-A'), 0);
  assert.equal(await repo.countIndependentAcceptedActors('ZJ-S12-A'), 0);

  const s12CanonicalTrack = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM canonical_track WHERE route_id = 'ZJ-S12-A'`
  );
  assert.equal(Number(s12CanonicalTrack.rows[0]?.count ?? 0), 0);
});

test('Canonical migration and seed replay are idempotent on live PostGIS', { skip: !hasDatabase }, async () => {
  const pool = getPgPool();
  assert.ok(pool);

  const migration = await runDatabaseMigrations();
  assert.equal(migration.success, true, migration.message);
  assert.equal(migration.mode, 'LIVE_DB');
  assert.deepEqual(migration.applied, []);

  const first = await seedCanonicalDatabase();
  const second = await seedCanonicalDatabase();
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.deepEqual(second.skippedRuntimeOnlyFieldValues, ['SF-004']);

  const repo = new CanonicalPostgresRepository(pool);
  assert.equal((await repo.listAreas()).length, 4);
  assert.equal((await repo.listRoutes()).length, 4);
  assert.equal((await repo.listDependenciesForEntity('route', 'ZJ-S12-A')).length, 1);

  const runtimeLeak = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM field_value
      WHERE field_value_id = 'SF-004' OR state = 'RUNTIME_ONLY'`
  );
  assert.equal(Number(runtimeLeak.rows[0]?.count ?? 0), 0);
});
