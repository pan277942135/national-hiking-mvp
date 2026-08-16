/**
 * Track Service for National Hiking Backend MVP.
 *
 * Canonical ingestion contract: GPX/KML only.
 * Invariant: ingest creates RawTrack only; it never creates/promotes a Route.
 */

import crypto from 'node:crypto';
import { Repositories } from '../repository/repositories.js';
import { RawTrack, ProvenanceType } from '../domain/types.js';
import { assertPlannedLineNotRecordedGps } from '../domain/invariants.js';

export interface TrackUploadInput {
  fileName?: string;
  // Kept as string-compatible adapter input so the API can reject extensions cleanly.
  format: 'GPX' | 'KML' | 'GEOJSON' | 'FIT';
  payload: string;
  declaredProvenance?: ProvenanceType;
}

export interface TrackUploadResult {
  track: RawTrack;
  isDuplicate: boolean;
  sha256: string;
  provenanceType: ProvenanceType;
  message: string;
}

function countMatches(payload: string, pattern: RegExp): number {
  return payload.match(pattern)?.length ?? 0;
}

/**
 * Conservative provenance classifier.
 *
 * A geometry line is not execution evidence merely because it contains track
 * points. GPX/KML requires dense execution timestamps before auto-classifying
 * as RECORDED_GPS. Ambiguous track geometry remains GEOMETRY_LINE_UNKNOWN.
 */
export function detectProvenance(payload: string, format: string, declared?: ProvenanceType): ProvenanceType {
  const normalizedFormat = format.toUpperCase();
  if (normalizedFormat !== 'GPX' && normalizedFormat !== 'KML') {
    throw new Error(`Unsupported canonical track format: ${format}. Only GPX and KML are accepted.`);
  }

  const lower = payload.toLowerCase();
  let detected: ProvenanceType = 'GEOMETRY_LINE_UNKNOWN';

  if (normalizedFormat === 'GPX' || lower.includes('<gpx')) {
    const trkptCount = countMatches(lower, /<trkpt\b/g);
    const timeCount = countMatches(lower, /<time\b/g);
    const routePointCount = countMatches(lower, /<(rtept|wpt)\b/g);

    if (trkptCount >= 2 && timeCount >= Math.max(2, Math.ceil(trkptCount * 0.8))) {
      detected = 'RECORDED_GPS';
    } else if (trkptCount > 0) {
      detected = 'GEOMETRY_LINE_UNKNOWN';
    } else if (routePointCount > 0) {
      detected = 'PLANNED_NAVIGATION_LINE';
    }
  }

  if (normalizedFormat === 'KML' || lower.includes('<kml')) {
    const whenCount = countMatches(lower, /<when\b/g);
    const gxCoordCount = countMatches(lower, /<gx:coord\b/g);
    const hasLineString = lower.includes('<linestring');

    if (gxCoordCount >= 2 && whenCount >= Math.max(2, Math.ceil(gxCoordCount * 0.8))) {
      detected = 'RECORDED_GPS';
    } else if (hasLineString && whenCount === 0) {
      detected = 'PLANNED_NAVIGATION_LINE';
    } else {
      detected = 'GEOMETRY_LINE_UNKNOWN';
    }
  }

  // A client declaration may downgrade evidence, but must never upgrade an
  // ambiguous/planned line into Recorded GPS.
  if (declared === 'PLANNED_NAVIGATION_LINE' || declared === 'GEOMETRY_LINE_UNKNOWN') {
    return declared;
  }
  if (declared === 'RECORDED_GPS_MERGED' && detected === 'RECORDED_GPS') {
    return 'RECORDED_GPS_MERGED';
  }
  if (declared === 'RECORDED_GPS' && detected !== 'RECORDED_GPS') {
    return detected;
  }

  return detected;
}

export async function processTrackUpload(
  repos: Repositories,
  input: TrackUploadInput
): Promise<TrackUploadResult> {
  if (!input.payload || input.payload.trim().length === 0) {
    throw new Error('Empty track payload');
  }

  const normalizedFormat = input.format.toUpperCase();
  if (normalizedFormat !== 'GPX' && normalizedFormat !== 'KML') {
    throw new Error(`Unsupported canonical track format: ${input.format}. Only GPX and KML are accepted.`);
  }

  const sha256 = crypto.createHash('sha256').update(input.payload).digest('hex');

  const existing = await repos.rawTracks.findBySha256(sha256);
  if (existing) {
    return {
      track: existing,
      isDuplicate: true,
      sha256,
      provenanceType: existing.provenance_type,
      message: `Track deduplicated (already exists with id ${existing.id}). No Route was created or mutated.`
    };
  }

  const provenanceType = detectProvenance(input.payload, normalizedFormat, input.declaredProvenance);
  const lower = input.payload.toLowerCase();
  const pointCount = normalizedFormat === 'GPX'
    ? countMatches(lower, /<trkpt\b/g) + countMatches(lower, /<(rtept|wpt)\b/g)
    : countMatches(lower, /<gx:coord\b/g) || countMatches(lower, /<coordinates\b/g);

  const newTrack: RawTrack = {
    id: `track_${sha256.substring(0, 16)}`,
    sha256,
    file_name: input.fileName || `upload_${Date.now()}.${normalizedFormat.toLowerCase()}`,
    format: normalizedFormat as RawTrack['format'],
    provenance_type: provenanceType,
    point_count: pointCount,
    raw_payload: input.payload,
    created_at: new Date().toISOString()
  };

  (newTrack as RawTrack & { recorded_execution?: boolean }).recorded_execution =
    provenanceType === 'RECORDED_GPS' || provenanceType === 'RECORDED_GPS_MERGED';

  assertPlannedLineNotRecordedGps(newTrack);
  await repos.rawTracks.save(newTrack);

  return {
    track: newTrack,
    isDuplicate: false,
    sha256,
    provenanceType,
    message: `RawTrack saved with provenance ${provenanceType}. No Route or CanonicalTrack was created.`
  };
}
