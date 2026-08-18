import crypto from 'node:crypto';
import { getPgPool } from '../config/database.js';
import { getAreaCatalogSummary, listAreaCatalog } from './area_catalog_service.js';

export type ProjectionEvidenceState =
  | 'UNKNOWN'
  | 'SUPPORTED'
  | 'CANONICAL'
  | 'RECHECK_REQUIRED'
  | 'MODEL_PATCH';

export interface ProjectedField {
  field_name: string;
  state: ProjectionEvidenceState;
  value: unknown;
  evidence_id: string | null;
  effective_from: string | null;
}

export type RoutePublicationState =
  | 'NAVIGATION_READY'
  | 'RULE_CHECK_REQUIRED'
  | 'GEOMETRY_BLOCKED'
  | 'DISCOVERY_ONLY';

export interface AreaRouteProjection {
  id: string;
  family_id: string;
  family_name: string;
  variant_code: string;
  name: string;
  identity_state: string;
  geometry_state: string;
  start_point_name: string | null;
  end_point_name: string | null;
  distance_meters: number | null;
  elevation_gain_meters: number | null;
  estimated_duration_minutes: number | null;
  publication_state: RoutePublicationState;
  navigation_allowed: boolean;
  rule_gate: ProjectedField;
}

export interface AreaPageProjection {
  page_type: 'AREA';
  area: Record<string, unknown>;
  facts: {
    current_operational_status: ProjectedField;
    traffic_control_policy: ProjectedField;
    night_access_policy: ProjectedField;
    parking_fee_current: ProjectedField;
  };
  catalog: {
    summary: unknown;
    access_points: unknown[];
    parking: unknown[];
    pois: unknown[];
  };
  routes: AreaRouteProjection[];
  seo: {
    title: string;
    description: string;
    canonical_path: string;
  };
  quality: {
    unknown_fields: string[];
    recheck_fields: string[];
    navigation_ready_route_count: number;
    read_only_hash: string;
  };
  projected_at: string;
}

function poolOrThrow() {
  const pool = getPgPool();
  if (!pool) throw new Error('PostgreSQL is not configured');
  return pool;
}

function normalizeEvidenceState(value: unknown): ProjectionEvidenceState {
  if (typeof value !== 'string') return 'UNKNOWN';
  const normalized = value.toUpperCase();
  if (['UNKNOWN', 'SUPPORTED', 'CANONICAL', 'RECHECK_REQUIRED', 'MODEL_PATCH'].includes(normalized)) {
    return normalized as ProjectionEvidenceState;
  }
  return 'UNKNOWN';
}

export function projectField(
  fieldName: string,
  row?: { field_value?: unknown; evidence_id?: string | null; effective_from?: string | Date | null }
): ProjectedField {
  if (!row) {
    return {
      field_name: fieldName,
      state: 'UNKNOWN',
      value: null,
      evidence_id: null,
      effective_from: null
    };
  }

  const fieldValue = row.field_value;
  let state: ProjectionEvidenceState = 'UNKNOWN';
  if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
    state = normalizeEvidenceState((fieldValue as Record<string, unknown>).state);
  }

  return {
    field_name: fieldName,
    state,
    value: fieldValue ?? null,
    evidence_id: row.evidence_id ?? null,
    effective_from: row.effective_from ? new Date(row.effective_from).toISOString() : null
  };
}

function ruleGateIsClear(ruleGate: ProjectedField): boolean {
  if (ruleGate.state !== 'CANONICAL' && ruleGate.state !== 'SUPPORTED') return false;
  if (!ruleGate.value || typeof ruleGate.value !== 'object' || Array.isArray(ruleGate.value)) return false;
  const value = ruleGate.value as Record<string, unknown>;
  const candidates = [value.gate, value.status, value.rule_gate, value.legal_clearance_status];
  return candidates.some(candidate => typeof candidate === 'string' && candidate.toUpperCase() === 'CLEAR');
}

export function deriveRoutePublicationState(input: {
  identityState: string;
  geometryState: string;
  ruleGate: ProjectedField;
}): { publication_state: RoutePublicationState; navigation_allowed: boolean } {
  if (input.identityState !== 'CANONICAL') {
    return { publication_state: 'DISCOVERY_ONLY', navigation_allowed: false };
  }
  if (input.geometryState !== 'ACCEPTED_CONSENSUS') {
    return { publication_state: 'GEOMETRY_BLOCKED', navigation_allowed: false };
  }
  if (!ruleGateIsClear(input.ruleGate)) {
    return { publication_state: 'RULE_CHECK_REQUIRED', navigation_allowed: false };
  }
  return { publication_state: 'NAVIGATION_READY', navigation_allowed: true };
}

