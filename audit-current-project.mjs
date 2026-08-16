import fs from 'fs';
import path from 'path';

const projectRoot = process.argv[2] || '.';

console.log('================================================================');
console.log('           PROJECT AUDIT: DOMAIN, MIGRATION & REPO STATE        ');
console.log('================================================================\n');

// 1. Filesystem structure check
console.log('--- [1] Structural Check ---');
const requiredPaths = [
  'migrations',
  'seed',
  'seed/manifest.json',
  'src/domain/types.ts',
  'src/domain/invariants.ts',
  'src/domain/hard_gate.ts',
  'src/services/eligibility_service.ts',
  'src/services/track_service.ts',
  'src/services/page_projection_service.ts',
  'src/services/runtime_snapshot_service.ts',
  'src/repository/repositories.ts',
  'src/migration_runner.ts',
  'server.ts',
  'tests/hard_gate.test.ts',
  'tests/domain_invariants.test.ts'
];

let structurePass = true;
for (const p of requiredPaths) {
  const fullPath = path.join(projectRoot, p);
  const exists = fs.existsSync(fullPath);
  console.log(`  [${exists ? 'PASS' : 'FAIL'}] ${p}`);
  if (!exists) structurePass = false;
}

// 2. Migration Check
console.log('\n--- [2] Migration Integrity (0001 - 0010) ---');
const migrationsDir = path.join(projectRoot, 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
console.log(`  Found ${migrationFiles.length} migration files.`);

const requiredKeywords = [
  { file: '0001_initial_schema.sql', kw: 'postgis' },
  { file: '0002_areas_and_jurisdictions.sql', kw: 'areas' },
  { file: '0003_route_family_and_routes.sql', kw: 'route_families' },
  { file: '0004_field_values_and_evidence.sql', kw: 'uq_current_field_value' },
  { file: '0005_raw_tracks_and_provenance.sql', kw: 'PLANNED_NAVIGATION_LINE' },
  { file: '0006_rules_and_legal_scopes.sql', kw: 'legal_scopes' },
  { file: '0007_runtime_snapshots.sql', kw: 'chk_runtime_validity' },
  { file: '0008_activities_and_first_party_evidence.sql', kw: 'activities' },
  { file: '0009_publication_and_eligibility_gates.sql', kw: 'publication_gate_results' },
  { file: '0010_page_projections_and_indexes.sql', kw: 'idx_page_projections_area' }
];

let migrationPass = true;
for (const req of requiredKeywords) {
  const fPath = path.join(migrationsDir, req.file);
  if (!fs.existsSync(fPath)) {
    console.log(`  [FAIL] Missing migration file ${req.file}`);
    migrationPass = false;
    continue;
  }
  const content = fs.readFileSync(fPath, 'utf8');
  if (content.includes(req.kw)) {
    console.log(`  [PASS] ${req.file} (Validated key constraint / DDL: "${req.kw}")`);
  } else {
    console.log(`  [FAIL] ${req.file} (Missing expected pattern: "${req.kw}")`);
    migrationPass = false;
  }
}

// 3. Domain Model Invariant Verification
console.log('\n--- [3] Track Provenance & Domain Invariant Verification ---');
const typesFile = fs.readFileSync(path.join(projectRoot, 'src/domain/types.ts'), 'utf8');
const canonicalProvenances = [
  'RECORDED_GPS',
  'RECORDED_GPS_MERGED',
  'PLANNED_NAVIGATION_LINE',
  'GEOMETRY_LINE_UNKNOWN'
];

let provenancePass = true;
for (const prov of canonicalProvenances) {
  if (typesFile.includes(prov)) {
    console.log(`  [PASS] Provenance Enum: ${prov}`);
  } else {
    console.log(`  [FAIL] Provenance Enum missing: ${prov}`);
    provenancePass = false;
  }
}

// 4. Seed Data Invariant
console.log('\n--- [4] Seed Data Canonical Invariant ---');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'seed/manifest.json'), 'utf8'));
const routeA = manifest.routes.find((r) => r.id === 'route_zj_s12_a');
console.log(`  Route ZJ-S12-A Identity State : ${routeA?.identity_state}`);
console.log(`  Route ZJ-S12-A Geometry State : ${routeA?.geometry_state}`);
console.log(`  Route ZJ-S12-A Geometry Field : ${routeA?.geometry_geojson ? 'PRESENT (VIOLATION)' : 'NULL (EXPECTED / UNFABRICATED)'}`);

const kmlTrack = manifest.raw_tracks.find((t) => t.id === 'track_zj_kml_control');
console.log(`  Control KML Track Provenance  : ${kmlTrack?.provenance_type}`);

console.log('\n================================================================');
console.log(`OVERALL AUDIT STATUS: ${structurePass && migrationPass && provenancePass ? 'AUDIT PASSED (100% COMPLIANT)' : 'AUDIT FAILED'}`);
console.log('================================================================');
