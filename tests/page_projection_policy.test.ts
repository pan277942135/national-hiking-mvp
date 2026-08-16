import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepositories } from '../src/repository/repositories.js';
import { loadSeedManifest } from '../seed/seed_loader.js';
import { processTrackUpload } from '../src/services/track_service.js';
import { projectRoutePage } from '../src/services/page_projection_service.js';

function recordedGpx(name: string, offset: number): string {
  return `<gpx version="1.1"><trk><name>${name}</name><trkseg>` +
    `<trkpt lat="32.10${offset}" lon="118.80${offset}"><time>2026-08-16T08:00:00Z</time></trkpt>` +
    `<trkpt lat="32.11${offset}" lon="118.81${offset}"><time>2026-08-16T08:10:00Z</time></trkpt>` +
    `</trkseg></trk></gpx>`;
}

test('Canonical identity may publish while unapproved geometry metrics stay hidden', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  const projection = await projectRoutePage(repos, 'route_zj_s12_a');
  assert.equal(projection.identity_state, 'CANONICAL');
  assert.equal(projection.geometry_state, 'GEOMETRY_BLOCKED');
  assert.equal(projection.navigation_allowed, false);
  assert.equal(projection.distance_meters, undefined);
  assert.equal(projection.elevation_gain_meters, undefined);
  assert.equal(projection.estimated_duration_minutes, undefined);
});

test('Geometry-derived metrics publish only after accepted child-route consensus', async () => {
  const { repos } = createMemoryRepositories();
  await loadSeedManifest(repos);

  await repos.routes.save({
    id: 'route_projection_ready',
    family_id: 'rf_zj_s12',
    variant_code: 'TEST-PROJECTION-READY',
    name: 'Synthetic projection-ready route',
    identity_state: 'CANONICAL',
    geometry_state: 'ACCEPTED_CONSENSUS',
    distance_meters: 4321,
    elevation_gain_meters: 210,
    estimated_duration_minutes: 95
  });

  const t1 = await processTrackUpload(repos, { format: 'GPX', payload: recordedGpx('projection-1', 1) });
  const t2 = await processTrackUpload(repos, { format: 'GPX', payload: recordedGpx('projection-2', 2) });
  await repos.assignments.save({
    id: 'projection-a1', track_id: t1.track.id, route_id: 'route_projection_ready', match_status: 'ACCEPTED'
  });
  await repos.assignments.save({
    id: 'projection-a2', track_id: t2.track.id, route_id: 'route_projection_ready', match_status: 'ACCEPTED'
  });

  const projection = await projectRoutePage(repos, 'route_projection_ready');
  assert.equal(projection.navigation_allowed, true);
  assert.equal(projection.distance_meters, 4321);
  assert.equal(projection.elevation_gain_meters, 210);
  assert.equal(projection.estimated_duration_minutes, 95);
});
