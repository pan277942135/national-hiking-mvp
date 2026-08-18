import crypto from 'node:crypto';
import { getPgPool } from '../config/database.js';
import { createRawSource, RawSourceResult } from '../services/raw_source_service.js';

export type WorkBuddyGapKey =
  | 'night_access_policy'
  | 'parking_fee_current'
  | 'route_zj_s12_a_geometry'
  | string;

export interface WorkBuddyResultRecord extends Record<string, unknown> {
  gap_key: WorkBuddyGapKey;
  source_platform: string;
  source_url: string;
  captured_at: string;
}

export interface WorkBuddyBlockedItem extends Record<string, unknown> {
  platform?: string;
  url?: string;
  native_id?: string;
  block_reason?: string;
  manual_action_needed?: string;
}

export interface WorkBuddyResultBatch {
  task_id: string;
  captured_at: string;
  results: WorkBuddyResultRecord[];
  blocked_items: WorkBuddyBlockedItem[];
  notes?: unknown;
}

export interface NormalizedWorkBuddyEvidence {
  taskId: string;
  gapKey: WorkBuddyGapKey;
  sourcePlatform: string;
  sourceUrl: string;
  capturedAt: string;
  nativeId: string | null;
  fingerprint: string;
  sourceType: string;
  payload: WorkBuddyResultRecord;
}

export interface WorkBuddyImportSummary {
  task_id: string;
  batch_raw_source_id: string | null;
  created: RawSourceResult[];
  skipped_duplicate_fingerprints: string[];
  blocked_items_count: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`WorkBuddy result field ${field} is required`);
  }
  return value.trim();
}

function assertIsoTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`WorkBuddy result field ${field} must be a valid ISO timestamp`);
  }
  return parsed.toISOString();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])])
  );
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function evidenceFingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function nativeIdFor(record: Record<string, unknown>): string | null {
  for (const key of ['track_id', 'native_id', 'title', 'access_point_name', 'parking_name']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function sourceTypeForGap(gapKey: WorkBuddyGapKey): string {
  if (gapKey === 'night_access_policy') return 'ACCESS_EVIDENCE';
  if (gapKey === 'parking_fee_current') return 'PARKING_EVIDENCE';
  if (gapKey === 'route_zj_s12_a_geometry') return 'TRACK_CANDIDATE_METADATA';
  return 'SEMANTIC_DISCOVERY';
}

export function parseWorkBuddyResultBatch(input: unknown): WorkBuddyResultBatch {
  if (!isObject(input)) throw new Error('WorkBuddy result must be a JSON object');

  const taskId = requiredString(input.task_id, 'task_id');
  const capturedAt = assertIsoTimestamp(requiredString(input.captured_at, 'captured_at'), 'captured_at');

  if (!Array.isArray(input.results)) {
    throw new Error('WorkBuddy result field results must be an array');
  }
  if (!Array.isArray(input.blocked_items)) {
    throw new Error('WorkBuddy result field blocked_items must be an array');
  }

  const results = input.results.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`WorkBuddy results[${index}] must be an object`);
    const gapKey = requiredString(raw.gap_key, `results[${index}].gap_key`);
    const sourcePlatform = requiredString(raw.source_platform, `results[${index}].source_platform`);
    const sourceUrl = requiredString(raw.source_url, `results[${index}].source_url`);
    const resultCapturedAt = assertIsoTimestamp(
      requiredString(raw.captured_at ?? capturedAt, `results[${index}].captured_at`),
      `results[${index}].captured_at`
    );
    return {
      ...raw,
      gap_key: gapKey,
      source_platform: sourcePlatform,
      source_url: sourceUrl,
      captured_at: resultCapturedAt
    } as WorkBuddyResultRecord;
  });

  const blockedItems = input.blocked_items.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`WorkBuddy blocked_items[${index}] must be an object`);
    return raw as WorkBuddyBlockedItem;
  });

  return {
    task_id: taskId,
    captured_at: capturedAt,
    results,
    blocked_items: blockedItems,
    notes: input.notes
  };
}

