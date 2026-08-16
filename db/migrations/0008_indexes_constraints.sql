BEGIN;

CREATE INDEX IF NOT EXISTS idx_claim_entity_field
  ON evidence_claim(entity_type, entity_id, field_key);
CREATE INDEX IF NOT EXISTS idx_dependency_entity_field
  ON dependency(entity_type, entity_id, field_key);
CREATE INDEX IF NOT EXISTS idx_rule_scope_entity
  ON rule(scope_type, scope_entity_id);
CREATE INDEX IF NOT EXISTS idx_runtime_scope
  ON runtime_snapshot(scope_type, scope_entity_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_segment_geom
  ON route_segment USING gist(geometry);
CREATE INDEX IF NOT EXISTS idx_raw_track_geom
  ON raw_track USING gist(geometry);
CREATE INDEX IF NOT EXISTS idx_legal_scope_geom
  ON legal_scope USING gist(geometry);
CREATE INDEX IF NOT EXISTS idx_protected_zone_geom
  ON protected_area_zone USING gist(geometry);
CREATE INDEX IF NOT EXISTS idx_designated_activity_geom
  ON designated_activity_area USING gist(geometry);
CREATE INDEX IF NOT EXISTS idx_raw_track_route_assignment_route_state
  ON raw_track_route_assignment(route_id, assignment_state);
CREATE INDEX IF NOT EXISTS idx_route_geometry_attempt_route_created
  ON route_geometry_acquisition_attempt(route_id, created_at DESC);

COMMIT;
