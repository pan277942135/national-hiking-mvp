/**
 * Runtime Snapshot Service for the memory/demo adapter.
 * Runtime observations are transient and never mutate static canonical truth.
 */

import { Repositories } from '../repository/repositories.js';
import { RuntimeSnapshot, HazardLevel } from '../domain/types.js';
import { assertRuntimeSnapshotValidity } from '../domain/invariants.js';

export interface CreateRuntimeSnapshotInput {
  areaId: string;
  routeId?: string;
  observedAt: string;
  validUntil: string;
  hazardLevel?: HazardLevel;
  trailStatus?: string;
  weatherSummary?: string;
  temperatureCelsius?: number;
  windSpeedKmh?: number;
  visibilityMeters?: number;
  snapshotPayload?: Record<string, unknown>;
  sourceName: string;
}

export async function createRuntimeSnapshot(
  repos: Repositories,
  input: CreateRuntimeSnapshotInput
): Promise<RuntimeSnapshot> {
  const area = await repos.areas.findById(input.areaId);
  if (!area) throw new Error(`Area not found for runtime snapshot: ${input.areaId}`);

  if (input.routeId) {
    const route = await repos.routes.findById(input.routeId);
    if (!route) throw new Error(`Route not found for runtime snapshot: ${input.routeId}`);
    const family = await repos.routeFamilies.findById(route.family_id);
    if (!family || family.area_id !== input.areaId) {
      throw new Error(`Route ${input.routeId} is not a child of Area ${input.areaId}`);
    }
  }

  const snapshot: RuntimeSnapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    area_id: input.areaId,
    route_id: input.routeId,
    observed_at: input.observedAt,
    valid_until: input.validUntil,
    hazard_level: input.hazardLevel || 'NORMAL',
    trail_status: input.trailStatus || 'OPEN',
    weather_summary: input.weatherSummary,
    temperature_celsius: input.temperatureCelsius,
    wind_speed_kmh: input.windSpeedKmh,
    visibility_meters: input.visibilityMeters,
    snapshot_payload: input.snapshotPayload || {},
    source_name: input.sourceName,
    created_at: new Date().toISOString()
  };

  assertRuntimeSnapshotValidity(snapshot);
  await repos.runtimeSnapshots.save(snapshot);
  return snapshot;
}
