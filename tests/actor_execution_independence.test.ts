import test from 'node:test';
import assert from 'node:assert/strict';
import { getPgPool } from '../src/config/database.js';
import { runDatabaseMigrations } from '../src/migration_runner.js';
import { seedCanonicalDatabase } from '../db/canonical_seed_runner.js';
import { ingestCanonicalRawTrack } from '../src/services/canonical_track_ingest_service.js';
import {
  evaluateAndAssignCanonicalRawTrack,
  type GeometryGateProfile
} from '../src/services/geometry_gate_service.js';
import { evaluateGeometryConsensusReadiness } from '../src/services/geometry_consensus_service.js';
import { hashActorId, recordFirstPartyActivity } from '../src/services/first_party_activity_service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const ROUTE_ID = 'CI-ACTOR-EXEC-INDEPENDENCE';

const FULL_ROUTE_PROFILE: GeometryGateProfile = {
  profileId: 'CI-ACTOR-EXEC-INDEPENDENCE-FULL-QA-V1',
  routeId: ROUTE_ID,
  profileVersion: 1,
  purpose: 'FULL_ROUTE_QA',
  requireDirection: 'FORWARD',
  acceptanceClass: 'STRONG',
  anchors: [
    { anchorId: 'A1', label: 'start', longitude: 118.8515, latitude: 32.0441, strongMaxMeters: 40, nearMaxMeters: 100 },
    { anchorId: 'A2', label: 'middle', longitude: 118.8554, latitude: 32.0518, strongMaxMeters: 40, nearMaxMeters: 100 },
    { anchorId: 'A3', label: 'end', longitude: 118.8542, latitude: 32.0556, strongMaxMeters: 40, nearMaxMeters: 100 }
  ]
};

async function resetAndSeed(): Promise<void> {
  const pool = getPgPool();
  assert.ok(pool);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
  const migration = await runDatabaseMigrations();
  assert.equal(migration.success, true, migration.message);
  const seed = await seedCanonicalDatabase();
  assert.equal(seed.success, true);

  await pool.query(
    `INSERT INTO route (
       route_id, route_family_id, area_id, canonical_name, identity_state, route_state, version
     ) VALUES ($1, 'ZJ-S12-RF', 'AREA-NJ-ZIJINSHAN', 'CI actor/execution independence fixture', 'CANDIDATE', 'GEOMETRY_BLOCKED', 1)`,
    [ROUTE_ID]
  );
}

function recordedGpx(name: string, minuteOffset: number): string {
  const base = new Date(Date.UTC(2026, 7, 16, 7, minuteOffset, 0));
  const stamps = [0, 5, 10].map(m => new Date(base.getTime() + m * 60_000).toISOString());
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>${name}</name><trkseg>
<trkpt lat="32.0441" lon="118.8515"><time>${stamps[0]}</time></trkpt>
<trkpt lat="32.0518" lon="118.8554"><time>${stamps[1]}</time></trkpt>
<trkpt lat="32.0556" lon="118.8542"><time>${stamps[2]}</time></trkpt>
</trkseg></trk></gpx>`;
}

test('Two actors on one execution do not satisfy two-execution public independence', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  const pool = getPgPool();
  assert.ok(pool);

  const track1 = await ingestCanonicalRawTrack(pool, {
    format: 'GPX',
    payload: recordedGpx('actor-exec-1', 0),
    sourceTrackId: 'actor-exec-1'
  });
  const track2 = await ingestCanonicalRawTrack(pool, {
    format: 'GPX',
    payload: recordedGpx('actor-exec-2', 20),
    sourceTrackId: 'actor-exec-2'
  });

  await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: track1.rawTrackId,
    routeId: ROUTE_ID,
    profile: FULL_ROUTE_PROFILE,
    independentProvenanceKey: 'INDEPENDENT-EXECUTION-1'
  });
  await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: track2.rawTrackId,
    routeId: ROUTE_ID,
    profile: FULL_ROUTE_PROFILE,
    independentProvenanceKey: 'INDEPENDENT-EXECUTION-2'
  });

  const actorA = hashActorId('ci-actor-exec-a', 'ci-actor-exec-salt');
  const actorB = hashActorId('ci-actor-exec-b', 'ci-actor-exec-salt');

  // Both distinct actors are attached to the SAME accepted execution. The
  // second accepted RawTrack has no first-party actor evidence yet.
  await recordFirstPartyActivity(pool, {
    actorHash: actorA,
    rawTrackId: track1.rawTrackId,
    recordedAt: '2026-08-16T07:00:00Z',
    routeId: ROUTE_ID,
    assignmentState: 'TARGET_ACCEPTED',
    integrityState: 'PASS'
  });
  await recordFirstPartyActivity(pool, {
    actorHash: actorB,
    rawTrackId: track1.rawTrackId,
    recordedAt: '2026-08-16T07:01:00Z',
    routeId: ROUTE_ID,
    assignmentState: 'TARGET_ACCEPTED',
    integrityState: 'PASS'
  });

  const falseIndependenceAttempt = await evaluateGeometryConsensusReadiness(pool, ROUTE_ID);
  assert.equal(falseIndependenceAttempt.independentExecutionCount, 2);
  assert.equal(falseIndependenceAttempt.distinctActorCount, 2);
  assert.equal(falseIndependenceAttempt.independentActorExecutionPairCount, 1);
  assert.equal(falseIndependenceAttempt.state, 'INSUFFICIENT_INDEPENDENT_ACTORS');
  assert.ok(
    falseIndependenceAttempt.reasonCodes.includes('INDEPENDENT_ACTOR_EXECUTION_PAIRS_1_OF_2')
  );

  // Once actor B is also observed on the second independent execution, a
  // one-to-one matching exists: actor A -> execution 1, actor B -> execution 2.
  await recordFirstPartyActivity(pool, {
    actorHash: actorB,
    rawTrackId: track2.rawTrackId,
    recordedAt: '2026-08-17T07:00:00Z',
    routeId: ROUTE_ID,
    assignmentState: 'TARGET_ACCEPTED',
    integrityState: 'PASS'
  });

  const ready = await evaluateGeometryConsensusReadiness(pool, ROUTE_ID);
  assert.equal(ready.independentExecutionCount, 2);
  assert.equal(ready.distinctActorCount, 2);
  assert.equal(ready.independentActorExecutionPairCount, 2);
  assert.equal(ready.state, 'READY_FOR_EDITORIAL_CANONICALIZATION');
  assert.ok(ready.pairCompatibility.every(pair => pair.compatible));
  assert.equal(ready.autoPromoted, false);
});
