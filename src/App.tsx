/**
 * National Hiking — Governance Registry & Hard Gate Dashboard
 * Professional Polish presentation layer.
 *
 * This UI intentionally labels memory/demo data and never implies that a live
 * PostgreSQL/PostGIS repository is attached when it is not.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  Database,
  Eye,
  FileCheck,
  Layers,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Upload,
  X
} from 'lucide-react';

interface Area {
  id: string;
  name: string;
  slug: string;
  area_type: string;
  protection_level: string;
  description?: string;
}
interface RouteFamily { id: string; area_id: string; name: string; canonical_code: string; }
interface GateResult {
  gate_status: 'ELIGIBLE' | 'DISCOVERY_ONLY' | 'GEOMETRY_BLOCKED' | 'RUNTIME_DATA_REQUIRED' | 'NO_RECOMMENDATION' | 'BLOCK';
  navigation_executable: boolean;
  geometry_consensus_valid: boolean;
  runtime_fresh: boolean;
  legal_clearance_status: string;
  reasons: string[];
  advisories: string[];
}
interface RouteItem {
  id: string;
  family_id: string;
  variant_code: string;
  name: string;
  identity_state: string;
  geometry_state: string;
  start_point_name?: string;
  end_point_name?: string;
  distance_meters?: number;
  elevation_gain_meters?: number;
  estimated_duration_minutes?: number;
  gateResult?: GateResult;
  accepted_tracks_count?: number;
  rejected_tracks_count?: number;
}
interface OverviewData {
  service: string;
  repository_mode: string;
  data_classification: string;
  warning?: string;
  canonical_seed?: string;
  areas: Area[];
  families: RouteFamily[];
  routes: RouteItem[];
  tracks: unknown[];
  assignments: unknown[];
  migrations: { source: string; total: number; valid: boolean; invariants: Record<string, boolean> };
  timestamp: string;
}

const STATUS_STYLE: Record<string, string> = {
  ELIGIBLE: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  DISCOVERY_ONLY: 'bg-amber-100 text-amber-900 border-amber-300',
  GEOMETRY_BLOCKED: 'bg-red-100 text-red-700 border-red-300',
  RUNTIME_DATA_REQUIRED: 'bg-blue-100 text-blue-800 border-blue-300',
  NO_RECOMMENDATION: 'bg-red-100 text-red-800 border-red-300',
  BLOCK: 'bg-red-100 text-red-800 border-red-300'
};

const sampleGPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"><trk><name>Recorded sample</name><trkseg>
<trkpt lat="32.0450" lon="118.8250"><time>2026-08-16T08:00:00Z</time></trkpt>
<trkpt lat="32.0460" lon="118.8260"><time>2026-08-16T08:01:00Z</time></trkpt>
</trkseg></trk></gpx>`;
const sampleKML = `<?xml version="1.0" encoding="UTF-8"?>
<kml><Placemark><name>Planned control line</name><LineString>
<coordinates>118.825,32.045,0 118.828,32.048,0</coordinates>
</LineString></Placemark></kml>`;

export default function App() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<RouteItem | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [uploadFormat, setUploadFormat] = useState<'GPX' | 'KML'>('GPX');
  const [uploadPayload, setUploadPayload] = useState(sampleGPX);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [runtimeMessage, setRuntimeMessage] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/overview');
      if (!res.ok) throw new Error(`Overview HTTP ${res.status}`);
      const json = await res.json() as OverviewData;
      setData(json);
      setSelectedAreaId(prev => prev || json.areas[0]?.id || '');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, []);

  const selectedArea = data?.areas.find(a => a.id === selectedAreaId) ?? data?.areas[0];
  const familyIds = useMemo(() => new Set(
    data?.families.filter(f => f.area_id === selectedArea?.id).map(f => f.id) ?? []
  ), [data, selectedArea?.id]);
  const areaRoutes = data?.routes.filter(r => familyIds.has(r.family_id)) ?? [];

  const submitTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadResult(null);
    const res = await fetch('/tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: uploadFormat,
        payload: uploadPayload,
        fileName: uploadFormat === 'GPX' ? 'session_upload.gpx' : 'session_upload.kml'
      })
    });
    const json = await res.json();
    setUploadResult(json);
    if (res.ok) await fetchData();
  };

  const submitRuntime = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedArea || !selectedRoute) return;
    const form = new FormData(e.currentTarget);
    const now = new Date();
    const validUntil = new Date(now.getTime() + Number(form.get('hours') || 2) * 3600_000);
    const res = await fetch('/runtime-snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        areaId: selectedArea.id,
        routeId: selectedRoute.id,
        observedAt: now.toISOString(),
        validUntil: validUntil.toISOString(),
        hazardLevel: form.get('hazard'),
        trailStatus: form.get('trailStatus'),
        weatherSummary: form.get('summary'),
        sourceName: form.get('source')
      })
    });
    const json = await res.json();
    setRuntimeMessage(res.ok ? `Snapshot accepted: ${json.snapshot?.id}` : json.error);
    if (res.ok) await fetchData();
  };

  return (
    <div className="flex h-screen w-full flex-col bg-[#F7F7F5] text-[#141414] antialiased">
      <header className="flex shrink-0 items-center justify-between border-b border-black bg-[#141414] px-6 py-3.5 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-[#F27D26] text-xs font-bold">NH</div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">NATIONAL HIKING <span className="font-normal text-stone-400">| Governance Registry</span></h1>
            <div className="mt-0.5 font-mono text-[10px] text-stone-400">Evidence-first Canonical Route & Hard Gate Engine</div>
          </div>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px]">
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200">{data?.data_classification ?? 'LOADING'}</span>
          <span className="rounded border border-white/15 bg-white/5 px-2 py-1 text-stone-300">API: {data?.repository_mode ?? 'UNKNOWN'}</span>
          <span className="rounded border border-white/15 bg-white/5 px-2 py-1 text-stone-300">PostGIS API Adapter: NOT ATTACHED</span>
          <button onClick={() => void fetchData()} className="rounded p-1.5 hover:bg-white/10" title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-[#141414]/10 bg-[#EAE9E6] p-5">
          <div className="mb-6">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-black/45">Validation Areas</div>
            <div className="space-y-1.5">
              {data?.areas.map(area => (
                <button key={area.id} onClick={() => { setSelectedAreaId(area.id); setSelectedRoute(null); }}
                  className={`w-full rounded border p-2.5 text-left transition ${selectedArea?.id === area.id ? 'border-black/20 bg-white shadow-sm' : 'border-transparent bg-white/35 hover:bg-white/70'}`}>
                  <div className="text-xs font-semibold">{area.name}</div>
                  <div className="mt-0.5 font-mono text-[9px] text-stone-500">{area.area_type} · {area.protection_level}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-black/45">Hard Invariants</div>
            <div className="space-y-2 text-[11px] leading-snug text-black/70">
              {[
                'Track ≠ Route; upload creates RawTrack only.',
                'Planned line ≠ Recorded GPS execution.',
                'Sibling variants never share geometry consensus.',
                'Public child geometry defaults to ≥2 independent executions.',
                'Unknown remains Unknown; runtime facts expire.',
                'Protected-area publication requires positive authorization.'
              ].map((t, i) => <div key={t} className="flex gap-2 rounded border border-black/5 bg-white/40 p-2"><b className="font-mono text-[#F27D26]">{String(i + 1).padStart(2, '0')}</b><span>{t}</span></div>)}
            </div>
          </div>

          <div className="rounded border border-black/10 bg-white/50 p-3 font-mono text-[10px] text-stone-600">
            <div className="mb-1 flex justify-between"><span>Canonical migrations</span><b>{data?.migrations.total ?? 0}/10</b></div>
            <div className="mb-1 flex justify-between"><span>Validation</span><b className={data?.migrations.valid ? 'text-emerald-700' : 'text-red-700'}>{data?.migrations.valid ? 'PASS' : 'FAIL'}</b></div>
            <div className="break-all text-[9px] text-stone-400">{data?.migrations.source ?? 'db/migrations'}</div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <section className="border-b border-black/10 bg-white/65 px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] text-stone-500">AREA / {selectedArea?.id ?? '—'}</div>
                <h2 className="mt-1 font-serif text-2xl italic">{selectedArea?.name ?? 'Loading area…'}</h2>
                <p className="mt-1 max-w-3xl text-xs text-stone-500">{selectedArea?.description}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setUploadResult(null); setUploadOpen(true); }} className="flex items-center gap-1.5 rounded border border-black/20 bg-white px-3 py-2 text-xs font-semibold hover:bg-stone-50"><Upload className="h-3.5 w-3.5 text-[#F27D26]" />POST /tracks</button>
                <button disabled={!selectedRoute} onClick={() => setRuntimeOpen(true)} className="flex items-center gap-1.5 rounded bg-[#F27D26] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><MapPin className="h-3.5 w-3.5" />Runtime snapshot</button>
              </div>
            </div>
            {data?.warning && <div className="mt-4 flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"><ShieldAlert className="h-4 w-4 shrink-0" />{data.warning}</div>}
          </section>

          <section className="space-y-5 p-6">
            <div className="overflow-hidden rounded border border-black/10 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-black/10 bg-[#FBFBFA] px-5 py-3.5">
                <div className="text-xs font-semibold uppercase tracking-wider">RouteFamily / Child Route Gate Registry</div>
                <div className="font-mono text-[10px] text-stone-500">{areaRoutes.length} child routes</div>
              </div>
              <div className="grid grid-cols-12 border-b border-black/10 bg-[#FBFBFA] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-stone-500">
                <span className="col-span-2">Variant</span><span className="col-span-4">Route</span><span className="col-span-2">Identity</span><span className="col-span-2">Geometry Evidence</span><span className="col-span-2 text-right">Hard Gate</span>
              </div>
              <div className="divide-y divide-black/5">
                {areaRoutes.map(route => {
                  const gate = route.gateResult;
                  return <div key={route.id} className="grid grid-cols-12 items-center px-4 py-3.5 text-xs hover:bg-stone-50/70">
                    <div className="col-span-2"><b className="font-mono">{route.variant_code}</b><div className="truncate font-mono text-[9px] text-stone-400">{route.id}</div></div>
                    <div className="col-span-4 pr-4"><div className="font-medium">{route.name}</div><div className="mt-0.5 text-[10px] text-stone-500">{route.start_point_name ?? '—'} → {route.end_point_name ?? '—'}</div></div>
                    <div className="col-span-2"><span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-blue-700"><CheckCircle2 className="h-3 w-3" />{route.identity_state}</span></div>
                    <div className="col-span-2"><div className={`font-mono text-[10px] font-bold ${route.geometry_state === 'ACCEPTED_CONSENSUS' ? 'text-emerald-700' : 'text-red-700'}`}>{route.geometry_state}</div><div className="text-[9px] text-stone-400">accepted {route.accepted_tracks_count ?? 0} / rejected {route.rejected_tracks_count ?? 0}</div></div>
                    <div className="col-span-2 flex items-center justify-end gap-2"><span className={`rounded border px-2 py-0.5 font-mono text-[9px] font-bold ${STATUS_STYLE[gate?.gate_status ?? 'GEOMETRY_BLOCKED']}`}>{gate?.gate_status ?? 'UNKNOWN'}</span><button onClick={() => setSelectedRoute(route)} className="rounded border border-black/15 bg-stone-50 p-1.5 hover:bg-stone-100"><Eye className="h-3 w-3" /></button></div>
                  </div>;
                })}
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded border border-black/10 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-500">S12 Evidence-backed QA</h3><FileCheck className="h-4 w-4 text-[#F27D26]" /></div>
                <div className="space-y-2 font-mono text-[10px]">
                  <div className="rounded bg-stone-50 p-2">42160328 · A01 815.5m · A02 1437.9m · A03 1573.6m · <b className="text-red-700">REJECT_AS_S12_RAW</b></div>
                  <div className="rounded bg-stone-50 p-2">45517618 · A01 1453.7m · A02 1639.5m · A03 1596.0m · <b className="text-red-700">REJECT_AS_S12_RAW</b></div>
                  <div className="rounded bg-stone-50 p-2">52046317 · A01 37.2m · A02 380.7m · A03 610.8m · <b className="text-red-700">REJECT_AS_S12_RAW</b></div>
                  <div className="rounded border border-amber-200 bg-amber-50 p-2">planned control · 16.3m / 45.4m / 41.9m · <b className="text-amber-800">PLANNED_NAVIGATION_LINE / CONTROL_ONLY</b></div>
                </div>
              </div>
              <div className="rounded border border-black/10 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-500">Persistence Boundary</h3><Database className="h-4 w-4 text-blue-600" /></div>
                <div className="space-y-2 text-xs text-stone-600">
                  <p><b>Canonical:</b> `db/migrations` + evidence-backed four-area seed.</p>
                  <p><b>Current UI/API:</b> memory adapter using synthetic UI fixtures.</p>
                  <p><b>Not yet true:</b> PostgreSQL-backed API repository. A reachable DATABASE_URL alone does not change this.</p>
                  <p><b>Next gate:</b> CI → canonical Postgres repository adapter → live PostGIS integration tests.</p>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>

      {selectedRoute && <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg overflow-y-auto border-l border-black/15 bg-white shadow-2xl">
        <div className="flex items-start justify-between bg-[#141414] p-5 text-white"><div><div className="font-mono text-[10px] text-[#F27D26]">{selectedRoute.variant_code}</div><h3 className="mt-1 text-sm font-semibold">{selectedRoute.name}</h3></div><button onClick={() => setSelectedRoute(null)}><X className="h-4 w-4" /></button></div>
        <div className="space-y-5 p-5">
          <div className="rounded border border-black/10 bg-stone-50 p-4 font-mono text-[10px]">
            <div className="mb-2 flex justify-between"><span>Identity</span><b>{selectedRoute.identity_state}</b></div>
            <div className="mb-2 flex justify-between"><span>Geometry</span><b>{selectedRoute.geometry_state}</b></div>
            <div className="mb-2 flex justify-between"><span>Gate</span><b>{selectedRoute.gateResult?.gate_status}</b></div>
            <div className="flex justify-between"><span>Navigation executable</span><b className={selectedRoute.gateResult?.navigation_executable ? 'text-emerald-700' : 'text-red-700'}>{String(selectedRoute.gateResult?.navigation_executable ?? false)}</b></div>
          </div>
          <div><h4 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-stone-500">Reason codes</h4><div className="space-y-1.5">{selectedRoute.gateResult?.reasons.map(r => <div key={r} className="rounded border border-red-100 bg-red-50 p-2 font-mono text-[10px] text-red-800">{r}</div>)}</div></div>
          <button onClick={() => setRuntimeOpen(true)} className="w-full rounded bg-[#F27D26] py-2 text-xs font-semibold text-white">Add transient runtime observation</button>
        </div>
      </div>}

      {uploadOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"><div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#141414] px-5 py-4 text-white"><div className="flex items-center gap-2 text-sm font-semibold"><Upload className="h-4 w-4 text-[#F27D26]" />POST /tracks — RawTrack only</div><button onClick={() => setUploadOpen(false)}><X className="h-4 w-4" /></button></div>
        <form onSubmit={submitTrack} className="space-y-4 p-5">
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">Canonical contract accepts <b>GPX/KML only</b>. Timestamp-free geometry is not promoted to Recorded GPS. Upload never creates a Route or CanonicalTrack.</div>
          <div className="flex gap-2"><button type="button" onClick={() => { setUploadFormat('GPX'); setUploadPayload(sampleGPX); }} className={`rounded border px-3 py-1.5 text-xs ${uploadFormat === 'GPX' ? 'border-[#F27D26] bg-orange-50' : ''}`}>GPX recorded sample</button><button type="button" onClick={() => { setUploadFormat('KML'); setUploadPayload(sampleKML); }} className={`rounded border px-3 py-1.5 text-xs ${uploadFormat === 'KML' ? 'border-[#F27D26] bg-orange-50' : ''}`}>KML planned control</button></div>
          <textarea value={uploadPayload} onChange={e => setUploadPayload(e.target.value)} rows={10} className="w-full rounded bg-stone-900 p-3 font-mono text-[10px] text-stone-100" />
          {uploadResult && <pre className="max-h-40 overflow-auto rounded bg-stone-100 p-3 text-[9px]">{JSON.stringify(uploadResult, null, 2)}</pre>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setUploadOpen(false)} className="rounded border px-4 py-2 text-xs">Close</button><button className="rounded bg-[#F27D26] px-4 py-2 text-xs font-semibold text-white">Ingest RawTrack</button></div>
        </form>
      </div></div>}

      {runtimeOpen && selectedArea && selectedRoute && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"><div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#141414] px-5 py-4 text-white"><div className="text-sm font-semibold">Transient Runtime Observation</div><button onClick={() => setRuntimeOpen(false)}><X className="h-4 w-4" /></button></div>
        <form onSubmit={submitRuntime} className="space-y-4 p-5 text-xs">
          <div className="rounded border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-900">Runtime facts have `observed_at` + `valid_until` and never mutate static canonical truth.</div>
          <div className="font-mono text-[10px] text-stone-500">{selectedArea.id} / {selectedRoute.id}</div>
          <label className="block">Hazard<select name="hazard" defaultValue="NORMAL" className="mt-1 w-full rounded border p-2"><option>NORMAL</option><option>ADVISORY</option><option>WARNING</option><option>CRITICAL_HAZARD</option><option>CLOSED</option></select></label>
          <label className="block">Trail status<input name="trailStatus" defaultValue="OPEN" className="mt-1 w-full rounded border p-2" /></label>
          <label className="block">Summary<input name="summary" defaultValue="Session field observation" className="mt-1 w-full rounded border p-2" /></label>
          <label className="block">Source<input name="source" defaultValue="Governance dashboard session fixture" className="mt-1 w-full rounded border p-2" /></label>
          <label className="block">Validity hours<input name="hours" type="number" min="1" defaultValue="2" className="mt-1 w-full rounded border p-2" /></label>
          {runtimeMessage && <div className="rounded bg-stone-100 p-2 font-mono text-[10px]">{runtimeMessage}</div>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setRuntimeOpen(false)} className="rounded border px-4 py-2">Close</button><button className="rounded bg-blue-600 px-4 py-2 font-semibold text-white">Record snapshot</button></div>
        </form>
      </div></div>}
    </div>
  );
}
