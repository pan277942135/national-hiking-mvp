-- Migration 0011: Raw Source Evidence Inbox
-- RawSource is immutable acquisition material before Evidence extraction.

CREATE TABLE IF NOT EXISTS raw_sources (
    id VARCHAR(64) PRIMARY KEY,

    area_id VARCHAR(64)
        REFERENCES areas(id)
        ON DELETE SET NULL,

    source_type VARCHAR(64) NOT NULL,
    source_platform VARCHAR(64) NOT NULL,
    source_url TEXT,

    gcs_uri TEXT NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    content_type VARCHAR(128) NOT NULL,

    captured_at TIMESTAMP WITH TIME ZONE NOT NULL,

    ingestion_status VARCHAR(32) NOT NULL DEFAULT 'STORED',

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_raw_source_ingestion_status
        CHECK (
            ingestion_status IN (
                'STORED',
                'EXTRACTED',
                'REJECTED'
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_raw_sources_area
    ON raw_sources(area_id);

CREATE INDEX IF NOT EXISTS idx_raw_sources_sha256
    ON raw_sources(sha256);

CREATE INDEX IF NOT EXISTS idx_raw_sources_platform
    ON raw_sources(source_platform);

CREATE INDEX IF NOT EXISTS idx_raw_sources_captured_at
    ON raw_sources(captured_at DESC);
