# National Hiking MVP

Evidence-first hiking route governance and recommendation backend with an AI Studio governance dashboard.

## Current status

- **Canonical persistence contract:** PostgreSQL/PostGIS migrations under `db/migrations/`
- **Canonical bootstrap seed:** `db/four_area_seed_manifest_v0_2.json`
- **Current API repository:** `MEMORY_UI_DEMO`
- **AI Studio demo fixtures:** `seed/ui_demo_manifest.json` (`UI_DEMO_ONLY`)
- **Live PostgreSQL API adapter:** not yet wired
- **Cloud SQL / paid deployment:** not authorized yet

## Non-negotiable invariants

- Track != Route
- no POI stitching to fabricate route geometry
- `PLANNED_NAVIGATION_LINE` is not Recorded GPS
- ambiguous geometry does not become execution evidence
- sibling Route evidence never counts toward target child Route consensus
- child-route public geometry consensus defaults to >=2 independent accepted Recorded GPS executions
- Unknown remains Unknown
- popularity never overrides Rule/Legal truth
- runtime facts require freshness and never become static truth
- protected-area route publication requires positive authorization
- Page Projection never mutates canonical truth

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

## Development

```bash
npm install
npm run lint
npm test
npm run build
npm run dev
```

## Database validation

Without `DATABASE_URL`, migration execution is `VALIDATED_ONLY`; no migration is reported as applied.

With a real PostgreSQL/PostGIS connection, `npm run migrate` can apply the canonical `db/migrations` chain and records migration checksums.

A reachable database does **not** make the current API database-backed. The API still uses the explicit memory/UI-demo repository until a canonical Postgres repository adapter is implemented and integration-tested.

## Reconciliation record

See `docs/CANONICAL_RECONCILIATION_V0.1.md` and GitHub Issue #1.
