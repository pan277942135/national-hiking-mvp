import type { Express, Request, Response } from 'express';
import { getPgPool } from '../config/database.js';
import { authorizeCanonicalWrite } from '../security/canonical_write_auth.js';
import { activateCanonicalTrackFromAcceptedRaw } from '../services/canonical_track_activation_service.js';

function requireCanonicalWrite(req: Request, res: Response): boolean {
  const auth = authorizeCanonicalWrite(req.get('authorization'));
  if (auth.authorized) return true;
  const code = auth.code ?? 'CANONICAL_WRITE_UNAUTHORIZED';
  const status = code === 'CANONICAL_WRITES_DISABLED' ? 503 : 401;
  res.status(status).json({
    error: code,
    message: code === 'CANONICAL_WRITES_DISABLED'
      ? 'Canonical mutation APIs are disabled until CANONICAL_WRITE_TOKEN is configured.'
      : 'Canonical mutation APIs require a valid Bearer token.'
  });
  return false;
}

/**
 * Explicit editorial promotion route.
 *
 * This endpoint is intentionally separate from geometry-gate ingestion. It can
 * only copy one already accepted FULL_ROUTE_QA RawTrack after the conservative
 * FIRST_PARTY_PUBLIC consensus predicate is ready. The activation service
 * re-evaluates readiness inside a SERIALIZABLE transaction and never infers
 * legal clearance, runtime safety, or EXECUTABLE state.
 */
export function registerCanonicalActivationRoute(app: Express): void {
  app.post('/api/canonical/routes/:routeId/canonical-track/activate', async (req, res) => {
    if (!requireCanonicalWrite(req, res)) return;

    const pool = getPgPool();
    if (!pool) {
      return res.status(503).json({
        error: 'CANONICAL_POSTGRES_UNAVAILABLE',
        message: 'Canonical PostgreSQL/PostGIS repository is not configured for this runtime.'
      });
    }

    try {
      const body = req.body ?? {};
      if (typeof body.sourceRawTrackId !== 'string' || !body.sourceRawTrackId.trim()) {
        return res.status(400).json({ error: 'sourceRawTrackId is required.' });
      }
      if (typeof body.reviewerId !== 'string' || !body.reviewerId.trim()) {
        return res.status(400).json({ error: 'reviewerId is required.' });
      }
      if (typeof body.reviewNote !== 'string' || !body.reviewNote.trim()) {
        return res.status(400).json({ error: 'reviewNote is required as explicit editorial rationale.' });
      }

      const result = await activateCanonicalTrackFromAcceptedRaw(pool, {
        routeId: req.params.routeId,
        sourceRawTrackId: body.sourceRawTrackId,
        reviewerId: body.reviewerId,
        reviewNote: body.reviewNote,
        consensusMode: 'FIRST_PARTY_PUBLIC'
      });

      res.status(201).json({
        repository_mode: 'CANONICAL_POSTGRES',
        data_classification: 'EDITORIAL_CANONICAL_GEOMETRY_PROMOTION',
        result,
        canonical_track_created: true,
        geometry_derivation: result.geometryDerivation,
        route_state_after_activation: result.routeState,
        dependency_rows_resolved: result.dependencyRowsResolved,
        navigation_executable_inferred: false,
        legal_clearance_inferred: false,
        runtime_safety_inferred: false
      });
    } catch (error) {
      const pgCode = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
      if (pgCode === '40001') {
        return res.status(409).json({
          error: 'SERIALIZATION_RETRY_REQUIRED',
          message: 'Evidence changed concurrently while canonicalization was being evaluated. Re-read readiness and retry the editorial action.'
        });
      }

      const message = (error as Error).message;
      const notFound = message.startsWith('Route not found:');
      const notReady = message.startsWith('Geometry consensus is not ready');
      const alreadyActive = message.includes('already has active CanonicalTrack');
      res.status(notFound ? 404 : notReady || alreadyActive ? 409 : 400).json({ error: message });
    }
  });
}
