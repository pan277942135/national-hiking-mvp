import test from 'node:test';
import assert from 'node:assert/strict';
import { getPgPool } from '../src/config/database.js';
import { runDatabaseMigrations } from '../src/migration_runner.js';
import { seedCanonicalDatabase } from '../db/canonical_seed_runner.js';
import { evaluateCanonicalExecutionGate } from '../src/services/canonical_execution_gate_service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const ROUTE_ID = 'CI-EXEC-GATE';
const TRACK_ID = 'CT-CI-EXEC-GATE';
let schemaInitializedInThisProcess = false;

/**
 * Reset application truth without repeatedly dropping/recreating the PostGIS
 * extension in the same backend process.
 *
 * PostGIS planner support functions cache geometry/operator-family OIDs per
 * backend. Recreating the extension between tests while the pg Pool keeps the
 * backend alive can leave those cached OIDs stale and produce planner errors
 * such as "no spatial operator found for st_intersects" even though both
 * columns are geometry(...,4326). That is a test-harness artifact, not a route
 * gate semantic.
 *
 * We perform one full schema rebuild at process start. Subsequent cases truncate
 * only application tables, preserving spatial_ref_sys, schema_migration and the
 * stable PostGIS extension/type/operator OIDs.
 */
async function resetAndSeed(): Promise<void> {
  const pool = getPgPool();
  assert.ok(pool);

  if (!schemaInitializedInThisProcess) {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
    const migrations = await runDatabaseMigrations();
    assert.equal(migrations.success, true, migrations.message);
    schemaInitializedInThisProcess = true;
  } else {
    const tables = await pool.query<{ table_list: string | null }>(
      `SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename) AS table_list
         FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ('spatial_ref_sys', 'schema_migration')`
    );
    const tableList = tables.rows[0]?.table_list;
    if (tableList) {
      await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    }
  }

  const seed = await seedCanonicalDatabase();
  assert.equal(seed.success, true);
}

