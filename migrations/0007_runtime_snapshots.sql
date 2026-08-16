-- Migration 0007: Runtime Snapshots and Freshness Gating
-- National Hiking Backend MVP

CREATE TABLE IF NOT EXISTS runtime_snapshots (
    id VARCHAR(64) PRIMARY KEY,
    area_id VARCHAR(64) NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    route_id VARCHAR(64) REFERENCES routes(id) ON DELETE CASCADE,
    observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    hazard_level VARCHAR(64) NOT NULL DEFAULT 'NORMAL', -- NORMAL, ADVISORY, WARNING, CRITICAL_HAZARD, CLOSED
    trail_status VARCHAR(64) NOT NULL DEFAULT 'OPEN', -- OPEN, CAUTION, MUDDY_FLOODED, ICE_SNOW, TEMPORARILY_BLOCKED, CLOSED
    weather_summary VARCHAR(255),
    temperature_celsius NUMERIC(4, 1),
    wind_speed_kmh NUMERIC(5, 1),
    visibility_meters INTEGER,
    snapshot_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_name VARCHAR(128) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_runtime_validity CHECK (valid_until >= observed_at)
);

CREATE INDEX IF NOT EXISTS idx_runtime_area_route ON runtime_snapshots(area_id, route_id);
CREATE INDEX IF NOT EXISTS idx_runtime_valid_until ON runtime_snapshots(valid_until);
CREATE INDEX IF NOT EXISTS idx_runtime_observed_at ON runtime_snapshots(observed_at);
