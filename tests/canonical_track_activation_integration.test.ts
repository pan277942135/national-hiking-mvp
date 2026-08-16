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
import { hashActorId, recordFirstPartyActivity } from '../src/services/first_party_activity_service.js';
import { evaluateGeometryConsensusReadiness } from '../src/services/geometry_consensus_service.js';
import { activateCanonicalTrackFromAcceptedRaw } from '../src/services/canonical_track_activation_service.js';
import { buildCanonicalRoutePageProjection } from '../src/services/canonical_page_projection_service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const ROUTE_ID = 'CI-CANONICAL-ACTIVATION';

async function resetAndSeed(options: { includeSyntheticRoute?: boolean } = {}): Promise<void> {
  const pool = getPgPool();
  assert.ok(pool);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
  const migration = await runDatabaseMigrations();
  assert.equal(migration.success, true, migration.message);
  const seed = await seedCanonicalDatabase();
  assert.equal(seed.success, true);

  if (options.includeSyntheticRoute !== false) {
    await pool.query(
      `INSERT INTO route (
         route_id, route_family_id, area_id, canonical_name, identity_state, route_state, version
       ) VALUES ($1, 'ZJ-S12-RF', 'AREA-NJ-ZIJINSHAN', 'CI canonical activation fixture',
                 'CANDIDATE', 'GEOMETRY_BLOCKED', 1)`,
      [ROUTE_ID]
    );
  }
}

function profile(): GeometryGateProfile {
  return {
    profileId: `${ROUTE_ID}-FULL-QA-V1`,
    routeId: ROUTE_ID,
    profileVersion: 1,
    purpose: 'FULL_ROUTE_QA',
    requireDirection: 'FORWARD',
    acceptanceClass: 'STRONG',
    anchors: [
      { anchorId: 'C01', label: 'start', longitude: 118.8515, latitude: 32.0441, strongMaxMeters: 30, nearMaxMeters: 80 },
      { anchorId: 'C02', label: 'middle', longitude: 118.8554, latitude: 32.0518, strongMaxMeters: 30, nearMaxMeters: 80 },
      { anchorId: 'C03', label: 'end', longitude: 118.8542, latitude: 32.0556, strongMaxMeters: 30, nearMaxMeters: 80 }
    ]
  };
}

