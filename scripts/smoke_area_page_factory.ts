import { getPgPool } from '../src/config/database.js';
import { projectAreaPage } from '../src/services/area_page_projection_service.js';

async function main() {
  const page = await projectAreaPage(process.argv[2] || 'zijinshan');

  const facts = Object.fromEntries(
    Object.entries(page.facts).map(([key, value]) => [key, value.state])
  );
  const routes = page.routes.map(route => ({
    id: route.id,
    variant_code: route.variant_code,
    identity: route.identity_state,
    geometry: route.geometry_state,
    publication: route.publication_state,
    navigation_allowed: route.navigation_allowed
  }));
  const counts = {
    access_points: page.catalog.access_points.length,
    parking: page.catalog.parking.length,
    pois: page.catalog.pois.length
  };

  if (page.area.id !== 'area_zijinshan') {
    throw new Error(`Unexpected Area projection: ${page.area.id}`);
  }
  if (page.facts.traffic_control_policy.state !== 'CANONICAL') {
    throw new Error(`traffic_control_policy expected CANONICAL, got ${page.facts.traffic_control_policy.state}`);
  }
  if (page.facts.current_operational_status.state !== 'SUPPORTED') {
    throw new Error(`current_operational_status expected SUPPORTED, got ${page.facts.current_operational_status.state}`);
  }
  if (page.facts.night_access_policy.state !== 'UNKNOWN') {
    throw new Error(`night_access_policy must remain UNKNOWN until validated, got ${page.facts.night_access_policy.state}`);
  }
  if (page.facts.parking_fee_current.state !== 'UNKNOWN') {
    throw new Error(`parking_fee_current must remain UNKNOWN until validated, got ${page.facts.parking_fee_current.state}`);
  }
  if (counts.access_points !== 4 || counts.parking !== 4 || counts.pois !== 3) {
    throw new Error(`Unexpected catalog counts: ${JSON.stringify(counts)}`);
  }
  if (page.routes.some(route => route.navigation_allowed && route.publication_state !== 'NAVIGATION_READY')) {
    throw new Error('Navigation invariant violated: only NAVIGATION_READY routes may allow navigation');
  }

  console.log('[AREA PAGE FACTORY] PASS', {
    area: page.area.id,
    facts,
    counts,
    routes,
    unknown_fields: page.quality.unknown_fields,
    navigation_ready_route_count: page.quality.navigation_ready_route_count,
    read_only_hash: page.quality.read_only_hash,
    canonical_path: page.seo.canonical_path
  });

  const pool = getPgPool();
  if (pool) await pool.end();
}

main().catch(async error => {
  console.error('AREA_PAGE_FACTORY_SMOKE_FAILED:', error);
  const pool = getPgPool();
  if (pool) await pool.end().catch(() => undefined);
  process.exit(1);
});
