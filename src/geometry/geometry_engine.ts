import crypto from 'node:crypto';
import { ProvenanceType } from '../domain/types.js';
import { detectProvenance } from '../services/track_service.js';

export interface GeoPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

export interface TrackAnalysisInput {
  trackId: string;
  format: 'GPX' | 'KML' | 'GEOJSON' | 'FIT';
  payload: string;
  declaredProvenance?: ProvenanceType;
  sourcePlatform?: string;
  author?: string;
}

export interface TrackQaResult {
  track_id: string;
  provenance_type: ProvenanceType;
  eligible_recorded_gps: boolean;
  points: GeoPoint[];
  point_count: number;
  distance_m: number;
  duration_s?: number;
  elevation_gain_m?: number;
  timestamp_coverage: number;
  max_speed_kmh?: number;
  invalid_coordinate_count: number;
  geometry_fingerprint: string;
  qa_flags: string[];
  source_platform?: string;
  author?: string;
}

export interface TrackSimilarity {
  compatible: boolean;
  mean_deviation_m: number;
  max_deviation_m: number;
  length_ratio: number;
  direction_reversed: boolean;
  reasons: string[];
}

export interface GeometryConsensusResult {
  status: 'ACCEPTED_CONSENSUS' | 'GEOMETRY_BLOCKED';
  accepted_track_ids: string[];
  rejected_track_ids: string[];
  compatible_pairs: Array<{
    a: string;
    b: string;
    similarity: TrackSimilarity;
  }>;
  reasons: string[];
}

const EARTH_RADIUS_M = 6_371_008.8;

function toRad(value: number): number {
  return value * Math.PI / 180;
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validCoordinate(point: GeoPoint): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
    point.lat >= -90 && point.lat <= 90 && point.lon >= -180 && point.lon <= 180;
}

function parseAttribute(attributes: string, name: string): number | undefined {
  const match = attributes.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function parseGpx(payload: string): GeoPoint[] {
  const points: GeoPoint[] = [];
  const regex = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(payload))) {
    const lat = parseAttribute(match[1], 'lat');
    const lon = parseAttribute(match[1], 'lon');
    if (lat === undefined || lon === undefined) continue;
    const inner = match[2] || '';
    const eleMatch = inner.match(/<ele>([^<]+)<\/ele>/i);
    const timeMatch = inner.match(/<time>([^<]+)<\/time>/i);
    const ele = eleMatch ? Number(eleMatch[1]) : undefined;
    points.push({
      lat,
      lon,
      ele: ele !== undefined && Number.isFinite(ele) ? ele : undefined,
      time: timeMatch?.[1]?.trim()
    });
  }
  return points;
}

function parseKml(payload: string): GeoPoint[] {
  const blocks = [...payload.matchAll(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi)];
  const points: GeoPoint[] = [];
  for (const block of blocks) {
    for (const token of block[1].trim().split(/\s+/)) {
      const [lonRaw, latRaw, eleRaw] = token.split(',');
      const lon = Number(lonRaw);
      const lat = Number(latRaw);
      const ele = eleRaw === undefined ? undefined : Number(eleRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      points.push({
        lat,
        lon,
        ele: ele !== undefined && Number.isFinite(ele) ? ele : undefined
      });
    }
  }
  return points;
}

function coordinatesFromGeoJson(value: unknown): GeoPoint[] {
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, any>;
  if (obj.type === 'Feature') return coordinatesFromGeoJson(obj.geometry);
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    for (const feature of obj.features) {
      const points = coordinatesFromGeoJson(feature);
      if (points.length) return points;
    }
    return [];
  }
  if (obj.type === 'LineString' && Array.isArray(obj.coordinates)) {
    return obj.coordinates
      .filter((coord: unknown) => Array.isArray(coord) && coord.length >= 2)
      .map((coord: number[]) => ({
        lon: Number(coord[0]),
        lat: Number(coord[1]),
        ele: coord[2] === undefined ? undefined : Number(coord[2])
      }))
      .filter(validCoordinate);
  }
  return [];
}

function parseGeoJson(payload: string): GeoPoint[] {
  try {
    return coordinatesFromGeoJson(JSON.parse(payload));
  } catch {
    return [];
  }
}

export function parseTrackPoints(format: TrackAnalysisInput['format'], payload: string): GeoPoint[] {
  if (format === 'GPX') return parseGpx(payload);
  if (format === 'KML') return parseKml(payload);
  if (format === 'GEOJSON') return parseGeoJson(payload);
  return [];
}

