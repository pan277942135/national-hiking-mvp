# Canonical Reconciliation V0.1

## Purpose

AI Studio produced a useful React/Express governance dashboard, but its initial backend persistence model diverged from the frozen National Hiking canonical contract. This branch reconciles the prototype without discarding useful UI work.

## Authoritative layers

### Canonical PostgreSQL/PostGIS persistence

Source of truth:

`db/migrations/0001_extensions_enums.sql` through `db/migrations/0010_first_party_activity.sql`

These migrations preserve the validated model for:

- Area / ManagedComponent / POI / AccessPoint / Parking
- Evidence / EvidenceClaim / versioned FieldValue / Dependency
- RouteFamily / child Route / RawTrack / CanonicalTrack / RouteSegment
- child-specific RawTrackRouteAssignment and geometry acquisition attempts
- LegalAuthority / LegalScope / ProtectedAreaZone / Rule
- designated activity and overnight entities
- RuntimeSnapshot
- PublicationGateResult / PageProjection state
- first-party Activity using `actor_hash`

### Canonical production/evidence bootstrap seed

`db/four_area_seed_manifest_v0_2.json`

It intentionally preserves Unknown, External Dependency and Runtime-Only states instead of filling gaps with synthetic values.

### AI Studio memory/UI demo

`seed/ui_demo_manifest.json`

Classification: `UI_DEMO_ONLY`.

This file contains synthetic records used to exercise UI and gate behavior. It must never be imported as production Evidence, RawTrack consensus, current Rule truth or current runtime truth. In particular, `track_zj_sibling_b_gps` is synthetic; no genuine ZJ-S12-B Recorded GPS execution has been supplied and validated.

## Reconciliation fixes

1. Restored the canonical migration chain under `db/migrations` and made the migration runner validate only that chain.
2. Dry-run migration mode reports `VALIDATED_ONLY` with `applied: []`; it cannot masquerade as live PostgreSQL execution.
3. Added checksum-drift detection for already-applied live migrations.
4. Restricted canonical RawTrack ingestion to GPX/KML.
5. Untimestamped GPX geometry remains `GEOMETRY_LINE_UNKNOWN`; it is not auto-promoted to execution evidence.
6. Planned KML LineString remains `PLANNED_NAVIGATION_LINE` / control evidence.
7. Fixed the planned-line invariant, whose prior condition was unreachable.
8. Removed route-name/ID heuristics for protected-area legality. Legal blocking requires explicit Rule/LegalScope evidence.
9. Sibling-route assignments never contribute to target child Route consensus.
10. Canonical static Page Projection exposes distance/elevation/navigation only from an active approved CanonicalTrack.
11. Added an actual PostgreSQL/PostGIS repository adapter and live CI replay against `postgis/postgis:16-3.5`.
12. Added `/api/canonical/*`, which reads canonical PostgreSQL/PostGIS truth only and never falls back to demo fixtures.
13. Canonical mutation APIs fail closed and require `CANONICAL_WRITE_TOKEN`.
14. Added deterministic PostGIS GeometryGate profiles. Callers cannot directly force `TARGET_ACCEPTED`.
15. `CORE_QA` is diagnostic only; only `FULL_ROUTE_QA` is target-acceptance capable.
16. First-party Activity route assignment must agree with the persisted RawTrack geometry gate and cannot manufacture acceptance.
17. Public consensus readiness defaults to >=2 independent accepted FULL_ROUTE_QA Recorded GPS executions and >=2 distinct first-party actor hashes.
18. Consensus additionally requires pairwise geometry compatibility; anchor agreement alone is insufficient.
19. Consensus readiness is review-only and never auto-creates CanonicalTrack.
20. Explicit editorial activation copies one accepted RawTrack exactly without route averaging/stitching, and geometry approval alone can produce at most `STATIC_PUBLISHABLE`.
21. Editorial activation re-evaluates consensus inside a PostgreSQL `SERIALIZABLE` transaction to remove the readiness/activation TOCTOU window.
22. Added the evidence-backed S12 QA fixture with measured anchor distances for 42160328, 45517618 and 52046317 plus the planned control line.

## ZJ-S12-A frozen state

`ZJ-S12-A = 下马坊驿站 → 民国邮政博物馆 → 南京地震科学馆 → 流徽榭`

- identity: `CANONICAL`
- geometry: `GEOMETRY_BLOCKED / EXTERNAL_DEPENDENCY`
- accepted production Recorded Raw: `0`
- accepted first-party actors: `0`
- active CanonicalTrack: none
- navigation: disabled

The historical A01→A03 profile is intentionally registered as `CORE_QA`. It validates only the core corridor and cannot promote the complete 下马坊→流徽榭 child Route. There is currently no production/server-registered S12-A `FULL_ROUTE_QA` profile.

No geometry is fabricated from POIs, planned lines, sibling variants, social descriptions, or a core-only anchor pass.

## Canonical API boundary

When PostgreSQL/PostGIS is configured, the evidence-backed namespace is available under `/api/canonical/*`.

Canonical reads include Area/Route overview, route detail, page projection, geometry consensus readiness, and the server-owned GeometryGate profile registry.

Canonical writes are internal/editorial only. They require a Bearer token configured through `CANONICAL_WRITE_TOKEN`. Mutation endpoints cover RawTrack ingestion, non-target editorial assignment, server-owned spatial gating, first-party Activity ingestion, and explicit CanonicalTrack activation.

The legacy dashboard endpoints such as `/api/overview` remain `MEMORY_UI_DEMO`. Database connectivity does not silently switch the UI to production truth.

## Legacy AI Studio migrations

The root `migrations/` directory is retained temporarily for prototype history only. It is **not authoritative** and must never be used for live database creation. The migration runner reads `db/migrations` exclusively.

## Remaining production boundary

The canonical Postgres repository and canonical API namespace are now implemented and integration-tested. The remaining architectural boundary is the **presentation/UI read-model cutover**: the AI Studio governance dashboard still consumes its isolated memory/demo endpoint instead of the canonical read namespace.

That cutover must be deliberate. It must not mix synthetic demo records with canonical Evidence/Rule/RawTrack truth, and it must preserve the Page Projection policy that hides navigation geometry until an active CanonicalTrack is approved.

## Cloud resource gate

Do not create Cloud SQL or other paid infrastructure merely to prove the database contract. GitHub Actions already runs the migration/seed/geometry pipeline against an ephemeral PostGIS service container.

A paid deployment should wait until:

- CI is green on the reconciliation branch
- PR review is complete
- canonical API/read-model contract is stable
- production secrets/auth policy is decided
- a deliberate hosting/database decision is made
