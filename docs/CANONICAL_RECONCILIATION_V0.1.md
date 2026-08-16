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
2. Dry-run migration mode now reports `VALIDATED_ONLY` with `applied: []`; it cannot masquerade as live PostgreSQL execution.
3. Added checksum-drift detection for already-applied live migrations.
4. Restricted canonical `POST /tracks` ingestion to GPX/KML.
5. Untimestamped GPX track geometry remains `GEOMETRY_LINE_UNKNOWN`; it is not auto-promoted to execution evidence.
6. Planned KML LineString remains `PLANNED_NAVIGATION_LINE` / control evidence.
7. Fixed the planned-line invariant, whose prior condition was unreachable.
8. Removed route-name/ID heuristics for protected-area legality. Legal blocking requires explicit rule/scope evidence.
9. Public child-route geometry consensus defaults to at least two independent accepted Recorded GPS executions for the same child Route.
10. Sibling-route assignments never contribute to the target child Route consensus.
11. API health/overview output explicitly labels the current repository as `MEMORY_UI_DEMO`.
12. Added the evidence-backed S12 QA fixture with measured anchor distances for 42160328, 45517618 and 52046317 plus the planned control line.

## ZJ-S12-A frozen state

`ZJ-S12-A = 下马坊驿站 → 民国邮政博物馆 → 南京地震科学馆 → 流徽榭`

- identity: `CANONICAL`
- geometry: `GEOMETRY_BLOCKED / EXTERNAL_DEPENDENCY`
- accepted Recorded Raw: `0`
- navigation: disabled

No geometry is fabricated from POIs, planned lines, sibling variants, or social descriptions.

## Legacy AI Studio migrations

The root `migrations/` directory is retained temporarily for prototype history only. It is **not authoritative** and must never be used for live database creation. The migration runner reads `db/migrations` exclusively.

## Remaining production blocker

The live PostgreSQL repository adapter is not yet wired to the API. A reachable `DATABASE_URL` currently proves connectivity and enables canonical migration execution, but API requests still use the explicit memory/demo repository.

Do not label the service database-backed until the canonical Postgres repositories are implemented and integration-tested.

## Cloud resource gate

Do not create Cloud SQL or deploy paid infrastructure until:

- CI passes typecheck/tests/build
- canonical reconciliation PR is reviewed
- live Postgres adapter contract is ready
- migration + seed integration tests are ready
