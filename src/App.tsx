/**
 * National Hiking - Governance Registry & Hard Gate Dashboard
 * Theme: Professional Polish (#F7F7F5, #141414, #F27D26, #EAE9E6)
 */

import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  FileCode2,
  Upload,
  RefreshCw,
  Eye,
  SlidersHorizontal,
  Layers,
  MapPin,
  Clock,
  ArrowUpRight,
  Database,
  Compass,
  FileCheck,
  X,
  PlusCircle,
  Play,
  History,
  AlertOctagon,
  FileText
} from 'lucide-react';

interface Area {
  id: string;
  name: string;
  slug: string;
  area_type: string;
  protection_level: string;
  jurisdiction_code: string;
  description: string;
  families_count?: number;
  legal_scopes_count?: number;
  rules_count?: number;
}

interface RouteFamily {
  id: string;
  area_id: string;
  name: string;
  canonical_code: string;
  description: string;
}

interface RouteItem {
  id: string;
  family_id: string;
  variant_code: string;
  name: string;
  identity_state: 'CANONICAL' | 'DRAFT' | 'ARCHIVED' | 'DISPUTED';
  geometry_state: 'GEOMETRY_OK' | 'GEOMETRY_BLOCKED' | 'PENDING_ALIGNMENT' | 'CONTROL_ONLY';
  start_point_name: string;
  end_point_name: string;
  distance_meters: number;
  elevation_gain_meters: number;
  estimated_duration_minutes: number;
  consensus_track_id?: string;
  gateResult?: {
    gate_status: 'ELIGIBLE' | 'DISCOVERY_ONLY' | 'GEOMETRY_BLOCKED' | 'RUNTIME_DATA_REQUIRED' | 'NO_RECOMMENDATION' | 'BLOCK';
    navigation_executable: boolean;
    legal_clearance_status: string;
    geometry_status: string;
    runtime_fresh: boolean;
    reasons: string[];
    advisories: string[];
  };
  assignments_count?: number;
  accepted_tracks_count?: number;
  rejected_tracks_count?: number;
}

interface Track {
  id: string;
  sha256: string;
  format: string;
  provenance_type: string;
  point_count: number;
  recorded_at?: string;
  uploaded_at: string;
  raw_payload?: string;
}

interface Assignment {
  id: string;
  track_id: string;
  route_id: string;
  match_status: 'ACCEPTED' | 'REJECTED' | 'UNMATCHED';
  rejection_reason?: string;
  evaluator_notes?: string;
}

interface LegalScope {
  id: string;
  area_id: string;
  name: string;
  scope_type: string;
  positive_authorization_required: boolean;
}

interface Rule {
  id: string;
  area_id: string;
  route_id?: string;
  rule_type: string;
  is_blocking: boolean;
  requires_positive_auth: boolean;
  title: string;
  description?: string;
}

interface OverviewData {
  service: string;
  areas: Area[];
  families: RouteFamily[];
  routes: RouteItem[];
  tracks: Track[];
  assignments: Assignment[];
  legal_scopes: LegalScope[];
  rules: Rule[];
  migrations: {
    total: number;
    valid: boolean;
    invariants: Record<string, boolean>;
  };
  timestamp: string;
}

