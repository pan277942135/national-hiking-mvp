import fs from 'node:fs/promises';
import path from 'node:path';
import { parseWorkBuddyResultBatch } from '../src/acquisition/workbuddy_result_importer.js';
import { createDefaultValidatorRegistry, EvidenceRecord } from '../src/validation/validator_registry.js';

function uniqueStrings(records: EvidenceRecord[], field: string): string[] {
  return [...new Set(records
    .map(record => record[field])
    .filter((value): value is string => typeof value === 'string' && !!value.trim())
    .map(value => value.trim()))];
}

async function main() {
  const filePath = process.argv[2] || process.env.WORKBUDDY_JSON_FILE;
  if (!filePath) {
    throw new Error('Usage: npm run validate:workbuddy -- <result.json> or set WORKBUDDY_JSON_FILE');
  }

  const absolute = path.resolve(filePath);
  const batch = parseWorkBuddyResultBatch(JSON.parse(await fs.readFile(absolute, 'utf8')));
  const registry = createDefaultValidatorRegistry();
  const now = new Date();
  const decisions = [];

  const nightRecords = batch.results.filter(record => record.gap_key === 'night_access_policy');
  for (const target of uniqueStrings(nightRecords, 'access_point_name')) {
    decisions.push(registry.validate('night_access_policy', nightRecords, { targetKey: target, now }));
  }
  if (nightRecords.length && !uniqueStrings(nightRecords, 'access_point_name').length) {
    decisions.push(registry.validate('night_access_policy', nightRecords, { now }));
  }

  const parkingRecords = batch.results.filter(record => record.gap_key === 'parking_fee_current');
  for (const target of uniqueStrings(parkingRecords, 'parking_name')) {
    decisions.push(registry.validate('parking_fee_current', parkingRecords, { targetKey: target, now }));
  }
  if (parkingRecords.length && !uniqueStrings(parkingRecords, 'parking_name').length) {
    decisions.push(registry.validate('parking_fee_current', parkingRecords, { now }));
  }

  const geometryRecords = batch.results.filter(record => record.gap_key === 'route_zj_s12_a_geometry');
  if (geometryRecords.length) {
    decisions.push(registry.validate('route_zj_s12_a_geometry', geometryRecords, { now }));
  }

  console.log('=== WORKBUDDY VALIDATION COMPLETE ===');
  console.log(JSON.stringify({
    file: absolute,
    task_id: batch.task_id,
    result_count: batch.results.length,
    blocked_items_count: batch.blocked_items.length,
    decisions,
    rule: 'Validation decisions do not mutate Canonical state. CANONICAL_CANDIDATE still requires promotion workflow.'
  }, null, 2));
}

main().catch(error => {
  console.error('WORKBUDDY_VALIDATION_FAILED:', error);
  process.exit(1);
});
