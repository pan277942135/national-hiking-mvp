/**
 * Runtime Snapshot Service for National Hiking Backend MVP
 * Invariants 9 & 10: Enforces observed_at, valid_until, and prevents stale 'go now' bypass.
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

  // Enforce Invariant 9: runtime state must include observed_at and valid_until (valid_until >= observed_at)
  assertRuntimeSnapshotValidity(snapshot);

  await repos.runtimeSnapshots.save(snapshot);
  return snapshot;
}
