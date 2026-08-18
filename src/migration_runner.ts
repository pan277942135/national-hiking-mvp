/**
 * Migration Runner for National Hiking Backend MVP
 * Validates, checks, and applies migrations 0001 through 0012.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { getDatabaseConfig, getPgPool } from './config/database.js';

export interface MigrationFile {
  version: string;
  name: string;
  filePath: string;
  sql: string;
  checksum: string;
}

export interface MigrationValidationResult {
  valid: boolean;
  migrationsFound: MigrationFile[];
  errors: string[];
  invariantsVerified: {
    orderedSequentially: boolean;
    foreignKeysDeclared: boolean;
    oneCurrentFieldValueInvariant: boolean;
    postgisConfigured: boolean;
    provenanceModelsPresent: boolean;
    runtimeSnapshotValidityCheck: boolean;
    areaCatalogEntitiesPresent: boolean;
  };
}

export function loadAndValidateMigrations(migrationsDir: string = path.join(process.cwd(), 'migrations')): MigrationValidationResult {
  const errors: string[] = [];
  
  if (!fs.existsSync(migrationsDir)) {
    return {
      valid: false,
      migrationsFound: [],
      errors: [`Migrations directory not found at ${migrationsDir}`],
      invariantsVerified: {
        orderedSequentially: false,
        foreignKeysDeclared: false,
        oneCurrentFieldValueInvariant: false,
        postgisConfigured: false,
        provenanceModelsPresent: false,
        runtimeSnapshotValidityCheck: false,
        areaCatalogEntitiesPresent: false
      }
    };
  }

  const expectedOrder = [
    '0001_initial_schema.sql',
    '0002_areas_and_jurisdictions.sql',
    '0003_route_family_and_routes.sql',
    '0004_field_values_and_evidence.sql',
    '0005_raw_tracks_and_provenance.sql',
    '0006_rules_and_legal_scopes.sql',
    '0007_runtime_snapshots.sql',
    '0008_activities_and_first_party_evidence.sql',
    '0009_publication_and_eligibility_gates.sql',
    '0010_page_projections_and_indexes.sql',
    '0011_raw_sources.sql',
    '0012_area_catalog_entities.sql'
  ];

  const migrationsFound: MigrationFile[] = [];
  for (const expected of expectedOrder) {
    const filePath = path.join(migrationsDir, expected);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing expected migration file: ${expected}`);
      continue;
    }
    const sql = fs.readFileSync(filePath, 'utf-8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const version = expected.split('_')[0];
    migrationsFound.push({
      version,
      name: expected,
      filePath,
      sql,
      checksum
    });
  }

  const allSql = migrationsFound.map(m => m.sql).join('\n');

  const orderedSequentially = migrationsFound.length === expectedOrder.length && errors.length === 0;
  const foreignKeysDeclared = allSql.includes('REFERENCES route_families(id)') &&
                              allSql.includes('REFERENCES routes(id)') &&
                              allSql.includes('REFERENCES areas(id)');
  const oneCurrentFieldValueInvariant = allSql.includes('uq_current_field_value') &&
                                        allSql.includes('WHERE is_current = true');
  const postgisConfigured = allSql.includes('CREATE EXTENSION IF NOT EXISTS "postgis"');
  const provenanceModelsPresent = allSql.includes('provenance_type VARCHAR') &&
                                 allSql.includes('RECORDED_GPS') &&
                                 allSql.includes('PLANNED_NAVIGATION_LINE');
  const runtimeSnapshotValidityCheck = allSql.includes('chk_runtime_validity CHECK (valid_until >= observed_at)');
  const areaCatalogEntitiesPresent = allSql.includes('CREATE TABLE IF NOT EXISTS access_points') &&
                                     allSql.includes('CREATE TABLE IF NOT EXISTS pois') &&
                                     allSql.includes('CREATE TABLE IF NOT EXISTS parking') &&
                                     allSql.includes('related_access_point_id VARCHAR(64)');

  if (!oneCurrentFieldValueInvariant) {
    errors.push('Missing unique partial index enforcing One-Current FieldValue invariant in 0004');
  }
  if (!runtimeSnapshotValidityCheck) {
    errors.push('Missing check constraint for runtime validity (valid_until >= observed_at) in 0007');
  }
  if (!foreignKeysDeclared) {
    errors.push('Foreign key relationships incomplete in route / area migrations');
  }
  if (!areaCatalogEntitiesPresent) {
    errors.push('Missing Area Catalog entity schema for access_points / pois / parking in 0012');
  }

  return {
    valid: errors.length === 0,
    migrationsFound,
    errors,
    invariantsVerified: {
      orderedSequentially,
      foreignKeysDeclared,
      oneCurrentFieldValueInvariant,
      postgisConfigured,
      provenanceModelsPresent,
      runtimeSnapshotValidityCheck,
      areaCatalogEntitiesPresent
    }
  };
}

export async function runDatabaseMigrations(): Promise<{ success: boolean; applied: string[]; message: string }> {
  const validation = loadAndValidateMigrations();
  if (!validation.valid) {
    return {
      success: false,
      applied: [],
      message: `Migration validation failed: ${validation.errors.join('; ')}`
    };
  }

  const pool = getPgPool();
  if (!pool) {
    return {
      success: true,
      applied: validation.migrationsFound.map(m => m.name),
      message: `Validated ${validation.migrationsFound.length}/${validation.migrationsFound.length} migrations successfully in dry-run mode (External DATABASE_URL not attached).`
    };
  }

  const applied: string[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64) NOT NULL
      );
    `);

    const res = await client.query('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(res.rows.map(r => r.version));

    for (const migration of validation.migrationsFound) {
      if (!appliedVersions.has(migration.version)) {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum]
        );
        applied.push(migration.name);
      }
    }

    await client.query('COMMIT');
    return {
      success: true,
      applied,
      message: applied.length > 0
        ? `Applied ${applied.length} migrations to PostgreSQL.`
        : `All ${validation.migrationsFound.length} migrations already up to date.`
    };
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    return {
      success: false,
      applied,
      message: `Migration failed: ${(err as Error).message}`
    };
  } finally {
    client.release();
  }
}