export function normalizeWorkBuddyEvidence(batch: WorkBuddyResultBatch): NormalizedWorkBuddyEvidence[] {
  return batch.results.map(record => {
    const nativeId = nativeIdFor(record);
    const identity = {
      task_id: batch.task_id,
      gap_key: record.gap_key,
      source_platform: record.source_platform,
      source_url: record.source_url,
      native_id: nativeId,
      captured_at: record.captured_at,
      payload: record
    };
    return {
      taskId: batch.task_id,
      gapKey: record.gap_key,
      sourcePlatform: record.source_platform,
      sourceUrl: record.source_url,
      capturedAt: record.captured_at,
      nativeId,
      fingerprint: evidenceFingerprint(identity),
      sourceType: sourceTypeForGap(record.gap_key),
      payload: record
    };
  });
}

async function existingRawSourceByFingerprint(fingerprint: string): Promise<string | null> {
  const pool = getPgPool();
  if (!pool) throw new Error('PostgreSQL is not configured');
  const result = await pool.query(
    `SELECT id FROM raw_sources
     WHERE metadata->>'workbuddy_evidence_fingerprint'=$1
     ORDER BY created_at DESC LIMIT 1`,
    [fingerprint]
  );
  return result.rows[0]?.id ?? null;
}

export async function importWorkBuddyResult(
  input: unknown,
  options: { areaId?: string } = {}
): Promise<WorkBuddyImportSummary> {
  const batch = parseWorkBuddyResultBatch(input);
  const areaId = options.areaId || 'area_zijinshan';
  const normalized = normalizeWorkBuddyEvidence(batch);

  const batchFingerprint = evidenceFingerprint({
    task_id: batch.task_id,
    captured_at: batch.captured_at,
    results: batch.results,
    blocked_items: batch.blocked_items,
    notes: batch.notes
  });

  let batchRawSourceId = await existingRawSourceByFingerprint(batchFingerprint);
  if (!batchRawSourceId) {
    const batchRaw = await createRawSource({
      areaId,
      sourceType: 'WORKBUDDY_BATCH',
      sourcePlatform: 'WORKBUDDY',
      contentType: 'application/json',
      contentText: JSON.stringify(batch, null, 2),
      capturedAt: batch.captured_at,
      metadata: {
        task_id: batch.task_id,
        workbuddy_evidence_fingerprint: batchFingerprint,
        record_kind: 'BATCH_RAW',
        blocked_items_count: batch.blocked_items.length
      }
    });
    batchRawSourceId = batchRaw.id;
  }

  const created: RawSourceResult[] = [];
  const skipped: string[] = [];

  for (const evidence of normalized) {
    const existing = await existingRawSourceByFingerprint(evidence.fingerprint);
    if (existing) {
      skipped.push(evidence.fingerprint);
      continue;
    }

    const raw = await createRawSource({
      areaId,
      sourceType: evidence.sourceType,
      sourcePlatform: 'WORKBUDDY',
      sourceUrl: evidence.sourceUrl,
      contentType: 'application/json',
      contentText: JSON.stringify(evidence.payload, null, 2),
      capturedAt: evidence.capturedAt,
      metadata: {
        task_id: evidence.taskId,
        gap_key: evidence.gapKey,
        original_source_platform: evidence.sourcePlatform,
        native_id: evidence.nativeId,
        workbuddy_evidence_fingerprint: evidence.fingerprint,
        batch_raw_source_id: batchRawSourceId,
        validation_state: 'UNVALIDATED'
      }
    });
    created.push(raw);
  }

  return {
    task_id: batch.task_id,
    batch_raw_source_id: batchRawSourceId,
    created,
    skipped_duplicate_fingerprints: skipped,
    blocked_items_count: batch.blocked_items.length
  };
}
