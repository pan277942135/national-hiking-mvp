import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Car,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Compass,
  Footprints,
  MapPin,
  Mountain,
  ParkingCircle,
  Route,
  ShieldCheck
} from 'lucide-react';

type EvidenceState = 'UNKNOWN' | 'SUPPORTED' | 'CANONICAL' | 'RECHECK_REQUIRED' | 'MODEL_PATCH';

type ProjectedField = {
  field_name: string;
  state: EvidenceState;
  value: any;
  evidence_id: string | null;
  effective_from: string | null;
};

type AreaRoute = {
  id: string;
  family_name: string;
  variant_code: string;
  name: string;
  identity_state: string;
  geometry_state: string;
  start_point_name: string | null;
  end_point_name: string | null;
  distance_meters: number | null;
  elevation_gain_meters: number | null;
  estimated_duration_minutes: number | null;
  publication_state: 'NAVIGATION_READY' | 'RULE_CHECK_REQUIRED' | 'GEOMETRY_BLOCKED' | 'DISCOVERY_ONLY';
  navigation_allowed: boolean;
};

type CatalogRecord = {
  id: string;
  name: string;
  catalog_state: string;
  access_type?: string;
  poi_type?: string;
  related_access_point_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  current_fields?: Record<string, unknown>;
};

type AreaPageProjection = {
  area: {
    id: string;
    name: string;
    slug: string;
    area_type: string;
    protection_level: string;
    description?: string;
  };
  facts: {
    current_operational_status: ProjectedField;
    traffic_control_policy: ProjectedField;
    night_access_policy: ProjectedField;
    parking_fee_current: ProjectedField;
  };
  catalog: {
    summary: any;
    access_points: CatalogRecord[];
    parking: CatalogRecord[];
    pois: CatalogRecord[];
  };
  routes: AreaRoute[];
  seo: { title: string; description: string; canonical_path: string };
  quality: {
    unknown_fields: string[];
    recheck_fields: string[];
    navigation_ready_route_count: number;
    read_only_hash: string;
  };
  projected_at: string;
};

function stateLabel(state: EvidenceState) {
  if (state === 'CANONICAL') return '已核验';
  if (state === 'SUPPORTED') return '有证据支持';
  if (state === 'RECHECK_REQUIRED') return '需要复核';
  if (state === 'MODEL_PATCH') return '模型待修正';
  return '暂未确认';
}

function stateClass(state: EvidenceState) {
  if (state === 'CANONICAL') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (state === 'SUPPORTED') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (state === 'RECHECK_REQUIRED') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-stone-200 bg-stone-50 text-stone-600';
}

function compactFactValue(field: ProjectedField): string {
  if (!field.value || field.state === 'UNKNOWN') return '暂无足够证据';
  if (typeof field.value === 'string') return field.value;
  if (typeof field.value !== 'object') return String(field.value);
  const value = field.value as Record<string, any>;
  return (
    value.status ||
    value.summary ||
    value.policy_summary ||
    value.value ||
    value.gate ||
    '已记录结构化证据'
  );
}

function formatDistance(meters: number | null) {
  return meters === null ? '—' : `${(meters / 1000).toFixed(1)} km`;
}

function routeStatus(route: AreaRoute) {
  if (route.publication_state === 'NAVIGATION_READY') return ['可导航', 'text-emerald-700 bg-emerald-50 border-emerald-200'];
  if (route.publication_state === 'RULE_CHECK_REQUIRED') return ['规则待核验', 'text-amber-700 bg-amber-50 border-amber-200'];
  if (route.publication_state === 'GEOMETRY_BLOCKED') return ['轨迹待补齐', 'text-rose-700 bg-rose-50 border-rose-200'];
  return ['仅供发现', 'text-stone-600 bg-stone-50 border-stone-200'];
}