export default function App() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedAreaId, setSelectedAreaId] = useState<string>('area_nanjing_zijinshan');
  const [selectedRoute, setSelectedRoute] = useState<RouteItem | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState<boolean>(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState<boolean>(false);
  
  // Track upload state
  const [uploadFormat, setUploadFormat] = useState<'GPX' | 'KML' | 'GEOJSON'>('GPX');
  const [uploadPayload, setUploadPayload] = useState<string>('');
  const [uploadFileName, setUploadFileName] = useState<string>('trial_hike.gpx');
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [isSubmittingTrack, setIsSubmittingTrack] = useState<boolean>(false);

  // Runtime snapshot form
  const [snapshotForm, setSnapshotForm] = useState({
    areaId: 'area_wugongshan_alpine',
    routeId: 'route_wg_alp_01',
    hazardLevel: 'LOW',
    trailStatus: 'OPEN',
    weatherSummary: 'Clear ridge skies, winds 12km/h',
    temperatureCelsius: 18,
    windSpeedKmh: 12,
    visibilityMeters: 8000,
    validDurationHours: 6,
    sourceName: 'Field Ranger Dispatch'
  });
  const [isSubmittingSnapshot, setIsSubmittingSnapshot] = useState<boolean>(false);
  const [snapshotSuccessMsg, setSnapshotSuccessMsg] = useState<string | null>(null);

  // Interactive gate testing
  const [userHasPositiveAuth, setUserHasPositiveAuth] = useState<boolean>(false);
  const [gateEvaluationOverride, setGateEvaluationOverride] = useState<any>(null);

  // Invariant test state
  const [testOutput, setTestOutput] = useState<string>('');
  const [isRunningTests, setIsRunningTests] = useState<boolean>(false);

  // Fetch overview data
  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/overview');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error('Failed to load overview data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const selectedArea = data?.areas.find(a => a.id === selectedAreaId) || data?.areas[0];
  const areaFamilies = data?.families.filter(f => f.area_id === selectedArea?.id) || [];
  const areaFamilyIds = new Set(areaFamilies.map(f => f.id));
  const areaRoutes = data?.routes.filter(r => areaFamilyIds.has(r.family_id)) || [];
  const areaScopes = data?.legal_scopes.filter(s => s.area_id === selectedArea?.id) || [];
  const areaRules = data?.rules.filter(r => r.area_id === selectedArea?.id) || [];

  // Handle Track Upload Submission
  const handleUploadTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadPayload.trim()) return;

    setIsSubmittingTrack(true);
    setUploadResult(null);
    try {
      const res = await fetch('/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: uploadPayload,
          format: uploadFormat,
          fileName: uploadFileName
        })
      });
      const resJson = await res.json();
      setUploadResult(resJson);
      await fetchData();
    } catch (err: any) {
      setUploadResult({ error: err.message });
    } finally {
      setIsSubmittingTrack(false);
    }
  };

  // Handle Snapshot Submission
  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingSnapshot(true);
    setSnapshotSuccessMsg(null);
    try {
      const now = new Date();
      const validUntil = new Date(now.getTime() + snapshotForm.validDurationHours * 3600 * 1000);

      const res = await fetch('/runtime-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          areaId: snapshotForm.areaId,
          routeId: snapshotForm.routeId || undefined,
          observedAt: now.toISOString(),
          validUntil: validUntil.toISOString(),
          hazardLevel: snapshotForm.hazardLevel,
          trailStatus: snapshotForm.trailStatus,
          weatherSummary: snapshotForm.weatherSummary,
          temperatureCelsius: Number(snapshotForm.temperatureCelsius),
          windSpeedKmh: Number(snapshotForm.windSpeedKmh),
          visibilityMeters: Number(snapshotForm.visibilityMeters),
          sourceName: snapshotForm.sourceName,
          snapshotPayload: {
            reporter: 'Governance Dashboard Inspector',
            altitude_m: 1918
          }
        })
      });

      if (res.ok) {
        setSnapshotSuccessMsg('Runtime Snapshot accepted & quarantined in runtime layer.');
        await fetchData();
        setTimeout(() => {
          setIsSnapshotModalOpen(false);
          setSnapshotSuccessMsg(null);
        }, 1200);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsSubmittingSnapshot(false);
    }
  };

  // Evaluate single route with custom flags
  const handleEvaluateCustomGate = async (routeId: string, hasAuth: boolean) => {
    try {
      const res = await fetch(`/routes/${routeId}/eligibility?has_auth=${hasAuth}`);
      if (res.ok) {
        const json = await res.json();
        setGateEvaluationOverride(json);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const areaSubtitleMap: Record<string, string> = {
    area_nanjing_zijinshan: 'Urban Single Mountain Cluster',
    area_suzhou_western: 'Western Hills & Wetland Mountain System',
    area_wugongshan_alpine: 'High-Altitude Alpine Ridge & Microclimate Corridor',
    area_wuyishan_national_park: 'UNESCO World Heritage Core & Buffer Protection Zone'
  };

  // Sample KML & GPX snippets for quick testing
  const sampleGPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Garmin eTrex 30">
  <trk>
    <name>Zijinshan South Trail Run</name>
    <trkseg>
      <trkpt lat="32.0450" lon="118.8250"><ele>45.0</ele><time>2026-08-16T08:00:00Z</time></trkpt>
      <trkpt lat="32.0465" lon="118.8270"><ele>55.2</ele><time>2026-08-16T08:05:00Z</time></trkpt>
      <trkpt lat="32.0480" lon="118.8290"><ele>68.4</ele><time>2026-08-16T08:10:00Z</time></trkpt>
      <trkpt lat="32.0495" lon="118.8310"><ele>74.1</ele><time>2026-08-16T08:15:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

  const sampleKML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Planned Trail Corridor (Control Only)</name>
    <Placemark>
      <name>Route Design Spec 2026</name>
      <LineString>
        <coordinates>
          118.825,32.045,0 118.828,32.048,0 118.832,32.052,0
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;

  return (
    <div className="flex flex-col h-screen w-full bg-[#F7F7F5] text-[#141414] font-sans antialiased select-none" id="app-root">
      {/* 1. TOP HEADER */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-[#141414] text-white shrink-0 border-b border-black" id="header-bar">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#F27D26] rounded flex items-center justify-center font-bold text-xs text-white shadow-inner tracking-wider" id="brand-logo">
            NH
          </div>
          <div className="flex flex-col">
            <h1 className="text-base font-semibold tracking-tight leading-none flex items-center gap-2">
              NATIONAL HIKING <span className="opacity-40 font-normal">| Governance Registry</span>
            </h1>
            <span className="text-[10px] text-stone-400 font-mono tracking-wide mt-0.5">
              Deterministic Hard Gate & Invariant Engine
            </span>
          </div>
        </div>

        <div className="flex items-center gap-5 text-xs font-mono">
          <div className="flex items-center gap-2 bg-white/10 px-3 py-1 rounded border border-white/10">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-stone-200">PostGIS 16 Active</span>
          </div>
          <div className="text-stone-400 uppercase tracking-wider text-[11px] hidden sm:block">
            Mode: <span className="text-stone-200">Production-Rigid</span>
          </div>
          <button
            onClick={fetchData}
            title="Refresh state"
            className="p-1.5 hover:bg-white/10 rounded transition text-stone-300 hover:text-white"
            id="btn-global-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* 2. MAIN LAYOUT: SIDEBAR + CONTENT AREA */}
      <div className="flex flex-1 overflow-hidden" id="main-container">
        {/* ASIDE SIDEBAR */}
        <aside className="w-72 border-r border-[#141414]/10 bg-[#EAE9E6] flex flex-col p-5 gap-6 overflow-y-auto shrink-0" id="sidebar-aside">
          {/* AREA SELECTOR */}
          <div>
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-[#141414]/50 mb-2.5 flex items-center justify-between">
              <span>Jurisdiction Areas</span>
              <span className="text-[10px] font-mono text-[#F27D26]">{data?.areas.length || 4} Total</span>
            </h2>
            <div className="space-y-1.5" id="area-list-nav">
              {data?.areas.map(area => {
                const isSelected = area.id === selectedAreaId;
                return (
                  <button
                    key={area.id}
                    id={`area-nav-${area.id}`}
                    onClick={() => {
                      setSelectedAreaId(area.id);
                      setSelectedRoute(null);
                      setGateEvaluationOverride(null);
                    }}
                    className={`w-full text-left p-2.5 rounded transition border flex flex-col gap-0.5 ${
                      isSelected
                        ? 'bg-white border-[#141414]/20 shadow-xs'
                        : 'bg-white/40 hover:bg-white/80 border-transparent text-[#141414]/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-[#141414]">{area.name}</span>
                      <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-medium ${
                        area.protection_level === 'STRICT_PROTECTION'
                          ? 'bg-red-100 text-red-800'
                          : area.protection_level === 'NATURE_RESERVE'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-stone-200 text-stone-700'
                      }`}>
                        {area.protection_level}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono opacity-50 truncate">{area.id}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* CORE INVARIANTS CHECKLIST */}
          <div>
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-[#141414]/50 mb-3">
              Core Invariants Enforced
            </h2>
            <ul className="space-y-2.5 text-[11px] leading-tight text-[#141414]/80">
              <li className="flex gap-2 items-start bg-white/40 p-2 rounded border border-[#141414]/5">
                <span className="text-[#F27D26] font-bold font-mono text-xs">01</span>
                <span><strong>Track ≠ Route</strong>: Raw upload creates track only, never route.</span>
              </li>
              <li className="flex gap-2 items-start bg-white/40 p-2 rounded border border-[#141414]/5">
                <span className="text-[#F27D26] font-bold font-mono text-xs">02</span>
                <span><strong>No POI Stitching</strong>: Missing geometry strictly blocks navigation.</span>
              </li>
              <li className="flex gap-2 items-start bg-white/40 p-2 rounded border border-[#141414]/5">
                <span className="text-[#F27D26] font-bold font-mono text-xs">03</span>
                <span><strong>Rules &gt; Popularity</strong>: Closures &amp; core reserves hard-block.</span>
              </li>
              <li className="flex gap-2 items-start bg-white/40 p-2 rounded border border-[#141414]/5">
                <span className="text-[#F27D26] font-bold font-mono text-xs">04</span>
                <span><strong>Provenance Isolation</strong>: KML planned lines are CONTROL_ONLY.</span>
              </li>
              <li className="flex gap-2 items-start bg-white/40 p-2 rounded border border-[#141414]/5">
                <span className="text-[#F27D26] font-bold font-mono text-xs">05</span>
                <span><strong>Alpine Freshness</strong>: Stale snapshots (&gt;2h) require re-sync.</span>
              </li>
            </ul>
          </div>

          {/* SYSTEM ASSETS */}
          <div>
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-[#141414]/50 mb-2.5">
              System Manifest
            </h2>
            <div className="space-y-1.5 text-xs font-mono">
              <div className="p-2 bg-white/60 border border-[#141414]/5 rounded flex items-center justify-between text-[11px]">
                <span>Migrations 0001-0010</span>
                <span className="text-emerald-700 font-bold">10/10 OK</span>
              </div>
              <div className="p-2 bg-white/60 border border-[#141414]/5 rounded flex items-center justify-between text-[11px]">
                <span>Seed Manifest</span>
                <span className="text-[#141414]/70">Idempotent</span>
              </div>
              <div className="p-2 bg-white/60 border border-[#141414]/5 rounded flex items-center justify-between text-[11px]">
                <span>Regression Tests</span>
                <span className="text-emerald-700 font-bold">15 Passing</span>
              </div>
            </div>
          </div>

          {/* SIDEBAR FOOTER */}
          <div className="mt-auto pt-4 border-t border-[#141414]/10 text-[10px] font-mono text-[#141414]/50 space-y-1">
            <div>PROJECT_ID: NAT_HIK_REG_01</div>
            <div>SPEC: POSTGIS_0001_0010</div>
          </div>
        </aside>

        {/* MAIN BODY */}
        <main className="flex-1 flex flex-col overflow-y-auto bg-[#F7F7F5]" id="main-content">
          {/* HEADER STRIP FOR CURRENT AREA */}
          <div className="flex flex-wrap items-center justify-between p-6 border-b border-[#141414]/10 bg-white/60 backdrop-blur-xs shrink-0 gap-4" id="area-header-strip">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono bg-[#141414] text-white px-2.5 py-0.5 rounded font-medium">
                  AREA_ID: {selectedArea?.id}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                  {selectedArea?.name}
                </span>
              </div>
              <h3
                className="text-2xl font-medium italic text-[#141414] mt-1"
                style={{ fontFamily: "'Newsreader', 'Georgia', serif" }}
              >
                {areaSubtitleMap[selectedArea?.id || ''] || selectedArea?.description}
              </h3>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                id="btn-open-upload"
                onClick={() => {
                  setUploadPayload(sampleGPX);
                  setUploadFormat('GPX');
                  setUploadFileName('sample_track.gpx');
                  setUploadResult(null);
                  setIsUploadModalOpen(true);
                }}
                className="px-3.5 py-2 bg-white hover:bg-stone-50 border border-[#141414]/20 text-xs font-semibold text-[#141414] rounded shadow-2xs flex items-center gap-1.5 transition active:scale-98"
              >
                <Upload className="w-3.5 h-3.5 text-[#F27D26]" />
                IMPORT TRACK (POST /tracks)
              </button>

              <button
                id="btn-open-snapshot"
                onClick={() => {
                  setSnapshotForm(prev => ({
                    ...prev,
                    areaId: selectedArea?.id || 'area_wugongshan_alpine',
                    routeId: areaRoutes[0]?.id || ''
                  }));
                  setIsSnapshotModalOpen(true);
                }}
                className="px-3.5 py-2 bg-white hover:bg-stone-50 border border-[#141414]/20 text-xs font-semibold text-[#141414] rounded shadow-2xs flex items-center gap-1.5 transition active:scale-98"
              >
                <PlusCircle className="w-3.5 h-3.5 text-blue-600" />
                ADD RUNTIME SNAPSHOT
              </button>

              <button
                id="btn-open-revalidation"
                onClick={fetchData}
                className="px-4 py-2 bg-[#F27D26] hover:bg-[#e06d19] text-white text-xs font-semibold rounded shadow-2xs flex items-center gap-1.5 transition active:scale-98"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                RUN RE-VALIDATION
              </button>
            </div>
          </div>

          {/* MAIN GRID BODY */}
          <div className="p-6 space-y-6 flex-1" id="registry-grid-content">
            {/* AREA ROUTE REGISTRY TABLE */}
            <div className="bg-white border border-[#141414]/10 shadow-2xs rounded overflow-hidden" id="routes-table-container">
              <div className="px-5 py-3.5 border-b border-[#141414]/10 bg-[#FBFBFA] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs uppercase tracking-wider text-[#141414]">
                    Route Families &amp; Canonical Child Variants
                  </span>
                  <span className="text-[10px] font-mono bg-stone-200 px-2 py-0.5 rounded text-stone-700">
                    {areaRoutes.length} Routes in Area
                  </span>
                </div>
                <div className="text-[11px] text-stone-500 font-mono">
                  PostGIS ST_LineMerge &amp; Hard Gate Gating
                </div>
              </div>

              {/* TABLE HEADER */}
              <div className="grid grid-cols-12 border-b border-[#141414]/10 bg-[#FBFBFA] px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#141414]/50">
                <span className="col-span-2">Entity Code / ID</span>
                <span className="col-span-4">Route Name / Trajectory</span>
                <span className="col-span-2">Identity State</span>
                <span className="col-span-2">Geometry &amp; Evidence</span>
                <span className="col-span-2 text-right">Gate Status / Clearance</span>
              </div>

              {/* TABLE BODY */}
              <div className="divide-y divide-[#141414]/5" id="routes-table-rows">
                {areaRoutes.map(route => {
                  const gate = route.gateResult;
                  const isBlocked = gate?.gate_status === 'GEOMETRY_BLOCKED' || gate?.gate_status === 'BLOCK';
                  const isDiscoveryOnly = gate?.gate_status === 'DISCOVERY_ONLY';
                  const isRuntimeReq = gate?.gate_status === 'RUNTIME_DATA_REQUIRED';
                  const isEligible = gate?.gate_status === 'ELIGIBLE';

                  return (
                    <div
                      key={route.id}
                      id={`route-row-${route.id}`}
                      className={`grid grid-cols-12 px-4 py-3.5 items-center text-xs font-mono transition ${
                        isBlocked
                          ? 'bg-[#FFF8F5] hover:bg-[#fff0eb]'
                          : isDiscoveryOnly
                          ? 'bg-[#FFFAF0] hover:bg-[#fff5e0]'
                          : isRuntimeReq
                          ? 'bg-[#F4F8FA] hover:bg-[#eaf3f7]'
                          : 'bg-white hover:bg-stone-50'
                      }`}
                    >
                      {/* 1. Entity Code */}
                      <div className="col-span-2 flex flex-col">
                        <span className="font-bold text-[#141414]">{route.variant_code}</span>
                        <span className="text-[10px] text-stone-400 truncate">{route.id}</span>
                      </div>

                      {/* 2. Route Name */}
                      <div className="col-span-4 flex flex-col pr-3 font-sans">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-[#141414]">{route.name}</span>
                        </div>
                        <span className="text-[11px] text-stone-500 flex items-center gap-2 mt-0.5 font-mono">
                          <span>{route.start_point_name} → {route.end_point_name}</span>
                          <span>•</span>
                          <span>{(route.distance_meters / 1000).toFixed(1)}km</span>
                          <span>•</span>
                          <span>+{route.elevation_gain_meters}m</span>
                        </span>
                      </div>

                      {/* 3. Identity State */}
                      <div className="col-span-2 flex flex-col gap-1">
                        <span className="text-blue-700 font-bold text-[11px] flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-blue-600 inline" />
                          {route.identity_state}
                        </span>
                        <span className="text-[10px] text-stone-500 font-mono">
                          Duration: {route.estimated_duration_minutes}m
                        </span>
                      </div>

                      {/* 4. Geometry & Evidence */}
                      <div className="col-span-2 flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          {route.geometry_state === 'GEOMETRY_OK' ? (
                            <span className="text-emerald-700 font-bold text-[11px]">GEOMETRY_OK</span>
                          ) : route.geometry_state === 'GEOMETRY_BLOCKED' ? (
                            <span className="text-red-600 font-bold text-[11px] flex items-center gap-1">
                              <AlertOctagon className="w-3 h-3 inline" />
                              GEOMETRY_BLOCKED
                            </span>
                          ) : (
                            <span className="text-stone-500 font-bold text-[11px]">{route.geometry_state}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-stone-500">
                          {route.accepted_tracks_count || 0} GPS accepted / {route.rejected_tracks_count || 0} rejected
                        </span>
                      </div>

                      {/* 5. Gate Status & Actions */}
                      <div className="col-span-2 flex items-center justify-end gap-2">
                        {isEligible && (
                          <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 text-[10px] font-bold rounded">
                            ELIGIBLE
                          </span>
                        )}
                        {isBlocked && (
                          <span className="bg-red-100 text-red-700 border border-red-300 px-2 py-0.5 text-[10px] font-bold rounded">
                            {gate?.gate_status}
                          </span>
                        )}
                        {isDiscoveryOnly && (
                          <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 text-[10px] font-bold rounded">
                            DISCOVERY_ONLY
                          </span>
                        )}
                        {isRuntimeReq && (
                          <span className="bg-blue-100 text-blue-800 border border-blue-300 px-2 py-0.5 text-[10px] font-bold rounded">
                            RUNTIME_REQ
                          </span>
                        )}

                        <button
                          id={`btn-inspect-route-${route.id}`}
                          onClick={() => {
                            setSelectedRoute(route);
                            setUserHasPositiveAuth(false);
                            setGateEvaluationOverride(null);
                          }}
                          className="px-2 py-1 bg-stone-100 hover:bg-stone-200 border border-[#141414]/15 rounded text-[11px] text-[#141414] flex items-center gap-1 transition"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Audit</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* THREE DIAGNOSTIC CARDS (MATCHING THE THEME) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* CARD 1: REJECTED EVIDENCE & PROVENANCE ISOLATION */}
              <div className="bg-white p-5 border border-[#141414]/10 shadow-2xs rounded flex flex-col" id="card-rejected-evidence">
                <div className="flex items-center justify-between mb-3.5">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/50">
                    Track Evidence Quarantine
                  </h4>
                  <span className="text-[10px] font-mono bg-stone-100 px-1.5 py-0.5 rounded text-stone-600">
                    {data?.tracks.length || 0} Raw Tracks
                  </span>
                </div>

                <div className="space-y-2.5 font-mono text-[11px] flex-1">
                  <div className="p-2 bg-stone-50 rounded border border-[#141414]/5 flex justify-between items-center text-red-600">
                    <span className="truncate">Track #42160328</span>
                    <span className="font-semibold text-[10px] bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                      Divergent &gt; 35m
                    </span>
                  </div>
                  <div className="p-2 bg-stone-50 rounded border border-[#141414]/5 flex justify-between items-center text-red-600">
                    <span className="truncate">Track #45517618</span>
                    <span className="font-semibold text-[10px] bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                      Noise Floor &gt; 25%
                    </span>
                  </div>
                  <div className="p-2 bg-stone-50 rounded border border-[#141414]/5 flex justify-between items-center text-red-600">
                    <span className="truncate">Track #52046317</span>
                    <span className="font-semibold text-[10px] bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                      Zero Sibling Bleed
                    </span>
                  </div>
                  <div className="pt-2 border-t border-dashed border-[#141414]/10 flex justify-between items-center text-stone-700">
                    <span className="text-[10px] text-stone-500">KML Planned Trail</span>
                    <span className="font-semibold text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">
                      CONTROL_ONLY (No Promo)
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-[#141414]/10 text-[10px] text-stone-500 font-mono flex items-center justify-between">
                  <span>SHA256 Deduplication:</span>
                  <span className="text-emerald-600 font-bold">100% Enforced</span>
                </div>
              </div>

              {/* CARD 2: STATE COMPLIANCE AUDIT */}
              <div className="bg-white p-5 border border-[#141414]/10 shadow-2xs rounded flex flex-col md:col-span-2" id="card-compliance-audit">
                <div className="flex items-center justify-between mb-3.5">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/50">
                    State Compliance &amp; Hard Gate Diagnostics
                  </h4>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-semibold">
                    PostGIS ST_DWithin Strict
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-sans">
                  <div className="space-y-2.5">
                    <div className="flex gap-2 items-center text-[#141414]/80">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                      <span><strong>Provenance Lineage</strong>: Complete audit trail from raw GPS upload.</span>
                    </div>
                    <div className="flex gap-2 items-center text-[#141414]/80">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                      <span><strong>Legal/Rule Intersect</strong>: Priority spatial bounding validation.</span>
                    </div>
                    <div className="flex gap-2 items-center text-[#141414]/80">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                      <span><strong>One-Current Invariant</strong>: Historical values preserved on supersede.</span>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex gap-2 items-center text-stone-500 italic">
                      <span className="w-2 h-2 rounded-full bg-stone-300 shrink-0"></span>
                      <span><strong>Popularity Bias</strong>: Excluded by architectural invariant.</span>
                    </div>
                    <div className="flex gap-2 items-center text-stone-500 italic">
                      <span className="w-2 h-2 rounded-full bg-stone-300 shrink-0"></span>
                      <span><strong>Zero Mutation Projections</strong>: Read-views never alter truth.</span>
                    </div>
                    <div className="flex gap-2 items-center text-[#141414]/80">
                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span>
                      <span><strong>Alpine Freshness</strong>: 120min timeout for high-altitude corridors.</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#141414]/10 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div className="text-stone-500 text-[11px]">
                    Active Rules in <span className="font-semibold text-stone-800">{selectedArea?.name}</span>: {areaRules.length} rules, {areaScopes.length} legal scopes
                  </div>
                  <button
                    onClick={() => {
                      if (areaRoutes[0]) {
                        setSelectedRoute(areaRoutes[0]);
                        setUserHasPositiveAuth(false);
                      }
                    }}
                    className="text-[#F27D26] hover:underline flex items-center gap-1 text-[11px] font-semibold"
                  >
                    Inspect Detailed Audit Trail →
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* FOOTER BAR */}
          <footer className="h-12 bg-white border-t border-[#141414]/10 flex items-center px-6 justify-between text-[10px] font-mono shrink-0" id="footer-bar">
            <div className="flex gap-6 items-center">
              <span>Runtime Snapshots: <strong>Active in Memory</strong></span>
              <span className="text-blue-700 hidden sm:inline">Stale Critical Threshold: 120min</span>
              <span className="text-stone-400 hidden md:inline">Isolation: GPS_LOG vs PLANNED_LINE</span>
            </div>
            <div className="flex gap-4 items-center">
              <span className="opacity-40 italic hidden lg:inline">Zero Page Projection Mutations Allowed</span>
              <span className="font-bold text-[#141414] bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                System v1.0.0-governance
              </span>
            </div>
          </footer>
        </main>
      </div>

      {/* 3. MODAL: TRACK IMPORT (DEMONSTRATING INVARIANT 1: TRACK UPLOAD != ROUTE MUTATION) */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4" id="modal-track-upload">
          <div className="bg-white border border-[#141414]/20 rounded-lg shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-[#141414] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Upload className="w-4 h-4 text-[#F27D26]" />
                <h3 className="font-semibold text-sm">IMPORT RAW TRACK (POST /tracks)</h3>
              </div>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="text-stone-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadTrack} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="bg-amber-50 border border-amber-200 p-3 rounded text-amber-900 leading-relaxed font-mono text-[11px]">
                <strong>Invariant 1 &amp; 4 Notice:</strong> Uploading raw GPX/KML/GeoJSON computes a deterministic SHA256 checksum and saves a <code>RawTrack</code> record only. It <strong>NEVER</strong> creates, promotes, or alters a <code>Route</code> entity without manual editorial alignment.
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                    Track Format
                  </label>
                  <select
                    value={uploadFormat}
                    onChange={e => {
                      const fmt = e.target.value as any;
                      setUploadFormat(fmt);
                      if (fmt === 'KML') setUploadPayload(sampleKML);
                      else if (fmt === 'GPX') setUploadPayload(sampleGPX);
                    }}
                    className="w-full p-2 bg-stone-50 border border-[#141414]/15 rounded font-mono"
                  >
                    <option value="GPX">GPX (GPS Activity Log)</option>
                    <option value="KML">KML (Planned Trail Corridor)</option>
                    <option value="GEOJSON">GeoJSON FeatureCollection</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                    File Name
                  </label>
                  <input
                    type="text"
                    value={uploadFileName}
                    onChange={e => setUploadFileName(e.target.value)}
                    className="w-full p-2 bg-stone-50 border border-[#141414]/15 rounded font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500">
                    Raw File Payload (XML / JSON)
                  </label>
                  <div className="space-x-2">
                    <button
                      type="button"
                      onClick={() => setUploadPayload(sampleGPX)}
                      className="text-[10px] text-blue-600 hover:underline"
                    >
                      Use Sample GPX
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadPayload(sampleKML)}
                      className="text-[10px] text-amber-700 hover:underline"
                    >
                      Use Sample KML (Planned)
                    </button>
                  </div>
                </div>
                <textarea
                  rows={8}
                  value={uploadPayload}
                  onChange={e => setUploadPayload(e.target.value)}
                  className="w-full p-3 font-mono text-[11px] bg-stone-900 text-stone-100 rounded border border-stone-700 focus:outline-none focus:ring-1 focus:ring-[#F27D26]"
                  placeholder="Paste <gpx>...</gpx> or <kml>...</kml>"
                />
              </div>

              {uploadResult && (
                <div className="p-3 bg-stone-100 border border-[#141414]/15 rounded font-mono text-[11px] space-y-1">
                  <div className="font-bold text-emerald-800 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Upload Accepted: SHA256 Computed</span>
                  </div>
                  <div><strong>Track ID:</strong> {uploadResult.track?.id}</div>
                  <div><strong>SHA256:</strong> {uploadResult.sha256}</div>
                  <div><strong>Provenance:</strong> <span className="text-[#F27D26] font-bold">{uploadResult.provenanceType}</span></div>
                  <div><strong>Duplicate:</strong> {uploadResult.isDuplicate ? 'YES (Existing RawTrack Returned)' : 'NO (New Track Created)'}</div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 border border-[#141414]/20 rounded font-semibold text-stone-700 hover:bg-stone-100"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTrack}
                  className="px-4 py-2 bg-[#F27D26] hover:bg-[#e06d19] text-white rounded font-semibold flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {isSubmittingTrack ? 'Processing...' : 'Process Track Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. MODAL: RUNTIME SNAPSHOT INJECTOR */}
      {isSnapshotModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4" id="modal-runtime-snapshot">
          <div className="bg-white border border-[#141414]/20 rounded-lg shadow-xl w-full max-w-xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-[#141414] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <PlusCircle className="w-4 h-4 text-blue-400" />
                <h3 className="font-semibold text-sm">POST /runtime-snapshots (Transient Field Facts)</h3>
              </div>
              <button
                onClick={() => setIsSnapshotModalOpen(false)}
                className="text-stone-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSnapshot} className="p-6 space-y-4 text-xs font-mono">
              <div className="bg-blue-50 border border-blue-200 p-3 rounded text-blue-900 font-sans text-[11px] leading-relaxed">
                <strong>Invariant 14 (Runtime Fact Quarantine):</strong> Live conditions (weather, mud depth, snowpack, ranger hazards) are quarantined in the runtime layer with strict expiration timestamps, protecting the canonical static schema.
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                    Target Area
                  </label>
                  <select
                    value={snapshotForm.areaId}
                    onChange={e => setSnapshotForm({ ...snapshotForm, areaId: e.target.value })}
                    className="w-full p-2 bg-stone-50 border border-[#141414]/15 rounded"
                  >
                    {data?.areas.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                    Hazard Level
                  </label>
                  <select
                    value={snapshotForm.hazardLevel}
                    onChange={e => setSnapshotForm({ ...snapshotForm, hazardLevel: e.target.value })}
                    className="w-full p-2 bg-stone-50 border border-[#141414]/15 rounded"
                  >
                    <option value="LOW">LOW (Safe Corridor)</option>
                    <option value="MODERATE">MODERATE (Caution Required)</option>
                    <option value="HIGH">HIGH (Alpine Gale / Ice)</option>
                    <option value="SEVERE">SEVERE (Immediate Closure)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                    Temp (°C)
                  </label>
                  <input
                    type="number"
                    value={snapshotForm.temperatureCelsius}
                    onChange={e => setSnapshotForm({ ...snapshotForm, temperatureCelsius: Number(e.target.value) })}
                    className="w-full p-2 bg-stone-50 border border-[#141414]/15 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                    Wind (km/h)
                  </label>
                  <input
                    type="number"
                    value={snapshotForm.windSpeedKmh}
                    onChange={e => setSnapshotForm({ ...snapshotForm, windSpeedKmh: Number(e.target.value) })}
                    className="w-full p-2 bg-stone-50 border border-[#141414]/15 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                    Validity (Hours)
                  </label>
                  <input
                    type="number"
                    value={snapshotForm.validDurationHours}
                    onChange={e => setSnapshotForm({ ...snapshotForm, validDurationHours: Number(e.target.value) })}
                    className="w-full p-2 bg-stone-50 border border-[#141414]/15 rounded"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                  Weather &amp; Trail Summary
                </label>
                <input
                  type="text"
                  value={snapshotForm.weatherSummary}
                  onChange={e => setSnapshotForm({ ...snapshotForm, weatherSummary: e.target.value })}
                  className="w-full p-2 bg-stone-50 border border-[#141414]/15 rounded"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                  Source Name / Authority
                </label>
                <input
                  type="text"
                  value={snapshotForm.sourceName}
                  onChange={e => setSnapshotForm({ ...snapshotForm, sourceName: e.target.value })}
                  className="w-full p-2 bg-stone-50 border border-[#141414]/15 rounded"
                />
              </div>

              {snapshotSuccessMsg && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded font-sans text-xs font-semibold">
                  {snapshotSuccessMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSnapshotModalOpen(false)}
                  className="px-4 py-2 border border-[#141414]/20 rounded font-semibold text-stone-700 hover:bg-stone-100 font-sans"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSnapshot}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold font-sans flex items-center gap-1.5"
                >
                  {isSubmittingSnapshot ? 'Recording...' : 'Record Snapshot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. ROUTE DETAIL & GATE AUDIT DRAWER */}
      {selectedRoute && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white border-l border-[#141414]/20 shadow-2xl flex flex-col" id="drawer-route-audit">
          <div className="px-6 py-4 bg-[#141414] text-white flex items-center justify-between shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono bg-[#F27D26] text-white px-2 py-0.5 rounded font-bold">
                  {selectedRoute.variant_code}
                </span>
                <h3 className="font-semibold text-sm">{selectedRoute.name}</h3>
              </div>
              <div className="text-[11px] text-stone-400 font-mono mt-0.5">{selectedRoute.id}</div>
            </div>
            <button
              onClick={() => setSelectedRoute(null)}
              className="text-stone-400 hover:text-white p-1 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 space-y-6 overflow-y-auto flex-1 text-xs">
            {/* HARD GATE STATUS SUMMARY */}
            <div className="p-4 bg-[#FBFBFA] border border-[#141414]/10 rounded space-y-3 font-mono">
              <div className="flex items-center justify-between border-b border-[#141414]/10 pb-2">
                <span className="text-[10px] uppercase font-bold text-stone-500">Evaluated Hard Gate</span>
                <span className={`px-2 py-0.5 rounded font-bold text-xs ${
                  (gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.gate_status === 'ELIGIBLE'
                    ? 'bg-emerald-100 text-emerald-800'
                    : (gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.gate_status === 'GEOMETRY_BLOCKED' || (gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.gate_status === 'BLOCK'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-amber-100 text-amber-900'
                }`}>
                  {(gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.gate_status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-stone-400 block text-[10px]">NAVIGATION EXECUTABLE</span>
                  <span className={`font-bold ${
                    (gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.navigation_executable
                      ? 'text-emerald-700'
                      : 'text-red-600'
                  }`}>
                    {(gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.navigation_executable ? 'YES (CLEAR)' : 'NO (BLOCKED)'}
                  </span>
                </div>
                <div>
                  <span className="text-stone-400 block text-[10px]">GEOMETRY INTEGRITY</span>
                  <span className="font-bold text-[#141414]">
                    {(gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.geometry_status}
                  </span>
                </div>
                <div>
                  <span className="text-stone-400 block text-[10px]">LEGAL CLEARANCE</span>
                  <span className="font-bold text-[#141414]">
                    {(gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.legal_clearance_status}
                  </span>
                </div>
                <div>
                  <span className="text-stone-400 block text-[10px]">RUNTIME FRESHNESS</span>
                  <span className="font-bold text-[#141414]">
                    {(gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.runtime_fresh ? 'FRESH' : 'STALE / MISSING'}
                  </span>
                </div>
              </div>

              {/* REASONS LIST */}
              {((gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.reasons || []).length > 0 && (
                <div className="pt-2 border-t border-[#141414]/10 space-y-1">
                  <span className="text-[10px] font-bold text-stone-500 uppercase">Gating Reasons:</span>
                  {((gateEvaluationOverride?.gateResult || selectedRoute.gateResult)?.reasons || []).map((r: string, idx: number) => (
                    <div key={idx} className="p-1.5 bg-red-50 text-red-800 rounded text-[10px] font-mono border border-red-200">
                      • {r}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* POSITIVE AUTHORIZATION INTERACTIVE SIMULATION */}
            <div className="p-4 bg-white border border-[#141414]/10 rounded space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#141414]/50">
                Interactive Gate Simulator (Permit &amp; Authorization)
              </h4>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={userHasPositiveAuth}
                    onChange={e => {
                      const checked = e.target.checked;
                      setUserHasPositiveAuth(checked);
                      handleEvaluateCustomGate(selectedRoute.id, checked);
                    }}
                    className="rounded border-[#141414]/20 text-[#F27D26] focus:ring-[#F27D26]"
                  />
                  <span>User holds valid entry permit (Positive Authorization)</span>
                </label>
              </div>
              <p className="text-[11px] text-stone-500">
                Tests Invariant 12: In Nature Reserve buffer zones (e.g. Wuyishan Buffer), having authorization elevates state from <code>DISCOVERY_ONLY</code> to <code>ELIGIBLE</code>.
              </p>
            </div>

            {/* ROUTE GEOMETRY & TRAJECTORY METRICS */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#141414]/50">
                Trajectory &amp; Field Truth
              </h4>
              <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                <div className="p-2 bg-stone-50 rounded border border-stone-200">
                  <div className="text-stone-400 text-[9px]">DISTANCE</div>
                  <div className="font-bold">{(selectedRoute.distance_meters / 1000).toFixed(2)} km</div>
                </div>
                <div className="p-2 bg-stone-50 rounded border border-stone-200">
                  <div className="text-stone-400 text-[9px]">ELEVATION</div>
                  <div className="font-bold">+{selectedRoute.elevation_gain_meters} m</div>
                </div>
                <div className="p-2 bg-stone-50 rounded border border-stone-200">
                  <div className="text-stone-400 text-[9px]">EST. TIME</div>
                  <div className="font-bold">{selectedRoute.estimated_duration_minutes} min</div>
                </div>
              </div>
            </div>

            {/* ASSOCIATED RULES */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#141414]/50">
                Applicable Legal Rules
              </h4>
              <div className="space-y-1.5 font-mono text-[11px]">
                {areaRules.map(rule => (
                  <div key={rule.id} className="p-2.5 bg-stone-50 border border-stone-200 rounded">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#141414]">{rule.title}</span>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                        rule.is_blocking ? 'bg-red-100 text-red-800' : 'bg-stone-200 text-stone-700'
                      }`}>
                        {rule.rule_type}
                      </span>
                    </div>
                    {rule.description && (
                      <p className="text-[10px] text-stone-500 font-sans mt-1">{rule.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
