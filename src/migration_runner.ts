/**
 * Canonical PostgreSQL/PostGIS migration runner.
 *
 * Source of truth: db/migrations/0001..0010.
 * The root-level migrations/ directory is an AI Studio draft and is NOT authoritative.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPgPool } from './config/database.js';

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
    protectedAreaModelPresent: boolean;
    routeFamilyVariantModelPresent: boolean;
    firstPartyActivityModelPresent: boolean;
  };
}

export const CANONICAL_MIGRATION_ORDER = [
  '0001_extensions_enums.sql',
  '0002_core_entities.sql',
  '0003_evidence_promotion.sql',
  '0004_route_track.sql',
  '0005_legal_rule_protected.sql',
  '0006_runtime_overnight.sql',
  '0007_gate_projection.sql',
  '0008_indexes_constraints.sql',
  '0009_routefamily_variant_geometry.sql',
  '0010_first_party_activity.sql'
] as const;

export function loadAndValidateMigrations(
  migrationsDir: string = path.join(process.cwd(), 'db', 'migrations')
): MigrationValidationResult {
  const errors: string[] = [];

  const emptyFlags = {
    orderedSequentially: false,
    foreignKeysDeclared: false,
    oneCurrentFieldValueInvariant: false,
    postgisConfigured: false,
    provenanceModelsPresent: false,
    runtimeSnapshotValidityCheck: false,
    protectedAreaModelPresent: false,
    routeFamilyVariantModelPresent: false,
    firstPartyActivityModelPresent: false
  };

  if (!fs.existsSync(migrationsDir)) {
    return {
      valid: false,
      migrationsFound: [],
      errors: [`Canonical migrations directory not found at ${migrationsDir}`],
      invariantsVerified: emptyFlags
    };
  }

  const numberedFiles = fs.readdirSync(migrationsDir)
    .filter(f => /^00\d\d_.*\.sql$/.test(f))
    .sort();

  const orderedSequentially =
    numberedFiles.length === CANONICAL_MIGRATION_ORDER.length &&
    CANONICAL_MIGRATION_ORDER.every((name, index) => numberedFiles[index] === name);

  if (!orderedSequentially) {
    errors.push(
      `Canonical migration order mismatch. Expected ${CANONICAL_MIGRATION_ORDER.join(', ')}, found ${numberedFiles.join(', ')}`
    );
  }

  const migrationsFound: MigrationFile[] = [];
  for (const expected of CANONICAL_MIGRATION_ORDER) {
    const filePath = path.join(migrationsDir, expected);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing canonical migration file: ${expected}`);
      continue;
    }
    const sql = fs.readFileSync(filePath, 'utf-8');
    migrationsFound.push({
      version: expected.substring(0, 4),
      name: expected,
      filePath,
      sql,
      checksum: crypto.createHash('sha256').update(sql).digest('hex')
    });
  }

  const allSql = migrationsFound.map(m => m.sql).join('\n').toLowerCase();

  const foreignKeysDeclared =
    allSql.includes('references area(area_id)') &&
    allSql.includes('references route(route_id)') &&
    allSql.includes('references route_family(route_family_id)');

  const oneCurrentFieldValueInvariant =
    allSql.includes('uq_field_value_one_current') &&
    allSql.includes('where is_current');

  const postgisConfigured = allSql.includes('create extension if not exists postgis');

  const provenanceModelsPresent =
    allSql.includes('provenance_class') &&
    allSql.includes("'recorded_gps'") &&
    allSql.includes("'recorded_gps_merged'") &&
    allSql.includes("'planned_navigation_line'") &&
    allSql.includes("'geometry_line_unknown'") &&
    allSql.includes('recorded_execution');

  const runtimeSnapshotValidityCheck =
    allSql.includes('create table if not exists runtime_snapshot') &&
    allSql.includes('check (valid_until >= observed_at)');

  const protectedAreaModelPresent =
    allSql.includes('create table if not exists legal_scope') &&
    allSql.includes('create table if not exists protected_area_zone') &&
    allSql.includes('create table if not exists access_authorization_state');

  const routeFamilyVariantModelPresent =
    allSql.includes('create table if not exists route_family') &&
    allSql.includes('create table if not exists raw_track_route_assignment') &&
    allSql.includes('independent_provenance_key') &&
    allSql.includes('create table if not exists route_geometry_acquisition_attempt');

  const firstPartyActivityModelPresent =
    allSql.includes('create table if not exists activity') &&
    allSql.includes('actor_hash') &&
    allSql.includes('create table if not exists activity_route_assignment');

  const checks: Array<[boolean, string]> = [
    [foreignKeysDeclared, 'Canonical foreign-key relationships are incomplete'],
    [oneCurrentFieldValueInvariant, 'Missing one-current FieldValue partial unique index'],
    [postgisConfigured, 'PostGIS extension declaration missing'],
    [provenanceModelsPresent, 'Canonical RawTrack provenance model incomplete'],
    [runtimeSnapshotValidityCheck, 'Runtime snapshot validity check missing'],
    [protectedAreaModelPresent, 'Protected-area/legal-scope model incomplete'],
    [routeFamilyVariantModelPresent, 'RouteFamily/child-variant geometry model incomplete'],
    [firstPartyActivityModelPresent, 'First-party Activity evidence model incomplete']
  ];

  for (const [pass, message] of checks) {
    if (!pass) errors.push(message);
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
      protectedAreaModelPresent,
      routeFamilyVariantModelPresent,
      firstPartyActivityModelPresent
    }
  };
}

export interface MigrationRunResult {
  success: boolean;
  mode: 'VALIDATED_ONLY' | 'LIVE_DB';
  applied: string[];
  validated: string[];
  message: string;
}

export async function runDatabaseMigrations(): Promise<MigrationRunResult> {
  const validation = loadAndValidateMigrations();
  if (!validation.valid) {
    return {
      success: false,
      mode: 'VALIDATED_ONLY',
      applied: [],
      validated: validation.migrationsFound.map(m => m.name),
      message: `Canonical migration validation failed: ${validation.errors.join('; ')}`
    };
  }

  const pool = getPgPool();
  if (!pool) {
    return {
      success: true,
      mode: 'VALIDATED_ONLY',
      applied: [],
      validated: validation.migrationsFound.map(m => m.name),
      message: 'Canonical migrations validated only. No PostgreSQL/PostGIS DATABASE_URL is attached; nothing was applied.'
    };
  }

  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        migration_name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const migration of validation.migrationsFound) {
      const existing = await client.query(
        'SELECT checksum FROM schema_migration WHERE migration_name = $1',
        [migration.name]
      );

      if (existing.rowCount && existing.rows[0].checksum !== migration.checksum) {
        throw new Error(`Checksum drift detected for already-applied migration ${migration.name}`);
      }
      if (existing.rowCount) continue;

      // Canonical migration files may contain their own BEGIN/COMMIT wrappers.
      // Do not nest them inside a runner-wide transaction.
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO schema_migration (migration_name, checksum) VALUES ($1, $2)',
        [migration.name, migration.checksum]
      );
      applied.push(migration.name);
    }

    return {
      success: true,
      mode: 'LIVE_DB',
      applied,
      validated: validation.migrationsFound.map(m => m.name),
      message: applied.length
        ? `Applied ${applied.length} canonical migrations to PostgreSQL/PostGIS.`
        : 'Canonical PostgreSQL/PostGIS schema is already up to date.'
    };
  } catch (err: unknown) {
    return {
      success: false,
      mode: 'LIVE_DB',
      applied,
      validated: validation.migrationsFound.map(m => m.name),
      message: `Canonical migration execution failed: ${(err as Error).message}`
    };
  } finally {
    client.release();
  }
}
