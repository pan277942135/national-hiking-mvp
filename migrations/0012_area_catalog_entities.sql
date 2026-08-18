-- Migration 0012: Area Catalog Entities
-- Stable catalog identity/location lives here. Dynamic facts such as current fees,
-- opening hours and temporary access rules remain in FieldValue + Evidence.

CREATE TABLE IF NOT EXISTS access_points (
    id VARCHAR(64) PRIMARY KEY,
    area_id VARCHAR(64) NOT NULL
        REFERENCES areas(id)
        ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    access_type VARCHAR(64) NOT NULL,
    catalog_state VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_public BOOLEAN,
    aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_access_point_catalog_state CHECK (
        catalog_state IN ('DRAFT','SUPPORTED','CANONICAL','DEPRECATED')
    ),
    CONSTRAINT chk_access_point_latitude CHECK (
        latitude IS NULL OR (latitude >= -90 AND latitude <= 90)
    ),
    CONSTRAINT chk_access_point_longitude CHECK (
        longitude IS NULL OR (longitude >= -180 AND longitude <= 180)
    ),
    CONSTRAINT chk_access_point_coordinate_pair CHECK (
        (latitude IS NULL AND longitude IS NULL) OR
        (latitude IS NOT NULL AND longitude IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_point_area_name_active
    ON access_points(area_id, lower(name))
    WHERE catalog_state <> 'DEPRECATED';

CREATE INDEX IF NOT EXISTS idx_access_points_area
    ON access_points(area_id, catalog_state);

CREATE TABLE IF NOT EXISTS pois (
    id VARCHAR(64) PRIMARY KEY,
    area_id VARCHAR(64) NOT NULL
        REFERENCES areas(id)
        ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    poi_type VARCHAR(64) NOT NULL,
    catalog_state VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    altitude_m DOUBLE PRECISION,
    aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_poi_catalog_state CHECK (
        catalog_state IN ('DRAFT','SUPPORTED','CANONICAL','DEPRECATED')
    ),
    CONSTRAINT chk_poi_latitude CHECK (
        latitude IS NULL OR (latitude >= -90 AND latitude <= 90)
    ),
    CONSTRAINT chk_poi_longitude CHECK (
        longitude IS NULL OR (longitude >= -180 AND longitude <= 180)
    ),
    CONSTRAINT chk_poi_coordinate_pair CHECK (
        (latitude IS NULL AND longitude IS NULL) OR
        (latitude IS NOT NULL AND longitude IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_poi_area_name_active
    ON pois(area_id, lower(name))
    WHERE catalog_state <> 'DEPRECATED';

CREATE INDEX IF NOT EXISTS idx_pois_area
    ON pois(area_id, catalog_state, poi_type);

CREATE TABLE IF NOT EXISTS parking (
    id VARCHAR(64) PRIMARY KEY,
    area_id VARCHAR(64) NOT NULL
        REFERENCES areas(id)
        ON DELETE CASCADE,
    related_access_point_id VARCHAR(64)
        REFERENCES access_points(id)
        ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    catalog_state VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    capacity INTEGER,
    aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_parking_catalog_state CHECK (
        catalog_state IN ('DRAFT','SUPPORTED','CANONICAL','DEPRECATED')
    ),
    CONSTRAINT chk_parking_capacity CHECK (
        capacity IS NULL OR capacity >= 0
    ),
    CONSTRAINT chk_parking_latitude CHECK (
        latitude IS NULL OR (latitude >= -90 AND latitude <= 90)
    ),
    CONSTRAINT chk_parking_longitude CHECK (
        longitude IS NULL OR (longitude >= -180 AND longitude <= 180)
    ),
    CONSTRAINT chk_parking_coordinate_pair CHECK (
        (latitude IS NULL AND longitude IS NULL) OR
        (latitude IS NOT NULL AND longitude IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_area_name_active
    ON parking(area_id, lower(name))
    WHERE catalog_state <> 'DEPRECATED';

CREATE INDEX IF NOT EXISTS idx_parking_area
    ON parking(area_id, catalog_state);

CREATE INDEX IF NOT EXISTS idx_parking_access_point
    ON parking(related_access_point_id);
