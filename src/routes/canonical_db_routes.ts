import type { Express, Request, Response } from 'express';
import { getPgPool } from '../config/database.js';
import { CanonicalPostgresRepository } from '../repository/postgres/canonical_postgres.js';
import {
  assignCanonicalRawTrack,
  ingestCanonicalRawTrack,
  type CanonicalAssignmentState,
  type CanonicalTrackFormat
} from '../services/canonical_track_ingest_service.js';
import {
  evaluateAndAssignCanonicalRawTrack,
  S12_CORE_QA_PROFILE_V1,
  type GeometryGateProfile
} from '../services/geometry_gate_service.js';
import { recordFirstPartyActivity } from '../services/first_party_activity_service.js';

const GEOMETRY_GATE_PROFILES: Readonly<Record<string, GeometryGateProfile>> = {
  [S12_CORE_QA_PROFILE_V1.profileId]: S12_CORE_QA_PROFILE_V1
};

function unavailable(res: Response) {
  return res.status(503).json({
    error: 'CANONICAL_POSTGRES_UNAVAILABLE',
    message: 'Canonical PostgreSQL/PostGIS repository is not configured for this runtime.'
  });
}

export function registerCanonicalDbRoutes(app: Express): void {
  app.get('/api/canonical/overview', async (_req, res) => {
    const pool = getPgPool();
    if (!pool) return unavailable(res);
    try {
      const repo = new CanonicalPostgresRepository(pool);
      const [areas, families, routes, migrations] = await Promise.all([
        repo.listAreas(),
        repo.listRouteFamilies(),
        repo.listRoutes(),
        repo.getAppliedMigrationNames()
      ]);

      const routeEvidence = await Promise.all(routes.map(async route => ({
        route_id: route.route_id,
        route_state: route.route_state,
        active_canonical_track_id: route.active_canonical_track_id,
        accepted_raw_execution_count: await repo.countIndependentAcceptedRawExecutions(route.route_id),
        accepted_first_party_actor_count: await repo.countIndependentAcceptedActors(route.route_id)
      })));

      res.json({
        repository_mode: 'CANONICAL_POSTGRES',
        data_classification: 'CANONICAL_EVIDENCE_BACKED',
        migrations,
        areas,
        route_families: families,
        routes,
        route_evidence: routeEvidence,
        geometry_gate_profiles: Object.values(GEOMETRY_GATE_PROFILES).map(profile => ({
          profile_id: profile.profileId,
          route_id: profile.routeId,
          purpose: profile.purpose,
          profile_version: profile.profileVersion
        })),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/canonical/areas/:areaId', async (req, res) => {
    const pool = getPgPool();
    if (!pool) return unavailable(res);
    try {
      const repo = new CanonicalPostgresRepository(pool);
      const area = await repo.findArea(req.params.areaId);
      if (!area) return res.status(404).json({ error: `Area not found: ${req.params.areaId}` });
      res.json({
        repository_mode: 'CANONICAL_POSTGRES',
        data_classification: 'CANONICAL_EVIDENCE_BACKED',
        area,
        route_families: await repo.listRouteFamilies(area.area_id),
        routes: await repo.listRoutes(area.area_id)
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/canonical/routes/:routeId', async (req, res) => {
    const pool = getPgPool();
    if (!pool) return unavailable(res);
    try {
      const repo = new CanonicalPostgresRepository(pool);
      const route = await repo.findRoute(req.params.routeId);
      if (!route) return res.status(404).json({ error: `Route not found: ${req.params.routeId}` });
      const [assignments, activities, dependencies, rawCount, actorCount] = await Promise.all([
        repo.listRawAssignments(route.route_id),
        repo.listActivityAssignments(route.route_id),
        repo.listDependenciesForEntity('route', route.route_id),
        repo.countIndependentAcceptedRawExecutions(route.route_id),
        repo.countIndependentAcceptedActors(route.route_id)
      ]);
      res.json({
        repository_mode: 'CANONICAL_POSTGRES',
        data_classification: 'CANONICAL_EVIDENCE_BACKED',
        route,
        raw_track_assignments: assignments,
        activity_assignments: activities,
        dependencies,
        geometry_consensus_readiness: {
          independent_recorded_raw_executions: rawCount,
          independent_first_party_actors: actorCount,
          default_threshold: 2,
          ready_for_editorial_review: rawCount >= 2 || actorCount >= 2,
          auto_promotion_allowed: false
        }
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/canonical/tracks', async (req: Request, res: Response) => {
    const pool = getPgPool();
    if (!pool) return unavailable(res);
    try {
      const body = req.body ?? {};
      const format = String(body.format ?? '').toUpperCase() as CanonicalTrackFormat;
      if (format !== 'GPX' && format !== 'KML') {
        return res.status(400).json({ error: 'Canonical track ingestion accepts GPX or KML only.' });
      }
      if (typeof body.payload !== 'string' || !body.payload.trim()) {
        return res.status(400).json({ error: 'payload must contain GPX/KML text.' });
      }

      const result = await ingestCanonicalRawTrack(pool, {
        format,
        payload: body.payload,
        fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
        sourceTrackId: typeof body.sourceTrackId === 'string' ? body.sourceTrackId : undefined,
        evidenceId: typeof body.evidenceId === 'string' ? body.evidenceId : undefined
      });
      res.status(result.duplicate ? 200 : 201).json({
        repository_mode: 'CANONICAL_POSTGRES',
        data_classification: 'RAW_TRACK_EVIDENCE',
        result,
        route_mutated: false
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  /**
   * Low-level editorial classification endpoint. TARGET_ACCEPTED is forbidden
   * here; target acceptance must be computed by the spatial geometry gate.
   */
  app.post('/api/canonical/routes/:routeId/raw-assignments', async (req, res) => {
    const pool = getPgPool();
    if (!pool) return unavailable(res);
    try {
      const body = req.body ?? {};
      const assignmentState = String(body.assignmentState ?? '') as CanonicalAssignmentState;
      const allowed: CanonicalAssignmentState[] = [
        'TARGET_REJECTED', 'SIBLING_ACCEPTED', 'CONTROL_ONLY', 'UNCLASSIFIED'
      ];
      if (assignmentState === 'TARGET_ACCEPTED') {
        return res.status(400).json({
          error: 'DIRECT_TARGET_ACCEPTED_DISABLED',
          message: 'Use /geometry-gate with a server-known profile; callers cannot force TARGET_ACCEPTED.'
        });
      }
      if (!allowed.includes(assignmentState)) {
        return res.status(400).json({ error: 'Invalid assignmentState.' });
      }
      if (typeof body.rawTrackId !== 'string' || typeof body.geometryGateState !== 'string') {
        return res.status(400).json({ error: 'rawTrackId and geometryGateState are required.' });
      }

      await assignCanonicalRawTrack(pool, {
        rawTrackId: body.rawTrackId,
        routeId: req.params.routeId,
        assignmentState,
        geometryGateState: body.geometryGateState,
        directionClass: typeof body.directionClass === 'string' ? body.directionClass : undefined,
        independentProvenanceKey: typeof body.independentProvenanceKey === 'string'
          ? body.independentProvenanceKey
          : undefined,
        qa: body.qa && typeof body.qa === 'object' ? body.qa : undefined
      });
      res.status(201).json({
        repository_mode: 'CANONICAL_POSTGRES',
        assignment_saved: true,
        route_mutated: false,
        canonical_track_created: false
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  /**
   * Spatial assignment endpoint. Clients may select only a server-known,
   * versioned profile. Arbitrary anchors are intentionally not accepted.
   */
  app.post('/api/canonical/routes/:routeId/geometry-gate', async (req, res) => {
    const pool = getPgPool();
    if (!pool) return unavailable(res);
    try {
      const body = req.body ?? {};
      if (typeof body.rawTrackId !== 'string' || typeof body.profileId !== 'string') {
        return res.status(400).json({ error: 'rawTrackId and profileId are required.' });
      }
      const profile = GEOMETRY_GATE_PROFILES[body.profileId];
      if (!profile) {
        return res.status(400).json({
          error: 'UNKNOWN_GEOMETRY_GATE_PROFILE',
          allowed_profile_ids: Object.keys(GEOMETRY_GATE_PROFILES)
        });
      }
      if (profile.routeId !== req.params.routeId) {
        return res.status(400).json({
          error: 'PROFILE_ROUTE_MISMATCH',
          profile_route_id: profile.routeId,
          requested_route_id: req.params.routeId
        });
      }

      const result = await evaluateAndAssignCanonicalRawTrack(pool, {
        rawTrackId: body.rawTrackId,
        routeId: req.params.routeId,
        profile,
        independentProvenanceKey: typeof body.independentProvenanceKey === 'string'
          ? body.independentProvenanceKey
          : undefined
      });
      res.status(200).json({
        repository_mode: 'CANONICAL_POSTGRES',
        data_classification: 'GEOMETRY_GATE_RESULT',
        result,
        route_mutated: false,
        canonical_track_created: false
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/canonical/activities', async (req, res) => {
    const pool = getPgPool();
    if (!pool) return unavailable(res);
    try {
      const body = req.body ?? {};
      if (typeof body.actorHash !== 'string' || typeof body.rawTrackId !== 'string' || typeof body.recordedAt !== 'string') {
        return res.status(400).json({ error: 'actorHash, rawTrackId and recordedAt are required.' });
      }
      const result = await recordFirstPartyActivity(pool, {
        actorHash: body.actorHash,
        rawTrackId: body.rawTrackId,
        recordedAt: body.recordedAt,
        routeId: typeof body.routeId === 'string' ? body.routeId : undefined,
        assignmentState: body.assignmentState,
        geometryGateState: body.geometryGateState,
        integrityState: body.integrityState,
        deviceClass: body.deviceClass,
        gpsAccuracyMedianM: body.gpsAccuracyMedianM,
        gpsAccuracyP90M: body.gpsAccuracyP90M,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined
      });
      res.status(result.created ? 201 : 200).json({
        repository_mode: 'CANONICAL_POSTGRES',
        data_classification: 'FIRST_PARTY_ACTIVITY_EVIDENCE',
        result,
        route_mutated: false,
        legality_mutated: false
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
}
