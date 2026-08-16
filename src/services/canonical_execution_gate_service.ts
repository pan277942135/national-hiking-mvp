import type { Pool } from 'pg';
import { CanonicalPostgresRepository } from '../repository/postgres/canonical_postgres.js';

export type CanonicalExecutionGateStatus =
  | 'ELIGIBLE'
  | 'CONDITIONAL'
  | 'GEOMETRY_BLOCKED'
  | 'DISCOVERY_ONLY'
  | 'RUNTIME_DATA_REQUIRED'
  | 'NO_DEFAULT_RECOMMENDATION'
  | 'NO_RECOMMENDATION';

export type CanonicalExecutionGateMode = 'LIVE_EXECUTION' | 'STATIC_PUBLICATION';

export interface CanonicalExecutionGateInput {
  routeId: string;
  mode?: CanonicalExecutionGateMode;
  evaluatedAt?: Date;
  userHasPositiveAuthorization?: boolean;
}

export interface CanonicalExecutionGateResult {
  routeId: string;
  areaId: string;
  mode: CanonicalExecutionGateMode;
  status: CanonicalExecutionGateStatus;
  navigationExecutable: boolean;
  canonicalGeometryPresent: boolean;
  legalState: 'CLEAR' | 'CONDITIONAL' | 'PERMIT_REQUIRED' | 'BLOCKED' | 'UNRESOLVED';
  runtimeState: 'NOT_EVALUATED' | 'MISSING' | 'STALE' | 'FRESH' | 'BLOCKING';
  reasonCodes: string[];
  advisories: string[];
  evidenceRefs: string[];
  observedAt: string | null;
  validUntil: string | null;
  evaluatedAt: string;
}

interface RuleRow {
  rule_id: string;
  rule_type: string;
  severity: 'HARD' | 'RESTRICT' | 'ADVISORY' | 'INFO';
  source_evidence_id: string;
  precedence_rank: number | null;
}

interface ZoneRow {
  zone_id: string;
  access_default: string;
}

interface AuthorizationRow {
  authorization_id: string;
  state: string;
  source_evidence_id: string | null;
}

