/**
 * National Hiking Backend MVP Server.
 *
 * The presentation UI continues to use MEMORY_UI_DEMO. A separate
 * /api/canonical/* namespace is backed by the canonical PostgreSQL/PostGIS
 * repository when DATABASE_URL/PGHOST is configured. This separation prevents
 * demo fixtures from being mistaken for canonical truth.
 */

import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createMemoryRepositories } from './src/repository/repositories.js';
import { loadSeedManifest } from './seed/seed_loader.js';
import { checkDatabaseConnection } from './src/config/database.js';
import { loadAndValidateMigrations } from './src/migration_runner.js';
import { processTrackUpload } from './src/services/track_service.js';
import { evaluateRouteEligibility } from './src/services/eligibility_service.js';
import { createRuntimeSnapshot } from './src/services/runtime_snapshot_service.js';
import { projectRoutePage } from './src/services/page_projection_service.js';
import { registerCanonicalDbRoutes } from './src/routes/canonical_db_routes.js';
import { registerCanonicalActivationRoute } from './src/routes/canonical_activation_route.js';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '20mb' }));
  app.use(express.text({
    limit: '20mb',
    type: ['application/xml', 'text/xml', 'application/gpx+xml', 'application/vnd.google-earth.kml+xml']
  }));

  // Canonical DB routes are isolated from the demo UI namespace. When no DB is
  // configured they return 503 rather than silently falling back to demo data.
  registerCanonicalDbRoutes(app);
  // Canonical geometry activation is an explicit, token-protected editorial
  // action and is kept separate from ingestion/gating endpoints.
  registerCanonicalActivationRoute(app);

  const { repos } = createMemoryRepositories();
  const seedResult = await loadSeedManifest(repos);
  console.log(
    `[BOOTSTRAP] ${seedResult.dataClassification}: ${seedResult.areasCount} demo areas, ${seedResult.routesCount} demo routes.`
  );

  app.get('/health', async (_req, res) => {
    const dbStatus = await checkDatabaseConnection();
    const migrationValidation = loadAndValidateMigrations();
    const areas = await repos.areas.listAll();
    const routes = await repos.routes.listAll();

    res.json({
      status: 'ok',
      service: 'National Hiking Backend MVP',
      presentation_repository: {
        mode: 'MEMORY_UI_DEMO',
        data_classification: seedResult.dataClassification,
        canonical_database_backed: false,
        note: 'Default presentation endpoints remain isolated synthetic/demo data.'
      },
      canonical_repository: {
        namespace: '/api/canonical/*',
        mode: dbStatus.connected ? 'CANONICAL_POSTGRES' : 'UNAVAILABLE',
        configured_and_reachable: dbStatus.connected,
        postgis_detected: dbStatus.isPostgis ?? false,
        note: dbStatus.connected
          ? 'Canonical namespace reads/writes PostgreSQL/PostGIS only; it never falls back to demo fixtures.'
          : 'Configure PostgreSQL/PostGIS to enable canonical endpoints.'
      },
      external_postgresql: {
        configured_and_reachable: dbStatus.connected,
        message: dbStatus.message,
        postgis_detected: dbStatus.isPostgis ?? false
      },
      migrations: {
        source: 'db/migrations',
        total: migrationValidation.migrationsFound.length,
        valid: migrationValidation.valid,
        invariantsVerified: migrationValidation.invariantsVerified
      },
      entities_loaded: {
        demo_areas_count: areas.length,
        demo_routes_count: routes.length
      },
      timestamp: new Date().toISOString()
    });
  });

  app.get('/areas', async (_req, res) => {
    try {
      const areas = await repos.areas.listAll();
      const enriched = await Promise.all(areas.map(async area => ({
        ...area,
        families_count: (await repos.routeFamilies.findByAreaId(area.id)).length,
        legal_scopes_count: (await repos.legalScopes.findByAreaId(area.id)).length,
        rules_count: (await repos.rules.findByAreaId(area.id)).length
      })));
      res.json({ data_classification: seedResult.dataClassification, areas: enriched });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/overview', async (_req, res) => {
    try {
      const areas = await repos.areas.listAll();
      const families = await repos.routeFamilies.listAll();
      const routes = await repos.routes.listAll();
      const tracks = await repos.rawTracks.listAll();
      const assignments = await repos.assignments.listAll();
      const scopes = await repos.legalScopes.listAll();
      const rules = await repos.rules.listAll();
      const migrationValidation = loadAndValidateMigrations();
      const dbStatus = await checkDatabaseConnection();

      const routesWithGate = await Promise.all(routes.map(async route => {
        const gate = await evaluateRouteEligibility(repos, { routeId: route.id });
        const projection = await projectRoutePage(repos, route.id);
        const routeAssignments = assignments.filter(a => a.route_id === route.id);
        return {
          ...route,
          gateResult: gate.gateResult,
          page_projection: projection,
          assignments_count: routeAssignments.length,
          accepted_tracks_count: routeAssignments.filter(a => a.match_status === 'ACCEPTED').length,
          rejected_tracks_count: routeAssignments.filter(a => a.match_status === 'REJECTED').length
        };
      }));

      res.json({
        service: 'National Hiking Governance Registry',
        repository_mode: 'MEMORY_UI_DEMO',
        data_classification: seedResult.dataClassification,
        warning: 'Synthetic demo records are not production Evidence/RawTrack/Rule truth.',
        canonical_seed: 'db/four_area_seed_manifest_v0_2.json',
        canonical_api: {
          namespace: '/api/canonical/*',
          available: dbStatus.connected,
          mode: dbStatus.connected ? 'CANONICAL_POSTGRES' : 'UNAVAILABLE'
        },
        areas,
        families,
        routes: routesWithGate,
        tracks,
        assignments,
        legal_scopes: scopes,
        rules,
        migrations: {
          source: 'db/migrations',
          total: migrationValidation.migrationsFound.length,
          valid: migrationValidation.valid,
          invariants: migrationValidation.invariantsVerified
        },
        timestamp: new Date().toISOString()
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/areas/:areaId', async (req, res) => {
    try {
      const area = (await repos.areas.findById(req.params.areaId)) ||
                   (await repos.areas.findBySlug(req.params.areaId));
      if (!area) return res.status(404).json({ error: `Area not found: ${req.params.areaId}` });

      res.json({
        data_classification: seedResult.dataClassification,
        area,
        route_families: await repos.routeFamilies.findByAreaId(area.id),
        legal_scopes: await repos.legalScopes.findByAreaId(area.id),
        rules: await repos.rules.findByAreaId(area.id)
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/areas/:areaId/routes', async (req, res) => {
    try {
      const area = (await repos.areas.findById(req.params.areaId)) ||
                   (await repos.areas.findBySlug(req.params.areaId));
      if (!area) return res.status(404).json({ error: `Area not found: ${req.params.areaId}` });

      const families = await repos.routeFamilies.findByAreaId(area.id);
      const familyIds = new Set(families.map(f => f.id));
      const areaRoutes = (await repos.routes.listAll()).filter(r => familyIds.has(r.family_id));
      const projected = await Promise.all(areaRoutes.map(r => projectRoutePage(repos, r.id)));

      res.json({
        data_classification: seedResult.dataClassification,
        area_id: area.id,
        area_name: area.name,
        routes_count: projected.length,
        routes: projected
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/routes/:routeId', async (req, res) => {
    try {
      const route = (await repos.routes.findById(req.params.routeId)) ||
                    (await repos.routes.findByVariantCode(req.params.routeId));
      if (!route) return res.status(404).json({ error: `Route not found: ${req.params.routeId}` });

      res.json({
        data_classification: seedResult.dataClassification,
        route,
        family: await repos.routeFamilies.findById(route.family_id),
        assigned_tracks: await repos.assignments.findByRouteId(route.id),
        page_projection: await projectRoutePage(repos, route.id)
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/routes/:routeId/eligibility', async (req, res) => {
    try {
      const route = (await repos.routes.findById(req.params.routeId)) ||
                    (await repos.routes.findByVariantCode(req.params.routeId));
      if (!route) return res.status(404).json({ error: `Route not found: ${req.params.routeId}` });

      const result = await evaluateRouteEligibility(repos, {
        routeId: route.id,
        userHasPositiveAuth: req.query.has_auth === 'true'
      });
      res.json({ data_classification: seedResult.dataClassification, ...result });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/tracks', async (req, res) => {
    try {
      let payload = '';
      let format: 'GPX' | 'KML' = 'GPX';
      let fileName = 'uploaded_track.gpx';

      if (typeof req.body === 'string') {
        payload = req.body;
        format = /<kml\b/i.test(payload) ? 'KML' : 'GPX';
        fileName = format === 'KML' ? 'uploaded_track.kml' : fileName;
      } else if (req.body && typeof req.body === 'object' && typeof req.body.payload === 'string') {
        const requested = String(req.body.format || 'GPX').toUpperCase();
        if (requested !== 'GPX' && requested !== 'KML') {
          return res.status(400).json({
            error: `Unsupported canonical track format: ${requested}. Only GPX and KML are accepted.`
          });
        }
        format = requested;
        payload = req.body.payload;
        fileName = req.body.fileName || (format === 'KML' ? 'uploaded_track.kml' : fileName);
      } else {
        return res.status(400).json({
          error: 'Track upload requires a GPX/KML payload. Arbitrary JSON/GeoJSON is not a canonical RawTrack upload.'
        });
      }

      if (!payload.trim()) return res.status(400).json({ error: 'Empty track payload' });

      const result = await processTrackUpload(repos, { payload, format, fileName });
      res.status(result.isDuplicate ? 200 : 201).json({
        data_classification: 'SESSION_UPLOAD',
        ...result
      });
    } catch (err: unknown) {
      const message = (err as Error).message;
      const status = /Unsupported canonical track format|Empty track payload/.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/runtime-snapshots', async (req, res) => {
    try {
      const {
        areaId, routeId, observedAt, validUntil, hazardLevel, trailStatus,
        weatherSummary, temperatureCelsius, windSpeedKmh, visibilityMeters,
        sourceName, snapshotPayload
      } = req.body || {};

      if (!areaId || !observedAt || !validUntil || !sourceName) {
        return res.status(400).json({
          error: 'Missing required fields: areaId, observedAt, validUntil, and sourceName are mandatory.'
        });
      }

      const snapshot = await createRuntimeSnapshot(repos, {
        areaId, routeId, observedAt, validUntil, hazardLevel, trailStatus,
        weatherSummary, temperatureCelsius, windSpeedKmh, visibilityMeters,
        sourceName, snapshotPayload
      });

      res.status(201).json({
        success: true,
        data_classification: 'SESSION_RUNTIME_OBSERVATION',
        snapshot
      });
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`National Hiking Backend running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
