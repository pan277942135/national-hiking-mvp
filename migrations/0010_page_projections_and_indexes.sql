-- Migration 0010: Page Projections and Final Verification Indexes
-- National Hiking Backend MVP

CREATE TABLE IF NOT EXISTS page_projections (
    route_id VARCHAR(64) PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
    area_id VARCHAR(64) NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    family_id VARCHAR(64) NOT NULL REFERENCES route_families(id) ON DELETE CASCADE,
    canonical_name VARCHAR(255) NOT NULL,
    family_name VARCHAR(255) NOT NULL,
    area_name VARCHAR(255) NOT NULL,
    variant_code VARCHAR(64) NOT NULL,
    identity_state VARCHAR(64) NOT NULL,
    geometry_state VARCHAR(64) NOT NULL,
    gate_status VARCHAR(64) NOT NULL,
    navigation_allowed BOOLEAN NOT NULL DEFAULT false,
    distance_meters NUMERIC(10, 2),
    elevation_gain_meters NUMERIC(8, 2),
    estimated_duration_minutes INTEGER,
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    advisories JSONB NOT NULL DEFAULT '[]'::jsonb,
    runtime_freshness_status VARCHAR(64) NOT NULL DEFAULT 'UNKNOWN',
    latest_snapshot JSONB,
    read_only_hash VARCHAR(64) NOT NULL,
    projected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_page_projections_area ON page_projections(area_id);
CREATE INDEX IF NOT EXISTS idx_page_projections_gate_status ON page_projections(gate_status);
CREATE INDEX IF NOT EXISTS idx_page_projections_nav ON page_projections(navigation_allowed);