function FactCard({ title, field, icon }: { title: string; field: ProjectedField; icon: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">{icon}{title}</div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${stateClass(field.state)}`}>{stateLabel(field.state)}</span>
      </div>
      <div className="mt-4 text-base font-medium text-stone-900">{compactFactValue(field)}</div>
      <div className="mt-3 text-xs text-stone-500">
        {field.evidence_id ? `Evidence · ${field.evidence_id}` : '当前没有可展示的证据引用'}
      </div>
    </div>
  );
}

function CatalogCard({ item, kind }: { item: CatalogRecord; kind: 'access' | 'parking' | 'poi' }) {
  const Icon = kind === 'parking' ? ParkingCircle : kind === 'access' ? MapPin : Compass;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4">
      <div className="mt-0.5 rounded-xl bg-stone-100 p-2 text-stone-700"><Icon size={17} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate font-medium text-stone-900">{item.name}</div>
          <span className="shrink-0 text-[11px] font-semibold text-sky-700">{item.catalog_state}</span>
        </div>
        <div className="mt-1 text-xs text-stone-500">
          {item.access_type || item.poi_type || (item.related_access_point_id ? '已关联入口' : '停车实体')}
        </div>
        <div className="mt-2 text-xs text-stone-400">
          {item.latitude == null || item.longitude == null ? '坐标尚未通过点位证据核验' : '坐标已记录'}
        </div>
      </div>
    </div>
  );
}