async function currentFields(entityType: string, entityIds: string[], fieldNames: string[]) {
  const result = new Map<string, Map<string, ProjectedField>>();
  if (!entityIds.length || !fieldNames.length) return result;
  const pool = poolOrThrow();
  const rows = await pool.query(
    `SELECT entity_id, field_name, field_value, evidence_id, effective_from
     FROM field_values
     WHERE entity_type=$1
       AND entity_id = ANY($2::varchar[])
       AND field_name = ANY($3::varchar[])
       AND is_current=true`,
    [entityType, entityIds, fieldNames]
  );

  for (const row of rows.rows) {
    const byField = result.get(row.entity_id) || new Map<string, ProjectedField>();
    byField.set(row.field_name, projectField(row.field_name, row));
    result.set(row.entity_id, byField);
  }
  return result;
}

async function resolveArea(areaKey: string) {
  const pool = poolOrThrow();
  const result = await pool.query(
    `SELECT id,name,slug,area_type,protection_level,jurisdiction_code,description
     FROM areas
     WHERE id=$1 OR slug=$1
     LIMIT 1`,
    [areaKey]
  );
  return result.rows[0] || null;
}

export async function projectAreaPage(areaKey: string): Promise<AreaPageProjection> {
  if (!areaKey.trim()) throw new Error('area id or slug is required');
  const pool = poolOrThrow();
  const area = await resolveArea(areaKey);
  if (!area) throw new Error(`Area not found: ${areaKey}`);

  const areaFieldNames = [
    'current_operational_status',
    'traffic_control_policy',
    'night_access_policy',
    'parking_fee_current'
  ];
  const areaFields = await currentFields('AREA', [area.id], areaFieldNames);
  const byAreaField = areaFields.get(area.id) || new Map<string, ProjectedField>();
  const fact = (name: string) => byAreaField.get(name) || projectField(name);

  const routeRows = await pool.query(
    `SELECT r.id,r.family_id,rf.name AS family_name,r.variant_code,r.name,
            r.identity_state,r.geometry_state,r.start_point_name,r.end_point_name,
            r.distance_meters,r.elevation_gain_meters,r.estimated_duration_minutes
     FROM routes r
     JOIN route_families rf ON rf.id=r.family_id
     WHERE rf.area_id=$1
     ORDER BY rf.canonical_code,r.variant_code`,
    [area.id]
  );

  const routeIds = routeRows.rows.map(row => row.id);
  const routeFields = await currentFields('ROUTE', routeIds, ['current_rule_state']);
  const routes: AreaRouteProjection[] = routeRows.rows.map(row => {
    const ruleGate = routeFields.get(row.id)?.get('current_rule_state') || projectField('current_rule_state');
    const publication = deriveRoutePublicationState({
      identityState: row.identity_state,
      geometryState: row.geometry_state,
      ruleGate
    });
    return {
      id: row.id,
      family_id: row.family_id,
      family_name: row.family_name,
      variant_code: row.variant_code,
      name: row.name,
      identity_state: row.identity_state,
      geometry_state: row.geometry_state,
      start_point_name: row.start_point_name,
      end_point_name: row.end_point_name,
      distance_meters: row.distance_meters === null ? null : Number(row.distance_meters),
      elevation_gain_meters: row.elevation_gain_meters === null ? null : Number(row.elevation_gain_meters),
      estimated_duration_minutes: row.estimated_duration_minutes,
      ...publication,
      rule_gate: ruleGate
    };
  });

  const [summary, accessPoints, parking, pois] = await Promise.all([
    getAreaCatalogSummary(area.id),
    listAreaCatalog(area.id, 'ACCESS_POINT'),
    listAreaCatalog(area.id, 'PARKING'),
    listAreaCatalog(area.id, 'POI')
  ]);

  const facts = {
    current_operational_status: fact('current_operational_status'),
    traffic_control_policy: fact('traffic_control_policy'),
    night_access_policy: fact('night_access_policy'),
    parking_fee_current: fact('parking_fee_current')
  };

  const factEntries = Object.entries(facts);
  const unknownFields = factEntries.filter(([, value]) => value.state === 'UNKNOWN').map(([name]) => name);
  const recheckFields = factEntries.filter(([, value]) => value.state === 'RECHECK_REQUIRED').map(([name]) => name);
  const projectedAt = new Date().toISOString();
  const hashPayload = JSON.stringify({
    area: area.id,
    facts: factEntries.map(([name, value]) => [name, value.state, value.evidence_id]),
    routes: routes.map(route => [route.id, route.identity_state, route.geometry_state, route.publication_state]),
    catalog: summary
  });

  return {
    page_type: 'AREA',
    area,
    facts,
    catalog: {
      summary,
      access_points: accessPoints,
      parking,
      pois
    },
    routes,
    seo: {
      title: `${area.name}徒步路线、入口与停车｜全国徒步路线`,
      description: `${area.name}的路线、入口、停车与当前规则。所有动态信息均按证据状态展示，未知信息不会由系统补写。`,
      canonical_path: `/explore/areas/${area.slug}`
    },
    quality: {
      unknown_fields: unknownFields,
      recheck_fields: recheckFields,
      navigation_ready_route_count: routes.filter(route => route.navigation_allowed).length,
      read_only_hash: crypto.createHash('sha256').update(hashPayload).digest('hex').slice(0, 16)
    },
    projected_at: projectedAt
  };
}
