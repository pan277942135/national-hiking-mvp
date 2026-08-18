import { getPgPool } from '../config/database.js';

export type CatalogEntityType = 'ACCESS_POINT' | 'POI' | 'PARKING';
export type CatalogState = 'DRAFT' | 'SUPPORTED' | 'CANONICAL' | 'DEPRECATED';

export interface CatalogQueryOptions {
  includeDeprecated?: boolean;
  state?: CatalogState;
}

export interface CatalogEntityRecord extends Record<string, unknown> {
  id: string;
  area_id: string;
  name: string;
  catalog_state: CatalogState;
  current_fields: Record<string, unknown>;
}

const TABLE_BY_TYPE: Record<CatalogEntityType, string> = {
  ACCESS_POINT: 'access_points',
  POI: 'pois',
  PARKING: 'parking'
};

const FIELD_ENTITY_TYPE: Record<CatalogEntityType, string> = {
  ACCESS_POINT: 'ACCESS_POINT',
  POI: 'POI',
  PARKING: 'PARKING'
};

function poolOrThrow() {
  const pool = getPgPool();
  if (!pool) throw new Error('PostgreSQL is not configured');
  return pool;
}

function assertCatalogState(value: string | undefined): CatalogState | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase();
  if (!['DRAFT', 'SUPPORTED', 'CANONICAL', 'DEPRECATED'].includes(normalized)) {
    throw new Error(`Invalid catalog_state: ${value}`);
  }
  return normalized as CatalogState;
}

export function parseCatalogState(value: unknown): CatalogState | undefined {
  return assertCatalogState(typeof value === 'string' ? value : undefined);
}

async function currentFieldsByEntityIds(
  entityType: CatalogEntityType,
  ids: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();
  if (!ids.length) return result;

  const pool = poolOrThrow();
  const rows = await pool.query(
    `SELECT entity_id, field_name, field_value, evidence_id, effective_from
     FROM field_values
     WHERE entity_type=$1 AND entity_id = ANY($2::varchar[]) AND is_current=true
     ORDER BY entity_id, field_name`,
    [FIELD_ENTITY_TYPE[entityType], ids]
  );

  for (const row of rows.rows) {
    const existing = result.get(row.entity_id) || {};
    existing[row.field_name] = {
      value: row.field_value,
      evidence_id: row.evidence_id,
      effective_from: row.effective_from
    };
    result.set(row.entity_id, existing);
  }
  return result;
}

export async function listAreaCatalog(
  areaId: string,
  entityType: CatalogEntityType,
  options: CatalogQueryOptions = {}
): Promise<CatalogEntityRecord[]> {
  if (!areaId.trim()) throw new Error('area_id is required');
  const table = TABLE_BY_TYPE[entityType];
  const pool = poolOrThrow();
  const params: unknown[] = [areaId];
  const filters = ['area_id=$1'];

  if (!options.includeDeprecated) filters.push(`catalog_state <> 'DEPRECATED'`);
  if (options.state) {
    params.push(options.state);
    filters.push(`catalog_state=$${params.length}`);
  }

  const rows = await pool.query(
    `SELECT * FROM ${table}
     WHERE ${filters.join(' AND ')}
     ORDER BY CASE catalog_state
       WHEN 'CANONICAL' THEN 1
       WHEN 'SUPPORTED' THEN 2
       WHEN 'DRAFT' THEN 3
       ELSE 4 END,
       name, id`,
    params
  );

  const currentFields = await currentFieldsByEntityIds(entityType, rows.rows.map(row => row.id));
  return rows.rows.map(row => ({
    ...row,
    current_fields: currentFields.get(row.id) || {}
  })) as CatalogEntityRecord[];
}

export async function getCatalogEntity(
  entityType: CatalogEntityType,
  id: string
): Promise<CatalogEntityRecord | null> {
  if (!id.trim()) throw new Error('catalog entity id is required');
  const table = TABLE_BY_TYPE[entityType];
  const pool = poolOrThrow();
  const rows = await pool.query(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  if (!rows.rows[0]) return null;
  const currentFields = await currentFieldsByEntityIds(entityType, [id]);
  return {
    ...rows.rows[0],
    current_fields: currentFields.get(id) || {}
  } as CatalogEntityRecord;
}

export async function getAreaCatalogSummary(areaId: string) {
  const [accessPoints, pois, parking] = await Promise.all([
    listAreaCatalog(areaId, 'ACCESS_POINT'),
    listAreaCatalog(areaId, 'POI'),
    listAreaCatalog(areaId, 'PARKING')
  ]);

  const countStates = (records: CatalogEntityRecord[]) => ({
    total: records.length,
    canonical: records.filter(r => r.catalog_state === 'CANONICAL').length,
    supported: records.filter(r => r.catalog_state === 'SUPPORTED').length,
    draft: records.filter(r => r.catalog_state === 'DRAFT').length
  });

  return {
    area_id: areaId,
    access_points: countStates(accessPoints),
    pois: countStates(pois),
    parking: countStates(parking)
  };
}