function gpx(name: string, minuteOffset: number, lonOffset = 0): string {
  const t0 = new Date(Date.UTC(2026, 7, 16, 7, minuteOffset, 0));
  const times = [t0, new Date(t0.getTime() + 300_000), new Date(t0.getTime() + 600_000)];
  const points = [
    [32.0441, 118.8515 + lonOffset],
    [32.0518, 118.8554 + lonOffset],
    [32.0556, 118.8542 + lonOffset]
  ];
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>${name}</name><trkseg>${points
    .map(([lat, lon], i) => `<trkpt lat="${lat}" lon="${lon}"><time>${times[i].toISOString()}</time></trkpt>`)
    .join('')}</trkseg></trk></gpx>`;
}

test('Reviewed activation copies one approved RawTrack exactly and never infers EXECUTABLE', { skip: !hasDatabase }, async () => {
  await resetAndSeed();
  const pool = getPgPool();
  assert.ok(pool);
  const gateProfile = profile();

  const t1 = await ingestCanonicalRawTrack(pool, { format: 'GPX', payload: gpx('canonical-source-1', 0) });
  const t2 = await ingestCanonicalRawTrack(pool, { format: 'GPX', payload: gpx('canonical-source-2', 20, 0.00002) });

  for (const [track, key] of [[t1, 'CANON-EXEC-1'], [t2, 'CANON-EXEC-2']] as const) {
    const gate = await evaluateAndAssignCanonicalRawTrack(pool, {
      rawTrackId: track.rawTrackId,
      routeId: ROUTE_ID,
      profile: gateProfile,
      independentProvenanceKey: key
    });
    assert.equal(gate.assignmentState, 'TARGET_ACCEPTED');
  }

  const actorA = hashActorId('canonical-actor-a', 'ci-canonical-salt');
  const actorB = hashActorId('canonical-actor-b', 'ci-canonical-salt');
  await recordFirstPartyActivity(pool, {
    actorHash: actorA,
    rawTrackId: t1.rawTrackId,
    recordedAt: '2026-08-16T07:00:00Z',
    routeId: ROUTE_ID,
    assignmentState: 'TARGET_ACCEPTED',
    integrityState: 'PASS'
  });
  await recordFirstPartyActivity(pool, {
    actorHash: actorB,
    rawTrackId: t2.rawTrackId,
    recordedAt: '2026-08-16T08:00:00Z',
    routeId: ROUTE_ID,
    assignmentState: 'TARGET_ACCEPTED',
    integrityState: 'PASS'
  });

  const readiness = await evaluateGeometryConsensusReadiness(pool, ROUTE_ID);
  assert.equal(readiness.state, 'READY_FOR_EDITORIAL_CANONICALIZATION');

  const activated = await activateCanonicalTrackFromAcceptedRaw(pool, {
    routeId: ROUTE_ID,
    sourceRawTrackId: t1.rawTrackId,
    reviewerId: 'ci-editor-001',
    reviewNote: 'Explicit CI editorial approval of synthetic fixture only.'
  });
  assert.equal(activated.routeState, 'STATIC_PUBLISHABLE');
  assert.equal(activated.autoPromoted, false);
  assert.equal(activated.legalClearanceInferred, false);
  assert.ok(activated.distanceMeters > 0);
  assert.equal(activated.elevationGainMeters, null);

  const equality = await pool.query<{ same_geometry: boolean; derivation: string; reviewer: string }>(
    `SELECT
       ST_Equals(ct.geometry, rt.geometry) AS same_geometry,
       ct.qa->>'geometry_derivation' AS derivation,
       ct.qa->>'reviewer_id' AS reviewer
     FROM canonical_track ct
     JOIN raw_track rt ON rt.raw_track_id = $2
     WHERE ct.canonical_track_id = $1`,
    [activated.canonicalTrackId, t1.rawTrackId]
  );
  assert.equal(equality.rows[0]?.same_geometry, true);
  assert.equal(equality.rows[0]?.derivation, 'COPY_APPROVED_RAW_TRACK_NO_AVERAGING');
  assert.equal(equality.rows[0]?.reviewer, 'ci-editor-001');

  const route = await pool.query<{ route_state: string; active_canonical_track_id: string; version: number }>(
    'SELECT route_state, active_canonical_track_id, version FROM route WHERE route_id = $1',
    [ROUTE_ID]
  );
  assert.equal(route.rows[0]?.route_state, 'STATIC_PUBLISHABLE');
  assert.equal(route.rows[0]?.active_canonical_track_id, activated.canonicalTrackId);
  assert.equal(route.rows[0]?.version, 2);

  const projection = await buildCanonicalRoutePageProjection(pool, ROUTE_ID);
  assert.equal(projection.geometry.state, 'CANONICAL_TRACK_ACTIVE');
  assert.equal(projection.geometry.navigation_visible, false);
  assert.equal(projection.geometry.map_download_visible, false);
  assert.equal(projection.geometry.distance_meters, activated.distanceMeters);
  assert.equal(projection.geometry.elevation_gain_meters, null);
});

test('Production S12-A cannot be canonicalized without real full-route consensus', { skip: !hasDatabase }, async () => {
  await resetAndSeed({ includeSyntheticRoute: false });
  const pool = getPgPool();
  assert.ok(pool);

  const count = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM canonical_track WHERE route_id = 'ZJ-S12-A'`
  );
  assert.equal(Number(count.rows[0]?.count ?? 0), 0);

  await assert.rejects(
    activateCanonicalTrackFromAcceptedRaw(pool, {
      routeId: 'ZJ-S12-A',
      sourceRawTrackId: 'NONEXISTENT-RAW',
      reviewerId: 'ci-editor-001'
    }),
    /Geometry consensus is not ready for canonicalization/
  );

  const route = await pool.query<{ route_state: string; active_canonical_track_id: string | null }>(
    `SELECT route_state, active_canonical_track_id FROM route WHERE route_id = 'ZJ-S12-A'`
  );
  assert.equal(route.rows[0]?.route_state, 'GEOMETRY_BLOCKED');
  assert.equal(route.rows[0]?.active_canonical_track_id, null);
});
