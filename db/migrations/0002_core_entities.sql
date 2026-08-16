BEGIN;

CREATE TABLE IF NOT EXISTS area (
  area_id text PRIMARY KEY,
  area_type area_type_enum NOT NULL,
  canonical_name text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  geometry geometry(MultiPolygon,4326),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS area_relation (
  area_relation_id text PRIMARY KEY,
  parent_area_id text NOT NULL REFERENCES area(area_id),
  child_area_id text REFERENCES area(area_id),
  managed_component_id text,
  relation_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (child_area_id IS NOT NULL OR managed_component_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS managed_component (
  managed_component_id text PRIMARY KEY,
  area_id text REFERENCES area(area_id),
  canonical_name text NOT NULL,
  manager_name text,
  scope_mode text NOT NULL,
  geometry geometry(Geometry,4326),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE area_relation
  DROP CONSTRAINT IF EXISTS area_relation_managed_component_fk;
ALTER TABLE area_relation
  ADD CONSTRAINT area_relation_managed_component_fk
  FOREIGN KEY (managed_component_id) REFERENCES managed_component(managed_component_id);

CREATE TABLE IF NOT EXISTS poi (
  poi_id text PRIMARY KEY,
  area_id text REFERENCES area(area_id),
  managed_component_id text REFERENCES managed_component(managed_component_id),
  canonical_name text NOT NULL,
  poi_type text NOT NULL,
  roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  geometry_type text NOT NULL,
  geometry geometry(Geometry,4326),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_point (
  access_point_id text PRIMARY KEY,
  area_id text REFERENCES area(area_id),
  poi_id text REFERENCES poi(poi_id),
  canonical_name text NOT NULL,
  role text NOT NULL,
  coordinate_confidence numeric(4,3),
  geometry geometry(Point,4326),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coordinate_confidence IS NULL OR (coordinate_confidence >= 0 AND coordinate_confidence <= 1))
);

CREATE TABLE IF NOT EXISTS transfer_edge (
  transfer_edge_id text PRIMARY KEY,
  from_access_point_id text NOT NULL REFERENCES access_point(access_point_id),
  to_access_point_id text NOT NULL REFERENCES access_point(access_point_id),
  mode text NOT NULL,
  distance_m numeric,
  duration_min numeric,
  state text NOT NULL DEFAULT 'SUPPORTED',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (distance_m IS NULL OR distance_m >= 0),
  CHECK (duration_min IS NULL OR duration_min >= 0)
);

CREATE TABLE IF NOT EXISTS parking (
  parking_id text PRIMARY KEY,
  area_id text REFERENCES area(area_id),
  access_point_id text REFERENCES access_point(access_point_id),
  canonical_name text NOT NULL,
  capacity_cars integer,
  capacity_buses integer,
  tariff_actual jsonb,
  tariff_ceiling jsonb,
  tariff_state text,
  geometry geometry(Geometry,4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (capacity_cars IS NULL OR capacity_cars >= 0),
  CHECK (capacity_buses IS NULL OR capacity_buses >= 0)
);

COMMIT;
