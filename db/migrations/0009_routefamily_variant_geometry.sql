-- National Hiking MVP V0.2
-- RouteFamily / child-variant geometry provenance patch.
-- PostgreSQL/PostGIS migration skeleton; not executed against a live DB in this artifact run.

ALTER TABLE raw_track
    ADD COLUMN IF NOT EXISTS provenance_class text NOT NULL DEFAULT 'GEOMETRY_LINE_UNKNOWN',
    ADD COLUMN IF NOT EXISTS provenance_confidence numeric(4,3),
    ADD COLUMN IF NOT EXISTS recorded_execution boolean NOT NULL DEFAULT false;

ALTER TABLE raw_track
    ADD CONSTRAINT raw_track_provenance_class_chk
    CHECK (provenance_class IN (
        'RECORDED_GPS',
        'RECORDED_GPS_MERGED',
        'PLANNED_NAVIGATION_LINE',
        'GEOMETRY_LINE_UNKNOWN'
    ));

CREATE TABLE IF NOT EXISTS raw_track_route_assignment (
    raw_track_id text NOT NULL REFERENCES raw_track(raw_track_id),
    route_id text NOT NULL REFERENCES route(route_id),
    assignment_state text NOT NULL,
    geometry_gate_state text NOT NULL,
    direction_class text,
    independent_provenance_key text,
    qa jsonb NOT NULL DEFAULT '{}'::jsonb,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (raw_track_id, route_id),
    CHECK (assignment_state IN (
        'TARGET_ACCEPTED',
        'TARGET_REJECTED',
        'SIBLING_ACCEPTED',
        'CONTROL_ONLY',
        'UNCLASSIFIED'
    ))
);

CREATE INDEX IF NOT EXISTS idx_raw_track_route_assignment_route_state
    ON raw_track_route_assignment(route_id, assignment_state);

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
        'DISCOVERY_CONTROL',
        'D2_PREVERIFIED',
        'TARGET_ACCEPTED',
        'TARGET_REJECTED',
        'SIBLING_ACCEPTED',
        'CONTROL_ONLY',
        'EXTERNAL_DEPENDENCY'
    ))
);

CREATE INDEX IF NOT EXISTS idx_route_geometry_attempt_route_created
    ON route_geometry_acquisition_attempt(route_id, created_at DESC);

-- Service-level invariant (not expressible as a simple row CHECK):
-- a CanonicalTrack may be proposed only from >=2 independent TARGET_ACCEPTED
-- raw_track_route_assignment rows whose raw_track.recorded_execution=true,
-- assigned to the SAME route_id. Sibling route assignments never count.
