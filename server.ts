/**
 * National Hiking Backend MVP Server
 * Implements core API endpoints and invariants.
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createMemoryRepositories } from './src/repository/repositories.js';
import { loadSeedManifest } from './seed/seed_loader.js';
import { checkDatabaseConnection } from './src/config/database.js';
import { loadAndValidateMigrations } from './src/migration_runner.js';
import { processTrackUpload } from './src/services/track_service.js';
import { evaluateRouteEligibility } from './src/services/eligibility_service.js';
import { createRuntimeSnapshot } from './src/services/runtime_snapshot_service.js';
import { projectRoutePage } from './src/services/page_projection_service.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '20mb' }));
  app.use(express.text({ limit: '20mb', type: ['application/xml', 'text/xml', 'application/gpx+xml'] }));

  // Initialize in-memory repository store and seed data
  const { repos } = createMemoryRepositories();
  const seedResult = await loadSeedManifest(repos);
  console.log(`[BOOTSTRAP] Seed manifest loaded: ${seedResult.areasCount} areas, ${seedResult.routesCount} routes.`);

  // -------------------------------------------------------------
  // API ROUTES FIRST
  // -------------------------------------------------------------

  // GET /health
  app.get('/health', async (req, res) => {
    const dbStatus = await checkDatabaseConnection();
    const migrationValidation = loadAndValidateMigrations();
    const areas = await repos.areas.listAll();
    const routes = await repos.routes.listAll();

    res.json({
      status: 'ok',
      service: 'National Hiking Backend MVP',
      database: {
        mode: dbStatus.connected ? 'POSTGRESQL_POSTGIS' : 'STRUCTURED_MEMORY_ADAPTER',
        connected: dbStatus.connected,
        message: dbStatus.message
      },
      migrations: {
        total: 10,
        valid: migrationValidation.valid,
        invariantsVerified: migrationValidation.invariantsVerified
      },
      entities_loaded: {
        areas_count: areas.length,
        routes_count: routes.length
      },
      timestamp: new Date().toISOString()
    });
  });

  // GET /areas
  app.get('/areas', async (req, res) => {
    try {
      const areas = await repos.areas.listAll();
      const enriched = await Promise.all(
        areas.map(async area => {
          const families = await repos.routeFamilies.findByAreaId(area.id);
          const legalScopes = await repos.legalScopes.findByAreaId(area.id);
          const rules = await repos.rules.findByAreaId(area.id);
          return {
            ...area,
            families_count: families.length,
            legal_scopes_count: legalScopes.length,
            rules_count: rules.length
          };
        })
      );
      res.json({ areas: enriched });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/overview
  app.get('/api/overview', async (req, res) => {
    try {
      const areas = await repos.areas.listAll();
      const families = await repos.routeFamilies.listAll();
      const routes = await repos.routes.listAll();
      const tracks = await repos.rawTracks.listAll();
      const assignments = await repos.assignments.listAll();
      const scopes = await repos.legalScopes.listAll();
      const rules = await repos.rules.listAll();
      const migrationValidation = loadAndValidateMigrations();

      const routesWithGate = await Promise.all(
        routes.map(async r => {
          const gate = await evaluateRouteEligibility(repos, { routeId: r.id });
          const projection = await projectRoutePage(repos, r.id);
          const routeAssignments = assignments.filter(a => a.route_id === r.id);
          return {
            ...r,
            gateResult: gate.gateResult,
            page_projection: projection,
            assignments_count: routeAssignments.length,
            accepted_tracks_count: routeAssignments.filter(a => a.match_status === 'ACCEPTED').length,
            rejected_tracks_count: routeAssignments.filter(a => a.match_status === 'REJECTED').length
          };
        })
      );

      res.json({
        service: 'National Hiking Governance Registry',
        areas,
        families,
        routes: routesWithGate,
        tracks,
        assignments,
        legal_scopes: scopes,
        rules,
        migrations: {
          total: 10,
          valid: migrationValidation.valid,
          invariants: migrationValidation.invariantsVerified
        },
        timestamp: new Date().toISOString()
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /areas/:areaId
  app.get('/areas/:areaId', async (req, res) => {
    try {
      const area = (await repos.areas.findById(req.params.areaId)) || (await repos.areas.findBySlug(req.params.areaId));
      if (!area) {
        return res.status(404).json({ error: `Area not found: ${req.params.areaId}` });
      }

      const families = await repos.routeFamilies.findByAreaId(area.id);
      const legalScopes = await repos.legalScopes.findByAreaId(area.id);
      const rules = await repos.rules.findByAreaId(area.id);

      res.json({
        area,
        route_families: families,
        legal_scopes: legalScopes,
        rules
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /areas/:areaId/routes
  app.get('/areas/:areaId/routes', async (req, res) => {
    try {
      const area = (await repos.areas.findById(req.params.areaId)) || (await repos.areas.findBySlug(req.params.areaId));
      if (!area) {
        return res.status(404).json({ error: `Area not found: ${req.params.areaId}` });
      }

      const families = await repos.routeFamilies.findByAreaId(area.id);
      const familyIds = new Set(families.map(f => f.id));
      const allRoutes = await repos.routes.listAll();
      const areaRoutes = allRoutes.filter(r => familyIds.has(r.family_id));

      const enrichedRoutes = await Promise.all(
        areaRoutes.map(async r => {
          const projection = await projectRoutePage(repos, r.id);
          return projection;
        })
      );

      res.json({
        area_id: area.id,
        area_name: area.name,
        routes_count: enrichedRoutes.length,
        routes: enrichedRoutes
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /routes/:routeId
  app.get('/routes/:routeId', async (req, res) => {
    try {
      const route = (await repos.routes.findById(req.params.routeId)) ||
                    (await repos.routes.findByVariantCode(req.params.routeId));
      if (!route) {
        return res.status(404).json({ error: `Route not found: ${req.params.routeId}` });
      }

      const family = await repos.routeFamilies.findById(route.family_id);
      const assignments = await repos.assignments.findByRouteId(route.id);
      const projection = await projectRoutePage(repos, route.id);

      res.json({
        route,
        family,
        assigned_tracks: assignments,
        page_projection: projection
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /routes/:routeId/eligibility
  app.get('/routes/:routeId/eligibility', async (req, res) => {
    try {
      const route = (await repos.routes.findById(req.params.routeId)) ||
                    (await repos.routes.findByVariantCode(req.params.routeId));
      if (!route) {
        return res.status(404).json({ error: `Route not found: ${req.params.routeId}` });
      }

      const userHasPositiveAuth = req.query.has_auth === 'true';
      const result = await evaluateRouteEligibility(repos, {
        routeId: route.id,
        userHasPositiveAuth
      });

      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /tracks
  // Accepts GPX/KML/GeoJSON, computes SHA256, deduplicates, classifies provenance, creates RawTrack ONLY.
  // NEVER automatically creates or promotes a Route.
  app.post('/tracks', async (req, res) => {
    try {
      let payload = '';
      let format: 'GPX' | 'KML' | 'GEOJSON' | 'FIT' = 'GPX';
      let fileName = 'uploaded_track.gpx';

      if (typeof req.body === 'string') {
        payload = req.body;
        if (payload.includes('<kml')) format = 'KML';
        else if (payload.startsWith('{')) format = 'GEOJSON';
      } else if (req.body && typeof req.body === 'object') {
        if (req.body.payload) {
          payload = req.body.payload;
          format = req.body.format || 'GPX';
          fileName = req.body.fileName || fileName;
        } else {
          payload = JSON.stringify(req.body);
          format = 'GEOJSON';
        }
      }

      if (!payload || payload.trim().length === 0) {
        return res.status(400).json({ error: 'Empty track payload' });
      }

      const result = await processTrackUpload(repos, {
        payload,
        format,
        fileName
      });

      res.status(result.isDuplicate ? 200 : 201).json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /runtime-snapshots
  app.post('/runtime-snapshots', async (req, res) => {
    try {
      const {
        areaId,
        routeId,
        observedAt,
        validUntil,
        hazardLevel,
        trailStatus,
        weatherSummary,
        temperatureCelsius,
        windSpeedKmh,
        visibilityMeters,
        sourceName,
        snapshotPayload
      } = req.body;

      if (!areaId || !observedAt || !validUntil || !sourceName) {
        return res.status(400).json({
          error: 'Missing required fields: areaId, observedAt, validUntil, and sourceName are mandatory.'
        });
      }

      const snapshot = await createRuntimeSnapshot(repos, {
        areaId,
        routeId,
        observedAt,
        validUntil,
        hazardLevel,
        trailStatus,
        weatherSummary,
        temperatureCelsius,
        windSpeedKmh,
        visibilityMeters,
        sourceName,
        snapshotPayload
      });

      res.status(201).json({
        success: true,
        snapshot
      });
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // -------------------------------------------------------------
  // Vite Middleware / Static Asset Serving
  // -------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`National Hiking Backend running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
