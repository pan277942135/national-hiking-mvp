import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { getPgPool } from '../src/config/database.js';
import { createRawSource } from '../src/services/raw_source_service.js';

type AnyRecord = Record<string, any>;

const AREA_ID = 'area_zijinshan';
const OFFICIAL_TRAFFIC_URL = 'https://zschina.nanjing.gov.cn/zfxxgk/zfxxgkml/202509/t20250925_5657134.html';
const OFFICIAL_EVIDENCE_ID = 'ev_zj_traffic_20250925';
const TRAFFIC_FIELD_ID = 'fv_zj_traffic_control_policy';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

async function seedZijinshan(pool: any) {
  const manifestPath = path.join(process.cwd(), 'seed', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as AnyRecord;

  const area = manifest.areas.find((x: AnyRecord) => x.id === AREA_ID);
  if (!area) throw new Error(`Seed area ${AREA_ID} not found`);

  const jurisdiction = manifest.jurisdictions.find(
    (x: AnyRecord) => x.code === area.jurisdiction_code
  );
  const families = manifest.route_families.filter((x: AnyRecord) => x.area_id === AREA_ID);
  const familyIds = new Set(families.map((x: AnyRecord) => x.id));
  const routes = manifest.routes.filter((x: AnyRecord) => familyIds.has(x.family_id));
  const routeIds = new Set(routes.map((x: AnyRecord) => x.id));
  const trackIds = new Set<string>();

  for (const route of routes) {
    if (route.consensus_track_id) trackIds.add(route.consensus_track_id);
  }
  for (const track of manifest.raw_tracks) {
    if (String(track.id).startsWith('track_zj_')) trackIds.add(track.id);
  }

  const tracks = manifest.raw_tracks.filter((x: AnyRecord) => trackIds.has(x.id));
  const assignments = manifest.raw_track_route_assignments.filter(
    (x: AnyRecord) => routeIds.has(x.route_id) && trackIds.has(x.track_id)
  );
  const scopes = manifest.legal_scopes.filter((x: AnyRecord) => x.area_id === AREA_ID);
  const rules = manifest.rules.filter((x: AnyRecord) => x.area_id === AREA_ID);
  const snapshots = manifest.runtime_snapshots.filter(
    (x: AnyRecord) => x.area_id === AREA_ID || routeIds.has(x.route_id)
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (jurisdiction) {
      await client.query(
        `INSERT INTO jurisdictions (code,name,level,parent_code)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (code) DO UPDATE SET
           name=EXCLUDED.name,
           level=EXCLUDED.level,
           parent_code=EXCLUDED.parent_code`,
        [jurisdiction.code, jurisdiction.name, jurisdiction.level, jurisdiction.parent_code ?? null]
      );
    }

    await client.query(
      `INSERT INTO areas
       (id,name,slug,area_type,protection_level,jurisdiction_code,boundary_geojson,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name,
         slug=EXCLUDED.slug,
         area_type=EXCLUDED.area_type,
         protection_level=EXCLUDED.protection_level,
         jurisdiction_code=EXCLUDED.jurisdiction_code,
         boundary_geojson=EXCLUDED.boundary_geojson,
         description=EXCLUDED.description,
         updated_at=CURRENT_TIMESTAMP`,
      [area.id, area.name, area.slug, area.area_type, area.protection_level,
       area.jurisdiction_code, json(area.boundary_geojson), area.description ?? null]
    );

    for (const rf of families) {
      await client.query(
        `INSERT INTO route_families (id,area_id,name,canonical_code,description)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           area_id=EXCLUDED.area_id,
           name=EXCLUDED.name,
           canonical_code=EXCLUDED.canonical_code,
           description=EXCLUDED.description,
           updated_at=CURRENT_TIMESTAMP`,
        [rf.id, rf.area_id, rf.name, rf.canonical_code, rf.description ?? null]
      );
    }

    for (const route of routes) {
      await client.query(
        `INSERT INTO routes
         (id,family_id,variant_code,name,identity_state,geometry_state,start_point_name,end_point_name,
          distance_meters,elevation_gain_meters,estimated_duration_minutes,geometry_geojson,consensus_track_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
         ON CONFLICT (id) DO UPDATE SET
           family_id=EXCLUDED.family_id,
           variant_code=EXCLUDED.variant_code,
           name=EXCLUDED.name,
           identity_state=EXCLUDED.identity_state,
           geometry_state=EXCLUDED.geometry_state,
           start_point_name=EXCLUDED.start_point_name,
           end_point_name=EXCLUDED.end_point_name,
           distance_meters=EXCLUDED.distance_meters,
           elevation_gain_meters=EXCLUDED.elevation_gain_meters,
           estimated_duration_minutes=EXCLUDED.estimated_duration_minutes,
           geometry_geojson=EXCLUDED.geometry_geojson,
           consensus_track_id=EXCLUDED.consensus_track_id,
           updated_at=CURRENT_TIMESTAMP`,
        [route.id, route.family_id, route.variant_code, route.name, route.identity_state,
         route.geometry_state, route.start_point_name ?? null, route.end_point_name ?? null,
         route.distance_meters ?? null, route.elevation_gain_meters ?? null,
         route.estimated_duration_minutes ?? null, json(route.geometry_geojson),
         route.consensus_track_id ?? null]
      );
    }

    for (const track of tracks) {
      await client.query(
        `INSERT INTO raw_tracks
         (id,sha256,file_name,format,provenance_type,recorded_at,point_count,total_distance_meters,
          total_elevation_gain_meters,duration_seconds,raw_payload,geometry_geojson,device_info)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           file_name=EXCLUDED.file_name,
           format=EXCLUDED.format,
           provenance_type=EXCLUDED.provenance_type,
           recorded_at=EXCLUDED.recorded_at,
           point_count=EXCLUDED.point_count,
           total_distance_meters=EXCLUDED.total_distance_meters,
           total_elevation_gain_meters=EXCLUDED.total_elevation_gain_meters,
           duration_seconds=EXCLUDED.duration_seconds,
           raw_payload=EXCLUDED.raw_payload,
           geometry_geojson=EXCLUDED.geometry_geojson,
           device_info=EXCLUDED.device_info`,
        [track.id, track.sha256, track.file_name ?? null, track.format, track.provenance_type,
         track.recorded_at ?? null, track.point_count ?? 0, track.total_distance_meters ?? null,
         track.total_elevation_gain_meters ?? null, track.duration_seconds ?? null,
         track.raw_payload, json(track.geometry_geojson), json(track.device_info)]
      );
    }

    for (const assign of assignments) {
      await client.query(
        `INSERT INTO raw_track_route_assignments
         (id,track_id,route_id,match_status,rejection_reason,deviation_meters,confidence_score,evaluated_at,evaluator_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (track_id,route_id) DO UPDATE SET
           match_status=EXCLUDED.match_status,
           rejection_reason=EXCLUDED.rejection_reason,
           deviation_meters=EXCLUDED.deviation_meters,
           confidence_score=EXCLUDED.confidence_score,
           evaluated_at=EXCLUDED.evaluated_at,
           evaluator_notes=EXCLUDED.evaluator_notes`,
        [assign.id, assign.track_id, assign.route_id, assign.match_status,
         assign.rejection_reason ?? null, assign.deviation_meters ?? null,
         assign.confidence_score ?? null, assign.evaluated_at ?? null,
         assign.evaluator_notes ?? null]
      );
    }

    for (const scope of scopes) {
      await client.query(
        `INSERT INTO legal_scopes
         (id,area_id,name,scope_type,positive_authorization_required,boundary_geojson,description)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         ON CONFLICT (id) DO UPDATE SET
           area_id=EXCLUDED.area_id,
           name=EXCLUDED.name,
           scope_type=EXCLUDED.scope_type,
           positive_authorization_required=EXCLUDED.positive_authorization_required,
           boundary_geojson=EXCLUDED.boundary_geojson,
           description=EXCLUDED.description`,
        [scope.id, scope.area_id, scope.name, scope.scope_type,
         scope.positive_authorization_required ?? false, json(scope.boundary_geojson),
         scope.description ?? null]
      );
    }

    for (const rule of rules) {
      await client.query(
        `INSERT INTO rules
         (id,area_id,route_id,rule_type,is_blocking,requires_positive_auth,title,description,effective_start,effective_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           area_id=EXCLUDED.area_id,
           route_id=EXCLUDED.route_id,
           rule_type=EXCLUDED.rule_type,
           is_blocking=EXCLUDED.is_blocking,
           requires_positive_auth=EXCLUDED.requires_positive_auth,
           title=EXCLUDED.title,
           description=EXCLUDED.description,
           effective_start=EXCLUDED.effective_start,
           effective_end=EXCLUDED.effective_end`,
        [rule.id, rule.area_id, rule.route_id ?? null, rule.rule_type,
         rule.is_blocking ?? true, rule.requires_positive_auth ?? false,
         rule.title, rule.description ?? null, rule.effective_start ?? null,
         rule.effective_end ?? null]
      );
    }

    for (const snap of snapshots) {
      await client.query(
        `INSERT INTO runtime_snapshots
         (id,area_id,route_id,observed_at,valid_until,hazard_level,trail_status,weather_summary,
          temperature_celsius,wind_speed_kmh,visibility_meters,snapshot_payload,source_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
         ON CONFLICT (id) DO NOTHING`,
        [snap.id, snap.area_id, snap.route_id ?? null, snap.observed_at, snap.valid_until,
         snap.hazard_level ?? 'NORMAL', snap.trail_status ?? 'OPEN',
         snap.weather_summary ?? null, snap.temperature_celsius ?? null,
         snap.wind_speed_kmh ?? null, snap.visibility_meters ?? null,
         json(snap.snapshot_payload ?? {}), snap.source_name]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    areas: 1,
    route_families: families.length,
    routes: routes.length,
    raw_tracks: tracks.length,
    assignments: assignments.length,
    legal_scopes: scopes.length,
    rules: rules.length,
    runtime_snapshots: snapshots.length
  };
}

async function ingestOfficialTrafficNotice(pool: any) {
  const response = await fetch(OFFICIAL_TRAFFIC_URL, {
    headers: { 'user-agent': 'NationalHikingMVP/0.1 (+evidence-acquisition)' }
  });
  if (!response.ok) {
    throw new Error(`Official source fetch failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const sha256 = crypto.createHash('sha256').update(html).digest('hex');
  const existing = await pool.query(
    `SELECT id,gcs_uri,sha256 FROM raw_sources
     WHERE source_url=$1 AND sha256=$2
     ORDER BY created_at DESC LIMIT 1`,
    [OFFICIAL_TRAFFIC_URL, sha256]
  );

  let rawSource: AnyRecord;
  if (existing.rows[0]) {
    rawSource = {
      id: existing.rows[0].id,
      gcs_uri: existing.rows[0].gcs_uri,
      sha256: existing.rows[0].sha256,
      reused: true
    };
  } else {
    rawSource = await createRawSource({
      areaId: AREA_ID,
      sourceType: 'OFFICIAL_DOCUMENT',
      sourcePlatform: 'ZSCHINA_NANJING_GOV_CN',
      sourceUrl: OFFICIAL_TRAFFIC_URL,
      contentType: response.headers.get('content-type') || 'text/html; charset=utf-8',
      contentText: html,
      capturedAt: new Date().toISOString(),
      metadata: {
        acquisition_goal: 'RULE',
        adapter: 'official_http_v1',
        authority: '中山陵园管理局'
      }
    });
  }

  return { html, rawSource };
}

async function validateAndPromoteTrafficPolicy(pool: any, html: string, rawSource: AnyRecord) {
  const compact = html.replace(/\s+/g, '');
  const signals = {
    title: compact.includes('关于实施钟山风景名胜区交通优化提升措施的通告'),
    weekday: compact.includes('工作日9：00-17：00') || compact.includes('工作日9:00-17:00'),
    weekend: compact.includes('节假日、双休日8：30-17：30') || compact.includes('节假日、双休日8:30-17:30'),
    reservation: compact.includes('提前1天') && compact.includes('每个自然月内最多可以申领2次'),
    validity: compact.includes('有效期至2028年9月30日')
  };

  if (Object.values(signals).some(v => !v)) {
    throw new Error(`Official traffic notice validation failed: ${JSON.stringify(signals)}`);
  }

  const policy = {
    state: 'CANONICAL',
    scope: '钟山风景名胜区道路交通管控',
    authority: ['中山陵园管理局', '南京市公安局', '南京市交通运输局'],
    document_no: '中陵规〔2025〕1号',
    effective_from: '2025-10-01',
    effective_until: '2028-09-30',
    time_windows: {
      weekday: '09:00-17:00',
      weekend_and_holiday: '08:30-17:30'
    },
    vehicle_reservation: {
      required_for_designated_access: true,
      lead_time_days: 1,
      monthly_limit_per_vehicle: 2
    },
    source_url: OFFICIAL_TRAFFIC_URL
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO evidences
       (id,entity_type,entity_id,source_type,source_uri,collector_id,recorded_at,confidence,metadata)
       VALUES ($1,'AREA',$2,'OFFICIAL_DOCUMENT',$3,'official_http_v1',$4,1.000,$5::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         source_uri=EXCLUDED.source_uri,
         recorded_at=EXCLUDED.recorded_at,
         confidence=EXCLUDED.confidence,
         metadata=EXCLUDED.metadata`,
      [OFFICIAL_EVIDENCE_ID, AREA_ID, OFFICIAL_TRAFFIC_URL,
       '2025-09-25T00:00:00+08:00',
       json({ raw_source_id: rawSource.id, raw_source_sha256: rawSource.sha256, signals, canonical_state: 'CANONICAL' })]
    );

    await client.query(
      `UPDATE field_values
       SET is_current=false, superseded_at=CURRENT_TIMESTAMP
       WHERE entity_type='AREA' AND entity_id=$1 AND field_name='traffic_control_policy'
         AND is_current=true AND id<>$2`,
      [AREA_ID, TRAFFIC_FIELD_ID]
    );

    await client.query(
      `INSERT INTO field_values
       (id,entity_type,entity_id,field_name,field_value,evidence_id,is_current,effective_from,superseded_at)
       VALUES ($1,'AREA',$2,'traffic_control_policy',$3::jsonb,$4,true,$5,NULL)
       ON CONFLICT (id) DO UPDATE SET
         field_value=EXCLUDED.field_value,
         evidence_id=EXCLUDED.evidence_id,
         is_current=true,
         effective_from=EXCLUDED.effective_from,
         superseded_at=NULL`,
      [TRAFFIC_FIELD_ID, AREA_ID, json(policy), OFFICIAL_EVIDENCE_ID, '2025-10-01T00:00:00+08:00']
    );

    await client.query(
      `UPDATE raw_sources
       SET ingestion_status='EXTRACTED',
           metadata=metadata || $2::jsonb
       WHERE id=$1`,
      [rawSource.id, json({ validator: 'traffic_control_v1', validated_at: new Date().toISOString() })]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return policy;
}

async function maybeIngestWorkBuddy() {
  const filePath = process.env.WORKBUDDY_JSON_FILE;
  if (!filePath) {
    return { status: 'WAITING_EXTERNAL_DATA', raw_source_id: null };
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`WORKBUDDY_JSON_FILE does not exist: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  JSON.parse(content);

  const raw = await createRawSource({
    areaId: AREA_ID,
    sourceType: 'SEMANTIC_DISCOVERY',
    sourcePlatform: 'WORKBUDDY',
    contentType: 'application/json',
    contentText: content,
    capturedAt: new Date().toISOString(),
    metadata: {
      acquisition_goal: 'SEMANTIC_POPULARITY_DISCOVERY',
      validation_state: 'UNVALIDATED_RAW'
    }
  });
  return { status: 'INGESTED_RAW_ONLY', raw_source_id: raw.id };
}

async function writeContractsAndReplan(pool: any, workbuddy: AnyRecord) {
  const bucketName = requiredEnv('RAW_BUCKET');
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);

  const contract = {
    version: '1.0',
    producer: 'WORKBUDDY',
    target_area_id: AREA_ID,
    destination: 'POST /raw-sources',
    rule: 'WorkBuddy returns Raw Evidence only; it must never declare Canonical conclusions.',
    required_result_fields: ['source_url', 'captured_at', 'title_or_track_id', 'content_or_summary'],
    preferred_queries: ['紫金山 徒步', '紫金山 路线', '紫金山 登山', '紫金山 入口', '紫金山 停车'],
    platforms: ['小红书', '抖音', '两步路', '六只脚', '微信公众号', '百度'],
    example_envelope: {
      source_type: 'SEMANTIC_DISCOVERY',
      source_platform: 'WORKBUDDY',
      area_id: AREA_ID,
      content_type: 'application/json',
      content_text: '{...raw WorkBuddy result...}'
    }
  };

  await bucket.file('system/contracts/workbuddy-zijinshan-v1.json').save(
    Buffer.from(JSON.stringify(contract, null, 2)),
    { resumable: false, contentType: 'application/json' }
  );

  const fv = await pool.query(
    `SELECT field_name,field_value FROM field_values
     WHERE entity_type='AREA' AND entity_id=$1 AND is_current=true`,
    [AREA_ID]
  );
  const fields = new Map(fv.rows.map((r: AnyRecord) => [r.field_name, r.field_value]));
  const route = await pool.query(
    `SELECT id,identity_state,geometry_state FROM routes WHERE id='route_zj_s12_a'`
  );
  const rawWorkBuddy = await pool.query(
    `SELECT count(*)::int AS count FROM raw_sources WHERE area_id=$1 AND source_platform='WORKBUDDY'`,
    [AREA_ID]
  );

  const tasks = [
    {
      key: 'traffic_control_policy',
      priority: 'P0',
      status: fields.has('traffic_control_policy') ? 'DONE' : 'OPEN',
      source_strategy: 'OFFICIAL'
    },
    {
      key: 'current_operational_status',
      priority: 'P0',
      status: fields.has('current_operational_status') ? 'RECHECK_REQUIRED' : 'OPEN',
      source_strategy: 'OFFICIAL_REALTIME',
      reason: 'Current status requires fresh operational evidence; stale reopening notices cannot be treated as current.'
    },
    {
      key: 'night_access_policy',
      priority: 'P0',
      status: fields.has('night_access_policy') ? 'DONE' : 'OPEN',
      source_strategy: 'OFFICIAL_PLUS_TRAILHEAD_VERIFICATION'
    },
    {
      key: 'parking_fee_current',
      priority: 'P0',
      status: fields.has('parking_fee_current') ? 'DONE' : 'OPEN',
      source_strategy: 'OPERATOR_FIRST_RECENT_CROSSCHECK'
    },
    {
      key: 'route_zj_s12_a_geometry',
      priority: 'P0',
      status: route.rows[0]?.geometry_state === 'ACCEPTED_CONSENSUS' ? 'DONE' : 'OPEN',
      source_strategy: 'RECORDED_GPS_AT_LEAST_TWO_INDEPENDENT'
    },
    {
      key: 'domestic_semantic_discovery',
      priority: 'P1',
      status: Number(rawWorkBuddy.rows[0]?.count || 0) > 0 ? 'READY_FOR_VALIDATION' : 'WAITING_EXTERNAL_DATA',
      source_strategy: 'WORKBUDDY',
      reason: 'No fabricated social/platform data. Await a real WorkBuddy result payload.'
    }
  ];

  const report = {
    area_id: AREA_ID,
    generated_at: new Date().toISOString(),
    workbuddy_run: workbuddy,
    tasks,
    next_task: tasks.find(t => t.status === 'OPEN' || t.status === 'RECHECK_REQUIRED') ?? null
  };

  const payload = Buffer.from(JSON.stringify(report, null, 2));
  await bucket.file('system/replan/zijinshan/latest.json').save(payload, {
    resumable: false,
    contentType: 'application/json'
  });

  return report;
}

async function verify(pool: any) {
  const result = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM areas WHERE id='area_zijinshan') AS area_count,
      (SELECT count(*)::int FROM route_families WHERE area_id='area_zijinshan') AS family_count,
      (SELECT count(*)::int FROM routes r JOIN route_families f ON f.id=r.family_id WHERE f.area_id='area_zijinshan') AS route_count,
      (SELECT count(*)::int FROM raw_sources WHERE area_id='area_zijinshan') AS raw_source_count,
      (SELECT count(*)::int FROM evidences WHERE entity_type='AREA' AND entity_id='area_zijinshan') AS evidence_count,
      (SELECT count(*)::int FROM field_values WHERE entity_type='AREA' AND entity_id='area_zijinshan' AND is_current=true) AS current_field_count
  `);
  return result.rows[0];
}

async function main() {
  requiredEnv('PGHOST');
  requiredEnv('PGDATABASE');
  requiredEnv('PGPASSWORD');
  requiredEnv('RAW_BUCKET');

  const pool = getPgPool();
  if (!pool) throw new Error('PostgreSQL pool unavailable');

  console.log('[⑤] Seeding Zijinshan production subset into PostgreSQL...');
  const seed = await seedZijinshan(pool);
  console.log('[⑤] PASS', seed);

  console.log('[⑥] Fetching first official source adapter target...');
  const official = await ingestOfficialTrafficNotice(pool);
  console.log('[⑥] PASS', { raw_source_id: official.rawSource.id, gcs_uri: official.rawSource.gcs_uri, reused: !!official.rawSource.reused });

  console.log('[⑧] Deterministic validator -> Canonical field value...');
  const policy = await validateAndPromoteTrafficPolicy(pool, official.html, official.rawSource);
  console.log('[⑧] PASS', { field: 'traffic_control_policy', state: policy.state, effective_until: policy.effective_until });

  console.log('[⑦] WorkBuddy raw intake...');
  const workbuddy = await maybeIngestWorkBuddy();
  console.log('[⑦]', workbuddy.status);

  console.log('[⑨] Acquisition Engine Replan report...');
  const replan = await writeContractsAndReplan(pool, workbuddy);
  console.log('[⑨] PASS', { next_task: replan.next_task, report: `gs://${process.env.RAW_BUCKET}/system/replan/zijinshan/latest.json` });

  const verification = await verify(pool);
  console.log('\n=== NATIONAL HIKING MVP REMAINING BOOTSTRAP COMPLETE ===');
  console.log(JSON.stringify({ seed, official_raw_source_id: official.rawSource.id, workbuddy, verification, next_task: replan.next_task }, null, 2));

  await pool.end();
}

main().catch(err => {
  console.error('BOOTSTRAP_FAILED:', err);
  process.exit(1);
});