export default function AreaExplorePage() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const areaKey = pathParts[pathParts.length - 1] || 'zijinshan';
  const [data, setData] = useState<AreaPageProjection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/page-factory/areas/${encodeURIComponent(areaKey)}`)
      .then(async response => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || '加载失败');
        return json;
      })
      .then(json => {
        if (alive) setData(json);
      })
      .catch(err => {
        if (alive) setError(err.message);
      });
    return () => { alive = false; };
  }, [areaKey]);

  const sortedRoutes = useMemo(() => {
    if (!data) return [];
    const rank: Record<AreaRoute['publication_state'], number> = {
      NAVIGATION_READY: 1,
      RULE_CHECK_REQUIRED: 2,
      GEOMETRY_BLOCKED: 3,
      DISCOVERY_ONLY: 4
    };
    return [...data.routes].sort((a, b) => rank[a.publication_state] - rank[b.publication_state]);
  }, [data]);

  if (error) {
    return <main className="mx-auto max-w-5xl p-8"><div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800">{error}</div></main>;
  }

  if (!data) {
    return <main className="mx-auto max-w-5xl p-8 text-sm text-stone-500">正在生成 Area Page Projection…</main>;
  }

  return (
    <main className="min-h-screen bg-[#F7F7F5] text-stone-950">
      <div className="mx-auto max-w-6xl px-5 py-6 md:px-8 md:py-10">
        <a href="/" className="inline-flex items-center gap-2 text-sm font-medium text-stone-500 hover:text-stone-900">
          <ArrowLeft size={16} /> 数据治理后台
        </a>

        <section className="mt-7 overflow-hidden rounded-[32px] border border-stone-200 bg-white shadow-sm">
          <div className="grid gap-8 p-7 md:grid-cols-[1.4fr_0.8fr] md:p-10">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                <span>Area Page Factory V1</span><span>·</span><span>{data.area.protection_level}</span>
              </div>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">{data.area.name}</h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-stone-600">
                {data.area.description || '基于结构化路线、入口、停车、POI 与规则证据生成。未知信息保持未知。'}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-700">{data.area.area_type}</span>
                <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-700">Projection {data.quality.read_only_hash}</span>
              </div>
            </div>
            <div className="rounded-3xl bg-stone-950 p-6 text-white">
              <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={18} /> 数据完整度</div>
              <div className="mt-6 grid grid-cols-2 gap-5">
                <div><div className="text-3xl font-semibold">{data.routes.length}</div><div className="mt-1 text-xs text-stone-400">路线候选</div></div>
                <div><div className="text-3xl font-semibold">{data.quality.navigation_ready_route_count}</div><div className="mt-1 text-xs text-stone-400">可导航路线</div></div>
                <div><div className="text-3xl font-semibold">{data.quality.unknown_fields.length}</div><div className="mt-1 text-xs text-stone-400">关键 Unknown</div></div>
                <div><div className="text-3xl font-semibold">{data.catalog.access_points.length + data.catalog.parking.length + data.catalog.pois.length}</div><div className="mt-1 text-xs text-stone-400">Catalog 实体</div></div>
              </div>
              <div className="mt-6 border-t border-white/10 pt-4 text-xs leading-5 text-stone-400">页面只消费只读 Projection，不反向修改 Canonical 数据。</div>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div><div className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Current facts</div><h2 className="mt-1 text-2xl font-semibold">现在能确认什么</h2></div>
            {data.quality.unknown_fields.length > 0 && <div className="flex items-center gap-1.5 text-xs text-amber-700"><AlertCircle size={14} /> {data.quality.unknown_fields.length} 项保持 Unknown</div>}
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <FactCard title="当前运营状态" field={data.facts.current_operational_status} icon={<CheckCircle2 size={17} />} />
            <FactCard title="交通管控" field={data.facts.traffic_control_policy} icon={<Car size={17} />} />
            <FactCard title="夜间进入" field={data.facts.night_access_policy} icon={<Clock3 size={17} />} />
            <FactCard title="停车现价" field={data.facts.parking_fee_current} icon={<ParkingCircle size={17} />} />
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-4"><div className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Routes</div><h2 className="mt-1 text-2xl font-semibold">路线</h2></div>
          <div className="space-y-3">
            {sortedRoutes.map(route => {
              const [label, badgeClass] = routeStatus(route);
              return (
                <article key={route.id} className="grid gap-5 rounded-3xl border border-stone-200 bg-white p-5 md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-stone-500">{route.variant_code}</span><span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${badgeClass}`}>{label}</span></div>
                    <h3 className="mt-2 text-xl font-semibold">{route.name}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-stone-500">
                      <span className="inline-flex items-center gap-1.5"><Route size={15} /> {formatDistance(route.distance_meters)}</span>
                      <span className="inline-flex items-center gap-1.5"><Mountain size={15} /> {route.elevation_gain_meters == null ? '—' : `${route.elevation_gain_meters} m`}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock3 size={15} /> {route.estimated_duration_minutes == null ? '—' : `${route.estimated_duration_minutes} 分钟`}</span>
                    </div>
                    <div className="mt-3 text-xs text-stone-400">{route.start_point_name || '起点待核验'} → {route.end_point_name || '终点待核验'} · Geometry {route.geometry_state}</div>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-stone-500">{route.navigation_allowed ? '进入路线' : '等待证据补齐'} <ChevronRight size={16} /></div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-3">
          <div>
            <div className="mb-3 flex items-center gap-2 font-semibold"><MapPin size={18} /> 入口 / 集散点</div>
            <div className="space-y-3">{data.catalog.access_points.map(item => <CatalogCard key={item.id} item={item} kind="access" />)}</div>
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2 font-semibold"><ParkingCircle size={18} /> 停车</div>
            <div className="space-y-3">{data.catalog.parking.map(item => <CatalogCard key={item.id} item={item} kind="parking" />)}</div>
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2 font-semibold"><Footprints size={18} /> 路线相关 POI</div>
            <div className="space-y-3">{data.catalog.pois.map(item => <CatalogCard key={item.id} item={item} kind="poi" />)}</div>
          </div>
        </section>

        <footer className="mt-12 border-t border-stone-200 py-6 text-xs leading-5 text-stone-500">
          Generated {new Date(data.projected_at).toLocaleString()} · Unknown remains Unknown · 该页面是数据库的只读投影，不是人工文章。
        </footer>
      </div>
    </main>
  );
}
