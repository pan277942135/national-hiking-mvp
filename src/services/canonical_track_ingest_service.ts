import crypto from 'node:crypto';
import type { Pool } from 'pg';

export type CanonicalTrackFormat = 'GPX' | 'KML';
export type CanonicalProvenanceClass =
  | 'RECORDED_GPS'
  | 'RECORDED_GPS_MERGED'
  | 'PLANNED_NAVIGATION_LINE'
  | 'GEOMETRY_LINE_UNKNOWN';

export interface CanonicalTrackIngestInput {
  format: CanonicalTrackFormat;
  payload: string;
  fileName?: string;
  sourceTrackId?: string;
  evidenceId?: string;
}

export interface CanonicalTrackIngestResult {
  rawTrackId: string;
  sha256: string;
  duplicate: boolean;
  provenanceClass: CanonicalProvenanceClass;
  recordedExecution: boolean;
  pointCount: number;
  timestampCount: number;
}

export type CanonicalAssignmentState =
  | 'TARGET_ACCEPTED'
  | 'TARGET_REJECTED'
  | 'SIBLING_ACCEPTED'
  | 'CONTROL_ONLY'
  | 'UNCLASSIFIED';

interface ParsedGeometry {
  coordinates: Array<[number, number]>;
  timestampCount: number;
  provenanceClass: CanonicalProvenanceClass;
  recordedExecution: boolean;
}

function parseNumber(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseGpx(payload: string): ParsedGeometry {
  const points: Array<[number, number]> = [];
  let timestampCount = 0;
  const trkptRegex = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt\s*>|<trkpt\b([^>]*)\/>/gi;
  let match: RegExpExecArray | null;

  while ((match = trkptRegex.exec(payload)) !== null) {
    const attrs = match[1] ?? match[3] ?? '';
    const body = match[2] ?? '';
    const latMatch = /\blat=["']([^"']+)["']/i.exec(attrs);
    const lonMatch = /\blon=["']([^"']+)["']/i.exec(attrs);
    if (!latMatch || !lonMatch) continue;
    const lat = parseNumber(latMatch[1]);
    const lon = parseNumber(lonMatch[1]);
    if (lat === null || lon === null) continue;
    points.push([lon, lat]);
    if (/<time>[^<]+<\/time>/i.test(body)) timestampCount++;
  }

  if (points.length < 2) {
    throw new Error('GPX must contain at least two valid <trkpt> coordinates');
  }

  const allTimestamped = timestampCount === points.length;
  return {
    coordinates: points,
    timestampCount,
    provenanceClass: allTimestamped ? 'RECORDED_GPS' : 'GEOMETRY_LINE_UNKNOWN',
    recordedExecution: allTimestamped
  };
}

function parseKml(payload: string): ParsedGeometry {
  const gxCoords = [...payload.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/gi)]
    .map(m => m[1].trim().split(/\s+/).slice(0, 2).map(Number))
    .filter(v => v.length === 2 && v.every(Number.isFinite))
    .map(v => [v[0], v[1]] as [number, number]);
  const gxWhens = [...payload.matchAll(/<when>[^<]+<\/when>/gi)].length;

  if (gxCoords.length >= 2) {
    const allTimestamped = gxWhens === gxCoords.length;
    return {
      coordinates: gxCoords,
      timestampCount: gxWhens,
      provenanceClass: allTimestamped ? 'RECORDED_GPS' : 'GEOMETRY_LINE_UNKNOWN',
      recordedExecution: allTimestamped
    };
  }

  const coordMatch = /<coordinates>([\s\S]*?)<\/coordinates>/i.exec(payload);
  if (!coordMatch) {
    throw new Error('KML must contain LineString <coordinates> or gx:Track coordinates');
  }

  const coordinates = coordMatch[1]
    .trim()
    .split(/\s+/)
    .map(token => token.split(',').slice(0, 2).map(Number))
    .filter(v => v.length === 2 && v.every(Number.isFinite))
    .map(v => [v[0], v[1]] as [number, number]);

  if (coordinates.length < 2) {
    throw new Error('KML LineString must contain at least two valid coordinates');
  }

  return {
    coordinates,
    timestampCount: 0,
    provenanceClass: 'PLANNED_NAVIGATION_LINE',
    recordedExecution: false
  };
}

export function parseCanonicalTrackGeometry(
  format: CanonicalTrackFormat,
  payload: string
): ParsedGeometry {
  return format === 'GPX' ? parseGpx(payload) : parseKml(payload);
}

function lineStringWkt(coordinates: Array<[number, number]>): string {
  return `LINESTRING(${coordinates.map(([lon, lat]) => `${lon} ${lat}`).join(',')})`;
}

