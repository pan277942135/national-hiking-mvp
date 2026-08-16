/**
 * Hard Gate & Eligibility Engine for National Hiking Backend MVP.
 *
 * This memory-mode evaluator is conservative. It never infers legal scope from
 * route names/IDs and never treats one raw GPS trace as public geometry consensus.
 */

import {
  Area,
  Route,
  RawTrack,
  RawTrackRouteAssignment,
  Rule,
  LegalScope,
  RuntimeSnapshot,
  PublicationGateResult,
  GateStatus
} from './types.js';
import { countIndependentTargetRecordedExecutions } from './invariants.js';

export interface GateEvaluationContext {
  area: Area;
  route: Route;
  assignments: RawTrackRouteAssignment[];
  tracks: RawTrack[];
  rules: Rule[];
  legalScopes: LegalScope[];
  latestSnapshot?: RuntimeSnapshot;
  userHasPositiveAuth?: boolean;
  currentTime?: Date;
}

function isRuleActive(rule: Rule, now: Date): boolean {
  const start = rule.effective_start ? new Date(rule.effective_start) : null;
  const end = rule.effective_end ? new Date(rule.effective_end) : null;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

export function evaluateHardGate(context: GateEvaluationContext): PublicationGateResult {
  const now = context.currentTime ?? new Date();
  const reasons: string[] = [];
  const advisories: string[] = [];

  let gateStatus: GateStatus = 'ELIGIBLE';
  let geometryConsensusValid = false;
  let runtimeFresh = false;
  let legalClearanceStatus: 'CLEAR' | 'BLOCKED' | 'PERMIT_REQUIRED' | 'HARD_CLOSURE' = 'CLEAR';

  // ------------------------------------------------------------------
  // 1. LEGAL / RULE GATE
  // No route-name or ID substring heuristics are allowed here.
  // ------------------------------------------------------------------
  const applicableRules = context.rules.filter(rule => {
    if (rule.route_id && rule.route_id !== context.route.id) return false;
    return isRuleActive(rule, now);
  });

  const activeHardClosure = applicableRules.find(
    rule => rule.rule_type === 'HARD_CLOSURE' && rule.is_blocking
  );

  if (activeHardClosure) {
    const protectedHardBlock =
      activeHardClosure.requires_positive_auth &&
      (context.area.protection_level === 'STRICT_PROTECTION' ||
       context.area.protection_level === 'NATURE_RESERVE');

    gateStatus = protectedHardBlock ? 'BLOCK' : 'NO_RECOMMENDATION';
    legalClearanceStatus = protectedHardBlock ? 'BLOCKED' : 'HARD_CLOSURE';
    reasons.push(protectedHardBlock
      ? 'EXPLICIT_PROTECTED_AREA_HARD_RULE'
      : `HARD_CLOSURE_ACTIVE: ${activeHardClosure.title}`);
  }

  const requiresPositiveAuth =
    context.area.protection_level === 'STRICT_PROTECTION' ||
    context.area.protection_level === 'NATURE_RESERVE' ||
    context.legalScopes.some(s => s.positive_authorization_required) ||
    applicableRules.some(r => r.requires_positive_auth);

  if (
    requiresPositiveAuth &&
    !context.userHasPositiveAuth &&
    gateStatus !== 'BLOCK' &&
    gateStatus !== 'NO_RECOMMENDATION'
  ) {
    gateStatus = 'DISCOVERY_ONLY';
    legalClearanceStatus = 'PERMIT_REQUIRED';
    reasons.push('PROTECTED_AREA_REQUIRES_POSITIVE_AUTHORIZATION');
    advisories.push('Positive authorization must be verified before navigation can be enabled.');
  }

  // ------------------------------------------------------------------
  // 2. CHILD-ROUTE GEOMETRY GATE
  // Default public consensus: >=2 independent TARGET_ACCEPTED recorded
  // executions for this exact child route. Sibling assignments never count.
  // ------------------------------------------------------------------
  const independentRecordedExecutions = countIndependentTargetRecordedExecutions(
    context.route.id,
    context.assignments,
    context.tracks
  );

  if (
    context.route.geometry_state === 'ACCEPTED_CONSENSUS' &&
    independentRecordedExecutions >= 2
  ) {
    geometryConsensusValid = true;
  } else {
    if (context.route.geometry_state === 'CONTROL_ONLY') {
      reasons.push('PLANNED_LINE_CONTROL_ONLY_NOT_EXECUTABLE_GPS');
    } else if (context.route.geometry_state === 'EXTERNAL_DEPENDENCY') {
      reasons.push('EXTERNAL_DEPENDENCY_GEOMETRY_PENDING');
    } else if (context.route.geometry_state === 'GEOMETRY_BLOCKED') {
      reasons.push('GEOMETRY_BLOCKED_NO_ACCEPTED_RECORDED_EVIDENCE');
    } else if (context.route.geometry_state === 'ACCEPTED_CONSENSUS') {
      reasons.push(`INSUFFICIENT_INDEPENDENT_RECORDED_EXECUTIONS:${independentRecordedExecutions}/2`);
    } else {
      reasons.push('MISSING_CANONICAL_GEOMETRY');
    }

    // Preserve a stronger legal state (BLOCK / NO_RECOMMENDATION /
    // DISCOVERY_ONLY). Geometry is still recorded as a reason.
    if (gateStatus === 'ELIGIBLE') {
      gateStatus = 'GEOMETRY_BLOCKED';
    }
  }

  // ------------------------------------------------------------------
  // 3. RUNTIME GATE
  // Runtime freshness can block an otherwise eligible action, but it must not
  // erase a stronger legal/geometry decision already reached above.
  // ------------------------------------------------------------------
  const snapshot = context.latestSnapshot;
  if (!snapshot) {
    runtimeFresh = false;
    if (context.area.area_type === 'ALPINE_CROSS_JURISDICTION' && gateStatus === 'ELIGIBLE') {
      gateStatus = 'RUNTIME_DATA_REQUIRED';
      reasons.push('MANDATORY_ALPINE_RUNTIME_SNAPSHOT_MISSING');
    } else {
      advisories.push('No recent runtime field snapshot available; conditions remain unconfirmed.');
    }
  } else {
    const validUntil = new Date(snapshot.valid_until);
    if (validUntil < now) {
      runtimeFresh = false;
      const criticalStaleness =
        context.area.area_type === 'ALPINE_CROSS_JURISDICTION' ||
        snapshot.hazard_level === 'WARNING' ||
        snapshot.hazard_level === 'CRITICAL_HAZARD';

      if (criticalStaleness && gateStatus === 'ELIGIBLE') {
        gateStatus = 'RUNTIME_DATA_REQUIRED';
        reasons.push(`RUNTIME_DATA_STALE: Valid until ${snapshot.valid_until}, current time ${now.toISOString()}`);
      } else {
        advisories.push(`Runtime report is stale (observed at ${snapshot.observed_at}).`);
      }
    } else {
      runtimeFresh = true;
      if (snapshot.hazard_level === 'CLOSED' || snapshot.hazard_level === 'CRITICAL_HAZARD') {
        gateStatus = 'NO_RECOMMENDATION';
        reasons.push(`CRITICAL_RUNTIME_HAZARD: ${snapshot.trail_status}`);
      } else if (snapshot.hazard_level === 'WARNING') {
        advisories.push(`Active Hazard Warning: ${snapshot.weather_summary || snapshot.trail_status}`);
      }
    }
  }

  const navigationExecutable =
    gateStatus === 'ELIGIBLE' &&
    geometryConsensusValid &&
    legalClearanceStatus === 'CLEAR';

  return {
    id: `gate_${context.route.id}_${now.getTime()}`,
    route_id: context.route.id,
    gate_status: gateStatus,
    navigation_executable: navigationExecutable,
    geometry_consensus_valid: geometryConsensusValid,
    runtime_fresh: runtimeFresh,
    legal_clearance_status: legalClearanceStatus,
    reasons,
    advisories,
    calculated_at: now.toISOString()
  };
}
