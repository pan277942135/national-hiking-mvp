import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evidenceFingerprint,
  normalizeWorkBuddyEvidence,
  parseWorkBuddyResultBatch,
  sourceTypeForGap
} from '../src/acquisition/workbuddy_result_importer.js';
import { createDefaultValidatorRegistry } from '../src/validation/validator_registry.js';
import {
  analyzeTrack,
  compareTrackGeometry,
  evaluateGeometryConsensus
} from '../src/geometry/geometry_engine.js';

function makeGpx(latOffset = 0, lonOffset = 0, startTime = '2026-08-18T00:00:00Z'): string {
  const base = new Date(startTime).getTime();
  const points = Array.from({ length: 40 }, (_, index) => {
    const lat = 32.050000 + latOffset + index * 0.00003;
    const lon = 118.800000 + lonOffset + index * 0.00045;
    const time = new Date(base + index * 30_000).toISOString();
    return `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${50 + index}</ele><time>${time}</time></trkpt>`;
  }).join('');
  return `<gpx version="1.1"><trk><trkseg>${points}</trkseg></trk></gpx>`;
}

test('WorkBuddy importer contract: validates batch and maps one result to one raw evidence envelope', () => {
  const batch = parseWorkBuddyResultBatch({
    task_id: 'WB-ZJ-P0-DELTA-001',
    captured_at: '2026-08-18T01:00:00Z',
    results: [
      {
        gap_key: 'night_access_policy',
        access_point_name: '蒋王庙登山口',
        source_platform: '小红书',
        source_url: 'https://example.test/note/1',
        native_id: 'note-1',
        captured_at: '2026-08-18T01:00:00Z',
        claimed_opening_or_closing_time: '22:00关闭'
      }
    ],
    blocked_items: [],
    notes: 'raw only'
  });

  const normalized = normalizeWorkBuddyEvidence(batch);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].gapKey, 'night_access_policy');
  assert.equal(normalized[0].sourceType, 'ACCESS_EVIDENCE');
  assert.equal(normalized[0].nativeId, 'note-1');
  assert.match(normalized[0].fingerprint, /^[0-9a-f]{64}$/);
});

test('WorkBuddy importer contract: stable fingerprint ignores object key ordering', () => {
  const a = evidenceFingerprint({ b: 2, a: { y: 2, x: 1 } });
  const b = evidenceFingerprint({ a: { x: 1, y: 2 }, b: 2 });
  assert.equal(a, b);
  assert.equal(sourceTypeForGap('route_zj_s12_a_geometry'), 'TRACK_CANDIDATE_METADATA');
});

test('WorkBuddy importer contract: rejects result without source_url', () => {
  assert.throws(() => parseWorkBuddyResultBatch({
    task_id: 'WB-ZJ-P0-DELTA-001',
    captured_at: '2026-08-18T01:00:00Z',
    results: [{ gap_key: 'night_access_policy', source_platform: '小红书', captured_at: '2026-08-18T01:00:00Z' }],
    blocked_items: []
  }), /source_url is required/);
});

test('Validator Registry: two independent recent night-access observations can become canonical candidate', () => {
  const registry = createDefaultValidatorRegistry();
  const decision = registry.validate('night_access_policy', [
    {
      access_point_name: '蒋王庙登山口', source_platform: '小红书', source_url: 'https://x/1', native_id: 'x1',
      published_at: '2026-08-10T00:00:00Z', captured_at: '2026-08-18T00:00:00Z',
      claimed_opening_or_closing_time: '22:00关闭'
    },
    {
      access_point_name: '蒋王庙登山口', source_platform: '抖音', source_url: 'https://d/2', native_id: 'd2',
      published_at: '2026-08-12T00:00:00Z', captured_at: '2026-08-18T00:00:00Z',
      claimed_opening_or_closing_time: '22:00关闭'
    }
  ], { targetKey: '蒋王庙登山口', now: new Date('2026-08-18T08:00:00Z') });

  assert.equal(decision.state, 'CANONICAL_CANDIDATE');
  assert.equal(decision.accepted_record_count, 2);
});

test('Validator Registry: conflicting night-access observations remain supported, never silently reconciled', () => {
  const registry = createDefaultValidatorRegistry();
  const decision = registry.validate('night_access_policy', [
    {
      access_point_name: '蒋王庙登山口', source_platform: '小红书', source_url: 'https://x/1', native_id: 'x1',
      published_at: '2026-08-10T00:00:00Z', claimed_opening_or_closing_time: '22:00关闭'
    },
    {
      access_point_name: '蒋王庙登山口', source_platform: '抖音', source_url: 'https://d/2', native_id: 'd2',
      published_at: '2026-08-12T00:00:00Z', claimed_opening_or_closing_time: '全天可进入'
    }
  ], { targetKey: '蒋王庙登山口', now: new Date('2026-08-18T08:00:00Z') });

  assert.equal(decision.state, 'SUPPORTED');
  assert.ok(decision.conflicts.length >= 2);
});

