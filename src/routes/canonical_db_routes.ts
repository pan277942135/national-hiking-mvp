import type { Express, Request, Response } from 'express';
import { getPgPool } from '../config/database.js';
import { CanonicalPostgresRepository } from '../repository/postgres/canonical_postgres.js';
import {
  assignCanonicalRawTrack,
  ingestCanonicalRawTrack,
  type CanonicalAssignmentState,
  type CanonicalTrackFormat
} from '../services/canonical_track_ingest_service.js';
import { evaluateAndAssignCanonicalRawTrack } from '../services/geometry_gate_service.js';
import {
  getRegisteredGeometryGateProfile,
  listRegisteredGeometryGateProfiles
} from '../services/geometry_gate_profile_registry.js';
import { evaluateGeometryConsensusReadiness } from '../services/geometry_consensus_service.js';
import { recordFirstPartyActivity } from '../services/first_party_activity_service.js';
import { buildCanonicalRoutePageProjection } from '../services/canonical_page_projection_service.js';
import { authorizeCanonicalWrite } from '../security/canonical_write_auth.js';

function unavailable(res: Response) {
  return res.status(503).json({
    error: 'CANONICAL_POSTGRES_UNAVAILABLE',
    message: 'Canonical PostgreSQL/PostGIS repository is not configured for this runtime.'
  });
}

function requireCanonicalWrite(req: Request, res: Response): boolean {
  const auth = authorizeCanonicalWrite(req.get('authorization'));
  if (auth.authorized) return true;

  const status = auth.code === 'CANONICAL_WRITES_DISABLED' ? 503 : 401;
  res.status(status).json({
    error: auth.code,
    message: auth.code === 'CANONICAL_WRITES_DISABLED'
      ? 'Canonical mutation APIs are disabled until CANONICAL_WRITE_TOKEN is configured.'
      : 'Canonical mutation APIs require a valid Bearer token.'
  });
  return false;
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

      const routeEvidence = await Promise.all(routes.map(async route => {
        const [rawCount, actorCount, readiness] = await Promise.all([
          repo.countIndependentAcceptedRawExecutions(route.route_id),
          repo.countIndependentAcceptedActors(route.route_id),
          evaluateGeometryConsensusReadiness(pool, route.route_id)
        ]);
        return {
          route_id: route.route_id,
          route_state: route.route_state,
          active_canonical_track_id: route.active_canonical_track_id,
          accepted_raw_execution_count: rawCount,
          accepted_first_party_actor_count: actorCount,
          geometry_consensus_state: readiness.state,
          ready_for_editorial_canonicalization:
            readiness.state === 'READY_FOR_EDITORIAL_CANONICALIZATION'
        };
      }));

      res.json({
        repository_mode: 'CANONICAL_POSTGRES',
        data_classification: 'CANONICAL_EVIDENCE_BACKED',
        migrations,
        areas,
        route_families: families,
        routes,
        route_evidence: routeEvidence,
        geometry_gate_profiles: listRegisteredGeometryGateProfiles().map(profile => ({
          profile_id: profile.profileId,
          route_id: profile.routeId,
          purpose: profile.purpose,
          profile_version: profile.profileVersion,
          target_acceptance_capable: profile.targetAcceptanceCapable
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
      const [assignments, activities, dependencies, readiness, pageProjection] = await Promise.all([
        repo.listRawAssignments(route.route_id),
        repo.listActivityAssignments(route.route_id),
        repo.listDependenciesForEntity('route', route.route_id),
        evaluateGeometryConsensusReadiness(pool, route.route_id),
        buildCanonicalRoutePageProjection(pool, route.route_id)
      ]);
      res.json({
        repository_mode: 'CANONICAL_POSTGRES',
        data_classification: 'CANONICAL_EVIDENCE_BACKED',
        route,
        raw_track_assignments: assignments,
        activity_assignments: activities,
        dependencies,
        page_projection: pageProjection,
        geometry_consensus_readiness: readiness
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/canonical/routes/:routeId/geometry-consensus-readiness', async (req, res) => {
    const pool = getPgPool();
    if (!pool) return unavailable(res);
    try {
      const readiness = await evaluateGeometryConsensusReadiness(pool, req.params.routeId);
      res.json({
        repository_mode: 'CANONICAL_POSTGRES',
        data_classification: 'GEOMETRY_CONSENSUS_READINESS',
        ...readiness
      });
    } catch (error) {
      const message = (error as Error).message;
      res.status(message.startsWith('Route not found:') ? 404 : 500).json({ error: message });
    }
  });

  app.get('/api/canonical/routes/:routeId/page-projection', async (req, res) => {
    const pool = getPgPool();
    if (!pool) return unavailable(res);
    try {
      const projection = await buildCanonicalRoutePageProjection(pool, req.params.routeId);
      res.json(projection);
    } catch (error) {
      const message = (error as Error).message;
      res.status(message.startsWith('Route not found:') ? 404 : 500).json({ error: message });
    }
  });

  app.get('/api/canonical/geometry-gate-profiles', (_req, res) => {
    res.json({
      policy: 'SERVER_OWNED_PROFILES_ONLY',
      arbitrary_client_profiles_allowed: false,
      profiles: listRegisteredGeometryGateProfiles()
    });
  });

  app.post('/api/canonical/tracks', async (req: Request, res: Response) => {
    if (!requireCanonicalWrite(req, res)) return;
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
    if (!requireCanonicalWrite(req, res)) return;
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
          message: 'Use /geometry-gate with a server-known FULL_ROUTE_QA profile; callers cannot force TARGET_ACCEPTED.'
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
   * Spatial assignment endpoint. Clients may select only a server-owned,
   * versioned profile. Arbitrary anchors are intentionally not accepted.
   */
  app.post('/api/canonical/routes/:routeId/geometry-gate', async (req, res) => {
    if (!requireCanonicalWrite(req, res)) return;
    const pool = getPgPool();
    if (!pool) return unavailable(res);
    try {
      const body = req.body ?? {};
      if (typeof body.rawTrackId !== 'string' || typeof body.profileId !== 'string') {
        return res.status(400).json({ error: 'rawTrackId and profileId are required.' });
      }
      const profile = getRegisteredGeometryGateProfile(body.profileId);
      if (!profile) {
        return res.status(400).json({
          error: 'UNKNOWN_GEOMETRY_GATE_PROFILE',
          allowed_profile_ids: listRegisteredGeometryGateProfiles().map(p => p.profileId)
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
    if (!requireCanonicalWrite(req, res)) return;
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
