/**
 * Repository layer used by the AI Studio memory/demo adapter.
 *
 * IMPORTANT: this is not the canonical PostgreSQL persistence adapter. The
 * canonical DB contract lives under `db/migrations`. A future Postgres adapter
 * must map these UI/demo DTOs to that contract explicitly.
 */

import {
  Area,
  RouteFamily,
  Route,
  RawTrack,
  RawTrackRouteAssignment,
  LegalScope,
  Rule,
  RuntimeSnapshot,
  Evidence,
  FieldValue,
  Activity,
  PublicationGateResult,
  PageProjection
} from '../domain/types.js';

export interface IAreaRepository {
  findById(id: string): Promise<Area | null>;
  findBySlug(slug: string): Promise<Area | null>;
  listAll(): Promise<Area[]>;
  save(area: Area): Promise<Area>;
}
export interface IRouteFamilyRepository {
  findById(id: string): Promise<RouteFamily | null>;
  findByAreaId(areaId: string): Promise<RouteFamily[]>;
  findByCanonicalCode(code: string): Promise<RouteFamily | null>;
  listAll(): Promise<RouteFamily[]>;
  save(family: RouteFamily): Promise<RouteFamily>;
}
export interface IRouteRepository {
  findById(id: string): Promise<Route | null>;
  findByFamilyId(familyId: string): Promise<Route[]>;
  findByVariantCode(variantCode: string): Promise<Route | null>;
  listAll(): Promise<Route[]>;
  save(route: Route): Promise<Route>;
}
export interface IRawTrackRepository {
  findById(id: string): Promise<RawTrack | null>;
  findBySha256(sha256: string): Promise<RawTrack | null>;
  listAll(): Promise<RawTrack[]>;
  save(track: RawTrack): Promise<RawTrack>;
}
export interface IRawTrackRouteAssignmentRepository {
  findByRouteId(routeId: string): Promise<RawTrackRouteAssignment[]>;
  findByTrackId(trackId: string): Promise<RawTrackRouteAssignment[]>;
  listAll(): Promise<RawTrackRouteAssignment[]>;
  save(assignment: RawTrackRouteAssignment): Promise<RawTrackRouteAssignment>;
}
export interface ILegalScopeRepository {
  findByAreaId(areaId: string): Promise<LegalScope[]>;
  listAll(): Promise<LegalScope[]>;
  save(scope: LegalScope): Promise<LegalScope>;
}
export interface IRuleRepository {
  findByAreaId(areaId: string): Promise<Rule[]>;
  findByRouteId(routeId: string): Promise<Rule[]>;
  listAll(): Promise<Rule[]>;
  save(rule: Rule): Promise<Rule>;
}
export interface IRuntimeSnapshotRepository {
  findLatestForRoute(routeId: string): Promise<RuntimeSnapshot | null>;
  findLatestForArea(areaId: string): Promise<RuntimeSnapshot | null>;
  listAll(): Promise<RuntimeSnapshot[]>;
  save(snapshot: RuntimeSnapshot): Promise<RuntimeSnapshot>;
}
export interface IEvidenceRepository {
  findById(id: string): Promise<Evidence | null>;
  findByEntity(entityType: string, entityId: string): Promise<Evidence[]>;
  listAll(): Promise<Evidence[]>;
  save(evidence: Evidence): Promise<Evidence>;
}
export interface IFieldValueRepository {
  findCurrent(entityType: string, entityId: string, fieldName: string): Promise<FieldValue | null>;
  listAll(): Promise<FieldValue[]>;
  save(fieldValue: FieldValue): Promise<FieldValue>;
}
export interface IActivityRepository {
  findById(id: string): Promise<Activity | null>;
  findByRouteId(routeId: string): Promise<Activity[]>;
  listAll(): Promise<Activity[]>;
  save(activity: Activity): Promise<Activity>;
}
export interface IPublicationGateResultRepository {
  findLatestByRouteId(routeId: string): Promise<PublicationGateResult | null>;
  listAll(): Promise<PublicationGateResult[]>;
  save(result: PublicationGateResult): Promise<PublicationGateResult>;
}
export interface IPageProjectionRepository {
  findByRouteId(routeId: string): Promise<PageProjection | null>;
  findByAreaId(areaId: string): Promise<PageProjection[]>;
  listAll(): Promise<PageProjection[]>;
  save(projection: PageProjection): Promise<PageProjection>;
}

