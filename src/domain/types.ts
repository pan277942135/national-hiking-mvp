/**
 * Domain Types for National Hiking Backend MVP
 * Strict adherence to invariants and domain entities
 */

export type AreaType =
  | 'URBAN_SINGLE_MOUNTAIN'
  | 'COMPOSITE_LOW_MOUNTAIN'
  | 'ALPINE_CROSS_JURISDICTION'
  | 'STRICT_PROTECTED_AREA';

export type ProtectionLevel =
  | 'OPEN'
  | 'SCENIC'
  | 'NATURE_RESERVE'
  | 'STRICT_PROTECTION';

export type IdentityState =
  | 'DRAFT'
  | 'PROPOSED'
  | 'CANONICAL'
  | 'DEPRECATED';

export type GeometryState =
  | 'NO_GEOMETRY'
  | 'EXTERNAL_DEPENDENCY'
  | 'GEOMETRY_BLOCKED'
  | 'CONTROL_ONLY'
  | 'ACCEPTED_CONSENSUS';

export type ProvenanceType =
  | 'RECORDED_GPS'
  | 'RECORDED_GPS_MERGED'
  | 'PLANNED_NAVIGATION_LINE'
  | 'GEOMETRY_LINE_UNKNOWN';

export type MatchStatus =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'CANDIDATE';

export type GateStatus =
  | 'ELIGIBLE'
  | 'GEOMETRY_BLOCKED'
  | 'RUNTIME_DATA_REQUIRED'
  | 'DISCOVERY_ONLY'
  | 'BLOCK'
  | 'NO_RECOMMENDATION';

export type RuleType =
  | 'HARD_CLOSURE'
  | 'PERMIT_REQUIRED'
  | 'SEASONAL_BAN'
  | 'FIRE_BAN'
  | 'NIGHT_BAN'
  | 'CAPACITY_LIMIT';

export type LegalScopeType =
  | 'CORE_PROTECTED_ZONE'
  | 'BUFFER_ZONE'
  | 'EXPERIMENTAL_ZONE'
  | 'GENERAL_CONTROL_ZONE'
  | 'PUBLIC_ACCESS';

export type HazardLevel =
  | 'NORMAL'
  | 'ADVISORY'
  | 'WARNING'
  | 'CRITICAL_HAZARD'
  | 'CLOSED';

