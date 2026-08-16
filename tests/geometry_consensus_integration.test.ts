import test from 'node:test';
import assert from 'node:assert/strict';
import { getPgPool } from '../src/config/database.js';
import { runDatabaseMigrations } from '../src/migration_runner.js';
import { seedCanonicalDatabase } from '../db/canonical_seed_runner.js';
import { ingestCanonicalRawTrack } from '../src/services/canonical_track_ingest_service.js';
import {
  evaluateAndAssignCanonicalRawTrack,
  GeometryGateProfile
} from '../src/services/geometry_gate_service.js';
import {
  evaluateGeometryConsensusReadiness
} from '../src/services/geometry_consensus_service.js';
import {
  hashActorId,
  recordFirstPartyActivity
} from '../src/services/first_party_activity_service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.PGHOST);

async function resetAndSeed(): Promise<void> {
  const pool = getPgPool();
  assert.ok(pool);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
  const migration = await runDatabaseMigrations();
  assert.equal(migration.success, true, migration.message);
  const seed = await seedCanonicalDatabase();
  assert.equal(seed.success, true);
}

function gpx(name: string, minuteOffset: number, longitudeOffset = 0): string {
  const t0 = new Date(Date.UTC(2026, 7, 16, 4, minuteOffset, 0));
  const t1 = new Date(t0.getTime() + 5 * 60_000);
  const t2 = new Date(t0.getTime() + 10 * 60_000);
  const p = [
    [32.0441, 118.8515 + longitudeOffset, t0],
    [32.0518, 118.8554 + longitudeOffset, t1],
    [32.0556, 118.8542 + longitudeOffset, t2]
  ];
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>${name}</name><trkseg>${p
    .map(([lat, lon, time]) => `<trkpt lat="${lat}" lon="${lon}"><time>${(time as Date).toISOString()}</time></trkpt>`)
    .join('')}</trkseg></trk></gpx>`;
}

async function createSyntheticRoute(routeId: string): Promise<void> {
  const pool = getPgPool();
  assert.ok(pool);
  await pool.query(
    `INSERT INTO route (
       route_id, route_family_id, area_id, canonical_name, identity_state, route_state, version
     ) VALUES ($1, 'ZJ-S12-RF', 'AREA-NJ-ZIJINSHAN', $2, 'CANDIDATE', 'GEOMETRY_BLOCKED', 1)`,
    [routeId, `CI ${routeId}`]
  );
}

function fullProfile(routeId: string, strongMaxMeters = 40): GeometryGateProfile {
  return {
    profileId: `${routeId}-FULL-QA-V1`,
    routeId,
    profileVersion: 1,
    purpose: 'FULL_ROUTE_QA',
    requireDirection: 'FORWARD',
    acceptanceClass: 'STRONG',
    anchors: [
      { anchorId: 'Q01', label: 'start', longitude: 118.8515, latitude: 32.0441, strongMaxMeters, nearMaxMeters: 120 },
      { anchorId: 'Q02', label: 'middle', longitude: 118.8554, latitude: 32.0518, strongMaxMeters, nearMaxMeters: 120 },
      { anchorId: 'Q03', label: 'end', longitude: 118.8542, latitude: 32.0556, strongMaxMeters, nearMaxMeters: 120 }
    ]
  };
}

test('FIRST_PARTY_PUBLIC readiness requires two independent actors and never auto-promotes', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  const pool = getPgPool();
  assert.ok(pool);

  const routeId = 'CI-CONSENSUS-READY';
  await createSyntheticRoute(routeId);
  const profile = fullProfile(routeId);

  const t1 = await ingestCanonicalRawTrack(pool, { format: 'GPX', payload: gpx('ready-1', 0) });
  const t2 = await ingestCanonicalRawTrack(pool, { format: 'GPX', payload: gpx('ready-2', 20) });
  await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: t1.rawTrackId, routeId, profile, independentProvenanceKey: 'READY-EXEC-1'
  });
  await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: t2.rawTrackId, routeId, profile, independentProvenanceKey: 'READY-EXEC-2'
  });

  const actorA = hashActorId('consensus-actor-a', 'ci-consensus-salt');
  await recordFirstPartyActivity(pool, {
    actorHash: actorA, rawTrackId: t1.rawTrackId, recordedAt: '2026-08-16T04:00:00Z',
    routeId, assignmentState: 'TARGET_ACCEPTED', geometryGateState: 'PASS', integrityState: 'PASS'
  });
  await recordFirstPartyActivity(pool, {
    actorHash: actorA, rawTrackId: t2.rawTrackId, recordedAt: '2026-08-17T04:00:00Z',
    routeId, assignmentState: 'TARGET_ACCEPTED', geometryGateState: 'PASS', integrityState: 'PASS'
  });

  const oneActor = await evaluateGeometryConsensusReadiness(pool, routeId);
  assert.equal(oneActor.independentExecutionCount, 2);
  assert.equal(oneActor.distinctActorCount, 1);
  assert.equal(oneActor.state, 'INSUFFICIENT_INDEPENDENT_ACTORS');
  assert.equal(oneActor.autoPromoted, false);

  const actorB = hashActorId('consensus-actor-b', 'ci-consensus-salt');
  await recordFirstPartyActivity(pool, {
    actorHash: actorB, rawTrackId: t2.rawTrackId, recordedAt: '2026-08-18T04:00:00Z',
    routeId, assignmentState: 'TARGET_ACCEPTED', geometryGateState: 'PASS', integrityState: 'PASS'
  });

  const ready = await evaluateGeometryConsensusReadiness(pool, routeId);
  assert.equal(ready.state, 'READY_FOR_EDITORIAL_CANONICALIZATION');
  assert.equal(ready.independentExecutionCount, 2);
  assert.equal(ready.distinctActorCount, 2);
  assert.ok(ready.pairCompatibility.every(pair => pair.compatible));
  assert.equal(ready.editorialActionRequired, true);
  assert.equal(ready.autoPromoted, false);

  const route = await pool.query<{ route_state: string; active_canonical_track_id: string | null }>(
    'SELECT route_state, active_canonical_track_id FROM route WHERE route_id = $1',
    [routeId]
  );
  assert.equal(route.rows[0]?.route_state, 'GEOMETRY_BLOCKED');
  assert.equal(route.rows[0]?.active_canonical_track_id, null);

  const productionS12 = await evaluateGeometryConsensusReadiness(pool, 'ZJ-S12-A');
  assert.equal(productionS12.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(productionS12.independentExecutionCount, 0);
});

test('Two full-route passes can still be rejected as an incompatible geometry cluster', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  const pool = getPgPool();
  assert.ok(pool);

  const routeId = 'CI-CONSENSUS-INCOMPATIBLE';
  await createSyntheticRoute(routeId);
  // Both tracks may pass broad 65m anchor tolerances while being >70m apart
  // from one another. This catches false consensus from anchor-only agreement.
  const profile = fullProfile(routeId, 65);

  const east = await ingestCanonicalRawTrack(pool, { format: 'GPX', payload: gpx('east', 0, 0.00055) });
  const west = await ingestCanonicalRawTrack(pool, { format: 'GPX', payload: gpx('west', 20, -0.00055) });

  const eastGate = await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: east.rawTrackId, routeId, profile, independentProvenanceKey: 'EAST-EXEC'
  });
  const westGate = await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: west.rawTrackId, routeId, profile, independentProvenanceKey: 'WEST-EXEC'
  });
  assert.equal(eastGate.assignmentState, 'TARGET_ACCEPTED');
  assert.equal(westGate.assignmentState, 'TARGET_ACCEPTED');

  const actorA = hashActorId('east-actor', 'ci-consensus-salt');
  const actorB = hashActorId('west-actor', 'ci-consensus-salt');
  await recordFirstPartyActivity(pool, {
    actorHash: actorA, rawTrackId: east.rawTrackId, recordedAt: '2026-08-16T05:00:00Z',
    routeId, assignmentState: 'TARGET_ACCEPTED', geometryGateState: 'PASS', integrityState: 'PASS'
  });
  await recordFirstPartyActivity(pool, {
    actorHash: actorB, rawTrackId: west.rawTrackId, recordedAt: '2026-08-16T06:00:00Z',
    routeId, assignmentState: 'TARGET_ACCEPTED', geometryGateState: 'PASS', integrityState: 'PASS'
  });

  const result = await evaluateGeometryConsensusReadiness(pool, routeId);
  assert.equal(result.independentExecutionCount, 2);
  assert.equal(result.distinctActorCount, 2);
  assert.equal(result.state, 'INCOMPATIBLE_CLUSTER');
  assert.ok(result.pairCompatibility.some(pair => !pair.compatible));
  assert.equal(result.autoPromoted, false);
});
