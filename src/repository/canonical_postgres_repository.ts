import type { Pool, PoolClient } from 'pg';

export interface CanonicalAreaRow {
  area_id: string;
  area_type: 'NATURAL' | 'COMPOSITE' | 'PROTECTED' | 'URBAN_GREEN';
  canonical_name: string;
  aliases: unknown[];
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface CanonicalRouteFamilyRow {
  route_family_id: string;
  area_id: string;
  canonical_name: string;
  identity_state: string;
  intent_scope: Record<string, unknown>;
  created_at: Date;
}

export interface CanonicalRouteRow {
  route_id: string;
  route_family_id: string | null;
  area_id: string;
  canonical_name: string;
  identity_state: string;
  route_state: 'IDENTITY_ONLY' | 'GEOMETRY_BLOCKED' | 'RULE_BLOCKED' | 'STATIC_PUBLISHABLE' | 'EXECUTABLE';
  route_type: string | null;
  active_canonical_track_id: string | null;
  version: number;
  created_at: Date;
}

export interface CanonicalFieldValueRow {
  field_value_id: string;
  entity_type: string;
  entity_id: string;
  field_key: string;
  state: string;
  value: unknown;
  confidence: number;
  valid_from: Date | null;
  valid_until: Date | null;
  version: number;
  is_current: boolean;
  lineage: Record<string, unknown>;
  created_at: Date;
}

export interface CanonicalDependencyRow {
  dependency_id: string;
  entity_type: string;
  entity_id: string;
  field_key: string | null;
  dependency_class: string;
  state: string;
  stop_status: string;
  reopen_trigger: string;
  preferred_source_class: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  resolved_at: Date | null;
}

export interface CanonicalDbReplaySnapshot {
  area_count: number;
  route_family_count: number;
  route_count: number;
  field_value_count: number;
  dependency_count: number;
  s12_a: CanonicalRouteRow | null;
  s12_dependency: CanonicalDependencyRow | null;
  zijinshan_night_state: CanonicalFieldValueRow | null;
  postgis_version: string;
}

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/**
 * Repository adapter over the frozen canonical PostgreSQL/PostGIS schema.
 *
 * This deliberately returns canonical persistence rows rather than AI Studio
 * UI/demo DTOs. The UI adapter and canonical database contract remain separate
 * until an explicit application mapping layer is introduced.
 */
export class CanonicalPostgresRepository {
  constructor(private readonly db: Queryable) {}

  async listAreas(): Promise<CanonicalAreaRow[]> {
    const result = await this.db.query<CanonicalAreaRow>(
      `SELECT area_id, area_type, canonical_name, aliases, version, created_at, updated_at
       FROM area ORDER BY area_id`
    );
    return result.rows;
  }

  async findAreaById(areaId: string): Promise<CanonicalAreaRow | null> {
    const result = await this.db.query<CanonicalAreaRow>(
      `SELECT area_id, area_type, canonical_name, aliases, version, created_at, updated_at
       FROM area WHERE area_id = $1`,
      [areaId]
    );
    return result.rows[0] ?? null;
  }

  async listRouteFamilies(): Promise<CanonicalRouteFamilyRow[]> {
    const result = await this.db.query<CanonicalRouteFamilyRow>(
      `SELECT route_family_id, area_id, canonical_name, identity_state, intent_scope, created_at
       FROM route_family ORDER BY route_family_id`
    );
    return result.rows;
  }

  async findRouteFamilyById(routeFamilyId: string): Promise<CanonicalRouteFamilyRow | null> {
    const result = await this.db.query<CanonicalRouteFamilyRow>(
      `SELECT route_family_id, area_id, canonical_name, identity_state, intent_scope, created_at
       FROM route_family WHERE route_family_id = $1`,
      [routeFamilyId]
    );
    return result.rows[0] ?? null;
  }

  async listRoutes(): Promise<CanonicalRouteRow[]> {
    const result = await this.db.query<CanonicalRouteRow>(
      `SELECT route_id, route_family_id, area_id, canonical_name, identity_state,
              route_state, route_type, active_canonical_track_id, version, created_at
       FROM route ORDER BY route_id`
    );
    return result.rows;
  }

  async findRouteById(routeId: string): Promise<CanonicalRouteRow | null> {
    const result = await this.db.query<CanonicalRouteRow>(
      `SELECT route_id, route_family_id, area_id, canonical_name, identity_state,
              route_state, route_type, active_canonical_track_id, version, created_at
       FROM route WHERE route_id = $1`,
      [routeId]
    );
    return result.rows[0] ?? null;
  }

  async findCurrentFieldValue(
    entityType: string,
    entityId: string,
    fieldKey: string
  ): Promise<CanonicalFieldValueRow | null> {
    const result = await this.db.query<CanonicalFieldValueRow>(
      `SELECT field_value_id, entity_type, entity_id, field_key, state, value,
              confidence::float8 AS confidence, valid_from, valid_until, version,
              is_current, lineage, created_at
       FROM field_value
       WHERE entity_type = $1 AND entity_id = $2 AND field_key = $3 AND is_current = true`,
      [entityType, entityId, fieldKey]
    );
    return result.rows[0] ?? null;
  }

  async listDependencies(): Promise<CanonicalDependencyRow[]> {
    const result = await this.db.query<CanonicalDependencyRow>(
      `SELECT dependency_id, entity_type, entity_id, field_key, dependency_class,
              state, stop_status, reopen_trigger, preferred_source_class, metadata,
              created_at, resolved_at
       FROM dependency ORDER BY dependency_id`
    );
    return result.rows;
  }

  async findDependencyById(dependencyId: string): Promise<CanonicalDependencyRow | null> {
    const result = await this.db.query<CanonicalDependencyRow>(
      `SELECT dependency_id, entity_type, entity_id, field_key, dependency_class,
              state, stop_status, reopen_trigger, preferred_source_class, metadata,
              created_at, resolved_at
       FROM dependency WHERE dependency_id = $1`,
      [dependencyId]
    );
    return result.rows[0] ?? null;
  }

  async getReplaySnapshot(): Promise<CanonicalDbReplaySnapshot> {
    const counts = await this.db.query<{
      area_count: string;
      route_family_count: string;
      route_count: string;
      field_value_count: string;
      dependency_count: string;
    }>(`
      SELECT
        (SELECT count(*) FROM area)::text AS area_count,
        (SELECT count(*) FROM route_family)::text AS route_family_count,
        (SELECT count(*) FROM route)::text AS route_count,
        (SELECT count(*) FROM field_value)::text AS field_value_count,
        (SELECT count(*) FROM dependency)::text AS dependency_count
    `);
    const postgis = await this.db.query<{ version: string }>('SELECT postgis_version() AS version');

    const [s12A, s12Dependency, nightState] = await Promise.all([
      this.findRouteById('ZJ-S12-A'),
      this.findDependencyById('DEP-ZJ-S12'),
      this.findCurrentFieldValue('area', 'AREA-NJ-ZIJINSHAN', 'night_legal_access_state')
    ]);

    const row = counts.rows[0];
    return {
      area_count: Number(row.area_count),
      route_family_count: Number(row.route_family_count),
      route_count: Number(row.route_count),
      field_value_count: Number(row.field_value_count),
      dependency_count: Number(row.dependency_count),
      s12_a: s12A,
      s12_dependency: s12Dependency,
      zijinshan_night_state: nightState,
      postgis_version: postgis.rows[0]?.version ?? 'UNKNOWN'
    };
  }
}