export interface Area {
  id: string;
  name: string;
  slug: string;
  area_type: AreaType;
  protection_level: ProtectionLevel;
  jurisdiction_code: string;
  boundary_geojson?: Record<string, unknown>;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RouteFamily {
  id: string;
  area_id: string;
  name: string;
  canonical_code: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Route {
  id: string;
  family_id: string;
  variant_code: string;
  name: string;
  identity_state: IdentityState;
  geometry_state: GeometryState;
  start_point_name?: string;
  end_point_name?: string;
  distance_meters?: number;
  elevation_gain_meters?: number;
  estimated_duration_minutes?: number;
  geometry_geojson?: Record<string, unknown>;
  consensus_track_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RawTrack {
  id: string;
  sha256: string;
  file_name?: string;
  format: 'GPX' | 'KML' | 'GEOJSON' | 'FIT';
  provenance_type: ProvenanceType;
  recorded_at?: string;
  point_count: number;
  total_distance_meters?: number;
  total_elevation_gain_meters?: number;
  duration_seconds?: number;
  raw_payload: string;
  geometry_geojson?: Record<string, unknown>;
  device_info?: Record<string, unknown>;
  created_at?: string;
}

export interface RawTrackRouteAssignment {
  id: string;
  track_id: string;
  route_id: string;
  match_status: MatchStatus;
  rejection_reason?: string;
  deviation_meters?: number;
  confidence_score?: number;
  evaluated_at?: string;
  evaluator_notes?: string;
}

export interface LegalScope {
  id: string;
  area_id: string;
  name: string;
  scope_type: LegalScopeType;
  positive_authorization_required: boolean;
  boundary_geojson?: Record<string, unknown>;
  description?: string;
  created_at?: string;
}

export interface Rule {
  id: string;
  area_id: string;
  route_id?: string;
  rule_type: RuleType;
  is_blocking: boolean;
  requires_positive_auth: boolean;
  title: string;
  description?: string;
  effective_start?: string;
  effective_end?: string;
  created_at?: string;
}

export interface RuntimeSnapshot {
  id: string;
  area_id: string;
  route_id?: string;
  observed_at: string;
  valid_until: string;
  hazard_level: HazardLevel;
  trail_status: string;
  weather_summary?: string;
  temperature_celsius?: number;
  wind_speed_kmh?: number;
  visibility_meters?: number;
  snapshot_payload?: Record<string, unknown>;
  source_name: string;
  created_at?: string;
}

export interface Evidence {
  id: string;
  entity_type: string;
  entity_id: string;
  source_type: string;
  source_uri?: string;
  collector_id?: string;
  recorded_at?: string;
  confidence: number;
  lineage_parent_id?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface FieldValue {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  field_value: unknown;
  evidence_id?: string;
  is_current: boolean;
  effective_from?: string;
  superseded_at?: string;
  created_at?: string;
}

export interface Activity {
  id: string;
  user_id: string;
  route_id: string;
  raw_track_id?: string;
  started_at: string;
  ended_at: string;
  completion_state: 'COMPLETED' | 'ABORTED' | 'PARTIAL' | 'DEVIATED';
  actual_distance_meters?: number;
  actual_elevation_gain_meters?: number;
  duration_seconds?: number;
  first_party_verified: boolean;
  report_notes?: string;
  created_at?: string;
}

export interface PublicationGateResult {
  id: string;
  route_id: string;
  gate_status: GateStatus;
  navigation_executable: boolean;
  geometry_consensus_valid: boolean;
  runtime_fresh: boolean;
  legal_clearance_status: 'CLEAR' | 'BLOCKED' | 'PERMIT_REQUIRED' | 'HARD_CLOSURE';
  reasons: string[];
  advisories: string[];
  calculated_at?: string;
}

export interface PageProjection {
  route_id: string;
  area_id: string;
  family_id: string;
  canonical_name: string;
  family_name: string;
  area_name: string;
  variant_code: string;
  identity_state: IdentityState;
  geometry_state: GeometryState;
  gate_status: GateStatus;
  navigation_allowed: boolean;
  distance_meters?: number;
  elevation_gain_meters?: number;
  estimated_duration_minutes?: number;
  reasons: string[];
  advisories: string[];
  runtime_freshness_status: 'FRESH' | 'STALE' | 'UNKNOWN';
  latest_snapshot?: Record<string, unknown>;
  read_only_hash: string;
  projected_at: string;
}

export interface ManagedComponent {
  id: string;
  area_id: string;
  name: string;
  component_type: string;
  status: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface POI {
  id: string;
  area_id: string;
  name: string;
  poi_type: string;
  latitude: number;
  longitude: number;
  altitude_m?: number;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface AccessPoint {
  id: string;
  area_id: string;
  name: string;
  access_type: string;
  latitude: number;
  longitude: number;
  is_public: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface Parking {
  id: string;
  area_id: string;
  name: string;
  capacity?: number;
  fee_type?: string;
  latitude: number;
  longitude: number;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface CanonicalTrack {
  id: string;
  route_id: string;
  source_track_id: string;
  geojson: Record<string, unknown>;
  length_m: number;
  elevation_gain_m: number;
  verified_at: string;
  verifier_id?: string;
}

export interface Dependency {
  id: string;
  source_entity_type: string;
  source_entity_id: string;
  target_entity_type: string;
  target_entity_id: string;
  dependency_type: string;
  created_at?: string;
}

export interface ProtectedAreaZone {
  id: string;
  area_id: string;
  name: string;
  zone_level: 'CORE' | 'BUFFER' | 'EXPERIMENTAL' | 'GENERAL';
  boundary_geojson?: Record<string, unknown>;
  legal_basis?: string;
  entry_requires_permit: boolean;
  created_at?: string;
}

