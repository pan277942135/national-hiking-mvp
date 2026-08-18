import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkBuddyResultBatch } from '../src/acquisition/workbuddy_result_importer.js';

test('WorkBuddy gap inference: parking result does not require explicit gap_key', () => {
  const batch = parseWorkBuddyResultBatch({
    task_id: 'WB-ZJ-P0-DELTA-001',
    captured_at: '2026-08-18T01:00:00Z',
    results: [{
      parking_name: '紫金·钟爱里停车场',
      source_platform: '景区官方',
      source_url: 'https://example.test/parking',
      captured_at: '2026-08-18T01:00:00Z',
      fee_text_raw: '6元/小时'
    }],
    blocked_items: []
  });
  assert.equal(batch.results[0].gap_key, 'parking_fee_current');
});

test('WorkBuddy gap inference: track result maps to S12-A geometry gap', () => {
  const batch = parseWorkBuddyResultBatch({
    task_id: 'WB-ZJ-P0-DELTA-001',
    captured_at: '2026-08-18T01:00:00Z',
    results: [{
      track_id: '123456',
      source_platform: '两步路',
      source_url: 'https://example.test/track/123456',
      captured_at: '2026-08-18T01:00:00Z'
    }],
    blocked_items: []
  });
  assert.equal(batch.results[0].gap_key, 'route_zj_s12_a_geometry');
});

test('WorkBuddy gap inference: unknown result shape is rejected rather than guessed', () => {
  assert.throws(() => parseWorkBuddyResultBatch({
    task_id: 'WB-ZJ-P0-DELTA-001',
    captured_at: '2026-08-18T01:00:00Z',
    results: [{
      source_platform: '未知',
      source_url: 'https://example.test/unknown',
      captured_at: '2026-08-18T01:00:00Z'
    }],
    blocked_items: []
  }), /cannot infer gap_key/);
});