export class MemoryRepositoryStore {
  public areas = new Map<string, Area>();
  public routeFamilies = new Map<string, RouteFamily>();
  public routes = new Map<string, Route>();
  public rawTracks = new Map<string, RawTrack>();
  public assignments = new Map<string, RawTrackRouteAssignment>();
  public legalScopes = new Map<string, LegalScope>();
  public rules = new Map<string, Rule>();
  public runtimeSnapshots = new Map<string, RuntimeSnapshot>();
  public evidences = new Map<string, Evidence>();
  public fieldValues = new Map<string, FieldValue>();
  public activities = new Map<string, Activity>();
  public publicationGateResults = new Map<string, PublicationGateResult>();
  public pageProjections = new Map<string, PageProjection>();

  clear() {
    this.areas.clear(); this.routeFamilies.clear(); this.routes.clear();
    this.rawTracks.clear(); this.assignments.clear(); this.legalScopes.clear();
    this.rules.clear(); this.runtimeSnapshots.clear(); this.evidences.clear();
    this.fieldValues.clear(); this.activities.clear(); this.publicationGateResults.clear();
    this.pageProjections.clear();
  }
}

export class MemoryAreaRepository implements IAreaRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findById(id: string) { return this.store.areas.get(id) ?? null; }
  async findBySlug(slug: string) { return [...this.store.areas.values()].find(a => a.slug === slug) ?? null; }
  async listAll() { return [...this.store.areas.values()]; }
  async save(area: Area) { this.store.areas.set(area.id, { ...area }); return area; }
}
export class MemoryRouteFamilyRepository implements IRouteFamilyRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findById(id: string) { return this.store.routeFamilies.get(id) ?? null; }
  async findByAreaId(areaId: string) { return [...this.store.routeFamilies.values()].filter(f => f.area_id === areaId); }
  async findByCanonicalCode(code: string) { return [...this.store.routeFamilies.values()].find(f => f.canonical_code === code) ?? null; }
  async listAll() { return [...this.store.routeFamilies.values()]; }
  async save(family: RouteFamily) { this.store.routeFamilies.set(family.id, { ...family }); return family; }
}
export class MemoryRouteRepository implements IRouteRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findById(id: string) { return this.store.routes.get(id) ?? null; }
  async findByFamilyId(familyId: string) { return [...this.store.routes.values()].filter(r => r.family_id === familyId); }
  async findByVariantCode(variantCode: string) { return [...this.store.routes.values()].find(r => r.variant_code === variantCode) ?? null; }
  async listAll() { return [...this.store.routes.values()]; }
  async save(route: Route) { this.store.routes.set(route.id, { ...route }); return route; }
}
export class MemoryRawTrackRepository implements IRawTrackRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findById(id: string) { return this.store.rawTracks.get(id) ?? null; }
  async findBySha256(sha256: string) { return [...this.store.rawTracks.values()].find(t => t.sha256 === sha256) ?? null; }
  async listAll() { return [...this.store.rawTracks.values()]; }
  async save(track: RawTrack) { this.store.rawTracks.set(track.id, { ...track }); return track; }
}
export class MemoryRawTrackRouteAssignmentRepository implements IRawTrackRouteAssignmentRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findByRouteId(routeId: string) { return [...this.store.assignments.values()].filter(a => a.route_id === routeId); }
  async findByTrackId(trackId: string) { return [...this.store.assignments.values()].filter(a => a.track_id === trackId); }
  async listAll() { return [...this.store.assignments.values()]; }
  async save(assignment: RawTrackRouteAssignment) { this.store.assignments.set(assignment.id, { ...assignment }); return assignment; }
}
export class MemoryLegalScopeRepository implements ILegalScopeRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findByAreaId(areaId: string) { return [...this.store.legalScopes.values()].filter(s => s.area_id === areaId); }
  async listAll() { return [...this.store.legalScopes.values()]; }
  async save(scope: LegalScope) { this.store.legalScopes.set(scope.id, { ...scope }); return scope; }
}
export class MemoryRuleRepository implements IRuleRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findByAreaId(areaId: string) { return [...this.store.rules.values()].filter(r => r.area_id === areaId); }
  async findByRouteId(routeId: string) { return [...this.store.rules.values()].filter(r => r.route_id === routeId); }
  async listAll() { return [...this.store.rules.values()]; }
  async save(rule: Rule) { this.store.rules.set(rule.id, { ...rule }); return rule; }
}
export class MemoryRuntimeSnapshotRepository implements IRuntimeSnapshotRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findLatestForRoute(routeId: string) {
    return [...this.store.runtimeSnapshots.values()]
      .filter(s => s.route_id === routeId)
      .sort((a,b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0] ?? null;
  }
  async findLatestForArea(areaId: string) {
    return [...this.store.runtimeSnapshots.values()]
      .filter(s => s.area_id === areaId && !s.route_id)
      .sort((a,b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0] ?? null;
  }
  async listAll() { return [...this.store.runtimeSnapshots.values()]; }
  async save(snapshot: RuntimeSnapshot) { this.store.runtimeSnapshots.set(snapshot.id, { ...snapshot }); return snapshot; }
}
export class MemoryEvidenceRepository implements IEvidenceRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findById(id: string) { return this.store.evidences.get(id) ?? null; }
  async findByEntity(entityType: string, entityId: string) { return [...this.store.evidences.values()].filter(e => e.entity_type === entityType && e.entity_id === entityId); }
  async listAll() { return [...this.store.evidences.values()]; }
  async save(evidence: Evidence) { this.store.evidences.set(evidence.id, { ...evidence }); return evidence; }
}
export class MemoryFieldValueRepository implements IFieldValueRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findCurrent(entityType: string, entityId: string, fieldName: string) {
    return [...this.store.fieldValues.values()].find(fv => fv.entity_type === entityType && fv.entity_id === entityId && fv.field_name === fieldName && fv.is_current) ?? null;
  }
  async listAll() { return [...this.store.fieldValues.values()]; }
  async save(fieldValue: FieldValue) {
    if (fieldValue.is_current) {
      for (const [id, fv] of this.store.fieldValues.entries()) {
        if (fv.entity_type === fieldValue.entity_type && fv.entity_id === fieldValue.entity_id && fv.field_name === fieldValue.field_name && fv.is_current && id !== fieldValue.id) {
          this.store.fieldValues.set(id, { ...fv, is_current: false, superseded_at: new Date().toISOString() });
        }
      }
    }
    this.store.fieldValues.set(fieldValue.id, { ...fieldValue });
    return fieldValue;
  }
}
export class MemoryActivityRepository implements IActivityRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findById(id: string) { return this.store.activities.get(id) ?? null; }
  async findByRouteId(routeId: string) { return [...this.store.activities.values()].filter(a => a.route_id === routeId); }
  async listAll() { return [...this.store.activities.values()]; }
  async save(activity: Activity) { this.store.activities.set(activity.id, { ...activity }); return activity; }
}
export class MemoryPublicationGateResultRepository implements IPublicationGateResultRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findLatestByRouteId(routeId: string) {
    return [...this.store.publicationGateResults.values()]
      .filter(p => p.route_id === routeId)
      .sort((a,b) => Date.parse(b.calculated_at || '') - Date.parse(a.calculated_at || ''))[0] ?? null;
  }
  async listAll() { return [...this.store.publicationGateResults.values()]; }
  async save(result: PublicationGateResult) { this.store.publicationGateResults.set(result.id, { ...result }); return result; }
}
export class MemoryPageProjectionRepository implements IPageProjectionRepository {
  constructor(private store: MemoryRepositoryStore) {}
  async findByRouteId(routeId: string) { return this.store.pageProjections.get(routeId) ?? null; }
  async findByAreaId(areaId: string) { return [...this.store.pageProjections.values()].filter(p => p.area_id === areaId); }
  async listAll() { return [...this.store.pageProjections.values()]; }
  async save(projection: PageProjection) { this.store.pageProjections.set(projection.route_id, { ...projection }); return projection; }
}

