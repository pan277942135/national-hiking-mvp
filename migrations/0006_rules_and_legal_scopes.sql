-- Migration 0006: Rules and Legal Scopes
-- National Hiking Backend MVP

CREATE TABLE IF NOT EXISTS legal_scopes (
    id VARCHAR(64) PRIMARY KEY,
    area_id VARCHAR(64) NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    scope_type VARCHAR(64) NOT NULL, -- CORE_PROTECTED_ZONE, BUFFER_ZONE, EXPERIMENTAL_ZONE, GENERAL_CONTROL_ZONE, PUBLIC_ACCESS
    positive_authorization_required BOOLEAN NOT NULL DEFAULT false,
    boundary_geojson JSONB,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rules (
    id VARCHAR(64) PRIMARY KEY,
    area_id VARCHAR(64) NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    route_id VARCHAR(64) REFERENCES routes(id) ON DELETE CASCADE,
    rule_type VARCHAR(64) NOT NULL, -- HARD_CLOSURE, PERMIT_REQUIRED, SEASONAL_BAN, FIRE_BAN, NIGHT_BAN, CAPACITY_LIMIT
    is_blocking BOOLEAN NOT NULL DEFAULT true,
    requires_positive_auth BOOLEAN NOT NULL DEFAULT false,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    effective_start TIMESTAMP WITH TIME ZONE,
    effective_end TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_legal_scopes_area ON legal_scopes(area_id);
CREATE INDEX IF NOT EXISTS idx_rules_area_route ON rules(area_id, route_id);
CREATE INDEX IF NOT EXISTS idx_rules_blocking ON rules(is_blocking);
