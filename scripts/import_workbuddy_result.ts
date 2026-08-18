import fs from 'node:fs/promises';
import path from 'node:path';
import { getPgPool } from '../src/config/database.js';
import { importWorkBuddyResult } from '../src/acquisition/workbuddy_result_importer.js';

async function main() {
  const filePath = process.argv[2] || process.env.WORKBUDDY_JSON_FILE;
  if (!filePath) {
    throw new Error('Usage: npm run import:workbuddy -- <result.json> or set WORKBUDDY_JSON_FILE');
  }

  const absolute = path.resolve(filePath);
  const raw = await fs.readFile(absolute, 'utf8');
  const parsed = JSON.parse(raw);

  const summary = await importWorkBuddyResult(parsed, {
    areaId: process.env.WORKBUDDY_AREA_ID || 'area_zijinshan'
  });

  console.log('=== WORKBUDDY IMPORT COMPLETE ===');
  console.log(JSON.stringify({ file: absolute, ...summary }, null, 2));

  const pool = getPgPool();
  if (pool) await pool.end();
}

main().catch(async error => {
  console.error('WORKBUDDY_IMPORT_FAILED:', error);
  const pool = getPgPool();
  if (pool) await pool.end().catch(() => undefined);
  process.exit(1);
});
