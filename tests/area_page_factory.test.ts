import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveRoutePublicationState,
  projectField
} from '../src/services/area_page_projection_service.js';

test('Area Page Factory: missing fact remains UNKNOWN rather than fabricated', () => {
  const field = projectField('night_access_policy');
  assert.equal(field.state, 'UNKNOWN');
  assert.equal(field.value, null);
  assert.equal(field.evidence_id, null);
});

test('Area Page Factory: evidence state is read from structured FieldValue payload', () => {
  const field = projectField('current_operational_status', {
    field_value: { state: 'SUPPORTED', status: 'LATEST_KNOWN_OPEN' },
    evidence_id: 'ev_status_1',
    effective_from: '2026-08-18T00:00:00Z'
  });
  assert.equal(field.state, 'SUPPORTED');
  assert.equal((field.value as any).status, 'LATEST_KNOWN_OPEN');
  assert.equal(field.evidence_id, 'ev_status_1');
});

test('Area Page Factory: canonical identity without geometry remains GEOMETRY_BLOCKED', () => {
  const result = deriveRoutePublicationState({
    identityState: 'CANONICAL',
    geometryState: 'GEOMETRY_BLOCKED',
    ruleGate: projectField('current_rule_state')
  });
  assert.equal(result.publication_state, 'GEOMETRY_BLOCKED');
  assert.equal(result.navigation_allowed, false);
});

test('Area Page Factory: accepted geometry without explicit rule CLEAR remains non-navigable', () => {
  const result = deriveRoutePublicationState({
    identityState: 'CANONICAL',
    geometryState: 'ACCEPTED_CONSENSUS',
    ruleGate: projectField('current_rule_state')
  });
  assert.equal(result.publication_state, 'RULE_CHECK_REQUIRED');
  assert.equal(result.navigation_allowed, false);
});

test('Area Page Factory: navigation requires identity + geometry + evidence-backed CLEAR rule gate', () => {
  const result = deriveRoutePublicationState({
    identityState: 'CANONICAL',
    geometryState: 'ACCEPTED_CONSENSUS',
    ruleGate: projectField('current_rule_state', {
      field_value: { state: 'CANONICAL', gate: 'CLEAR' },
      evidence_id: 'ev_rule_clear',
      effective_from: '2026-08-18T00:00:00Z'
    })
  });
  assert.equal(result.publication_state, 'NAVIGATION_READY');
  assert.equal(result.navigation_allowed, true);
});

test('Area Page Factory: non-canonical route identity remains discovery only', () => {
  const result = deriveRoutePublicationState({
    identityState: 'PROPOSED',
    geometryState: 'ACCEPTED_CONSENSUS',
    ruleGate: projectField('current_rule_state', {
      field_value: { state: 'CANONICAL', gate: 'CLEAR' },
      evidence_id: 'ev_rule_clear'
    })
  });
  assert.equal(result.publication_state, 'DISCOVERY_ONLY');
  assert.equal(result.navigation_allowed, false);
});
