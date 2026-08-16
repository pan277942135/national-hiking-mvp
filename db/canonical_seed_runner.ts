import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { getPgPool } from '../src/config/database.js';

interface CanonicalSeedManifest {
  version: string;
  source: string;
  areas: Array<{
    area_id: string;
    area_type: 'NATURAL' | 'COMPOSITE' | 'PROTECTED' | 'URBAN_GREEN';
    canonical_name: string;
    static_gate?: string;
  }>;
  route_families: Array<{
    route_family_id: string;
    area_id: string;
    canonical_name: string;
    identity_state?: string;
  }>;
  routes: Array<{
    route_id: string;
    route_family_id?: string;
    area_id: string;
    canonical_name: string;
    identity_state?: string;
    route_state: 'IDENTITY_ONLY' | 'GEOMETRY_BLOCKED' | 'RULE_BLOCKED' | 'STATIC_PUBLISHABLE' | 'EXECUTABLE';
    asset_state?: string;
  }>;
  field_values: Array<{
    id: string;
    entity_type: string;
    entity_id: string;
    field_key: string;
    state: string;
    value: unknown;
    confidence: number;
    import?: string;
  }>;
  dependencies: Array<{
    dependency_id: string;
    entity_type: string;
    entity_id: string;
    field_key?: string;
    class: string;
    state: string;
    stop_status: string;
    reopen_trigger: string;
  }>;
}

export interface CanonicalSeedResult {
  success: boolean;
  mode: 'LIVE_DB' | 'NO_DATABASE';
  areas: number;
  routeFamilies: number;
  routes: number;
  fieldValues: number;
  dependencies: number;
  manifestVersion?: string;
  message: string;
}

export function loadCanonicalSeedManifest(
  manifestPath: string = path.join(process.cwd(), 'db', 'four_area_seed_manifest_v0_2.json')
): CanonicalSeedManifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as CanonicalSeedManifest;
}

async function upsertManifest(client: PoolClient, manifest: CanonicalSeedManifest): Promise<void> {
  for (const area of manifest.areas) {
    await client.query(
      `INSERT INTO area (area_id, area_type, canonical_name, aliases, version)
       VALUES ($1, $2::area_type_enum, $3, '[]'::jsonb, 1)
       ON CONFLICT (area_id) DO UPDATE SET
         area_type = EXCLUDED.area_type,
         canonical_name = EXCLUDED.canonical_name,
         updated_at = now()`,
      [area.area_id, area.area_type, area.canonical_name]
    );
  }

  for (const family of manifest.route_families) {
    await client.query(
      `INSERT INTO route_family (
         route_family_id, area_id, canonical_name, identity_state, intent_scope
       ) VALUES ($1, $2, $3, $4, '{}'::jsonb)
       ON CONFLICT (route_family_id) DO UPDATE SET
         area_id = EXCLUDED.area_id,
         canonical_name = EXCLUDED.canonical_name,
         identity_state = EXCLUDED.identity_state`,
      [
        family.route_family_id,
        family.area_id,
        family.canonical_name,
        family.identity_state ?? 'CANDIDATE'
      ]
    );
  }

  for (const route of manifest.routes) {
    await client.query(
      `INSERT INTO route (
         route_id, route_family_id, area_id, canonical_name,
         identity_state, route_state, version
       ) VALUES ($1, $2, $3, $4, $5, $6::route_state_enum, 1)
       ON CONFLICT (route_id) DO UPDATE SET
         route_family_id = EXCLUDED.route_family_id,
         area_id = EXCLUDED.area_id,
         canonical_name = EXCLUDED.canonical_name,
         identity_state = EXCLUDED.identity_state,
         route_state = EXCLUDED.route_state`,
      [
        route.route_id,
        route.route_family_id ?? null,
        route.area_id,
        route.canonical_name,
        route.identity_state ?? 'CANONICAL',
        route.route_state
      ]
    );
  }

  for (const field of manifest.field_values) {
    // Preserve history if a future manifest adds a new version. For the frozen
    // V0.2 seed, id/version 1 is deterministic and idempotent.
    await client.query(
      `INSERT INTO field_value (
         field_value_id, entity_type, entity_id, field_key, state,
         value, confidence, version, is_current, lineage
       ) VALUES ($1, $2, $3, $4, $5::field_state_enum, $6::jsonb, $7, 1, true, $8::jsonb)
       ON CONFLICT (field_value_id) DO UPDATE SET
         state = EXCLUDED.state,
         value = EXCLUDED.value,
         confidence = EXCLUDED.confidence,
         is_current = true,
         lineage = EXCLUDED.lineage`,
      [
        field.id,
        field.entity_type,
        field.entity_id,
        field.field_key,
        field.state,
        JSON.stringify(field.value),
        field.confidence,
        JSON.stringify({ import: field.import ?? null, seed_manifest_version: manifest.version })
      ]
    );
  }

  for (const dependency of manifest.dependencies) {
    await client.query(
      `INSERT INTO dependency (
         dependency_id, entity_type, entity_id, field_key,
         dependency_class, state, stop_status, reopen_trigger,
         preferred_source_class, metadata
       ) VALUES ($1, $2, $3, $4, $5::dependency_class_enum, $6, $7, $8, NULL, $9::jsonb)
       ON CONFLICT (dependency_id) DO UPDATE SET
         entity_type = EXCLUDED.entity_type,
         entity_id = EXCLUDED.entity_id,
         field_key = EXCLUDED.field_key,
         dependency_class = EXCLUDED.dependency_class,
         state = EXCLUDED.state,
         stop_status = EXCLUDED.stop_status,
         reopen_trigger = EXCLUDED.reopen_trigger,
         metadata = EXCLUDED.metadata`,
      [
        dependency.dependency_id,
        dependency.entity_type,
        dependency.entity_id,
        dependency.field_key ?? null,
        dependency.class,
        dependency.state,
        dependency.stop_status,
        dependency.reopen_trigger,
        JSON.stringify({ seed_manifest_version: manifest.version })
      ]
    );
  }
}

export async function seedCanonicalDatabase(): Promise<CanonicalSeedResult> {
  const pool = getPgPool();
  if (!pool) {
    return {
      success: false,
      mode: 'NO_DATABASE',
      areas: 0,
      routeFamilies: 0,
      routes: 0,
      fieldValues: 0,
      dependencies: 0,
      message: 'DATABASE_URL is not configured; canonical production seed was not written.'
    };
  }

  const manifest = loadCanonicalSeedManifest();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await upsertManifest(client, manifest);
    await client.query('COMMIT');
    return {
      success: true,
      mode: 'LIVE_DB',
      areas: manifest.areas.length,
      routeFamilies: manifest.route_families.length,
      routes: manifest.routes.length,
      fieldValues: manifest.field_values.length,
      dependencies: manifest.dependencies.length,
      manifestVersion: manifest.version,
      message: 'Evidence-backed canonical seed loaded into PostgreSQL/PostGIS.'
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
