/**
 * AI Studio memory/UI demo seed loader.
 *
 * IMPORTANT: `ui_demo_manifest.json` contains synthetic fixtures used only to
 * exercise UI and hard-gate behavior. It is NOT production/evidence truth.
 * Canonical production seed lives at `db/four_area_seed_manifest_v0_2.json`.
 */

import { Repositories } from '../src/repository/repositories.js';
import manifestData from './ui_demo_manifest.json' with { type: 'json' };

export type SeedDataClassification = 'UI_DEMO_ONLY';

export interface SeedResult {
  dataClassification: SeedDataClassification;
  areasCount: number;
  familiesCount: number;
  routesCount: number;
  tracksCount: number;
  assignmentsCount: number;
  scopesCount: number;
  rulesCount: number;
  snapshotsCount: number;
  mutationsCreated: number;
  mutationsUpdated: number;
}

export async function loadSeedManifest(repos: Repositories): Promise<SeedResult> {
  let mutationsCreated = 0;
  let mutationsUpdated = 0;

  for (const area of manifestData.areas) {
    const existing = await repos.areas.findById(area.id);
    if (!existing) {
      await repos.areas.save(area as any);
      mutationsCreated++;
    } else {
      const isIdentical =
        existing.name === area.name &&
        existing.slug === area.slug &&
        existing.area_type === area.area_type &&
        existing.protection_level === area.protection_level &&
        existing.jurisdiction_code === area.jurisdiction_code &&
        existing.description === area.description;
      if (!isIdentical) {
        await repos.areas.save(area as any);
        mutationsUpdated++;
      }
    }
  }

  for (const rf of manifestData.route_families) {
    const parentArea = await repos.areas.findById(rf.area_id);
    if (!parentArea) throw new Error(`Parent Area ${rf.area_id} does not exist for RouteFamily ${rf.id}`);

    const existing = await repos.routeFamilies.findById(rf.id);
    if (!existing) {
      await repos.routeFamilies.save(rf as any);
      mutationsCreated++;
    } else {
      const isIdentical =
        existing.area_id === rf.area_id &&
        existing.name === rf.name &&
        existing.canonical_code === rf.canonical_code &&
        existing.description === rf.description;
      if (!isIdentical) {
        await repos.routeFamilies.save(rf as any);
        mutationsUpdated++;
      }
    }
  }

  for (const route of manifestData.routes) {
    const parentRf = await repos.routeFamilies.findById(route.family_id);
    if (!parentRf) throw new Error(`Parent RouteFamily ${route.family_id} does not exist for Route ${route.id}`);

    const existing = await repos.routes.findById(route.id);
    if (!existing) {
      await repos.routes.save(route as any);
      mutationsCreated++;
    } else {
      const isIdentical =
        existing.family_id === route.family_id &&
        existing.variant_code === route.variant_code &&
        existing.name === route.name &&
        existing.identity_state === route.identity_state &&
        existing.geometry_state === route.geometry_state &&
        existing.start_point_name === route.start_point_name &&
        existing.end_point_name === route.end_point_name &&
        existing.distance_meters === route.distance_meters &&
        existing.elevation_gain_meters === route.elevation_gain_meters &&
        existing.estimated_duration_minutes === route.estimated_duration_minutes &&
        existing.consensus_track_id === (route as any).consensus_track_id;
      if (!isIdentical) {
        await repos.routes.save(route as any);
        mutationsUpdated++;
      }
    }
  }

  for (const track of manifestData.raw_tracks) {
    const existing = await repos.rawTracks.findById(track.id);
    if (!existing) {
      await repos.rawTracks.save(track as any);
      mutationsCreated++;
    } else {
      const isIdentical =
        existing.sha256 === track.sha256 &&
        existing.format === track.format &&
        existing.provenance_type === track.provenance_type &&
        existing.point_count === track.point_count &&
        existing.raw_payload === track.raw_payload;
      if (!isIdentical) {
        await repos.rawTracks.save(track as any);
        mutationsUpdated++;
      }
    }
  }

  for (const assign of manifestData.raw_track_route_assignments) {
    const track = await repos.rawTracks.findById(assign.track_id);
    const route = await repos.routes.findById(assign.route_id);
    if (!track || !route) throw new Error(`Invalid assignment: track ${assign.track_id} or route ${assign.route_id} missing`);

    const existingList = await repos.assignments.findByRouteId(assign.route_id);
    const existing = existingList.find(a => a.id === assign.id || a.track_id === assign.track_id);
    if (!existing) {
      await repos.assignments.save(assign as any);
      mutationsCreated++;
    } else {
      const isIdentical =
        existing.match_status === assign.match_status &&
        existing.rejection_reason === (assign as any).rejection_reason &&
        existing.evaluator_notes === assign.evaluator_notes;
      if (!isIdentical) {
        await repos.assignments.save(assign as any);
        mutationsUpdated++;
      }
    }
  }

  for (const scope of manifestData.legal_scopes) {
    const area = await repos.areas.findById(scope.area_id);
    if (!area) throw new Error(`Parent Area ${scope.area_id} not found for scope ${scope.id}`);
    const existingList = await repos.legalScopes.findByAreaId(scope.area_id);
    const existing = existingList.find(s => s.id === scope.id);
    if (!existing) {
      await repos.legalScopes.save(scope as any);
      mutationsCreated++;
    } else if (
      existing.name !== scope.name ||
      existing.scope_type !== scope.scope_type ||
      existing.positive_authorization_required !== scope.positive_authorization_required
    ) {
      await repos.legalScopes.save(scope as any);
      mutationsUpdated++;
    }
  }

  for (const rule of manifestData.rules) {
    const area = await repos.areas.findById(rule.area_id);
    if (!area) throw new Error(`Parent Area ${rule.area_id} not found for rule ${rule.id}`);
    const existingList = await repos.rules.findByAreaId(rule.area_id);
    const existing = existingList.find(r => r.id === rule.id);
    if (!existing) {
      await repos.rules.save(rule as any);
      mutationsCreated++;
    } else if (
      existing.rule_type !== rule.rule_type ||
      existing.is_blocking !== rule.is_blocking ||
      existing.title !== rule.title
    ) {
      await repos.rules.save(rule as any);
      mutationsUpdated++;
    }
  }

  // Runtime snapshots below are fixtures only. They are loaded into the memory
  // demo runtime repository and never imported into canonical static DB seed.
  for (const snap of manifestData.runtime_snapshots) {
    const existing = await repos.runtimeSnapshots.findLatestForRoute(snap.route_id || '');
    if (!existing || existing.id !== snap.id) {
      await repos.runtimeSnapshots.save(snap as any);
      mutationsCreated++;
    }
  }

  return {
    dataClassification: 'UI_DEMO_ONLY',
    areasCount: manifestData.areas.length,
    familiesCount: manifestData.route_families.length,
    routesCount: manifestData.routes.length,
    tracksCount: manifestData.raw_tracks.length,
    assignmentsCount: manifestData.raw_track_route_assignments.length,
    scopesCount: manifestData.legal_scopes.length,
    rulesCount: manifestData.rules.length,
    snapshotsCount: manifestData.runtime_snapshots.length,
    mutationsCreated,
    mutationsUpdated
  };
}