async function insertSyntheticCanonicalRoute(): Promise<void> {
  const pool = getPgPool();
  assert.ok(pool);
  await pool.query('BEGIN');
  try {
    await pool.query(
      `INSERT INTO route (
         route_id, route_family_id, area_id, canonical_name, identity_state,
         route_state, version
       ) VALUES ($1, 'ZJ-S12-RF', 'AREA-NJ-ZIJINSHAN', 'CI execution gate route',
                 'CANONICAL', 'STATIC_PUBLISHABLE', 1)`,
      [ROUTE_ID]
    );
    await pool.query(
      `INSERT INTO canonical_track (
         canonical_track_id, route_id, geometry, distance_m, elevation_gain_m, qa, version
       ) VALUES (
         $1, $2,
         ST_GeomFromText('LINESTRING(118.8515 32.0441,118.8554 32.0518,118.8542 32.0556)',4326),
         1400, NULL, '{"fixture":true}'::jsonb, 1
       )`,
      [TRACK_ID, ROUTE_ID]
    );
    await pool.query(
      `UPDATE route SET active_canonical_track_id = $2 WHERE route_id = $1`,
      [ROUTE_ID, TRACK_ID]
    );
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function insertRuntime(input: {
  closureState?: string;
  weatherRisk?: string;
  fireState?: string;
  observedAt?: string;
  validUntil?: string;
} = {}): Promise<void> {
  const pool = getPgPool();
  assert.ok(pool);
  await pool.query(
    `INSERT INTO runtime_snapshot (
       snapshot_id, scope_type, scope_entity_id, observed_at, valid_until,
       closure_state, weather_risk, fire_control_state, evidence_refs
     ) VALUES ('SNAP-CI-EXEC', 'route', $1, $2, $3, $4, $5, $6, '["E-RUNTIME-CI"]'::jsonb)`,
    [
      ROUTE_ID,
      input.observedAt ?? '2026-08-16T10:00:00Z',
      input.validUntil ?? '2026-08-16T14:00:00Z',
      input.closureState ?? 'OPEN',
      input.weatherRisk ?? 'NORMAL',
      input.fireState ?? 'NORMAL'
    ]
  );
}

test('Known route-level legal block wins even when canonical geometry is missing', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  const pool = getPgPool();
  assert.ok(pool);

  const result = await evaluateCanonicalExecutionGate(pool, {
    routeId: 'ROUTE-WG-AT-10946833',
    evaluatedAt: new Date('2026-08-16T12:00:00Z')
  });
  assert.equal(result.canonicalGeometryPresent, false);
  assert.equal(result.status, 'NO_DEFAULT_RECOMMENDATION');
  assert.equal(result.legalState, 'BLOCKED');
  assert.ok(result.reasonCodes.includes('STATIC_ROUTE_RULE_BLOCKED'));
});

test('Route/Area scoped HARD rule blocks before geometry evaluation', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  const pool = getPgPool();
  assert.ok(pool);

  await pool.query(
    `INSERT INTO route (
       route_id, route_family_id, area_id, canonical_name, identity_state, route_state, version
     ) VALUES ('CI-HARD-NO-GEOM', 'ZJ-S12-RF', 'AREA-NJ-ZIJINSHAN',
               'Hard rule no geometry fixture', 'CANONICAL', 'STATIC_PUBLISHABLE', 1)`
  );
  await pool.query(
    `INSERT INTO evidence (evidence_id, source_type, publisher, observed_at)
     VALUES ('E-HARD-CI', 'OFFICIAL_RULE', 'CI fixture authority', '2026-08-16T00:00:00Z')`
  );
  await pool.query(
    `INSERT INTO rule (
       rule_id, rule_type, severity, scope_type, scope_entity_id,
       effective_from, effective_to, source_evidence_id
     ) VALUES ('RULE-HARD-CI', 'HARD_CLOSURE', 'HARD', 'ROUTE', 'CI-HARD-NO-GEOM',
               '2026-08-16T00:00:00Z', '2026-08-17T00:00:00Z', 'E-HARD-CI')`
  );

  const result = await evaluateCanonicalExecutionGate(pool, {
    routeId: 'CI-HARD-NO-GEOM',
    evaluatedAt: new Date('2026-08-16T12:00:00Z')
  });
  assert.equal(result.status, 'NO_RECOMMENDATION');
  assert.equal(result.legalState, 'BLOCKED');
  assert.equal(result.canonicalGeometryPresent, false);
  assert.ok(result.reasonCodes.includes('HARD_RULE_ACTIVE:RULE-HARD-CI'));
  assert.ok(result.evidenceRefs.includes('E-HARD-CI'));
});

test('Approved geometry without fresh runtime cannot produce a live navigation answer', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  await insertSyntheticCanonicalRoute();
  const pool = getPgPool();
  assert.ok(pool);

  const live = await evaluateCanonicalExecutionGate(pool, {
    routeId: ROUTE_ID,
    evaluatedAt: new Date('2026-08-16T12:00:00Z')
  });
  assert.equal(live.status, 'RUNTIME_DATA_REQUIRED');
  assert.equal(live.navigationExecutable, false);
  assert.equal(live.runtimeState, 'MISSING');

  const staticProjectionGate = await evaluateCanonicalExecutionGate(pool, {
    routeId: ROUTE_ID,
    mode: 'STATIC_PUBLICATION',
    evaluatedAt: new Date('2026-08-16T12:00:00Z')
  });
  assert.equal(staticProjectionGate.status, 'ELIGIBLE');
  assert.equal(staticProjectionGate.navigationExecutable, false,
    'static publication eligibility must never be presented as live navigation clearance');
  assert.equal(staticProjectionGate.runtimeState, 'NOT_EVALUATED');
});