function trackDistance(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

function elevationGain(points: GeoPoint[]): number | undefined {
  const withElevation = points.filter(point => Number.isFinite(point.ele));
  if (withElevation.length < 2) return undefined;
  let gain = 0;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1].ele;
    const current = points[i].ele;
    if (previous === undefined || current === undefined) continue;
    const delta = current - previous;
    if (delta > 0) gain += delta;
  }
  return gain;
}

function durationAndSpeed(points: GeoPoint[]): { durationS?: number; maxSpeedKmh?: number } {
  const timed = points.filter(point => point.time && !Number.isNaN(new Date(point.time).getTime()));
  if (timed.length < 2) return {};
  const first = new Date(timed[0].time!).getTime();
  const last = new Date(timed[timed.length - 1].time!).getTime();
  const durationS = Math.max(0, (last - first) / 1000);
  let maxSpeedKmh = 0;
  for (let i = 1; i < timed.length; i += 1) {
    const dt = (new Date(timed[i].time!).getTime() - new Date(timed[i - 1].time!).getTime()) / 1000;
    if (dt <= 0) continue;
    const speedKmh = haversineMeters(timed[i - 1], timed[i]) / dt * 3.6;
    maxSpeedKmh = Math.max(maxSpeedKmh, speedKmh);
  }
  return { durationS, maxSpeedKmh };
}

