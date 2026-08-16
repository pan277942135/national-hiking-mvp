import test from 'node:test';
import assert from 'node:assert/strict';
import { getPgPool } from '../src/config/database.js';
import { runDatabaseMigrations } from '../src/migration_runner.js';
import { seedCanonicalDatabase } from '../db/canonical_seed_runner.js';
import { ingestCanonicalRawTrack } from '../src/services/canonical_track_ingest_service.js';
import {
  evaluateAndAssignCanonicalRawTrack,
  S12_CORE_QA_PROFILE_V1
} from '../src/services/geometry_gate_service.js';
import { hashActorId, recordFirstPartyActivity } from '../src/services/first_party_activity_service.js';

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

const corePassingGpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
<trkpt lat="32.04416944444444" lon="118.8515861111111"><time>2026-08-16T09:00:00Z</time></trkpt>
<trkpt lat="32.05183" lon="118.85542"><time>2026-08-16T09:05:00Z</time></trkpt>
<trkpt lat="32.0555861" lon="118.8542"><time>2026-08-16T09:10:00Z</time></trkpt>
</trkseg></trk></gpx>`;

test('S12 core-only QA cannot be upgraded into first-party TARGET_ACCEPTED', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  const pool = getPgPool();
  assert.ok(pool);

  const raw = await ingestCanonicalRawTrack(pool, {
    format: 'GPX',
    payload: corePassingGpx,
    sourceTrackId: 'ci-s12-core-only'
  });
  const gate = await evaluateAndAssignCanonicalRawTrack(pool, {
    rawTrackId: raw.rawTrackId,
    routeId: 'ZJ-S12-A',
    profile: S12_CORE_QA_PROFILE_V1,
    independentProvenanceKey: 'CI-S12-CORE-ONLY'
  });

  assert.equal(gate.gateState, 'PASS');
  assert.equal(gate.profilePurpose, 'CORE_QA');
  assert.equal(gate.assignmentState, 'UNCLASSIFIED');

  const actorHash = hashActorId('ci-s12-core-actor', 'ci-s12-core-salt');
  await assert.rejects(
    recordFirstPartyActivity(pool, {
      actorHash,
      rawTrackId: raw.rawTrackId,
      recordedAt: '2026-08-16T09:00:00Z',
      routeId: 'ZJ-S12-A',
      assignmentState: 'TARGET_ACCEPTED',
      integrityState: 'PASS'
    }),
    /conflicts with RawTrack gate truth UNCLASSIFIED|requires a prior FULL_ROUTE_QA/
  );

  const count = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM activity_route_assignment
      WHERE route_id = 'ZJ-S12-A' AND assignment_state = 'TARGET_ACCEPTED'`
  );
  assert.equal(Number(count.rows[0]?.count ?? 0), 0);
});
