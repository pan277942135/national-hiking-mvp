import test from 'node:test';
import assert from 'node:assert/strict';
import { getPgPool } from '../src/config/database.js';
import { runDatabaseMigrations } from '../src/migration_runner.js';
import { seedCanonicalDatabase } from '../db/canonical_seed_runner.js';
import { CanonicalPostgresRepository } from '../src/repository/postgres/canonical_postgres.js';
import {
  assignCanonicalRawTrack,
  ingestCanonicalRawTrack
} from '../src/services/canonical_track_ingest_service.js';
import {
  evaluateAndAssignCanonicalRawTrack,
  S12_CORE_QA_PROFILE_V1
} from '../src/services/geometry_gate_service.js';
import {
  hashActorId,
  recordFirstPartyActivity
} from '../src/services/first_party_activity_service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.PGHOST);

async function resetCanonicalTables(): Promise<void> {
  const pool = getPgPool();
  assert.ok(pool, 'PostgreSQL pool must exist for DB integration tests');
  await pool.query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO public;
  `);
}

function recordedGpx(name: string, minuteOffset: number): string {
  const t0 = new Date(Date.UTC(2026, 7, 16, 2, minuteOffset, 0));
  const t1 = new Date(t0.getTime() + 5 * 60_000);
  const t2 = new Date(t0.getTime() + 10 * 60_000);
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>${name}</name><trkseg>
<trkpt lat="32.0441" lon="118.8515"><time>${t0.toISOString()}</time></trkpt>
<trkpt lat="32.0518" lon="118.8554"><time>${t1.toISOString()}</time></trkpt>
<trkpt lat="32.0556" lon="118.8542"><time>${t2.toISOString()}</time></trkpt>
</trkseg></trk></gpx>`;
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

test('RawTrack -> spatial gate -> first-party consensus stays review-only until canonical promotion', { skip: !hasDatabase }, async () => {
  const pool = getPgPool();
  assert.ok(pool);
  const repo = new CanonicalPostgresRepository(pool);

  const gpx1 = await ingestCanonicalRawTrack(pool, {
    format: 'GPX',
    fileName: 's12_actor_a_day1.gpx',
    payload: recordedGpx('S12 A day1', 0),
    sourceTrackId: 'ci-s12-a-1'
  });
  const gpx2 = await ingestCanonicalRawTrack(pool, {
    format: 'GPX',
    fileName: 's12_actor_a_day2.gpx',
    payload: recordedGpx('S12 A day2', 20),
    sourceTrackId: 'ci-s12-a-2'
  });
  const gpx3 = await ingestCanonicalRawTrack(pool, {
    format: 'GPX',
    fileName: 's12_actor_b_day1.gpx',
    payload: recordedGpx('S12 B day1', 40),
    sourceTrackId: 'ci-s12-b-1'
  });

  for (const track of [gpx1, gpx2, gpx3]) {
    assert.equal(track.provenanceClass, 'RECORDED_GPS');
    assert.equal(track.recordedExecution, true);
    assert.equal(track.pointCount, 3);
    assert.equal(track.timestampCount, 3);
  }

  await assert.rejects(
    assignCanonicalRawTrack(pool, {
      rawTrackId: gpx1.rawTrackId,
      routeId: 'ZJ-S12-A',
      assignmentState: 'TARGET_ACCEPTED',
      geometryGateState: 'PASS'
    }),
    /Direct TARGET_ACCEPTED assignment is disabled/
  );

  const gate1 = await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: gpx1.rawTrackId,
    routeId: 'ZJ-S12-A',
    profile: S12_CORE_QA_PROFILE_V1,
    independentProvenanceKey: 'CI-EXECUTION-A-1'
  });
  const gate2 = await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: gpx2.rawTrackId,
    routeId: 'ZJ-S12-A',
    profile: S12_CORE_QA_PROFILE_V1,
    independentProvenanceKey: 'CI-EXECUTION-A-2'
  });
  const gate3 = await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: gpx3.rawTrackId,
    routeId: 'ZJ-S12-A',
    profile: S12_CORE_QA_PROFILE_V1,
    independentProvenanceKey: 'CI-EXECUTION-B-1'
  });
  for (const gate of [gate1, gate2, gate3]) {
    assert.equal(gate.gateState, 'PASS');
    assert.equal(gate.assignmentState, 'TARGET_ACCEPTED');
    assert.equal(gate.directionClass, 'FORWARD');
    assert.ok(gate.anchors.every(a => a.hitClass === 'STRONG'));
  }

  assert.equal(await repo.countIndependentAcceptedRawExecutions('ZJ-S12-A'), 3);

  const planned = await ingestCanonicalRawTrack(pool, {
    format: 'KML',
    fileName: 's12_control.kml',
    payload: '<kml><Placemark><LineString><coordinates>118.8515,32.0441 118.8554,32.0518 118.8542,32.0556</coordinates></LineString></Placemark></kml>'
  });
  assert.equal(planned.provenanceClass, 'PLANNED_NAVIGATION_LINE');
  assert.equal(planned.recordedExecution, false);

  const plannedGate = await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: planned.rawTrackId,
    routeId: 'ZJ-S12-A',
    profile: S12_CORE_QA_PROFILE_V1
  });
  assert.equal(plannedGate.gateState, 'CONTROL_ONLY');
  assert.equal(plannedGate.assignmentState, 'CONTROL_ONLY');

  const far = await ingestCanonicalRawTrack(pool, {
    format: 'GPX',
    fileName: 'far_recorded.gpx',
    payload: '<gpx><trk><trkseg>' +
      '<trkpt lat="31.90" lon="118.60"><time>2026-08-16T03:00:00Z</time></trkpt>' +
      '<trkpt lat="31.91" lon="118.61"><time>2026-08-16T03:05:00Z</time></trkpt>' +
      '<trkpt lat="31.92" lon="118.62"><time>2026-08-16T03:10:00Z</time></trkpt>' +
      '</trkseg></trk></gpx>'
  });
  const farGate = await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: far.rawTrackId,
    routeId: 'ZJ-S12-A',
    profile: S12_CORE_QA_PROFILE_V1,
    independentProvenanceKey: 'CI-FAR-NEGATIVE'
  });
  assert.equal(farGate.gateState, 'FAIL');
  assert.equal(farGate.assignmentState, 'TARGET_REJECTED');
  assert.ok(farGate.anchors.some(a => a.hitClass === 'MISS'));

  const actorA = hashActorId('ci-actor-a', 'ci-only-salt');
  const actorB = hashActorId('ci-actor-b', 'ci-only-salt');

  await recordFirstPartyActivity(pool, {
    actorHash: actorA,
    rawTrackId: gpx1.rawTrackId,
    recordedAt: '2026-08-16T02:00:00Z',
    routeId: 'ZJ-S12-A',
    assignmentState: 'TARGET_ACCEPTED',
    geometryGateState: 'PASS',
    integrityState: 'PASS'
  });
  await recordFirstPartyActivity(pool, {
    actorHash: actorA,
    rawTrackId: gpx2.rawTrackId,
    recordedAt: '2026-08-17T02:00:00Z',
    routeId: 'ZJ-S12-A',
    assignmentState: 'TARGET_ACCEPTED',
    geometryGateState: 'PASS',
    integrityState: 'PASS'
  });

  assert.equal(await repo.countIndependentAcceptedActors('ZJ-S12-A'), 1,
    'same actor across multiple days is repeatability support, not full independence');

  await recordFirstPartyActivity(pool, {
    actorHash: actorB,
    rawTrackId: gpx3.rawTrackId,
    recordedAt: '2026-08-18T02:00:00Z',
    routeId: 'ZJ-S12-A',
    assignmentState: 'TARGET_ACCEPTED',
    geometryGateState: 'PASS',
    integrityState: 'PASS'
  });

  assert.equal(await repo.countIndependentAcceptedActors('ZJ-S12-A'), 2);

  const routeAfterEvidence = await repo.findRoute('ZJ-S12-A');
  assert.equal(routeAfterEvidence?.route_state, 'GEOMETRY_BLOCKED',
    'evidence ingestion must never auto-promote canonical route state');
  assert.equal(routeAfterEvidence?.active_canonical_track_id, null);

  const canonicalTrackCount = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM canonical_track WHERE route_id = 'ZJ-S12-A'`
  );
  assert.equal(Number(canonicalTrackCount.rows[0]?.count ?? 0), 0);
});