export interface Repositories {
  areas: IAreaRepository;
  routeFamilies: IRouteFamilyRepository;
  routes: IRouteRepository;
  rawTracks: IRawTrackRepository;
  assignments: IRawTrackRouteAssignmentRepository;
  legalScopes: ILegalScopeRepository;
  rules: IRuleRepository;
  runtimeSnapshots: IRuntimeSnapshotRepository;
  evidences: IEvidenceRepository;
  fieldValues: IFieldValueRepository;
  activities: IActivityRepository;
  gateResults: IPublicationGateResultRepository;
  pageProjections: IPageProjectionRepository;
}

export function createMemoryRepositories(
  store: MemoryRepositoryStore = new MemoryRepositoryStore()
): { repos: Repositories; store: MemoryRepositoryStore } {
  return {
    store,
    repos: {
      areas: new MemoryAreaRepository(store),
      routeFamilies: new MemoryRouteFamilyRepository(store),
      routes: new MemoryRouteRepository(store),
      rawTracks: new MemoryRawTrackRepository(store),
      assignments: new MemoryRawTrackRouteAssignmentRepository(store),
      legalScopes: new MemoryLegalScopeRepository(store),
      rules: new MemoryRuleRepository(store),
      runtimeSnapshots: new MemoryRuntimeSnapshotRepository(store),
      evidences: new MemoryEvidenceRepository(store),
      fieldValues: new MemoryFieldValueRepository(store),
      activities: new MemoryActivityRepository(store),
      gateResults: new MemoryPublicationGateResultRepository(store),
      pageProjections: new MemoryPageProjectionRepository(store)
    }
  };
}
