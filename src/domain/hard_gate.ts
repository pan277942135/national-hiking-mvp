/**
 * Hard Gate & Eligibility Engine for National Hiking Backend MVP
 * Implements strict domain invariant checks and publication rules.
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

export function evaluateHardGate(context: GateEvaluationContext): PublicationGateResult {
  const now = context.currentTime ?? new Date();
  const reasons: string[] = [];
  const advisories: string[] = [];

  let gateStatus: GateStatus = 'ELIGIBLE';
  let navigationExecutable = false;
  let geometryConsensusValid = false;
  let runtimeFresh = false;
  let legalClearanceStatus: 'CLEAR' | 'BLOCKED' | 'PERMIT_REQUIRED' | 'HARD_CLOSURE' = 'CLEAR';

  // -------------------------------------------------------------
  // 1. LEGAL & PROTECTED AREA CHECKS (Invariants 8, 11, 12)
  // -------------------------------------------------------------
  
  const applicableRules = context.rules.filter(rule => {
    if (rule.route_id && rule.route_id !== context.route.id) return false;
    return true;
  });

  // Check for Core Protected Zone (strictly non-accessible)
  const inCoreZone =
    context.route.variant_code.toUpperCase().includes('CORE') ||
    context.route.name.includes('核心') ||
    context.legalScopes.some(
      scope => scope.scope_type === 'CORE_PROTECTED_ZONE' && context.route.id.includes('core')
    );

  if (inCoreZone) {
    gateStatus = 'BLOCK';
    legalClearanceStatus = 'BLOCKED';
    reasons.push('CORE_PROTECTED_ZONE_STRICT_PROHIBITION');
  }

  // Check for Active Hard Closures
  const activeHardClosure = applicableRules.find(rule => {
    if (rule.rule_type !== 'HARD_CLOSURE' || !rule.is_blocking) return false;
    const start = rule.effective_start ? new Date(rule.effective_start) : null;
    const end = rule.effective_end ? new Date(rule.effective_end) : null;
    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  });

  if (activeHardClosure && gateStatus !== 'BLOCK') {
    gateStatus = 'NO_RECOMMENDATION';
    legalClearanceStatus = 'HARD_CLOSURE';
    reasons.push(`HARD_CLOSURE_ACTIVE: ${activeHardClosure.title}`);
  }

  // Check for Positive Authorization in Protected Areas (Invariant 12)
  const requiresPositiveAuth =
    context.area.protection_level === 'STRICT_PROTECTION' ||
    context.area.protection_level === 'NATURE_RESERVE' ||
    context.legalScopes.some(s => s.positive_authorization_required) ||
    applicableRules.some(r => r.requires_positive_auth);

  if (requiresPositiveAuth && !context.userHasPositiveAuth && gateStatus !== 'BLOCK' && gateStatus !== 'NO_RECOMMENDATION') {
    gateStatus = 'DISCOVERY_ONLY';
    legalClearanceStatus = 'PERMIT_REQUIRED';
    reasons.push('PROTECTED_AREA_REQUIRES_POSITIVE_AUTHORIZATION');
    advisories.push('Requires verified entry permit or ranger permit before navigation.');
  }

  // -------------------------------------------------------------
  // 2. GEOMETRY CONSENSUS CHECKS (Invariants 1, 2, 4, 5, 6, 7)
  // -------------------------------------------------------------
  
  // Child-route specific: Only tracks assigned specifically to this route
  const childAssignments = context.assignments.filter(a => a.route_id === context.route.id);
  const acceptedAssignments = childAssignments.filter(a => a.match_status === 'ACCEPTED');

  // Verify provenance of accepted tracks (Invariant 7: canonical nav geometry requires accepted recorded GPS)
  const acceptedGpsTracks = acceptedAssignments
    .map(a => context.tracks.find(t => t.id === a.track_id))
    .filter((t): t is RawTrack => !!t && t.provenance_type === 'RECORDED_GPS');

  if (context.route.geometry_state === 'ACCEPTED_CONSENSUS' && acceptedGpsTracks.length > 0) {
    geometryConsensusValid = true;
  } else {
    geometryConsensusValid = false;
    if (context.route.geometry_state === 'CONTROL_ONLY') {
      reasons.push('PLANNED_LINE_CONTROL_ONLY_NOT_EXECUTABLE_GPS');
    } else if (context.route.geometry_state === 'EXTERNAL_DEPENDENCY') {
      reasons.push('EXTERNAL_DEPENDENCY_GEOMETRY_PENDING');
    } else if (context.route.geometry_state === 'GEOMETRY_BLOCKED') {
      reasons.push('GEOMETRY_BLOCKED_NO_ACCEPTED_RECORDED_EVIDENCE');
    } else {
      reasons.push('MISSING_CANONICAL_GEOMETRY');
    }
  }

  // If geometry is not valid, navigation CANNOT be executed (Invariant 4)
  if (!geometryConsensusValid) {
    if (gateStatus === 'ELIGIBLE' || gateStatus === 'DISCOVERY_ONLY') {
      gateStatus = 'GEOMETRY_BLOCKED';
    }
  }

  // -------------------------------------------------------------
  // 3. RUNTIME SNAPSHOT & FRESHNESS CHECKS (Invariants 9, 10, 14)
  // -------------------------------------------------------------
  
  const snapshot = context.latestSnapshot;
  if (!snapshot) {
    // Unknown must remain Unknown (Invariant 11)
    runtimeFresh = false;
    if (context.area.area_type === 'ALPINE_CROSS_JURISDICTION') {
      // Alpine cross-jurisdiction routes require mandatory runtime snapshot
      if (gateStatus === 'ELIGIBLE') {
        gateStatus = 'RUNTIME_DATA_REQUIRED';
        reasons.push('MANDATORY_ALPINE_RUNTIME_SNAPSHOT_MISSING');
      }
    } else {
      advisories.push('No recent runtime field snapshot available; conditions unconfirmed.');
    }
  } else {
    const validUntil = new Date(snapshot.valid_until);
    const observedAt = new Date(snapshot.observed_at);

    if (validUntil < now) {
      runtimeFresh = false;
      // Stale critical runtime data (Invariant 10)
      if (context.area.area_type === 'ALPINE_CROSS_JURISDICTION' || snapshot.hazard_level === 'WARNING' || snapshot.hazard_level === 'CRITICAL_HAZARD') {
        if (gateStatus === 'ELIGIBLE') {
          gateStatus = 'RUNTIME_DATA_REQUIRED';
          reasons.push(`RUNTIME_DATA_STALE: Valid until ${snapshot.valid_until}, current time ${now.toISOString()}`);
        }
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

  // -------------------------------------------------------------
  // 4. NAVIGATION EXECUTABLE DECISION
  // -------------------------------------------------------------
  
  navigationExecutable =
    gateStatus === 'ELIGIBLE' &&
    geometryConsensusValid &&
    (legalClearanceStatus === 'CLEAR' || legalClearanceStatus === 'PERMIT_REQUIRED' && !!context.userHasPositiveAuth);

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
