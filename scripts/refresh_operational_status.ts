import { Storage } from '@google-cloud/storage';
import { getPgPool } from '../src/config/database.js';
import { createRawSource } from '../src/services/raw_source_service.js';

const AREA_ID = 'area_zijinshan';
const OPENING_URL = 'https://zschina.nanjing.gov.cn/fjms/jqjd/zjssd/';
const REOPEN_URL = 'https://www.nanjing.gov.cn/njxx/202607/t20260714_5876179.html';
const TOURISM_INDEX_URL = 'https://zschina.nanjing.gov.cn/lyzx/';
const FIELD_ID = 'fv_zj_current_operational_status';
const EVIDENCE_ID = 'ev_zj_current_operational_status';

type AnyRecord = Record<string, any>;

type OfficialFetch = {
  html: string;
  contentType: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchOfficial(url: string): Promise<OfficialFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'NationalHikingMVP/0.1 (+operational-status-refresh)' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
    return {
      html: await response.text(),
      contentType: response.headers.get('content-type') || 'text/html; charset=utf-8'
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOptional(url: string): Promise<OfficialFetch | null> {
  try {
    return await fetchOfficial(url);
  } catch (error) {
    console.warn(`[STATUS] Optional official source unavailable: ${url} :: ${(error as Error).message}`);
    return null;
  }
}

async function storeOfficialRaw(
  url: string,
  platform: string,
  acquisitionGoal: string,
  html: string,
  contentType: string
) {
  return createRawSource({
    areaId: AREA_ID,
    sourceType: 'OFFICIAL_LIVE_CHECK',
    sourcePlatform: platform,
    sourceUrl: url,
    contentType,
    contentText: html,
    capturedAt: new Date().toISOString(),
    metadata: {
      acquisition_goal: acquisitionGoal,
      adapter: 'official_operational_status_v1'
    }
  });
}

async function writeSupportedOperationalStatus(pool: any) {
  const checkedAt = new Date();
  const validUntil = new Date(checkedAt.getTime() + 24 * 60 * 60 * 1000);

  const [opening, reopen, tourism] = await Promise.all([
    fetchOfficial(OPENING_URL),
    fetchOfficial(REOPEN_URL),
    fetchOptional(TOURISM_INDEX_URL)
  ]);

  const openingText = normalizeText(opening.html);
  const reopenText = normalizeText(reopen.html);
  const tourismText = tourism ? normalizeText(tourism.html) : '';

  const signals = {
    standing_opening_page: /开放时间/.test(openingText),
    zijinshan_service_present: /紫金山天文台|紫金山索道/.test(openingText),
    explicit_reopen_notice: /钟山风景区/.test(reopenText) && /恢复正常对外开放/.test(reopenText),
    post_reopen_tourism_activity: tourism
      ? (/2026-07-2[0-9]|2026-07-1[4-9]/.test(tourismText) || /暑期|毕业旅行|钟山/.test(tourismText))
      : null
  };

  if (!signals.standing_opening_page || !signals.zijinshan_service_present || !signals.explicit_reopen_notice) {
    throw new Error(`Operational status evidence validation failed: ${JSON.stringify(signals)}`);
  }

  const raws: AnyRecord[] = [];
  raws.push(await storeOfficialRaw(
    OPENING_URL,
    'ZSCHINA_NANJING_GOV_CN',
    'CURRENT_OPERATIONAL_STATUS_STANDING_COMPONENT_SCHEDULE',
    opening.html,
    opening.contentType
  ));
  raws.push(await storeOfficialRaw(
    REOPEN_URL,
    'NANJING_GOV_CN',
    'CURRENT_OPERATIONAL_STATUS_LAST_EXPLICIT_STATUS',
    reopen.html,
    reopen.contentType
  ));
  if (tourism) {
    raws.push(await storeOfficialRaw(
      TOURISM_INDEX_URL,
      'ZSCHINA_NANJING_GOV_CN',
      'CURRENT_OPERATIONAL_STATUS_RECENT_ACTIVITY_AUXILIARY',
      tourism.html,
      tourism.contentType
    ));
  }

  const value = {
    state: 'SUPPORTED',
    status: 'LATEST_KNOWN_OPEN',
    checked_at: checkedAt.toISOString(),
    valid_until: validUntil.toISOString(),
    latest_explicit_status: {
      status: 'OPEN',
      observed_at: '2026-07-13T14:00:00+08:00',
      source_url: REOPEN_URL
    },
    standing_component_schedule_checked: true,
    recent_official_tourism_activity_checked: tourism ? signals.post_reopen_tourism_activity : false,
    raw_source_ids: raws.map(r => r.id),
    limitations: [
      'SUPPORTED is not a same-minute canonical OPEN assertion.',
      'Standing component schedules do not imply every trail or sub-area is open.',
      'Temporary weather, maintenance or safety closures may supersede standing schedules.',
      'Refresh every 24 hours and immediately on an explicit closure/reopening notice.'
    ]
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO evidences
       (id,entity_type,entity_id,source_type,source_uri,collector_id,recorded_at,confidence,metadata)
       VALUES ($1,'AREA',$2,'OFFICIAL_LIVE_CHECK',$3,'official_operational_status_v1',$4,0.850,$5::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         source_uri=EXCLUDED.source_uri,
         recorded_at=EXCLUDED.recorded_at,
         confidence=EXCLUDED.confidence,
         metadata=EXCLUDED.metadata`,
      [EVIDENCE_ID, AREA_ID, OPENING_URL, checkedAt.toISOString(), JSON.stringify({ signals, raw_source_ids: raws.map(r => r.id) })]
    );

    await client.query(
      `UPDATE field_values
       SET is_current=false, superseded_at=CURRENT_TIMESTAMP
       WHERE entity_type='AREA' AND entity_id=$1 AND field_name='current_operational_status'
         AND is_current=true AND id<>$2`,
      [AREA_ID, FIELD_ID]
    );

    await client.query(
      `INSERT INTO field_values
       (id,entity_type,entity_id,field_name,field_value,evidence_id,is_current,effective_from,superseded_at)
       VALUES ($1,'AREA',$2,'current_operational_status',$3::jsonb,$4,true,$5,NULL)
       ON CONFLICT (id) DO UPDATE SET
         field_value=EXCLUDED.field_value,
         evidence_id=EXCLUDED.evidence_id,
         is_current=true,
         effective_from=EXCLUDED.effective_from,
         superseded_at=NULL`,
      [FIELD_ID, AREA_ID, JSON.stringify(value), EVIDENCE_ID, checkedAt.toISOString()]
    );

    await client.query(
      `UPDATE raw_sources SET ingestion_status='EXTRACTED' WHERE id = ANY($1::varchar[])`,
      [raws.map(r => r.id)]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { value, signals, raws };
}

async function writeReplan(pool: any) {
  const rows = await pool.query(
    `SELECT field_name,field_value FROM field_values
     WHERE entity_type='AREA' AND entity_id=$1 AND is_current=true`,
    [AREA_ID]
  );
  const fields = new Map(rows.rows.map((r: AnyRecord) => [r.field_name, r.field_value]));
  const operational = fields.get('current_operational_status') as AnyRecord | undefined;
  const operationalFresh = !!operational?.valid_until && new Date(operational.valid_until).getTime() > Date.now();

  const route = await pool.query(
    `SELECT id,identity_state,geometry_state FROM routes WHERE id='route_zj_s12_a'`
  );
  const workbuddy = await pool.query(
    `SELECT count(*)::int AS count FROM raw_sources
     WHERE area_id=$1 AND source_platform='WORKBUDDY'`,
    [AREA_ID]
  );

  const tasks = [
    {
      key: 'traffic_control_policy', priority: 'P0',
      status: fields.has('traffic_control_policy') ? 'DONE' : 'OPEN', source_strategy: 'OFFICIAL'
    },
    {
      key: 'current_operational_status', priority: 'P0',
      status: operationalFresh ? 'SUPPORTED_MONITOR' : 'RECHECK_REQUIRED',
      source_strategy: 'OFFICIAL_REALTIME',
      reason: operationalFresh
        ? 'Fresh 24h supported status exists; continue monitoring for explicit closure/reopening notices.'
        : 'Operational status evidence is absent or expired.'
    },
    {
      key: 'night_access_policy', priority: 'P0',
      status: fields.has('night_access_policy') ? 'DONE' : 'OPEN',
      source_strategy: 'OFFICIAL_PLUS_TRAILHEAD_VERIFICATION'
    },
    {
      key: 'parking_fee_current', priority: 'P0',
      status: fields.has('parking_fee_current') ? 'DONE' : 'OPEN',
      source_strategy: 'OPERATOR_FIRST_RECENT_CROSSCHECK'
    },
    {
      key: 'route_zj_s12_a_geometry', priority: 'P0',
      status: route.rows[0]?.geometry_state === 'ACCEPTED_CONSENSUS' ? 'DONE' : 'OPEN',
      source_strategy: 'RECORDED_GPS_AT_LEAST_TWO_INDEPENDENT'
    },
    {
      key: 'domestic_semantic_discovery', priority: 'P1',
      status: Number(workbuddy.rows[0]?.count || 0) > 0 ? 'READY_FOR_VALIDATION' : 'WAITING_EXTERNAL_DATA',
      source_strategy: 'WORKBUDDY'
    }
  ];

  const nextTask = tasks.find(t => t.status === 'OPEN' || t.status === 'RECHECK_REQUIRED') ?? null;
  const report = {
    area_id: AREA_ID,
    generated_at: new Date().toISOString(),
    tasks,
    next_task: nextTask
  };

  const bucket = new Storage().bucket(requiredEnv('RAW_BUCKET'));
  await bucket.file('system/replan/zijinshan/latest.json').save(
    Buffer.from(JSON.stringify(report, null, 2)),
    { resumable: false, contentType: 'application/json' }
  );
  return report;
}

async function main() {
  requiredEnv('PGHOST');
  requiredEnv('PGDATABASE');
  requiredEnv('PGPASSWORD');
  requiredEnv('RAW_BUCKET');

  const pool = getPgPool();
  if (!pool) throw new Error('PostgreSQL pool unavailable');

  console.log('[STATUS] Refreshing Zijinshan operational status from official sources...');
  const status = await writeSupportedOperationalStatus(pool);
  console.log('[STATUS] PASS', {
    state: status.value.state,
    status: status.value.status,
    valid_until: status.value.valid_until,
    raw_source_ids: status.raws.map((r: AnyRecord) => r.id)
  });

  const replan = await writeReplan(pool);
  console.log('[REPLAN] PASS', { next_task: replan.next_task });

  await pool.end();
}

main().catch(err => {
  console.error('OPERATIONAL_STATUS_REFRESH_FAILED:', err);
  process.exit(1);
});
