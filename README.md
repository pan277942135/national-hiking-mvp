# National Hiking MVP

Evidence-first hiking route governance and recommendation backend with an AI Studio governance dashboard.

## Current status

- **Canonical persistence contract:** PostgreSQL/PostGIS migrations under `db/migrations/`
- **Canonical bootstrap seed:** `db/four_area_seed_manifest_v0_2.json`
- **Presentation API/UI repository:** `MEMORY_UI_DEMO`
- **AI Studio demo fixtures:** `seed/ui_demo_manifest.json` (`UI_DEMO_ONLY`)
- **Canonical API namespace:** `/api/canonical/*` backed only by PostgreSQL/PostGIS; never falls back to demo fixtures
- **Canonical write policy:** fail-closed; mutation endpoints require `CANONICAL_WRITE_TOKEN`
- **Canonical geometry promotion:** explicit editorial action only after FULL_ROUTE_QA + consensus readiness
- **Cloud SQL / paid deployment:** not authorized; CI uses an ephemeral PostGIS service container

The presentation layer and canonical database layer intentionally coexist during migration. `/api/overview` remains demo/presentation data; `/api/canonical/*` is the evidence-backed database namespace when PostgreSQL/PostGIS is configured.

## Non-negotiable invariants

- Track != Route
- no POI stitching to fabricate route geometry
- `PLANNED_NAVIGATION_LINE` is not Recorded GPS
- ambiguous geometry does not become execution evidence
- sibling Route evidence never counts toward target child Route consensus
- child-route public geometry consensus defaults to >=2 independent accepted Recorded GPS executions
- conservative public first-party consensus also requires >=2 distinct actor hashes
- CORE_QA is diagnostic only; only a server-approved `FULL_ROUTE_QA` profile may derive `TARGET_ACCEPTED`
- callers cannot directly force `TARGET_ACCEPTED`
- geometry consensus readiness never auto-promotes a Route or creates `CanonicalTrack`
- explicit canonicalization copies one editor-selected accepted RawTrack exactly; it does not average/stitch a new line
- geometry approval does not infer legal clearance, runtime safety, or `EXECUTABLE`
- Unknown remains Unknown
- popularity never overrides Rule/Legal truth
- runtime facts require freshness and never become static truth
- protected-area route publication requires positive authorization
- Page Projection never mutates canonical truth

### S12-A safety boundary

`ZJ-S12-A` may have canonical identity while geometry remains blocked. Its historical A01→A03 anchor profile is `CORE_QA`, not a full 下马坊→流徽榭 acceptance profile. There is currently no production/server-registered `FULL_ROUTE_QA` profile for S12-A, so the public canonicalization pipeline cannot promote it from core-only evidence.

## Canonical DB migration chain

1. `0001_extensions_enums.sql`
2. `0002_core_entities.sql`
3. `0003_evidence_promotion.sql`
4. `0004_route_track.sql`
5. `0005_legal_rule_protected.sql`
6. `0006_runtime_overnight.sql`
7. `0007_gate_projection.sql`
8. `0008_indexes_constraints.sql`
9. `0009_routefamily_variant_geometry.sql`
10. `0010_first_party_activity.sql`

The root-level `migrations/` directory is a legacy AI Studio draft and is not authoritative.

## Canonical geometry pipeline

```text
GPX/KML
  -> RawTrack + SHA256/provenance
  -> server-owned GeometryGateProfile
  -> FULL_ROUTE_QA TARGET_ACCEPTED only when spatial gate passes
  -> First-party Activity linked to the persisted RawTrack gate truth
  -> Geometry consensus readiness
       - >=2 independent executions
       - >=2 distinct actors (FIRST_PARTY_PUBLIC default)
       - pairwise geometry compatibility
  -> READY_FOR_EDITORIAL_CANONICALIZATION
  -> explicit token-protected editorial activation
  -> exact accepted RawTrack copied to CanonicalTrack
  -> Route becomes at most STATIC_PUBLISHABLE from geometry approval alone
```

Readiness and activation are separate by design. Activation re-evaluates consensus inside a PostgreSQL `SERIALIZABLE` transaction to avoid a stale time-of-check/time-of-use promotion.

## Canonical API

Read endpoints require PostgreSQL/PostGIS but do not require the write token:

- `GET /api/canonical/overview`
- `GET /api/canonical/areas/:areaId`
- `GET /api/canonical/routes/:routeId`
- `GET /api/canonical/routes/:routeId/page-projection`
- `GET /api/canonical/routes/:routeId/geometry-consensus-readiness`
- `GET /api/canonical/geometry-gate-profiles`

Mutation endpoints require `Authorization: Bearer <CANONICAL_WRITE_TOKEN>` and fail closed when the token is not configured:

- `POST /api/canonical/tracks`
- `POST /api/canonical/routes/:routeId/raw-assignments` — cannot set `TARGET_ACCEPTED`
- `POST /api/canonical/routes/:routeId/geometry-gate` — server-owned profiles only
- `POST /api/canonical/activities`
- `POST /api/canonical/routes/:routeId/canonical-track-activation` — explicit editorial promotion only

## Development

```bash
npm install
npm run lint
npm test
npm run build
npm run dev
```

For the complete database-backed regression suite, provide a PostgreSQL/PostGIS database and run:

```bash
npm run test:db
```

GitHub Actions automatically provisions `postgis/postgis:16-3.5`, runs the canonical migration chain and seed replay, executes the deterministic and PostGIS regression suites, then runs the production build.

## Database validation

Without `DATABASE_URL`/`PGHOST`, migration execution is `VALIDATED_ONLY`; no migration is reported as applied.

With a real PostgreSQL/PostGIS connection, `npm run migrate` applies the canonical `db/migrations` chain and records migration checksums. `npm run seed:db` loads the evidence-backed four-area bootstrap seed while quarantining runtime-only facts.

Database connectivity does **not** cause the presentation endpoints to switch repositories. The canonical database is exposed only through the explicit `/api/canonical/*` namespace; the legacy AI Studio dashboard remains `MEMORY_UI_DEMO` until a deliberate UI/read-model cutover.

## Reconciliation record

See `docs/CANONICAL_RECONCILIATION_V0.1.md` and GitHub Issue #1.
