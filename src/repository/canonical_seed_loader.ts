import fs from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';

interface SeedArea {
  area_id: string;
  area_type: 'NATURAL' | 'COMPOSITE' | 'PROTECTED' | 'URBAN_GREEN';
  canonical_name: string;
  static_gate?: string;
}

interface SeedRouteFamily {
  route_family_id: string;
  area_id: string;
  canonical_name: string;
  identity_state?: string;
}

interface SeedRoute {
  route_id: string;
  area_id: string;
  route_family_id?: string;
  canonical_name: string;
  identity_state?: string;
  route_state: 'IDENTITY_ONLY' | 'GEOMETRY_BLOCKED' | 'RULE_BLOCKED' | 'STATIC_PUBLISHABLE' | 'EXECUTABLE';
  asset_state?: string;
}

interface SeedFieldValue {
  id: string;
  entity_type: string;
  entity_id: string;
  field_key: string;
  state: string;
  value: unknown;
  confidence: number;
  import: string;
}

interface SeedDependency {
  dependency_id: string;
  entity_type: string;
  entity_id: string;
  field_key?: string;
  class: string;
  state: string;
  stop_status: string;
  reopen_trigger: string;
  preferred_source_class?: string;
}

interface CanonicalSeedManifest {
  version: string;
  source: string;
  areas: SeedArea[];
  route_families: SeedRouteFamily[];
  routes: SeedRoute[];
  field_values: SeedFieldValue[];
  dependencies: SeedDependency[];
}

export interface CanonicalSeedResult {
  manifest_version: string;
  areas_upserted: number;
  route_families_upserted: number;
  routes_upserted: number;
  field_values_upserted: number;
  dependencies_upserted: number;
  runtime_only_values_skipped: string[];
  annotations_not_persisted: string[];
}

function loadManifest(manifestPath: string): CanonicalSeedManifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CanonicalSeedManifest;
}

async function seedWithClient(
  client: PoolClient,
  manifest: CanonicalSeedManifest
): Promise<CanonicalSeedResult> {
  const runtimeOnlyValuesSkipped: string[] = [];
  const annotationsNotPersisted = new Set<string>();

  for (const area of manifest.areas) {
    await client.query(
      `INSERT INTO area (area_id, area_type, canonical_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (area_id) DO UPDATE SET
         area_type = EXCLUDED.area_type,
         canonical_name = EXCLUDED.canonical_name,
         updated_at = now()`,
      [area.area_id, area.area_type, area.canonical_name]
    );
    if (area.static_gate !== undefined) annotationsNotPersisted.add('area.static_gate');
  }

  for (const family of manifest.route_families) {
    await client.query(
      `INSERT INTO route_family (route_family_id, area_id, canonical_name, identity_state)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (route_family_id) DO UPDATE SET
         area_id = EXCLUDED.area_id,
         canonical_name = EXCLUDED.canonical_name,
         identity_state = EXCLUDED.identity_state`,
      [family.route_family_id, family.area_id, family.canonical_name, family.identity_state ?? 'CANDIDATE']
    );
  }

  for (const route of manifest.routes) {
    await client.query(
      `INSERT INTO route (
         route_id, route_family_id, area_id, canonical_name, identity_state, route_state
       ) VALUES ($1, $2, $3, $4, $5, $6)
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
        route.identity_state ?? 'CANDIDATE',
        route.route_state
      ]
    );
    if (route.asset_state !== undefined) annotationsNotPersisted.add('route.asset_state');
  }

  for (const field of manifest.field_values) {
    // The manifest explicitly labels runtime-only facts as NO_STATIC_VALUE.
    // They are intentionally not persisted into canonical static FieldValue truth.
    if (field.import === 'NO_STATIC_VALUE' || field.state === 'RUNTIME_ONLY') {
      runtimeOnlyValuesSkipped.push(field.id);
      continue;
    }

    await client.query(
      `INSERT INTO field_value (
         field_value_id, entity_type, entity_id, field_key, state, value,
         confidence, version, is_current, lineage
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 1, true, $8::jsonb)
       ON CONFLICT (field_value_id) DO UPDATE SET
         entity_type = EXCLUDED.entity_type,
         entity_id = EXCLUDED.entity_id,
         field_key = EXCLUDED.field_key,
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
        JSON.stringify({
          seed_manifest_version: manifest.version,
          seed_source: manifest.source,
          import_directive: field.import
        })
      ]
    );
  }

  for (const dependency of manifest.dependencies) {
    await client.query(
      `INSERT INTO dependency (
         dependency_id, entity_type, entity_id, field_key, dependency_class,
         state, stop_status, reopen_trigger, preferred_source_class, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (dependency_id) DO UPDATE SET
         entity_type = EXCLUDED.entity_type,
         entity_id = EXCLUDED.entity_id,
         field_key = EXCLUDED.field_key,
         dependency_class = EXCLUDED.dependency_class,
         state = EXCLUDED.state,
         stop_status = EXCLUDED.stop_status,
         reopen_trigger = EXCLUDED.reopen_trigger,
         preferred_source_class = EXCLUDED.preferred_source_class,
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
        dependency.preferred_source_class ?? null,
        JSON.stringify({ seed_manifest_version: manifest.version })
      ]
    );
  }

  return {
    manifest_version: manifest.version,
    areas_upserted: manifest.areas.length,
    route_families_upserted: manifest.route_families.length,
    routes_upserted: manifest.routes.length,
    field_values_upserted: manifest.field_values.length - runtimeOnlyValuesSkipped.length,
    dependencies_upserted: manifest.dependencies.length,
    runtime_only_values_skipped: runtimeOnlyValuesSkipped,
    annotations_not_persisted: [...annotationsNotPersisted].sort()
  };
}

/**
 * Idempotently loads the evidence-backed four-area seed into the canonical DB.
 * No synthetic UI fixtures or runtime snapshots are imported.
 */
export async function seedCanonicalFourAreaManifest(
  pool: Pool,
  manifestPath: string = path.join(process.cwd(), 'db', 'four_area_seed_manifest_v0_2.json')
): Promise<CanonicalSeedResult> {
  const manifest = loadManifest(manifestPath);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await seedWithClient(client, manifest);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
