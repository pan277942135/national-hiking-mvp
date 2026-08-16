import type { Pool } from 'pg';
import { CanonicalPostgresRepository } from '../repository/postgres/canonical_postgres.js';

export interface CanonicalRoutePageProjection {
  projection_type: 'ROUTE_PUBLIC_PAGE_V1';
  repository_mode: 'CANONICAL_POSTGRES';
  data_classification: 'CANONICAL_EVIDENCE_BACKED';
  route_id: string;
  area_id: string;
  route_family_id: string | null;
  canonical_name: string;
  identity_state: string;
  route_state: string;
  canonical_version: number;
  geometry: {
    state: 'CANONICAL_TRACK_ACTIVE' | 'GEOMETRY_BLOCKED' | 'CANONICAL_ASSET_MISSING';
    active_canonical_track_id: string | null;
    map_download_visible: boolean;
    navigation_visible: boolean;
    distance_meters: number | null;
    elevation_gain_meters: number | null;
  };
  dependencies: Array<{
    dependency_id: string;
    dependency_class: string;
    state: string;
    stop_status: string;
    reopen_trigger: string;
  }>;
  reason_codes: string[];
  projected_at: string;
}

interface ActiveCanonicalTrackRow {
  canonical_track_id: string;
  route_id: string;
  distance_m: number;
  elevation_gain_m: number | null;
  version: number;
}

function geometryStateFor(
  routeState: string,
  activeTrack: ActiveCanonicalTrackRow | null
): CanonicalRoutePageProjection['geometry']['state'] {
  if (activeTrack) return 'CANONICAL_TRACK_ACTIVE';
  if (routeState === 'GEOMETRY_BLOCKED') return 'GEOMETRY_BLOCKED';
  return 'CANONICAL_ASSET_MISSING';
}

/**
 * Build the public Route page read-model from canonical PostgreSQL truth only.
 *
 * Critical publication rule:
 * - canonical/known identity may be displayed without executable geometry;
 * - distance/elevation/map download/navigation are emitted only from the
 *   Route's ACTIVE CanonicalTrack;
 * - raw tracks, planned lines, candidate metrics and sibling variants never
 *   leak into public geometry fields.
 *
 * This function is read-only. It never mutates Route, CanonicalTrack, Rule or
 * evidence truth.
 */
export async function buildCanonicalRoutePageProjection(
  pool: Pool,
  routeId: string
): Promise<CanonicalRoutePageProjection> {
  const repo = new CanonicalPostgresRepository(pool);
  const route = await repo.findRoute(routeId);
  if (!route) throw new Error(`Route not found: ${routeId}`);

  let activeTrack: ActiveCanonicalTrackRow | null = null;
  if (route.active_canonical_track_id) {
    const trackResult = await pool.query<ActiveCanonicalTrackRow>(
      `SELECT canonical_track_id, route_id,
              distance_m::float8 AS distance_m,
              elevation_gain_m::float8 AS elevation_gain_m,
              version
         FROM canonical_track
        WHERE canonical_track_id = $1
          AND route_id = $2`,
      [route.active_canonical_track_id, route.route_id]
    );
    activeTrack = trackResult.rows[0] ?? null;
  }

  const dependencies = await repo.listDependenciesForEntity('route', route.route_id);
  const geometryState = geometryStateFor(route.route_state, activeTrack);
  const executableGeometry = activeTrack !== null && route.route_state === 'EXECUTABLE';
  const reasonCodes: string[] = [];

  if (!activeTrack) reasonCodes.push('NO_ACTIVE_CANONICAL_TRACK');
  if (route.route_state === 'GEOMETRY_BLOCKED') reasonCodes.push('CHILD_ROUTE_GEOMETRY_BLOCKED');
  if (route.route_state === 'RULE_BLOCKED') reasonCodes.push('ROUTE_RULE_BLOCKED');
  if (activeTrack && route.route_state !== 'EXECUTABLE') {
    reasonCodes.push('CANONICAL_TRACK_PRESENT_BUT_ROUTE_NOT_EXECUTABLE');
  }

  return {
    projection_type: 'ROUTE_PUBLIC_PAGE_V1',
    repository_mode: 'CANONICAL_POSTGRES',
    data_classification: 'CANONICAL_EVIDENCE_BACKED',
    route_id: route.route_id,
    area_id: route.area_id,
    route_family_id: route.route_family_id,
    canonical_name: route.canonical_name,
    identity_state: route.identity_state,
    route_state: route.route_state,
    canonical_version: route.version,
    geometry: {
      state: geometryState,
      active_canonical_track_id: activeTrack?.canonical_track_id ?? null,
      map_download_visible: executableGeometry,
      navigation_visible: executableGeometry,
      distance_meters: executableGeometry ? activeTrack!.distance_m : null,
      elevation_gain_meters: executableGeometry ? activeTrack!.elevation_gain_m : null
    },
    dependencies: dependencies.map(dep => ({
      dependency_id: dep.dependency_id,
      dependency_class: dep.dependency_class,
      state: dep.state,
      stop_status: dep.stop_status,
      reopen_trigger: dep.reopen_trigger
    })),
    reason_codes: reasonCodes,
    projected_at: new Date().toISOString()
  };
}

/**
 * Persist a disposable/read-model projection. Canonical entity tables remain
 * untouched; only page_projection_state is upserted.
 */
export async function persistCanonicalRoutePageProjection(
  pool: Pool,
  projection: CanonicalRoutePageProjection
): Promise<void> {
  const projectionId = `route-public:${projection.route_id}:v1`;
  await pool.query(
    `INSERT INTO page_projection_state (
       projection_id, entity_type, entity_id, projection_type,
       canonical_version, gate_state, payload, rendered_at
     ) VALUES ($1, 'route', $2, $3, $4, $5, $6::jsonb, now())
     ON CONFLICT (entity_type, entity_id, projection_type) DO UPDATE SET
       canonical_version = EXCLUDED.canonical_version,
       gate_state = EXCLUDED.gate_state,
       payload = EXCLUDED.payload,
       rendered_at = now()`,
    [
      projectionId,
      projection.route_id,
      projection.projection_type,
      projection.canonical_version,
      projection.route_state,
      JSON.stringify(projection)
    ]
  );
}

export async function projectAndPersistCanonicalRoutePage(
  pool: Pool,
  routeId: string
): Promise<CanonicalRoutePageProjection> {
  const projection = await buildCanonicalRoutePageProjection(pool, routeId);
  await persistCanonicalRoutePageProjection(pool, projection);
  return projection;
}
