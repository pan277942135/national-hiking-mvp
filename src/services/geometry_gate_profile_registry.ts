import {
  S12_CORE_QA_PROFILE_V1,
  type GeometryGateProfile
} from './geometry_gate_service.js';

/**
 * Geometry gate profiles are server-owned governance configuration.
 *
 * Clients may select a registered profile ID but may never submit arbitrary
 * anchors/thresholds capable of manufacturing TARGET_ACCEPTED evidence.
 * A FULL_ROUTE_QA profile enters this registry only after editorial approval of
 * its route-specific anchor/corridor contract.
 */
const REGISTRY = new Map<string, GeometryGateProfile>([
  [S12_CORE_QA_PROFILE_V1.profileId, S12_CORE_QA_PROFILE_V1]
]);

export function getRegisteredGeometryGateProfile(profileId: string): GeometryGateProfile | null {
  return REGISTRY.get(profileId) ?? null;
}

export function listRegisteredGeometryGateProfiles(): Array<{
  profileId: string;
  routeId: string;
  profileVersion: number;
  purpose: GeometryGateProfile['purpose'];
  targetAcceptanceCapable: boolean;
}> {
  return [...REGISTRY.values()].map(profile => ({
    profileId: profile.profileId,
    routeId: profile.routeId,
    profileVersion: profile.profileVersion,
    purpose: profile.purpose,
    targetAcceptanceCapable: profile.purpose === 'FULL_ROUTE_QA'
  }));
}
