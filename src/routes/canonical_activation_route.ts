import type { Express } from 'express';

/**
 * Compatibility shim retained while server.ts still imports this module.
 *
 * The canonical activation endpoint is registered exactly once by
 * registerCanonicalDbRoutes(). Keeping this function as a no-op avoids two
 * Express handlers for the same mutation path and makes the ownership explicit
 * until the route modules are reorganized in a later cleanup.
 */
export function registerCanonicalActivationRoute(_app: Express): void {
  // Intentionally empty: /api/canonical/routes/:routeId/canonical-track/activate
  // is owned by canonical_db_routes.ts.
}