function geometryFingerprint(points: GeoPoint[]): string {
  const normalized = points.map(point => [
    Number(point.lat.toFixed(6)),
    Number(point.lon.toFixed(6))
  ]);
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function analyzeTrack(input: TrackAnalysisInput): TrackQaResult {
  const parsed = parseTrackPoints(input.format, input.payload);
  const invalidCoordinateCount = parsed.filter(point => !validCoordinate(point)).length;
  const points = parsed.filter(validCoordinate);
  const provenance = detectProvenance(input.payload, input.format, input.declaredProvenance);
  const distanceM = trackDistance(points);
  const timedCount = points.filter(point => point.time && !Number.isNaN(new Date(point.time).getTime())).length;
  const timestampCoverage = points.length ? timedCount / points.length : 0;
  const { durationS, maxSpeedKmh } = durationAndSpeed(points);
  const flags: string[] = [];

  if (provenance !== 'RECORDED_GPS' && provenance !== 'RECORDED_GPS_MERGED') flags.push('NOT_RECORDED_GPS');
  if (points.length < 20) flags.push('TOO_FEW_POINTS');
  if (distanceM < 500) flags.push('DISTANCE_TOO_SHORT');
  if (distanceM > 100_000) flags.push('DISTANCE_IMPLAUSIBLY_LONG');
  if (invalidCoordinateCount > 0) flags.push('INVALID_COORDINATES');
  if (maxSpeedKmh !== undefined && maxSpeedKmh > 45) flags.push('SPEED_SPIKE');

  const eligibleRecordedGps =
    (provenance === 'RECORDED_GPS' || provenance === 'RECORDED_GPS_MERGED') &&
    points.length >= 20 && distanceM >= 500 && distanceM <= 100_000 &&
    invalidCoordinateCount === 0 && !(maxSpeedKmh !== undefined && maxSpeedKmh > 45);

  return {
    track_id: input.trackId,
    provenance_type: provenance,
    eligible_recorded_gps: eligibleRecordedGps,
    points,
    point_count: points.length,
    distance_m: distanceM,
    duration_s: durationS,
    elevation_gain_m: elevationGain(points),
    timestamp_coverage: timestampCoverage,
    max_speed_kmh: maxSpeedKmh,
    invalid_coordinate_count: invalidCoordinateCount,
    geometry_fingerprint: geometryFingerprint(points),
    qa_flags: flags,
    source_platform: input.sourcePlatform,
    author: input.author
  };
}

function interpolate(a: GeoPoint, b: GeoPoint, ratio: number): GeoPoint {
  return {
    lat: a.lat + (b.lat - a.lat) * ratio,
    lon: a.lon + (b.lon - a.lon) * ratio
  };
}

export function resampleTrack(points: GeoPoint[], samples = 64): GeoPoint[] {
  if (points.length <= 1 || samples <= 1) return [...points];
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  const total = cumulative[cumulative.length - 1];
  if (total === 0) return Array.from({ length: samples }, () => ({ ...points[0] }));
  const result: GeoPoint[] = [];
  let segment = 1;
  for (let i = 0; i < samples; i += 1) {
    const target = total * (i / (samples - 1));
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const beforeDistance = cumulative[segment - 1];
    const afterDistance = cumulative[segment];
    const ratio = afterDistance === beforeDistance ? 0 : (target - beforeDistance) / (afterDistance - beforeDistance);
    result.push(interpolate(points[segment - 1], points[segment], Math.max(0, Math.min(1, ratio))));
  }
  return result;
}

function alignedDeviation(a: GeoPoint[], b: GeoPoint[]): { mean: number; max: number } {
  const samples = Math.max(16, Math.min(128, Math.max(a.length, b.length)));
  const ar = resampleTrack(a, samples);
  const br = resampleTrack(b, samples);
  const distances = ar.map((point, index) => haversineMeters(point, br[index]));
  return {
    mean: distances.reduce((sum, value) => sum + value, 0) / distances.length,
    max: Math.max(...distances)
  };
}

export function compareTrackGeometry(a: TrackQaResult, b: TrackQaResult): TrackSimilarity {
  const reasons: string[] = [];
  if (!a.points.length || !b.points.length) {
    return {
      compatible: false,
      mean_deviation_m: Number.POSITIVE_INFINITY,
      max_deviation_m: Number.POSITIVE_INFINITY,
      length_ratio: Number.POSITIVE_INFINITY,
      direction_reversed: false,
      reasons: ['EMPTY_GEOMETRY']
    };
  }

  const forward = alignedDeviation(a.points, b.points);
  const reversed = alignedDeviation(a.points, [...b.points].reverse());
  const directionReversed = reversed.mean < forward.mean;
  const chosen = directionReversed ? reversed : forward;
  const shorter = Math.min(a.distance_m, b.distance_m);
  const longer = Math.max(a.distance_m, b.distance_m);
  const lengthRatio = shorter > 0 ? longer / shorter : Number.POSITIVE_INFINITY;

  if (chosen.mean > 100) reasons.push('MEAN_DEVIATION_TOO_HIGH');
  if (chosen.max > 300) reasons.push('MAX_DEVIATION_TOO_HIGH');
  if (lengthRatio > 1.35) reasons.push('LENGTH_RATIO_TOO_HIGH');

  return {
    compatible: reasons.length === 0,
    mean_deviation_m: chosen.mean,
    max_deviation_m: chosen.max,
    length_ratio: lengthRatio,
    direction_reversed: directionReversed,
    reasons
  };
}

function independenceKey(track: TrackQaResult): string {
  const platform = track.source_platform?.trim().toLowerCase() || 'unknown-platform';
  const author = track.author?.trim().toLowerCase() || track.track_id.toLowerCase();
  return `${platform}:${author}`;
}

export function evaluateGeometryConsensus(tracks: TrackQaResult[]): GeometryConsensusResult {
  const eligible = tracks.filter(track => track.eligible_recorded_gps);
  const rejected = tracks.filter(track => !track.eligible_recorded_gps).map(track => track.track_id);
  const compatiblePairs: GeometryConsensusResult['compatible_pairs'] = [];
  const acceptedIds = new Set<string>();
  const reasons: string[] = [];

  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const a = eligible[i];
      const b = eligible[j];
      if (a.geometry_fingerprint === b.geometry_fingerprint) continue;
      if (independenceKey(a) === independenceKey(b)) continue;
      const similarity = compareTrackGeometry(a, b);
      if (!similarity.compatible) continue;
      compatiblePairs.push({ a: a.track_id, b: b.track_id, similarity });
      acceptedIds.add(a.track_id);
      acceptedIds.add(b.track_id);
    }
  }

  if (acceptedIds.size >= 2) {
    reasons.push('At least two independent, QA-passing, mutually compatible Recorded GPS tracks exist.');
    return {
      status: 'ACCEPTED_CONSENSUS',
      accepted_track_ids: [...acceptedIds],
      rejected_track_ids: rejected,
      compatible_pairs: compatiblePairs,
      reasons
    };
  }

  reasons.push('Geometry consensus requires at least two independent compatible Recorded GPS tracks.');
  return {
    status: 'GEOMETRY_BLOCKED',
    accepted_track_ids: [],
    rejected_track_ids: rejected,
    compatible_pairs: compatiblePairs,
    reasons
  };
}
