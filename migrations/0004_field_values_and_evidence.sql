-- Migration 0004: Field Values and Evidence Lineage
-- National Hiking Backend MVP

CREATE TABLE IF NOT EXISTS evidences (
    id VARCHAR(64) PRIMARY KEY,
    entity_type VARCHAR(64) NOT NULL, -- e.g. ROUTE, ROUTE_FAMILY, AREA, RULE
    entity_id VARCHAR(64) NOT NULL,
    source_type VARCHAR(64) NOT NULL, -- e.g. FIRST_PARTY_GPS, OFFICIAL_DOCUMENT, SATELLITE_IMAGERY, RANGER_LOG, COMMUNITY_SUBMISSION
    source_uri TEXT,
    collector_id VARCHAR(128),
    recorded_at TIMESTAMP WITH TIME ZONE,
    confidence NUMERIC(4, 3) DEFAULT 1.000,
    lineage_parent_id VARCHAR(64) REFERENCES evidences(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS field_values (
    id VARCHAR(64) PRIMARY KEY,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    field_name VARCHAR(128) NOT NULL,
    field_value JSONB NOT NULL,
    evidence_id VARCHAR(64) REFERENCES evidences(id) ON DELETE SET NULL,
    is_current BOOLEAN NOT NULL DEFAULT true,
    effective_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    superseded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Core Invariant: At most one current FieldValue per (entity_type, entity_id, field_name)
CREATE UNIQUE INDEX IF NOT EXISTS uq_current_field_value 
ON field_values (entity_type, entity_id, field_name) 
WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_field_values_lookup 
ON field_values (entity_type, entity_id, field_name);

CREATE INDEX IF NOT EXISTS idx_evidences_entity 
ON evidences (entity_type, entity_id);
