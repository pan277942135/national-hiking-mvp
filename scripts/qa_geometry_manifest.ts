import fs from 'node:fs/promises';
import path from 'node:path';
import { ProvenanceType } from '../src/domain/types.js';
import { analyzeTrack, evaluateGeometryConsensus } from '../src/geometry/geometry_engine.js';

type TrackFormat = 'GPX' | 'KML' | 'GEOJSON' | 'FIT';

interface GeometryManifestTrack {
  track_id: string;
  file_path: string;
  format: TrackFormat;
  source_platform?: string;
  author?: string;
  declared_provenance?: ProvenanceType;
}

interface GeometryManifest {
  route_id: string;
  tracks: GeometryManifestTrack[];
}

function isManifest(value: unknown): value is GeometryManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.route_id === 'string' && Array.isArray(obj.tracks);
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error('Usage: npm run qa:geometry -- <geometry-manifest.json>');
  }

  const absolute = path.resolve(manifestPath);
  const parsed: unknown = JSON.parse(await fs.readFile(absolute, 'utf8'));
  if (!isManifest(parsed)) throw new Error('Geometry manifest must contain route_id and tracks[]');
  if (parsed.tracks.length < 1) throw new Error('Geometry manifest tracks[] must not be empty');

  const baseDir = path.dirname(absolute);
  const analyses = [];
  for (const track of parsed.tracks) {
    if (!track.track_id || !track.file_path || !track.format) {
      throw new Error('Each geometry manifest track requires track_id, file_path, and format');
    }
    const payload = await fs.readFile(path.resolve(baseDir, track.file_path), 'utf8');
    analyses.push(analyzeTrack({
      trackId: track.track_id,
      format: track.format,
      payload,
      declaredProvenance: track.declared_provenance,
      sourcePlatform: track.source_platform,
      author: track.author
    }));
  }

  const consensus = evaluateGeometryConsensus(analyses);
  console.log('=== GEOMETRY QA COMPLETE ===');
  console.log(JSON.stringify({
    route_id: parsed.route_id,
    analyses: analyses.map(analysis => ({
      track_id: analysis.track_id,
      provenance_type: analysis.provenance_type,
      eligible_recorded_gps: analysis.eligible_recorded_gps,
      point_count: analysis.point_count,
      distance_m: Math.round(analysis.distance_m),
      elevation_gain_m: analysis.elevation_gain_m === undefined ? null : Math.round(analysis.elevation_gain_m),
      duration_s: analysis.duration_s ?? null,
      timestamp_coverage: Number(analysis.timestamp_coverage.toFixed(3)),
      max_speed_kmh: analysis.max_speed_kmh === undefined ? null : Number(analysis.max_speed_kmh.toFixed(2)),
      geometry_fingerprint: analysis.geometry_fingerprint,
      qa_flags: analysis.qa_flags,
      source_platform: analysis.source_platform ?? null,
      author: analysis.author ?? null
    })),
    consensus,
    rule: 'This command evaluates geometry consensus only. It never mutates Route or promotes Canonical geometry.'
  }, null, 2));
}

main().catch(error => {
  console.error('GEOMETRY_QA_FAILED:', error);
  process.exit(1);
});