test('Validator Registry: official current parking fee can become canonical candidate', () => {
  const registry = createDefaultValidatorRegistry();
  const decision = registry.validate('parking_fee_current', [
    {
      parking_name: '紫金·钟爱里停车场', source_platform: '景区官方', source_url: 'https://official/parking',
      published_at: '2026-08-01T00:00:00Z', fee_text_raw: '白天6元/小时', operator_or_publisher: '中山陵园管理局'
    }
  ], { targetKey: '紫金·钟爱里停车场', now: new Date('2026-08-18T08:00:00Z') });

  assert.equal(decision.state, 'CANONICAL_CANDIDATE');
});

test('Validator Registry: geometry metadata only reaches READY_FOR_TRACK_QA, never canonical geometry', () => {
  const registry = createDefaultValidatorRegistry();
  const decision = registry.validate('route_zj_s12_a_geometry', [
    {
      source_platform: '两步路', source_url: 'https://2bulu/1', track_id: 't1', author: 'a1',
      is_complete_claim: true, local_file_name_if_legitimate: 't1.gpx'
    },
    {
      source_platform: '六只脚', source_url: 'https://foooooot/2', track_id: 't2', author: 'a2',
      is_complete_claim: true, local_file_name_if_legitimate: 't2.gpx'
    }
  ]);

  assert.equal(decision.state, 'READY_FOR_TRACK_QA');
  assert.notEqual(decision.state, 'CANONICAL_CANDIDATE');
});

test('Geometry Engine: planned KML line is rejected as canonical geometry evidence', () => {
  const coordinates = Array.from({ length: 40 }, (_, i) => `${118.8 + i * 0.0004},${32.05 + i * 0.00002},0`).join(' ');
  const analysis = analyzeTrack({
    trackId: 'planned-kml',
    format: 'KML',
    payload: `<kml><Placemark><LineString><coordinates>${coordinates}</coordinates></LineString></Placemark></kml>`
  });
  assert.equal(analysis.provenance_type, 'PLANNED_NAVIGATION_LINE');
  assert.equal(analysis.eligible_recorded_gps, false);
  assert.ok(analysis.qa_flags.includes('NOT_RECORDED_GPS'));
});

test('Geometry Engine: two independent compatible Recorded GPS tracks establish consensus', () => {
  const a = analyzeTrack({
    trackId: 'gps-a', format: 'GPX', payload: makeGpx(), sourcePlatform: '两步路', author: 'runner-a'
  });
  const b = analyzeTrack({
    trackId: 'gps-b', format: 'GPX', payload: makeGpx(0.00003, 0.00002, '2026-08-19T00:00:00Z'),
    sourcePlatform: '六只脚', author: 'runner-b'
  });
  const similarity = compareTrackGeometry(a, b);
  assert.equal(a.eligible_recorded_gps, true);
  assert.equal(b.eligible_recorded_gps, true);
  assert.equal(similarity.compatible, true);

  const consensus = evaluateGeometryConsensus([a, b]);
  assert.equal(consensus.status, 'ACCEPTED_CONSENSUS');
  assert.deepEqual(new Set(consensus.accepted_track_ids), new Set(['gps-a', 'gps-b']));
});

test('Geometry Engine: sibling route geometry cannot satisfy target consensus', () => {
  const target = analyzeTrack({
    trackId: 'target', format: 'GPX', payload: makeGpx(), sourcePlatform: '两步路', author: 'runner-a'
  });
  const sibling = analyzeTrack({
    trackId: 'sibling', format: 'GPX', payload: makeGpx(0.02, 0.02), sourcePlatform: '六只脚', author: 'runner-b'
  });
  const similarity = compareTrackGeometry(target, sibling);
  assert.equal(similarity.compatible, false);

  const consensus = evaluateGeometryConsensus([target, sibling]);
  assert.equal(consensus.status, 'GEOMETRY_BLOCKED');
});

test('Geometry Engine: identical duplicate geometry does not count as two independent tracks', () => {
  const payload = makeGpx();
  const a = analyzeTrack({
    trackId: 'dup-a', format: 'GPX', payload, sourcePlatform: '两步路', author: 'runner-a'
  });
  const b = analyzeTrack({
    trackId: 'dup-b', format: 'GPX', payload, sourcePlatform: '六只脚', author: 'runner-b'
  });
  assert.equal(a.geometry_fingerprint, b.geometry_fingerprint);
  const consensus = evaluateGeometryConsensus([a, b]);
  assert.equal(consensus.status, 'GEOMETRY_BLOCKED');
});
