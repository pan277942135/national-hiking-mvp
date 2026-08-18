import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCatalogState } from '../src/services/area_catalog_service.js';

test('Area Catalog schema: creates AccessPoint, POI and Parking tables with Area ownership', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'migrations/0012_area_catalog_entities.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS access_points/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pois/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS parking/);
  assert.ok((sql.match(/REFERENCES areas\(id\)/g) || []).length >= 3);
  assert.match(sql, /related_access_point_id VARCHAR\(64\)/);
});

test('Area Catalog schema: unknown coordinates remain nullable but coordinate pairs stay consistent', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'migrations/0012_area_catalog_entities.sql'), 'utf8');
  assert.match(sql, /latitude DOUBLE PRECISION/);
  assert.match(sql, /longitude DOUBLE PRECISION/);
  assert.match(sql, /chk_access_point_coordinate_pair/);
  assert.match(sql, /chk_poi_coordinate_pair/);
  assert.match(sql, /chk_parking_coordinate_pair/);
});

test('Area Catalog schema: current fee and opening hours are not static Parking columns', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'migrations/0012_area_catalog_entities.sql'), 'utf8');
  const parkingSection = sql.split('CREATE TABLE IF NOT EXISTS parking')[1] || '';
  assert.doesNotMatch(parkingSection, /current_fee|fee_text|opening_hours|night_access_policy/i);
});

test('Area Catalog read API state parser rejects unknown promotion states', () => {
  assert.equal(parseCatalogState('canonical'), 'CANONICAL');
  assert.equal(parseCatalogState(undefined), undefined);
  assert.throws(() => parseCatalogState('VERIFIED_BY_AI'), /Invalid catalog_state/);
});
