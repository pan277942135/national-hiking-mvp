import fs from 'node:fs';
import path from 'node:path';
import { getPgPool } from '../src/config/database.js';

type CatalogState = 'DRAFT' | 'SUPPORTED' | 'CANONICAL' | 'DEPRECATED';
type AnyRecord = Record<string, any>;

interface CatalogSeed {
  version: string;
  area_id: string;
  policy: {
    default_catalog_state: CatalogState;
    coordinates_must_remain_unknown_without_point_evidence: boolean;
    dynamic_facts_forbidden_in_static_catalog: string[];
  };
  access_points: AnyRecord[];
  parking: AnyRecord[];
  pois: AnyRecord[];
}

function loadSeed(): CatalogSeed {
  const file = path.join(process.cwd(), 'seed', 'zijinshan_catalog_v1.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as CatalogSeed;
}

function assertNoDynamicFacts(seed: CatalogSeed) {
  const forbidden = new Set(seed.policy.dynamic_facts_forbidden_in_static_catalog);
  const walk = (value: unknown, trace: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${trace}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(key)) {
        throw new Error(`Dynamic fact ${key} is forbidden in static catalog at ${trace}.${key}`);
      }
      walk(child, `${trace}.${key}`);
    }
  };
  walk(seed.access_points, 'access_points');
  walk(seed.parking, 'parking');
  walk(seed.pois, 'pois');
}

function assertCoordinatePolicy(records: AnyRecord[], kind: string) {
  for (const record of records) {
    const hasLat = record.latitude !== null && record.latitude !== undefined;
    const hasLon = record.longitude !== null && record.longitude !== undefined;
    if (hasLat !== hasLon) {
      throw new Error(`${kind} ${record.id} has partial coordinates`);
    }
    if (record.catalog_state === 'CANONICAL' && (!hasLat || !hasLon)) {
      throw new Error(`${kind} ${record.id} cannot be CANONICAL without point coordinates`);
    }
  }
}

function validateSeed(seed: CatalogSeed) {
  if (seed.area_id !== 'area_zijinshan') throw new Error('Catalog seed may only target area_zijinshan');
  assertNoDynamicFacts(seed);
  assertCoordinatePolicy(seed.access_points, 'AccessPoint');
  assertCoordinatePolicy(seed.parking, 'Parking');
  assertCoordinatePolicy(seed.pois, 'POI');

  const accessIds = new Set(seed.access_points.map(r => r.id));
  for (const record of seed.parking) {
    if (record.related_access_point_id && !accessIds.has(record.related_access_point_id)) {
      throw new Error(`Parking ${record.id} references unknown access point ${record.related_access_point_id}`);
    }
  }
}

async function main() {
  const seed = loadSeed();
  validateSeed(seed);

  const pool = getPgPool();
  if (!pool) throw new Error('PostgreSQL is not configured');
  const client = await pool.connect();

  const counts = { access_points: 0, parking: 0, pois: 0 };
  try {
    await client.query('BEGIN');

    const area = await client.query('SELECT id FROM areas WHERE id=$1', [seed.area_id]);
    if (!area.rows[0]) throw new Error(`Area does not exist: ${seed.area_id}`);

    for (const record of seed.access_points) {
      await client.query(
        `INSERT INTO access_points
         (id,area_id,name,access_type,catalog_state,latitude,longitude,is_public,aliases,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           area_id=EXCLUDED.area_id,
           name=EXCLUDED.name,
           access_type=EXCLUDED.access_type,
           catalog_state=EXCLUDED.catalog_state,
           latitude=EXCLUDED.latitude,
           longitude=EXCLUDED.longitude,
           is_public=EXCLUDED.is_public,
           aliases=EXCLUDED.aliases,
           metadata=EXCLUDED.metadata,
           updated_at=CURRENT_TIMESTAMP`,
        [record.id, seed.area_id, record.name, record.access_type, record.catalog_state,
         record.latitude, record.longitude, record.is_public, JSON.stringify(record.aliases || []),
         JSON.stringify(record.metadata || {})]
      );
      counts.access_points += 1;
    }

    for (const record of seed.parking) {
      await client.query(
        `INSERT INTO parking
         (id,area_id,related_access_point_id,name,catalog_state,latitude,longitude,capacity,aliases,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           area_id=EXCLUDED.area_id,
           related_access_point_id=EXCLUDED.related_access_point_id,
           name=EXCLUDED.name,
           catalog_state=EXCLUDED.catalog_state,
           latitude=EXCLUDED.latitude,
           longitude=EXCLUDED.longitude,
           capacity=EXCLUDED.capacity,
           aliases=EXCLUDED.aliases,
           metadata=EXCLUDED.metadata,
           updated_at=CURRENT_TIMESTAMP`,
        [record.id, seed.area_id, record.related_access_point_id, record.name, record.catalog_state,
         record.latitude, record.longitude, record.capacity, JSON.stringify(record.aliases || []),
         JSON.stringify(record.metadata || {})]
      );
      counts.parking += 1;
    }

    for (const record of seed.pois) {
      await client.query(
        `INSERT INTO pois
         (id,area_id,name,poi_type,catalog_state,latitude,longitude,altitude_m,aliases,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           area_id=EXCLUDED.area_id,
           name=EXCLUDED.name,
           poi_type=EXCLUDED.poi_type,
           catalog_state=EXCLUDED.catalog_state,
           latitude=EXCLUDED.latitude,
           longitude=EXCLUDED.longitude,
           altitude_m=EXCLUDED.altitude_m,
           aliases=EXCLUDED.aliases,
           metadata=EXCLUDED.metadata,
           updated_at=CURRENT_TIMESTAMP`,
        [record.id, seed.area_id, record.name, record.poi_type, record.catalog_state,
         record.latitude, record.longitude, record.altitude_m, JSON.stringify(record.aliases || []),
         JSON.stringify(record.metadata || {})]
      );
      counts.pois += 1;
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  console.log('[CATALOG SEED] PASS', {
    area_id: seed.area_id,
    ...counts,
    canonical_count: 0,
    note: 'Identity/role only; coordinates and dynamic facts remain evidence-gated.'
  });
  await pool.end();
}

main().catch(error => {
  console.error('CATALOG_SEED_FAILED:', error);
  process.exit(1);
});