export async function ingestCanonicalRawTrack(
  pool: Pool,
  input: CanonicalTrackIngestInput
): Promise<CanonicalTrackIngestResult> {
  if (!input.payload.trim()) throw new Error('Track payload is empty');
  if (input.format !== 'GPX' && input.format !== 'KML') {
    throw new Error(`Unsupported canonical track format: ${input.format}`);
  }

  const sha256 = crypto.createHash('sha256').update(input.payload).digest('hex');
  const existing = await pool.query<{
    raw_track_id: string;
    provenance_class: CanonicalProvenanceClass;
    recorded_execution: boolean;
    metadata: { point_count?: number; timestamp_count?: number };
  }>(
    `SELECT raw_track_id, provenance_class, recorded_execution, metadata
       FROM raw_track WHERE sha256 = $1`,
    [sha256]
  );

  if (existing.rows[0]) {
    const row = existing.rows[0];
    return {
      rawTrackId: row.raw_track_id,
      sha256,
      duplicate: true,
      provenanceClass: row.provenance_class,
      recordedExecution: row.recorded_execution,
      pointCount: Number(row.metadata?.point_count ?? 0),
      timestampCount: Number(row.metadata?.timestamp_count ?? 0)
    };
  }

  const parsed = parseCanonicalTrackGeometry(input.format, input.payload);
  const rawTrackId = `RAW-${sha256.slice(0, 20).toUpperCase()}`;
  const metadata = {
    file_name: input.fileName ?? null,
    format: input.format,
    point_count: parsed.coordinates.length,
    timestamp_count: parsed.timestampCount,
    canonical_ingest_version: '0.1'
  };

  await pool.query(
    `INSERT INTO raw_track (
       raw_track_id, evidence_id, source_track_id, sha256, geometry,
       provenance_class, provenance_confidence, recorded_execution, metadata
     ) VALUES (
       $1, $2, $3, $4, ST_GeomFromText($5, 4326),
       $6, $7, $8, $9::jsonb
     )`,
    [
      rawTrackId,
      input.evidenceId ?? null,
      input.sourceTrackId ?? null,
      sha256,
      lineStringWkt(parsed.coordinates),
      parsed.provenanceClass,
      parsed.provenanceClass === 'RECORDED_GPS' ? 1 : parsed.provenanceClass === 'PLANNED_NAVIGATION_LINE' ? 0.95 : 0.5,
      parsed.recordedExecution,
      JSON.stringify(metadata)
    ]
  );

  return {
    rawTrackId,
    sha256,
    duplicate: false,
    provenanceClass: parsed.provenanceClass,
    recordedExecution: parsed.recordedExecution,
    pointCount: parsed.coordinates.length,
    timestampCount: parsed.timestampCount
  };
}

export async function assignCanonicalRawTrack(
  pool: Pool,
  input: {
    rawTrackId: string;
    routeId: string;
    assignmentState: CanonicalAssignmentState;
    geometryGateState: string;
    directionClass?: string;
    independentProvenanceKey?: string;
    qa?: Record<string, unknown>;
  }
): Promise<void> {
  const track = await pool.query<{ provenance_class: string; recorded_execution: boolean }>(
    `SELECT provenance_class, recorded_execution FROM raw_track WHERE raw_track_id = $1`,
    [input.rawTrackId]
  );
  if (!track.rows[0]) throw new Error(`RawTrack not found: ${input.rawTrackId}`);

  const route = await pool.query(`SELECT route_id FROM route WHERE route_id = $1`, [input.routeId]);
  if (!route.rows[0]) throw new Error(`Route not found: ${input.routeId}`);

  if (
    input.assignmentState === 'TARGET_ACCEPTED' &&
    (!track.rows[0].recorded_execution || !['RECORDED_GPS', 'RECORDED_GPS_MERGED'].includes(track.rows[0].provenance_class))
  ) {
    throw new Error('TARGET_ACCEPTED requires recorded execution provenance');
  }

  if (
    input.assignmentState === 'CONTROL_ONLY' &&
    track.rows[0].provenance_class === 'RECORDED_GPS'
  ) {
    // Allowed only if editorial review explicitly chooses control usage; no
    // automatic mutation is performed here.
  }

  await pool.query(
    `INSERT INTO raw_track_route_assignment (
       raw_track_id, route_id, assignment_state, geometry_gate_state,
       direction_class, independent_provenance_key, qa
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (raw_track_id, route_id) DO UPDATE SET
       assignment_state = EXCLUDED.assignment_state,
       geometry_gate_state = EXCLUDED.geometry_gate_state,
       direction_class = EXCLUDED.direction_class,
       independent_provenance_key = EXCLUDED.independent_provenance_key,
       qa = EXCLUDED.qa,
       assigned_at = now()`,
    [
      input.rawTrackId,
      input.routeId,
      input.assignmentState,
      input.geometryGateState,
      input.directionClass ?? null,
      input.independentProvenanceKey ?? null,
      JSON.stringify(input.qa ?? {})
    ]
  );
}
