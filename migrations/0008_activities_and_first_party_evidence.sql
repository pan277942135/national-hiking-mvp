-- Migration 0008: Activities and First-Party Evidence Model
-- National Hiking Backend MVP

CREATE TABLE IF NOT EXISTS activities (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    route_id VARCHAR(64) NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    raw_track_id VARCHAR(64) REFERENCES raw_tracks(id) ON DELETE SET NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completion_state VARCHAR(64) NOT NULL DEFAULT 'COMPLETED', -- COMPLETED, ABORTED, PARTIAL, DEVIATED
    actual_distance_meters NUMERIC(10, 2),
    actual_elevation_gain_meters NUMERIC(8, 2),
    duration_seconds INTEGER,
    first_party_verified BOOLEAN NOT NULL DEFAULT false,
    report_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activities_route ON activities(route_id);
CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_track ON activities(raw_track_id);
