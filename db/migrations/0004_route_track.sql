BEGIN;

CREATE TABLE IF NOT EXISTS route_family (
  route_family_id text PRIMARY KEY,
  area_id text NOT NULL REFERENCES area(area_id),
  canonical_name text NOT NULL,
  identity_state text NOT NULL DEFAULT 'CANDIDATE',
  intent_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  official_corridor geometry(Geometry,4326),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS route (
  route_id text PRIMARY KEY,
  route_family_id text REFERENCES route_family(route_family_id),
  area_id text NOT NULL REFERENCES area(area_id),
  canonical_name text NOT NULL,
  identity_state text NOT NULL DEFAULT 'CANDIDATE',
  route_state route_state_enum NOT NULL DEFAULT 'IDENTITY_ONLY',
  route_type text,
  active_canonical_track_id text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS endpoint_cluster (
  endpoint_cluster_id text PRIMARY KEY,
  route_family_id text REFERENCES route_family(route_family_id),
  route_id text REFERENCES route(route_id),
  cluster_role text NOT NULL,
  canonical_name text NOT NULL,
  geometry geometry(Geometry,4326),
  members jsonb NOT NULL DEFAULT '[]'::jsonb,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_track (
  raw_track_id text PRIMARY KEY,
  evidence_id text REFERENCES evidence(evidence_id),
  source_track_id text,
  sha256 text NOT NULL UNIQUE,
  recorded_at timestamptz,
  geometry geometry(LineString,4326) NOT NULL,
  provenance_class text NOT NULL DEFAULT 'GEOMETRY_LINE_UNKNOWN',
  provenance_confidence numeric(4,3),
  recorded_execution boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provenance_class IN (
    'RECORDED_GPS','RECORDED_GPS_MERGED',
    'PLANNED_NAVIGATION_LINE','GEOMETRY_LINE_UNKNOWN'
  )),
  CHECK (provenance_confidence IS NULL OR (provenance_confidence >= 0 AND provenance_confidence <= 1))
);

CREATE TABLE IF NOT EXISTS raw_track_route_assignment (
  raw_track_id text NOT NULL REFERENCES raw_track(raw_track_id),
  route_id text NOT NULL REFERENCES route(route_id),
  assignment_state text NOT NULL,
  geometry_gate_state text NOT NULL,
  direction_class text,
  independent_provenance_key text,
  qa jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(raw_track_id, route_id),
  CHECK (assignment_state IN (
    'TARGET_ACCEPTED','TARGET_REJECTED','SIBLING_ACCEPTED','CONTROL_ONLY','UNCLASSIFIED'
  ))
);

CREATE TABLE IF NOT EXISTS canonical_track (
  canonical_track_id text PRIMARY KEY,
  route_id text NOT NULL REFERENCES route(route_id),
  geometry geometry(LineString,4326) NOT NULL,
  distance_m numeric NOT NULL CHECK (distance_m >= 0),
  elevation_gain_m numeric,
  qa jsonb NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(route_id, version)
);

ALTER TABLE route
  DROP CONSTRAINT IF EXISTS route_active_canonical_track_fk;
ALTER TABLE route
  ADD CONSTRAINT route_active_canonical_track_fk
  FOREIGN KEY(active_canonical_track_id) REFERENCES canonical_track(canonical_track_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS route_segment (
  route_segment_id text PRIMARY KEY,
  route_id text NOT NULL REFERENCES route(route_id),
  canonical_track_id text NOT NULL REFERENCES canonical_track(canonical_track_id),
  segment_index integer NOT NULL CHECK (segment_index >= 0),
  geometry geometry(LineString,4326) NOT NULL,
  UNIQUE(route_id, canonical_track_id, segment_index)
);

CREATE TABLE IF NOT EXISTS route_geometry_acquisition_attempt (
  attempt_id text PRIMARY KEY,
  route_id text NOT NULL REFERENCES route(route_id),
  route_family_id text REFERENCES route_family(route_family_id),
  candidate_source_class text NOT NULL,
  candidate_native_id text,
  candidate_url text,
  d2_preverified boolean NOT NULL DEFAULT false,
  materialized_raw_track_id text REFERENCES raw_track(raw_track_id),
  result_state text NOT NULL,
  sibling_route_id text REFERENCES route(route_id),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (result_state IN (
    'DISCOVERY_CONTROL','D2_PREVERIFIED','TARGET_ACCEPTED','TARGET_REJECTED',
    'SIBLING_ACCEPTED','CONTROL_ONLY','EXTERNAL_DEPENDENCY'
  ))
);

COMMIT;
