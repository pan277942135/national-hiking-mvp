-- First-party Activity Evidence V0.1
-- PostgreSQL/PostGIS migration skeleton. Not executed against a live DB in this run.

CREATE TABLE IF NOT EXISTS activity (
    activity_id text PRIMARY KEY,
    actor_hash text NOT NULL,
    raw_track_id text NOT NULL REFERENCES raw_track(raw_track_id),
    source text NOT NULL DEFAULT 'FIRST_PARTY_ACTIVITY',
    recorded_at timestamptz NOT NULL,
    device_class text,
    gps_accuracy_median_m numeric,
    gps_accuracy_p90_m numeric,
    integrity_state text NOT NULL DEFAULT 'PASS',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (source = 'FIRST_PARTY_ACTIVITY'),
    CHECK (integrity_state IN ('PASS','REVIEW','REJECT')),
    CHECK (gps_accuracy_median_m IS NULL OR gps_accuracy_median_m >= 0),
    CHECK (gps_accuracy_p90_m IS NULL OR gps_accuracy_p90_m >= 0)
);

CREATE INDEX IF NOT EXISTS idx_activity_actor_time
    ON activity(actor_hash, recorded_at DESC);

CREATE TABLE IF NOT EXISTS activity_route_assignment (
    activity_id text NOT NULL REFERENCES activity(activity_id),
    route_id text NOT NULL REFERENCES route(route_id),
    assignment_state text NOT NULL,
    geometry_gate_state text NOT NULL,
    qa jsonb NOT NULL DEFAULT '{}'::jsonb,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (activity_id, route_id),
    CHECK (assignment_state IN (
        'TARGET_ACCEPTED',
        'TARGET_REJECTED',
        'SIBLING_ACCEPTED',
        'CONTROL_ONLY'
    ))
);

-- Service invariant:
-- public CanonicalTrack consensus defaults to >=2 TARGET_ACCEPTED executions
-- from >=2 distinct actor_hash values assigned to the SAME route_id.
-- Multiple days from the same actor may support repeatability but not full independence.
