-- Migration 0009: Publication and Hard Gate Eligibility Results
-- National Hiking Backend MVP

CREATE TABLE IF NOT EXISTS publication_gate_results (
    id VARCHAR(64) PRIMARY KEY,
    route_id VARCHAR(64) NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    gate_status VARCHAR(64) NOT NULL, -- ELIGIBLE, GEOMETRY_BLOCKED, RUNTIME_DATA_REQUIRED, DISCOVERY_ONLY, BLOCK, NO_RECOMMENDATION
    navigation_executable BOOLEAN NOT NULL DEFAULT false,
    geometry_consensus_valid BOOLEAN NOT NULL DEFAULT false,
    runtime_fresh BOOLEAN NOT NULL DEFAULT false,
    legal_clearance_status VARCHAR(64) NOT NULL DEFAULT 'CLEAR', -- CLEAR, BLOCKED, PERMIT_REQUIRED, HARD_CLOSURE
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    advisories JSONB NOT NULL DEFAULT '[]'::jsonb,
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gate_results_route ON publication_gate_results(route_id);
CREATE INDEX IF NOT EXISTS idx_gate_results_status ON publication_gate_results(gate_status);
