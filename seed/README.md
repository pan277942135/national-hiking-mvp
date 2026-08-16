# Seed data classification

This directory is **not** the production evidence database seed.

## `ui_demo_manifest.json`

Classification: **UI_DEMO_ONLY**.

It is preserved from the AI Studio prototype so the governance dashboard and hard-gate demonstrations can run without external services. Its route records, raw tracks, legal claims, runtime snapshots and authorizations must not be interpreted as observed/canonical facts.

Known synthetic examples include `track_zj_sibling_b_gps`, `track_sz_01_gps`, `track_wy_core_gps`, and demo runtime snapshots. In particular, no genuine `ZJ-S12-B` Recorded GPS execution has been supplied and validated.

## Production source of truth

Canonical/evidence-backed bootstrap seed lives at:

`db/four_area_seed_manifest_v0_2.json`

Canonical PostgreSQL/PostGIS migrations live at:

`db/migrations/0001_extensions_enums.sql` through `db/migrations/0010_first_party_activity.sql`.

Synthetic fixtures must never be imported into canonical evidence, RawTrack consensus, current Rule truth, or runtime truth.
