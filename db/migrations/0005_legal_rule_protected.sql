BEGIN;

CREATE TABLE IF NOT EXISTS legal_authority (
  legal_authority_id text PRIMARY KEY,
  authority_level text NOT NULL,
  jurisdiction_code text,
  title text NOT NULL,
  effective_from timestamptz,
  effective_to timestamptz,
  source_evidence_id text REFERENCES evidence(evidence_id),
  precedence_rank integer
);

CREATE TABLE IF NOT EXISTS legal_scope (
  legal_scope_id text PRIMARY KEY,
  area_id text REFERENCES area(area_id),
  jurisdiction_code text NOT NULL,
  legal_basis text,
  geometry geometry(MultiPolygon,4326),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS protected_area_zone (
  zone_id text PRIMARY KEY,
  legal_scope_id text NOT NULL REFERENCES legal_scope(legal_scope_id),
  zone_type text NOT NULL,
  access_default text NOT NULL,
  geometry geometry(MultiPolygon,4326) NOT NULL,
  effective_from timestamptz,
  effective_to timestamptz
);

CREATE TABLE IF NOT EXISTS designated_activity_area (
  activity_area_id text PRIMARY KEY,
  legal_scope_id text NOT NULL REFERENCES legal_scope(legal_scope_id),
  activity_type text NOT NULL,
  geometry geometry(MultiPolygon,4326) NOT NULL,
  effective_from timestamptz,
  effective_to timestamptz
);

CREATE TABLE IF NOT EXISTS rule (
  rule_id text PRIMARY KEY,
  legal_scope_id text REFERENCES legal_scope(legal_scope_id),
  legal_authority_id text REFERENCES legal_authority(legal_authority_id),
  rule_type text NOT NULL,
  severity rule_severity_enum NOT NULL,
  scope_type text NOT NULL,
  scope_entity_id text,
  scope_geometry geometry(Geometry,4326),
  effective_from timestamptz,
  effective_to timestamptz,
  source_evidence_id text NOT NULL REFERENCES evidence(evidence_id)
);

CREATE TABLE IF NOT EXISTS work_zone (
  work_zone_id text PRIMARY KEY,
  legal_scope_id text REFERENCES legal_scope(legal_scope_id),
  state text NOT NULL,
  geometry geometry(Geometry,4326),
  effective_from timestamptz,
  effective_to timestamptz,
  source_evidence_id text REFERENCES evidence(evidence_id)
);

CREATE TABLE IF NOT EXISTS access_authorization_state (
  authorization_id text PRIMARY KEY,
  route_id text REFERENCES route(route_id),
  zone_id text REFERENCES protected_area_zone(zone_id),
  state text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_evidence_id text REFERENCES evidence(evidence_id),
  valid_from timestamptz,
  valid_until timestamptz
);

COMMIT;
