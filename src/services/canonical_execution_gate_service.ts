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

function upper(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function jsonEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * Evaluate whether a canonical Route may be exposed as executable navigation.
 *
 * Precedence is deliberately conservative:
 * 1) approved canonical geometry must exist;
 * 2) persisted static legal blocks / unresolved legal dependencies;
 * 3) explicit current HARD rules and protected-zone defaults;
 * 4) authorization requirements;
 * 5) live runtime closure / freshness for LIVE_EXECUTION;
 * 6) advisories/restrictions.
 *
 * This service is read-only. It never promotes Route, Rule, CanonicalTrack or
 * RuntimeSnapshot state. Unknown remains Unknown.
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

  const result = (overrides: Partial<CanonicalExecutionGateResult>): CanonicalExecutionGateResult => ({
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

  // Geometry is an absolute prerequisite. A route_state label by itself never
  // exposes navigation.
  if (!route.active_canonical_track_id) {
    reasonCodes.push('NO_ACTIVE_CANONICAL_TRACK');
    return result({ status: 'GEOMETRY_BLOCKED', legalState: 'UNRESOLVED' });
  }

  const canonicalTrack = await pool.query<{ canonical_track_id: string }>(
    `SELECT canonical_track_id
       FROM canonical_track
      WHERE canonical_track_id = $1 AND route_id = $2`,
    [route.active_canonical_track_id, route.route_id]
  );
  if (!canonicalTrack.rows[0]) {
    reasonCodes.push('ACTIVE_CANONICAL_TRACK_REFERENCE_MISSING');
    return result({ status: 'GEOMETRY_BLOCKED', legalState: 'UNRESOLVED' });
  }

  // A persisted route-level legal block is explicit truth, not a naming
  // heuristic. It stays blocking until evidence resolves it.
  if (route.route_state === 'RULE_BLOCKED') {
    reasonCodes.push('STATIC_ROUTE_RULE_BLOCKED');
    return result({ status: 'NO_DEFAULT_RECOMMENDATION', legalState: 'BLOCKED' });
  }

  const currentLegalField = await repo.getCurrentFieldValue('route', route.route_id, 'legal_scope_state');
  if (currentLegalField?.state === 'BLOCKED_LEGALITY') {
    reasonCodes.push('LEGAL_SCOPE_FIELD_BLOCKED');
    return result({ status: 'NO_DEFAULT_RECOMMENDATION', legalState: 'BLOCKED' });
  }

  const dependencies = await repo.listDependenciesForEntity('route', route.route_id);
  const unresolvedLegalDependency = dependencies.find(dep =>
    dep.state !== 'RESOLVED' && ['LEGAL_SCOPE', 'AUTHORIZATION'].includes(dep.dependency_class)
  );
  if (unresolvedLegalDependency) {
    reasonCodes.push(`UNRESOLVED_${unresolvedLegalDependency.dependency_class}_DEPENDENCY`);
    return result({ status: 'NO_DEFAULT_RECOMMENDATION', legalState: 'UNRESOLVED' });
  }

  const publicationDefault = await repo.getCurrentFieldValue('area', route.area_id, 'publication_default');
  const areaRequiresAuthorization =
    publicationDefault?.state === 'CANONICAL' &&
    upper(String(publicationDefault.value)) === 'NO_ROUTE_UNLESS_AUTHORIZED';

  // Rules are applicable only through explicit route/area scope, spatial scope,
  // or an intersecting LegalScope. No route-name/ID inference is permitted.
  const rules = await pool.query<RuleRow>(
    `SELECT DISTINCT r.rule_id, r.rule_type, r.severity,
            r.source_evidence_id,
            la.precedence_rank
       FROM rule r
       LEFT JOIN legal_authority la ON la.legal_authority_id = r.legal_authority_id
       LEFT JOIN legal_scope ls ON ls.legal_scope_id = r.legal_scope_id
       JOIN canonical_track ct ON ct.canonical_track_id = $2 AND ct.route_id = $1
      WHERE (r.effective_from IS NULL OR r.effective_from <= $3)
        AND (r.effective_to IS NULL OR r.effective_to >= $3)
        AND (
          (upper(r.scope_type) = 'ROUTE' AND r.scope_entity_id = $1)
          OR (upper(r.scope_type) = 'AREA' AND r.scope_entity_id = $4)
          OR (r.scope_geometry IS NOT NULL AND ST_Intersects(r.scope_geometry, ct.geometry))
          OR (ls.geometry IS NOT NULL AND ST_Intersects(ls.geometry, ct.geometry))
        )
      ORDER BY la.precedence_rank DESC NULLS LAST, r.rule_id`,
    [route.route_id, route.active_canonical_track_id, nowIso, route.area_id]
  );
  for (const rule of rules.rows) evidenceRefs.push(rule.source_evidence_id);

  const hardRule = rules.rows.find(rule => rule.severity === 'HARD');
  if (hardRule) {
    reasonCodes.push(`HARD_RULE_ACTIVE:${hardRule.rule_id}`);
    return result({ status: 'NO_RECOMMENDATION', legalState: 'BLOCKED' });
  }

  // Protected area behavior is driven by explicit intersecting zone geometry.
  const zones = await pool.query<ZoneRow>(
    `SELECT DISTINCT z.zone_id, z.access_default
       FROM protected_area_zone z
       JOIN legal_scope ls ON ls.legal_scope_id = z.legal_scope_id
       JOIN canonical_track ct ON ct.canonical_track_id = $2 AND ct.route_id = $1
      WHERE ls.area_id = $3
        AND (z.effective_from IS NULL OR z.effective_from <= $4)
        AND (z.effective_to IS NULL OR z.effective_to >= $4)
        AND ST_Intersects(z.geometry, ct.geometry)`,
    [route.route_id, route.active_canonical_track_id, route.area_id, nowIso]
  );

  const blockedZone = zones.rows.find(zone =>
    ['PROHIBITED', 'CLOSED', 'NO_ACCESS', 'STRICT_PROHIBITION'].includes(upper(zone.access_default))
  );
  if (blockedZone) {
    reasonCodes.push(`PROTECTED_ZONE_PROHIBITED:${blockedZone.zone_id}`);
    return result({ status: 'NO_RECOMMENDATION', legalState: 'BLOCKED' });
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

  const explicitDeniedAuthorization = authorizationRows.rows.find(auth =>
    ['DENIED', 'REVOKED', 'BLOCKED', 'PROHIBITED'].includes(upper(auth.state))
  );
  if (explicitDeniedAuthorization) {
    reasonCodes.push(`AUTHORIZATION_BLOCKED:${explicitDeniedAuthorization.authorization_id}`);
    return result({ status: 'NO_RECOMMENDATION', legalState: 'BLOCKED' });
  }

  const persistedPositiveAuthorization = authorizationRows.rows.some(auth =>
    ['AUTHORIZED', 'PERMITTED', 'APPROVED', 'CLEAR'].includes(upper(auth.state))
  );
  const hasPositiveAuthorization = Boolean(input.userHasPositiveAuthorization || persistedPositiveAuthorization);
  const zoneRequiresAuthorization = zones.rows.some(zone =>
    ['PERMIT_REQUIRED', 'AUTHORIZED_ONLY', 'CONTROLLED'].includes(upper(zone.access_default))
  );
  const restrictivePermitRule = rules.rows.some(rule =>
    rule.severity === 'RESTRICT' && /PERMIT|AUTHORIZATION|APPROVAL|LICENSE/i.test(rule.rule_type)
  );
  const requiresAuthorization = areaRequiresAuthorization || zoneRequiresAuthorization || restrictivePermitRule;

  if (requiresAuthorization && !hasPositiveAuthorization) {
    reasonCodes.push('POSITIVE_AUTHORIZATION_REQUIRED');
    return result({ status: 'DISCOVERY_ONLY', legalState: 'PERMIT_REQUIRED' });
  }

  const nonPermitRestriction = rules.rows.find(rule => rule.severity === 'RESTRICT' && !/PERMIT|AUTHORIZATION|APPROVAL|LICENSE/i.test(rule.rule_type));
  if (nonPermitRestriction) {
    reasonCodes.push(`ACTIVE_RESTRICTION:${nonPermitRestriction.rule_id}`);
    advisories.push('Active restrictive rule requires conditional handling before execution.');
  }
  for (const advisoryRule of rules.rows.filter(rule => rule.severity === 'ADVISORY')) {
    advisories.push(`Active advisory rule: ${advisoryRule.rule_id}`);
  }

  const legalState: CanonicalExecutionGateResult['legalState'] = nonPermitRestriction
    ? 'CONDITIONAL'
    : 'CLEAR';

  if (mode === 'STATIC_PUBLICATION') {
    return result({
      status: nonPermitRestriction ? 'CONDITIONAL' : 'ELIGIBLE',
      navigationExecutable: false,
      legalState,
      runtimeState: 'NOT_EVALUATED'
    });
  }

  // A live execution answer always requires a fresh runtime observation. Prefer
  // route-scoped snapshot, then Area-scoped fallback.
  const runtime = await pool.query<RuntimeRow>(
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
  const snapshot = runtime.rows[0];
  if (!snapshot) {
    reasonCodes.push('LIVE_RUNTIME_SNAPSHOT_MISSING');
    return result({ status: 'RUNTIME_DATA_REQUIRED', legalState, runtimeState: 'MISSING' });
  }

  evidenceRefs.push(...jsonEvidenceRefs(snapshot.evidence_refs));
  const observedAt = new Date(snapshot.observed_at);
  const validUntil = new Date(snapshot.valid_until);
  if (validUntil < now) {
    reasonCodes.push('LIVE_RUNTIME_SNAPSHOT_STALE');
    return result({
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
    return result({
      status: 'NO_RECOMMENDATION', legalState, runtimeState: 'BLOCKING',
      observedAt: observedAt.toISOString(), validUntil: validUntil.toISOString()
    });
  }
  if (['CRITICAL', 'SEVERE', 'EXTREME', 'DANGER'].includes(weather)) {
    reasonCodes.push(`RUNTIME_WEATHER_BLOCK:${weather}`);
    return result({
      status: 'NO_RECOMMENDATION', legalState, runtimeState: 'BLOCKING',
      observedAt: observedAt.toISOString(), validUntil: validUntil.toISOString()
    });
  }
  if (['CLOSED', 'BAN', 'PROHIBITED', 'CRITICAL'].includes(fire)) {
    reasonCodes.push(`RUNTIME_FIRE_BLOCK:${fire}`);
    return result({
      status: 'NO_RECOMMENDATION', legalState, runtimeState: 'BLOCKING',
      observedAt: observedAt.toISOString(), validUntil: validUntil.toISOString()
    });
  }

  const runtimeWarning = ['WARNING', 'HIGH', 'ADVISORY'].includes(weather) ||
    ['WARNING', 'RESTRICTED'].includes(closure) ||
    ['WARNING', 'RESTRICTED'].includes(fire);
  if (runtimeWarning) {
    reasonCodes.push('RUNTIME_CONDITIONAL_WARNING');
    advisories.push('Fresh runtime snapshot contains a non-blocking warning.');
  }

  const status: CanonicalExecutionGateStatus = nonPermitRestriction || runtimeWarning
    ? 'CONDITIONAL'
    : 'ELIGIBLE';

  return result({
    status,
    navigationExecutable: status === 'ELIGIBLE',
    legalState,
    runtimeState: 'FRESH',
    observedAt: observedAt.toISOString(),
    validUntil: validUntil.toISOString()
  });
}
