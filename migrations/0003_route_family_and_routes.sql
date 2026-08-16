-- Migration 0003: Route Families and Child Route Variants
-- National Hiking Backend MVP

CREATE TABLE IF NOT EXISTS route_families (
    id VARCHAR(64) PRIMARY KEY,
    area_id VARCHAR(64) NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    canonical_code VARCHAR(64) NOT NULL UNIQUE, -- e.g. ZJ-S12-RF
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS routes (
    id VARCHAR(64) PRIMARY KEY,
    family_id VARCHAR(64) NOT NULL REFERENCES route_families(id) ON DELETE CASCADE,
    variant_code VARCHAR(64) NOT NULL, -- e.g. ZJ-S12-A
    name VARCHAR(255) NOT NULL,
    identity_state VARCHAR(64) NOT NULL DEFAULT 'PROPOSED', -- DRAFT, PROPOSED, CANONICAL, DEPRECATED
    geometry_state VARCHAR(64) NOT NULL DEFAULT 'NO_GEOMETRY', -- NO_GEOMETRY, EXTERNAL_DEPENDENCY, GEOMETRY_BLOCKED, CONTROL_ONLY, ACCEPTED_CONSENSUS
    start_point_name VARCHAR(255),
    end_point_name VARCHAR(255),
    distance_meters NUMERIC(10, 2),
    elevation_gain_meters NUMERIC(8, 2),
    estimated_duration_minutes INTEGER,
    geometry_geojson JSONB,
    consensus_track_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_family_variant UNIQUE(family_id, variant_code)
);

CREATE INDEX IF NOT EXISTS idx_routes_family_id ON routes(family_id);
CREATE INDEX IF NOT EXISTS idx_routes_variant_code ON routes(variant_code);
CREATE INDEX IF NOT EXISTS idx_routes_identity_state ON routes(identity_state);
CREATE INDEX IF NOT EXISTS idx_routes_geometry_state ON routes(geometry_state);