test('Fresh runtime OPEN can make a statically clear route live-eligible; stale or closed cannot', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  await insertSyntheticCanonicalRoute();
  const pool = getPgPool();
  assert.ok(pool);

  await insertRuntime();
  const open = await evaluateCanonicalExecutionGate(pool, {
    routeId: ROUTE_ID,
    evaluatedAt: new Date('2026-08-16T12:00:00Z')
  });
  assert.equal(open.status, 'ELIGIBLE');
  assert.equal(open.navigationExecutable, true);
  assert.equal(open.runtimeState, 'FRESH');
  assert.equal(open.observedAt, '2026-08-16T10:00:00.000Z');
  assert.equal(open.validUntil, '2026-08-16T14:00:00.000Z');
  assert.ok(open.evidenceRefs.includes('E-RUNTIME-CI'));

  await pool.query('DELETE FROM runtime_snapshot');
  await insertRuntime({ validUntil: '2026-08-16T11:00:00Z' });
  const stale = await evaluateCanonicalExecutionGate(pool, {
    routeId: ROUTE_ID,
    evaluatedAt: new Date('2026-08-16T12:00:00Z')
  });
  assert.equal(stale.status, 'RUNTIME_DATA_REQUIRED');
  assert.equal(stale.navigationExecutable, false);
  assert.equal(stale.runtimeState, 'STALE');

  await pool.query('DELETE FROM runtime_snapshot');
  await insertRuntime({ closureState: 'CLOSED' });
  const closed = await evaluateCanonicalExecutionGate(pool, {
    routeId: ROUTE_ID,
    evaluatedAt: new Date('2026-08-16T12:00:00Z')
  });
  assert.equal(closed.status, 'NO_RECOMMENDATION');
  assert.equal(closed.navigationExecutable, false);
  assert.equal(closed.runtimeState, 'BLOCKING');
  assert.ok(closed.reasonCodes.includes('RUNTIME_CLOSURE:CLOSED'));
});

test('Intersecting controlled protected zone requires positive authorization', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  await insertSyntheticCanonicalRoute();
  const pool = getPgPool();
  assert.ok(pool);

  await pool.query(
    `INSERT INTO legal_scope (
       legal_scope_id, area_id, jurisdiction_code, legal_basis, geometry, version
     ) VALUES (
       'LS-CI-CONTROLLED', 'AREA-NJ-ZIJINSHAN', 'CI', 'fixture only',
       ST_Multi(ST_GeomFromText('POLYGON((118.84 32.03,118.87 32.03,118.87 32.07,118.84 32.07,118.84 32.03))',4326)), 1
     )`
  );
  await pool.query(
    `INSERT INTO protected_area_zone (
       zone_id, legal_scope_id, zone_type, access_default, geometry, effective_from
     ) VALUES (
       'ZONE-CI-CONTROLLED', 'LS-CI-CONTROLLED', 'GENERAL', 'CONTROLLED',
       ST_Multi(ST_GeomFromText('POLYGON((118.84 32.03,118.87 32.03,118.87 32.07,118.84 32.07,118.84 32.03))',4326)),
       '2026-01-01T00:00:00Z'
     )`
  );
  await insertRuntime();

  const noAuth = await evaluateCanonicalExecutionGate(pool, {
    routeId: ROUTE_ID,
    evaluatedAt: new Date('2026-08-16T12:00:00Z'),
    userHasPositiveAuthorization: false
  });
  assert.equal(noAuth.status, 'DISCOVERY_ONLY');
  assert.equal(noAuth.legalState, 'PERMIT_REQUIRED');
  assert.equal(noAuth.navigationExecutable, false);

  const authorized = await evaluateCanonicalExecutionGate(pool, {
    routeId: ROUTE_ID,
    evaluatedAt: new Date('2026-08-16T12:00:00Z'),
    userHasPositiveAuthorization: true
  });
  assert.equal(authorized.status, 'ELIGIBLE');
  assert.equal(authorized.legalState, 'CLEAR');
  assert.equal(authorized.navigationExecutable, true);
});
