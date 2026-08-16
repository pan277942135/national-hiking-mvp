BEGIN;

CREATE TABLE IF NOT EXISTS campground (
  campground_id text PRIMARY KEY,
  area_id text NOT NULL REFERENCES area(area_id),
  activity_area_id text REFERENCES designated_activity_area(activity_area_id),
  canonical_name text NOT NULL,
  operator_name text,
  geometry geometry(Geometry,4326),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS night_entry_window (
  window_id text PRIMARY KEY,
  scope_type text NOT NULL,
  scope_entity_id text NOT NULL,
  entry_start_local time,
  entry_cutoff_local time,
  effective_from timestamptz,
  effective_to timestamptz,
  source_evidence_id text REFERENCES evidence(evidence_id)
);

CREATE TABLE IF NOT EXISTS camp_stay (
  camp_stay_id text PRIMARY KEY,
  campground_id text NOT NULL REFERENCES campground(campground_id),
  checkin_after_local time,
  checkout_before_local time,
  booking_required boolean,
  capacity jsonb,
  effective_from timestamptz,
  effective_to timestamptz,
  source_evidence_id text REFERENCES evidence(evidence_id)
);

CREATE TABLE IF NOT EXISTS overnight_plan (
  overnight_plan_id text PRIMARY KEY,
  route_id text NOT NULL REFERENCES route(route_id),
  nights jsonb NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime_snapshot (
  snapshot_id text PRIMARY KEY,
  scope_type text NOT NULL,
  scope_entity_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  closure_state text NOT NULL,
  weather_risk text,
  fire_control_state text,
  equipment_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  CHECK (valid_until >= observed_at)
);

COMMIT;
