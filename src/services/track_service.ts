/**
 * Track Service for National Hiking Backend MVP
 * Invariant: Computes SHA256, deduplicates, classifies provenance, creates RawTrack ONLY.
 * NEVER automatically creates or promotes a Route.
 */

import crypto from 'node:crypto';
import { Repositories } from '../repository/repositories.js';
import { RawTrack, ProvenanceType } from '../domain/types.js';

export interface TrackUploadInput {
  fileName?: string;
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

export function detectProvenance(payload: string, format: string, declared?: ProvenanceType): ProvenanceType {
  if (declared) return declared;

  const lower = payload.toLowerCase();
  
  if (format === 'KML' || lower.includes('<kml')) {
    // KML files exported from drawing tools are typically planned lines
    if (lower.includes('<linestring>') && !lower.includes('<when>')) {
      return 'PLANNED_NAVIGATION_LINE';
    }
  }

  if (format === 'GPX' || lower.includes('<gpx')) {
    // Check if it has genuine recorded time tags within track points
    if (lower.includes('<trkpt') && lower.includes('<time>')) {
      return 'RECORDED_GPS';
    }
    if (lower.includes('<trkpt')) {
      return 'RECORDED_GPS';
    }
    if (lower.includes('<rtept') || lower.includes('<wpt')) {
      return 'PLANNED_NAVIGATION_LINE';
    }
  }

  return 'GEOMETRY_LINE_UNKNOWN';
}

export async function processTrackUpload(
  repos: Repositories,
  input: TrackUploadInput
): Promise<TrackUploadResult> {
  const sha256 = crypto.createHash('sha256').update(input.payload).digest('hex');

  // Check deduplication
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

  const provenanceType = detectProvenance(input.payload, input.format, input.declaredProvenance);

  // Count basic points if possible
  const pointMatches = input.payload.match(/<trkpt|<coordinates|<point/gi);
  const pointCount = pointMatches ? pointMatches.length : 1;

  const newTrack: RawTrack = {
    id: `track_${sha256.substring(0, 16)}`,
    sha256,
    file_name: input.fileName || `upload_${Date.now()}.${input.format.toLowerCase()}`,
    format: input.format,
    provenance_type: provenanceType,
    point_count: pointCount,
    raw_payload: input.payload,
    created_at: new Date().toISOString()
  };

  await repos.rawTracks.save(newTrack);

  return {
    track: newTrack,
    isDuplicate: false,
    sha256,
    provenanceType,
    message: `RawTrack successfully saved with provenance ${provenanceType}. Preserved strict isolation: No Route created.`
  };
}
