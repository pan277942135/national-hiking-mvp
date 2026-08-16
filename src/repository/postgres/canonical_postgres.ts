import type { Pool, PoolClient } from 'pg';

export interface CanonicalAreaRow {
  area_id: string;
  area_type: 'NATURAL' | 'COMPOSITE' | 'PROTECTED' | 'URBAN_GREEN';
  canonical_name: string;
  aliases: unknown[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CanonicalRouteFamilyRow {
  route_family_id: string;
  area_id: string;
  canonical_name: string;
  identity_state: string;
  intent_scope: Record<string, unknown>;
  created_at: string;
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
  created_at: string;
}

export interface CanonicalFieldValueRow {
  field_value_id: string;
  entity_type: string;
  entity_id: string;
  field_key: string;
  state: string;
  value: unknown;
  confidence: number;
  version: number;
  is_current: boolean;
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
}

export interface CanonicalRawTrackAssignmentRow {
  raw_track_id: string;
  route_id: string;
  assignment_state: string;
  geometry_gate_state: string;
  direction_class: string | null;
  independent_provenance_key: string | null;
  qa: Record<string, unknown>;
  provenance_class: string;
  recorded_execution: boolean;
}

export interface CanonicalActivityAssignmentRow {
  activity_id: string;
  actor_hash: string;
  raw_track_id: string;
  route_id: string;
  assignment_state: string;
  geometry_gate_state: string;
  integrity_state: string;
  recorded_at: string;
}

/**
 * Canonical PostgreSQL/PostGIS repository.
 *
 * This adapter speaks directly to db/migrations/0001..0010 and deliberately
 * does not reuse the memory/UI-demo DTO repository. The two layers remain
 * isolated until the API is explicitly switched to DB-backed mode.
 */
export class CanonicalPostgresRepository {
  constructor(private readonly pool: Pool) {}

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listAreas(): Promise<CanonicalAreaRow[]> {
    const result = await this.pool.query<CanonicalAreaRow>(
      `SELECT area_id, area_type, canonical_name, aliases, version,
              created_at::text, updated_at::text
         FROM area
        ORDER BY area_id`
    );
    return result.rows;
  }

  async findArea(areaId: string): Promise<CanonicalAreaRow | null> {
    const result = await this.pool.query<CanonicalAreaRow>(
      `SELECT area_id, area_type, canonical_name, aliases, version,
              created_at::text, updated_at::text
         FROM area
        WHERE area_id = $1`,
      [areaId]
    );
    return result.rows[0] ?? null;
  }

  async listRouteFamilies(areaId?: string): Promise<CanonicalRouteFamilyRow[]> {
    const result = areaId
      ? await this.pool.query<CanonicalRouteFamilyRow>(
          `SELECT route_family_id, area_id, canonical_name, identity_state,
                  intent_scope, created_at::text
             FROM route_family
            WHERE area_id = $1
            ORDER BY route_family_id`,
          [areaId]
        )
      : await this.pool.query<CanonicalRouteFamilyRow>(
          `SELECT route_family_id, area_id, canonical_name, identity_state,
                  intent_scope, created_at::text
             FROM route_family
            ORDER BY route_family_id`
        );
    return result.rows;
  }

  async findRoute(routeId: string): Promise<CanonicalRouteRow | null> {
    const result = await this.pool.query<CanonicalRouteRow>(
      `SELECT route_id, route_family_id, area_id, canonical_name, identity_state,
              route_state, route_type, active_canonical_track_id, version,
              created_at::text
         FROM route
        WHERE route_id = $1`,
      [routeId]
    );
    return result.rows[0] ?? null;
  }

  async listRoutes(areaId?: string): Promise<CanonicalRouteRow[]> {
    const result = areaId
      ? await this.pool.query<CanonicalRouteRow>(
          `SELECT route_id, route_family_id, area_id, canonical_name, identity_state,
                  route_state, route_type, active_canonical_track_id, version,
                  created_at::text
             FROM route
            WHERE area_id = $1
            ORDER BY route_id`,
          [areaId]
        )
      : await this.pool.query<CanonicalRouteRow>(
          `SELECT route_id, route_family_id, area_id, canonical_name, identity_state,
                  route_state, route_type, active_canonical_track_id, version,
                  created_at::text
             FROM route
            ORDER BY route_id`
        );
    return result.rows;
  }

  async getCurrentFieldValue(
    entityType: string,
    entityId: string,
    fieldKey: string
  ): Promise<CanonicalFieldValueRow | null> {
    const result = await this.pool.query<CanonicalFieldValueRow>(
      `SELECT field_value_id, entity_type, entity_id, field_key, state,
              value, confidence::float8 AS confidence, version, is_current
         FROM field_value
        WHERE entity_type = $1
          AND entity_id = $2
          AND field_key = $3
          AND is_current = true`,
      [entityType, entityId, fieldKey]
    );
    return result.rows[0] ?? null;
  }

  async listDependenciesForEntity(
    entityType: string,
    entityId: string
  ): Promise<CanonicalDependencyRow[]> {
    const result = await this.pool.query<CanonicalDependencyRow>(
      `SELECT dependency_id, entity_type, entity_id, field_key,
              dependency_class, state, stop_status, reopen_trigger,
              preferred_source_class, metadata
         FROM dependency
        WHERE entity_type = $1 AND entity_id = $2
        ORDER BY dependency_id`,
      [entityType, entityId]
    );
    return result.rows;
  }

  async listRawAssignments(routeId: string): Promise<CanonicalRawTrackAssignmentRow[]> {
    const result = await this.pool.query<CanonicalRawTrackAssignmentRow>(
      `SELECT a.raw_track_id, a.route_id, a.assignment_state,
              a.geometry_gate_state, a.direction_class,
              a.independent_provenance_key, a.qa,
              t.provenance_class, t.recorded_execution
         FROM raw_track_route_assignment a
         JOIN raw_track t ON t.raw_track_id = a.raw_track_id
        WHERE a.route_id = $1
        ORDER BY a.raw_track_id`,
      [routeId]
    );
    return result.rows;
  }

  async listActivityAssignments(routeId: string): Promise<CanonicalActivityAssignmentRow[]> {
    const result = await this.pool.query<CanonicalActivityAssignmentRow>(
      `SELECT ara.activity_id, a.actor_hash, a.raw_track_id, ara.route_id,
              ara.assignment_state, ara.geometry_gate_state,
              a.integrity_state, a.recorded_at::text
         FROM activity_route_assignment ara
         JOIN activity a ON a.activity_id = ara.activity_id
        WHERE ara.route_id = $1
        ORDER BY ara.activity_id`,
      [routeId]
    );
    return result.rows;
  }

  /**
   * Raw evidence independence uses the persisted provenance key when present;
   * otherwise each raw_track_id is treated as its own evidence unit.
   */
  async countIndependentAcceptedRawExecutions(routeId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(DISTINCT COALESCE(a.independent_provenance_key, a.raw_track_id))::text AS count
         FROM raw_track_route_assignment a
         JOIN raw_track t ON t.raw_track_id = a.raw_track_id
        WHERE a.route_id = $1
          AND a.assignment_state = 'TARGET_ACCEPTED'
          AND t.recorded_execution = true
          AND t.provenance_class IN ('RECORDED_GPS', 'RECORDED_GPS_MERGED')`,
      [routeId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * First-party public consensus is stricter: at least two distinct actors.
   * Repeated days by the same actor support repeatability only.
   */
  async countIndependentAcceptedActors(routeId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(DISTINCT a.actor_hash)::text AS count
         FROM activity_route_assignment ara
         JOIN activity a ON a.activity_id = ara.activity_id
         JOIN raw_track t ON t.raw_track_id = a.raw_track_id
        WHERE ara.route_id = $1
          AND ara.assignment_state = 'TARGET_ACCEPTED'
          AND a.integrity_state = 'PASS'
          AND t.recorded_execution = true
          AND t.provenance_class IN ('RECORDED_GPS', 'RECORDED_GPS_MERGED')`,
      [routeId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getAppliedMigrationNames(): Promise<string[]> {
    const result = await this.pool.query<{ migration_name: string }>(
      `SELECT migration_name FROM schema_migration ORDER BY migration_name`
    );
    return result.rows.map(row => row.migration_name);
  }
}
