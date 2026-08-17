import crypto from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { getPgPool } from '../config/database.js';

export interface CreateRawSourceInput {
  areaId?: string;
  sourceType: string;
  sourcePlatform: string;
  sourceUrl?: string;
  contentType?: string;
  contentText?: string;
  contentBase64?: string;
  capturedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RawSourceResult {
  id: string;
  area_id: string | null;
  source_type: string;
  source_platform: string;
  source_url: string | null;
  gcs_uri: string;
  sha256: string;
  content_type: string;
  captured_at: string;
  ingestion_status: 'STORED';
  byte_size: number;
}

function safeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function extensionForContentType(contentType: string): string {
  const normalized = contentType.toLowerCase();

  if (normalized.includes('json')) return '.json';
  if (normalized.includes('html')) return '.html';
  if (normalized.includes('kml')) return '.kml';
  if (normalized.includes('gpx')) return '.gpx';
  if (normalized.includes('xml')) return '.xml';
  if (normalized.startsWith('text/')) return '.txt';

  return '.bin';
}

export async function createRawSource(
  input: CreateRawSourceInput
): Promise<RawSourceResult> {
  const bucketName = process.env.RAW_BUCKET;

  if (!bucketName) {
    throw new Error('RAW_BUCKET is not configured');
  }

  const pool = getPgPool();

  if (!pool) {
    throw new Error('PostgreSQL is not configured');
  }

  if (!input.sourceType?.trim()) {
    throw new Error('source_type is required');
  }

  if (!input.sourcePlatform?.trim()) {
    throw new Error('source_platform is required');
  }

  const hasText = typeof input.contentText === 'string';
  const hasBase64 = typeof input.contentBase64 === 'string';

  if (hasText === hasBase64) {
    throw new Error(
      'Exactly one of content_text or content_base64 is required'
    );
  }

  const content = hasText
    ? Buffer.from(input.contentText!, 'utf8')
    : Buffer.from(input.contentBase64!, 'base64');

  if (content.length === 0) {
    throw new Error('Raw source content must not be empty');
  }

  const capturedAt = input.capturedAt
    ? new Date(input.capturedAt)
    : new Date();

  if (Number.isNaN(capturedAt.getTime())) {
    throw new Error('captured_at must be a valid ISO timestamp');
  }

  const id = `raw_${crypto.randomUUID()}`;
  const sha256 = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');

  const contentType =
    input.contentType?.trim() || 'application/octet-stream';

  const areaSegment = input.areaId
    ? safeSegment(input.areaId)
    : 'unscoped';

  const platformSegment = safeSegment(input.sourcePlatform);

  const year = String(capturedAt.getUTCFullYear());
  const month = String(capturedAt.getUTCMonth() + 1).padStart(2, '0');

  const extension = extensionForContentType(contentType);

  const objectName =
    `areas/${areaSegment}/raw/${platformSegment}/` +
    `${year}/${month}/${id}${extension}`;

  const storage = new Storage();
  const file = storage.bucket(bucketName).file(objectName);

  await file.save(content, {
    resumable: false,
    contentType,
    metadata: {
      metadata: {
        raw_source_id: id,
        source_type: input.sourceType,
        source_platform: input.sourcePlatform
      }
    }
  });

  const gcsUri = `gs://${bucketName}/${objectName}`;
  const client = await pool.connect();

  try {
    await client.query(
      `
        INSERT INTO raw_sources (
          id,
          area_id,
          source_type,
          source_platform,
          source_url,
          gcs_uri,
          sha256,
          content_type,
          captured_at,
          ingestion_status,
          metadata
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,'STORED',$10::jsonb
        )
      `,
      [
        id,
        input.areaId || null,
        input.sourceType,
        input.sourcePlatform,
        input.sourceUrl || null,
        gcsUri,
        sha256,
        contentType,
        capturedAt.toISOString(),
        JSON.stringify({
          ...(input.metadata || {}),
          byte_size: content.length
        })
      ]
    );
  } catch (error) {
    try {
      await file.delete();
    } catch {
      // Best-effort cleanup only.
    }

    throw error;
  } finally {
    client.release();
  }

  return {
    id,
    area_id: input.areaId || null,
    source_type: input.sourceType,
    source_platform: input.sourcePlatform,
    source_url: input.sourceUrl || null,
    gcs_uri: gcsUri,
    sha256,
    content_type: contentType,
    captured_at: capturedAt.toISOString(),
    ingestion_status: 'STORED',
    byte_size: content.length
  };
}
