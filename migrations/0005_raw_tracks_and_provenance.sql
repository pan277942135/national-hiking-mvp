-- Migration 0005: Raw Tracks and Provenance Gating
-- National Hiking Backend MVP

CREATE TABLE IF NOT EXISTS raw_tracks (
    id VARCHAR(64) PRIMARY KEY,
    sha256 VARCHAR(64) NOT NULL UNIQUE,
    file_name VARCHAR(255),
    format VARCHAR(32) NOT NULL, -- GPX, KML, GEOJSON, FIT
    provenance_type VARCHAR(64) NOT NULL, -- RECORDED_GPS, RECORDED_GPS_MERGED, PLANNED_NAVIGATION_LINE, GEOMETRY_LINE_UNKNOWN
    recorded_at TIMESTAMP WITH TIME ZONE,
    point_count INTEGER NOT NULL DEFAULT 0,
    total_distance_meters NUMERIC(10, 2),
    total_elevation_gain_meters NUMERIC(8, 2),
    duration_seconds INTEGER,
    raw_payload TEXT NOT NULL,
    geometry_geojson JSONB,
    device_info JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raw_track_route_assignments (
    id VARCHAR(64) PRIMARY KEY,
    track_id VARCHAR(64) NOT NULL REFERENCES raw_tracks(id) ON DELETE CASCADE,
    route_id VARCHAR(64) NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    match_status VARCHAR(64) NOT NULL DEFAULT 'CANDIDATE', -- ACCEPTED, REJECTED, CANDIDATE
    rejection_reason VARCHAR(255), -- e.g. DEVIATION_FROM_CHILD_ALIGNMENT, NOISY_DRIFT, INCOMPLETE_COVERAGE, SIBLING_VARIANT_CROSSOVER, PLANNED_LINE_NOT_GPS
    deviation_meters NUMERIC(8, 2),
    confidence_score NUMERIC(4, 3),
    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    evaluator_notes TEXT,
    CONSTRAINT uq_track_route_assignment UNIQUE (track_id, route_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_tracks_sha256 ON raw_tracks(sha256);
CREATE INDEX IF NOT EXISTS idx_raw_tracks_provenance ON raw_tracks(provenance_type);
CREATE INDEX IF NOT EXISTS idx_assignments_route_status ON raw_track_route_assignments(route_id, match_status);