interface RuntimeRow {
  snapshot_id: string;
  observed_at: string;
  valid_until: string;
  closure_state: string;
  weather_risk: string | null;
  fire_control_state: string | null;
  evidence_refs: unknown;
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function evidenceList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function mergeRules(...groups: RuleRow[][]): RuleRow[] {
  const byId = new Map<string, RuleRow>();
  for (const row of groups.flat()) byId.set(row.rule_id, row);
  return [...byId.values()].sort((a, b) =>
    (b.precedence_rank ?? -1) - (a.precedence_rank ?? -1) || a.rule_id.localeCompare(b.rule_id)
  );
}

/**
 * Canonical live execution gate.
 *
 * Precedence:
 * 1. explicit route-level legal blocks and route/area HARD rules;
 * 2. unresolved legal/authorization dependencies;
 * 3. approved CanonicalTrack existence;
 * 4. spatial rules and protected-zone intersections;
 * 5. positive authorization requirements;
 * 6. fresh runtime state for LIVE_EXECUTION;
 * 7. non-blocking restrictions/advisories.
 *
 * Legal blocks intentionally precede geometry. A known closure/prohibition must
 * not be hidden behind an unrelated missing-geometry state. The service is
 * read-only and never mutates Route, Rule, CanonicalTrack or runtime truth.
 */
export async function evaluateCanonicalExecutionGate(
  pool: Pool,
  input: CanonicalExecutionGateInput
): Promise<CanonicalExecutionGateResult> {
  const repo = new CanonicalPostgresRepository(pool);
  const route = await repo.findRoute(input.routeId);
  if (!route) throw new Error(`Route not found: ${input.routeId}`);

  const mode = input.mode ?? 'LIVE_EXECUTION';
  const now = input.evaluatedAt ?? new Date();
  const nowIso = now.toISOString();
  const reasonCodes: string[] = [];
  const advisories: string[] = [];
  const evidenceRefs: string[] = [];

  const finish = (overrides: Partial<CanonicalExecutionGateResult>): CanonicalExecutionGateResult => ({
    routeId: route.route_id,
    areaId: route.area_id,
    mode,
    status: 'NO_DEFAULT_RECOMMENDATION',
    navigationExecutable: false,
    canonicalGeometryPresent: Boolean(route.active_canonical_track_id),
    legalState: 'UNRESOLVED',
    runtimeState: mode === 'STATIC_PUBLICATION' ? 'NOT_EVALUATED' : 'MISSING',
    reasonCodes: dedupe(reasonCodes),
    advisories: dedupe(advisories),
    evidenceRefs: dedupe(evidenceRefs),
    observedAt: null,
    validUntil: null,
    evaluatedAt: nowIso,
    ...overrides
  });

  // Explicit persisted legal state has precedence over geometry availability.
  if (route.route_state === 'RULE_BLOCKED') {
    reasonCodes.push('STATIC_ROUTE_RULE_BLOCKED');
    return finish({ status: 'NO_DEFAULT_RECOMMENDATION', legalState: 'BLOCKED' });
  }

  const currentLegalField = await repo.getCurrentFieldValue('route', route.route_id, 'legal_scope_state');
  if (currentLegalField?.state === 'BLOCKED_LEGALITY') {
    reasonCodes.push('LEGAL_SCOPE_FIELD_BLOCKED');
    return finish({ status: 'NO_DEFAULT_RECOMMENDATION', legalState: 'BLOCKED' });
  }

  // Route/Area-scoped rules do not require geometry and can therefore enforce a
  // hard closure even when the map asset is missing.
  const scopedRulesResult = await pool.query<RuleRow>(
    `SELECT r.rule_id, r.rule_type, r.severity, r.source_evidence_id,
            la.precedence_rank
       FROM rule r
       LEFT JOIN legal_authority la ON la.legal_authority_id = r.legal_authority_id
      WHERE (r.effective_from IS NULL OR r.effective_from <= $3)
        AND (r.effective_to IS NULL OR r.effective_to >= $3)
        AND (
          (upper(r.scope_type) = 'ROUTE' AND r.scope_entity_id = $1)
          OR (upper(r.scope_type) = 'AREA' AND r.scope_entity_id = $2)
        )
      ORDER BY la.precedence_rank DESC NULLS LAST, r.rule_id`,
    [route.route_id, route.area_id, nowIso]
  );
  for (const rule of scopedRulesResult.rows) evidenceRefs.push(rule.source_evidence_id);
  const scopedHardRule = scopedRulesResult.rows.find(rule => rule.severity === 'HARD');
  if (scopedHardRule) {
    reasonCodes.push(`HARD_RULE_ACTIVE:${scopedHardRule.rule_id}`);
    return finish({ status: 'NO_RECOMMENDATION', legalState: 'BLOCKED' });
  }

  const dependencies = await repo.listDependenciesForEntity('route', route.route_id);
  const unresolvedLegalDependency = dependencies.find(dep =>
    dep.state !== 'RESOLVED' && ['LEGAL_SCOPE', 'AUTHORIZATION'].includes(dep.dependency_class)
  );
  if (unresolvedLegalDependency) {
    reasonCodes.push(`UNRESOLVED_${unresolvedLegalDependency.dependency_class}_DEPENDENCY`);
    return finish({ status: 'NO_DEFAULT_RECOMMENDATION', legalState: 'UNRESOLVED' });
  }

  const publicationDefault = await repo.getCurrentFieldValue('area', route.area_id, 'publication_default');
  const areaRequiresAuthorization =
    publicationDefault?.state === 'CANONICAL' &&
    upper(publicationDefault.value) === 'NO_ROUTE_UNLESS_AUTHORIZED';

  // No route can become navigable without an approved canonical geometry asset.
  if (!route.active_canonical_track_id) {
    reasonCodes.push('NO_ACTIVE_CANONICAL_TRACK');
    return finish({ status: 'GEOMETRY_BLOCKED', legalState: areaRequiresAuthorization ? 'PERMIT_REQUIRED' : 'UNRESOLVED' });
  }

  const canonicalTrack = await pool.query<{ canonical_track_id: string }>(
    `SELECT canonical_track_id
       FROM canonical_track
      WHERE canonical_track_id = $1 AND route_id = $2`,
    [route.active_canonical_track_id, route.route_id]
  );
  if (!canonicalTrack.rows[0]) {
    reasonCodes.push('ACTIVE_CANONICAL_TRACK_REFERENCE_MISSING');
    return finish({ status: 'GEOMETRY_BLOCKED', legalState: 'UNRESOLVED' });
  }

  // Add spatially applicable rules only after canonical geometry exists.
  // Geography distance=0 is used as an exact intersection predicate rather
  // than ST_Intersects because the CI PostGIS 16/3.5 image exposed an internal
  // mixed-dimensional opfamily failure for Polygon/MultiPolygon vs LineString.
  // Both persisted geometries remain canonical SRID 4326 objects; this changes
  // only predicate implementation, not the legal scope semantics.
  const spatialRulesResult = await pool.query<RuleRow>(
    `SELECT DISTINCT r.rule_id, r.rule_type, r.severity,
            r.source_evidence_id, la.precedence_rank
       FROM rule r
       LEFT JOIN legal_authority la ON la.legal_authority_id = r.legal_authority_id
       LEFT JOIN legal_scope ls ON ls.legal_scope_id = r.legal_scope_id
       JOIN canonical_track ct ON ct.canonical_track_id = $2 AND ct.route_id = $1
      WHERE (r.effective_from IS NULL OR r.effective_from <= $3)
        AND (r.effective_to IS NULL OR r.effective_to >= $3)
        AND (
          (r.scope_geometry IS NOT NULL AND ST_Distance(r.scope_geometry::geography, ct.geometry::geography) = 0)
          OR (ls.geometry IS NOT NULL AND ST_Distance(ls.geometry::geography, ct.geometry::geography) = 0)
        )
      ORDER BY la.precedence_rank DESC NULLS LAST, r.rule_id`,
    [route.route_id, route.active_canonical_track_id, nowIso]
  );
  for (const rule of spatialRulesResult.rows) evidenceRefs.push(rule.source_evidence_id);
  const rules = mergeRules(scopedRulesResult.rows, spatialRulesResult.rows);
  const spatialHardRule = spatialRulesResult.rows.find(rule => rule.severity === 'HARD');
  if (spatialHardRule) {
    reasonCodes.push(`HARD_RULE_ACTIVE:${spatialHardRule.rule_id}`);
    return finish({ status: 'NO_RECOMMENDATION', legalState: 'BLOCKED' });
  }

  const zones = await pool.query<ZoneRow>(
    `SELECT DISTINCT z.zone_id, z.access_default
       FROM protected_area_zone z
       JOIN legal_scope ls ON ls.legal_scope_id = z.legal_scope_id
       JOIN canonical_track ct ON ct.canonical_track_id = $2 AND ct.route_id = $1
      WHERE ls.area_id = $3
        AND (z.effective_from IS NULL OR z.effective_from <= $4)
        AND (z.effective_to IS NULL OR z.effective_to >= $4)
        AND ST_Distance(z.geometry::geography, ct.geometry::geography) = 0`,
    [route.route_id, route.active_canonical_track_id, route.area_id, nowIso]
  );
  const blockedZone = zones.rows.find(zone =>
    ['PROHIBITED', 'CLOSED', 'NO_ACCESS', 'STRICT_PROHIBITION'].includes(upper(zone.access_default))
  );
  if (blockedZone) {
    reasonCodes.push(`PROTECTED_ZONE_PROHIBITED:${blockedZone.zone_id}`);
    return finish({ status: 'NO_RECOMMENDATION', legalState: 'BLOCKED' });
  }

  const authorizationRows = await pool.query<AuthorizationRow>(
    `SELECT authorization_id, state, source_evidence_id
       FROM access_authorization_state
      WHERE route_id = $1
        AND (valid_from IS NULL OR valid_from <= $2)
        AND (valid_until IS NULL OR valid_until >= $2)
      ORDER BY valid_from DESC NULLS LAST, authorization_id`,
    [route.route_id, nowIso]
  );
  for (const auth of authorizationRows.rows) {
    if (auth.source_evidence_id) evidenceRefs.push(auth.source_evidence_id);
  }
  const deniedAuth = authorizationRows.rows.find(auth =>
    ['DENIED', 'REVOKED', 'BLOCKED', 'PROHIBITED'].includes(upper(auth.state))
  );
  if (deniedAuth) {
    reasonCodes.push(`AUTHORIZATION_BLOCKED:${deniedAuth.authorization_id}`);
    return finish({ status: 'NO_RECOMMENDATION', legalState: 'BLOCKED' });
  }

  const persistedPositiveAuthorization = authorizationRows.rows.some(auth =>
    ['AUTHORIZED', 'PERMITTED', 'APPROVED', 'CLEAR'].includes(upper(auth.state))
  );
  const hasPositiveAuthorization = Boolean(input.userHasPositiveAuthorization || persistedPositiveAuthorization);
  const zoneRequiresAuthorization = zones.rows.some(zone =>
    ['PERMIT_REQUIRED', 'AUTHORIZED_ONLY', 'CONTROLLED'].includes(upper(zone.access_default))
  );
  const restrictivePermitRule = rules.some(rule =>
    rule.severity === 'RESTRICT' && /PERMIT|AUTHORIZATION|APPROVAL|LICENSE/i.test(rule.rule_type)
  );
  const requiresAuthorization = areaRequiresAuthorization || zoneRequiresAuthorization || restrictivePermitRule;
  if (requiresAuthorization && !hasPositiveAuthorization) {
    reasonCodes.push('POSITIVE_AUTHORIZATION_REQUIRED');
    return finish({ status: 'DISCOVERY_ONLY', legalState: 'PERMIT_REQUIRED' });
  }

  const nonPermitRestriction = rules.find(rule =>
    rule.severity === 'RESTRICT' && !/PERMIT|AUTHORIZATION|APPROVAL|LICENSE/i.test(rule.rule_type)
  );
  if (nonPermitRestriction) {
    reasonCodes.push(`ACTIVE_RESTRICTION:${nonPermitRestriction.rule_id}`);
    advisories.push('Active restrictive rule requires conditional handling before execution.');
  }
  for (const rule of rules.filter(item => item.severity === 'ADVISORY')) {
    advisories.push(`Active advisory rule: ${rule.rule_id}`);
  }
  const legalState: CanonicalExecutionGateResult['legalState'] = nonPermitRestriction
    ? 'CONDITIONAL'
    : 'CLEAR';

  if (mode === 'STATIC_PUBLICATION') {
    return finish({
      status: nonPermitRestriction ? 'CONDITIONAL' : 'ELIGIBLE',
      navigationExecutable: false,
      legalState,
      runtimeState: 'NOT_EVALUATED'
    });
  }

  // LIVE_EXECUTION always requires a fresh route or Area snapshot. Absence of
  // data is not interpreted as OPEN.
  const runtimeResult = await pool.query<RuntimeRow>(
    `SELECT snapshot_id, observed_at::text, valid_until::text,
            closure_state, weather_risk, fire_control_state, evidence_refs
       FROM runtime_snapshot
      WHERE (
          (lower(scope_type) = 'route' AND scope_entity_id = $1)
          OR (lower(scope_type) = 'area' AND scope_entity_id = $2)
        )
        AND observed_at <= $3
      ORDER BY CASE WHEN lower(scope_type) = 'route' THEN 0 ELSE 1 END,
               observed_at DESC
      LIMIT 1`,
    [route.route_id, route.area_id, nowIso]
  );
  const snapshot = runtimeResult.rows[0];
  if (!snapshot) {
    reasonCodes.push('LIVE_RUNTIME_SNAPSHOT_MISSING');
    return finish({ status: 'RUNTIME_DATA_REQUIRED', legalState, runtimeState: 'MISSING' });
  }

  evidenceRefs.push(...evidenceList(snapshot.evidence_refs));
  const observedAt = new Date(snapshot.observed_at);
  const validUntil = new Date(snapshot.valid_until);
  if (validUntil < now) {
    reasonCodes.push('LIVE_RUNTIME_SNAPSHOT_STALE');
    return finish({
      status: 'RUNTIME_DATA_REQUIRED',
      legalState,
      runtimeState: 'STALE',
      observedAt: observedAt.toISOString(),
      validUntil: validUntil.toISOString()
    });
  }

  const closure = upper(snapshot.closure_state);
  const weather = upper(snapshot.weather_risk);
  const fire = upper(snapshot.fire_control_state);
  if (['CLOSED', 'HARD_CLOSURE', 'BLOCKED', 'PROHIBITED'].includes(closure)) {
    reasonCodes.push(`RUNTIME_CLOSURE:${closure}`);
    return finish({
      status: 'NO_RECOMMENDATION', legalState, runtimeState: 'BLOCKING',
      observedAt: observedAt.toISOString(), validUntil: validUntil.toISOString()
    });
  }
  if (['CRITICAL', 'SEVERE', 'EXTREME', 'DANGER'].includes(weather)) {
    reasonCodes.push(`RUNTIME_WEATHER_BLOCK:${weather}`);
    return finish({
      status: 'NO_RECOMMENDATION', legalState, runtimeState: 'BLOCKING',
      observedAt: observedAt.toISOString(), validUntil: validUntil.toISOString()
    });
  }
  if (['CLOSED', 'BAN', 'PROHIBITED', 'CRITICAL'].includes(fire)) {
    reasonCodes.push(`RUNTIME_FIRE_BLOCK:${fire}`);
    return finish({
      status: 'NO_RECOMMENDATION', legalState, runtimeState: 'BLOCKING',
      observedAt: observedAt.toISOString(), validUntil: validUntil.toISOString()
    });
  }

  const runtimeWarning =
    ['WARNING', 'HIGH', 'ADVISORY'].includes(weather) ||
    ['WARNING', 'RESTRICTED'].includes(closure) ||
    ['WARNING', 'RESTRICTED'].includes(fire);
  if (runtimeWarning) {
    reasonCodes.push('RUNTIME_CONDITIONAL_WARNING');
    advisories.push('Fresh runtime snapshot contains a non-blocking warning.');
  }

  const status: CanonicalExecutionGateStatus = nonPermitRestriction || runtimeWarning
    ? 'CONDITIONAL'
    : 'ELIGIBLE';
  return finish({
    status,
    navigationExecutable: status === 'ELIGIBLE',
    legalState,
    runtimeState: 'FRESH',
    observedAt: observedAt.toISOString(),
    validUntil: validUntil.toISOString()
  });
}
