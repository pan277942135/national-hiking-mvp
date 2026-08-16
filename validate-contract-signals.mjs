import http from 'http';
import fs from 'fs';
import path from 'path';

const projectRoot = process.argv[2] || '.';

console.log('================================================================');
console.log('         VALIDATE CONTRACT SIGNALS & ENDPOINT CONTRACTS         ');
console.log('================================================================\n');

async function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runValidation() {
  const baseOptions = {
    hostname: 'localhost',
    port: 3000
  };

  let allPassed = true;

  // 1. GET /health
  try {
    const res = await request({ ...baseOptions, path: '/health', method: 'GET' });
    const ok = res.status === 200 && res.data?.status === 'ok';
    console.log(`[${ok ? 'PASS' : 'FAIL'}] GET /health (Status: ${res.status}, Mode: ${res.data?.database_mode})`);
    if (!ok) allPassed = false;
  } catch (err) {
    console.log(`[FAIL] GET /health (Error: ${err.message})`);
    allPassed = false;
  }

  // 2. GET /areas/:areaId
  try {
    const res = await request({ ...baseOptions, path: '/areas/area_zijinshan', method: 'GET' });
    const ok = res.status === 200 && res.data?.area?.id === 'area_zijinshan';
    console.log(`[${ok ? 'PASS' : 'FAIL'}] GET /areas/:areaId (Status: ${res.status}, Area: ${res.data?.area?.name})`);
    if (!ok) allPassed = false;
  } catch (err) {
    console.log(`[FAIL] GET /areas/:areaId (Error: ${err.message})`);
    allPassed = false;
  }

  // 3. GET /areas/:areaId/routes
  try {
    const res = await request({ ...baseOptions, path: '/areas/area_zijinshan/routes', method: 'GET' });
    const ok = res.status === 200 && Array.isArray(res.data?.routes);
    console.log(`[${ok ? 'PASS' : 'FAIL'}] GET /areas/:areaId/routes (Status: ${res.status}, Count: ${res.data?.routes_count})`);
    if (!ok) allPassed = false;
  } catch (err) {
    console.log(`[FAIL] GET /areas/:areaId/routes (Error: ${err.message})`);
    allPassed = false;
  }

  // 4. GET /routes/:routeId
  try {
    const res = await request({ ...baseOptions, path: '/routes/route_zj_s12_a', method: 'GET' });
    const ok = res.status === 200 && res.data?.route?.id === 'route_zj_s12_a';
    console.log(`[${ok ? 'PASS' : 'FAIL'}] GET /routes/:routeId (Status: ${res.status}, IdentityState: ${res.data?.route?.identity_state}, GeometryState: ${res.data?.route?.geometry_state})`);
    if (!ok) allPassed = false;
  } catch (err) {
    console.log(`[FAIL] GET /routes/:routeId (Error: ${err.message})`);
    allPassed = false;
  }

  // 5. GET /routes/:routeId/eligibility
  try {
    const res = await request({ ...baseOptions, path: '/routes/route_zj_s12_a/eligibility', method: 'GET' });
    const gate = res.data?.gateResult;
    const ok = res.status === 200 && gate?.gate_status === 'GEOMETRY_BLOCKED' && gate?.navigation_executable === false;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] GET /routes/:routeId/eligibility (Gate: ${gate?.gate_status}, NavExecutable: ${gate?.navigation_executable})`);
    if (!ok) allPassed = false;
  } catch (err) {
    console.log(`[FAIL] GET /routes/:routeId/eligibility (Error: ${err.message})`);
    allPassed = false;
  }

  // 6. POST /tracks
  try {
    const rawGPX = '<gpx version="1.1"><trk><name>Contract Validation Track</name><trkseg><trkpt lat="32.05" lon="118.84"><time>2026-08-16T09:00:00Z</time></trkpt></trkseg></trk></gpx>';
    const res = await request({
      ...baseOptions,
      path: '/tracks',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      format: 'GPX',
      fileName: 'contract_validation.gpx',
      payload: rawGPX
    });

    const isCreated = res.status === 201;
    const prov = res.data?.provenanceType === 'RECORDED_GPS';
    const sha = typeof res.data?.sha256 === 'string' && res.data.sha256.length === 64;
    const noAutoRoute = res.data?.routeCreated === undefined && res.data?.track?.id !== undefined;

    const ok = isCreated && prov && sha && noAutoRoute;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] POST /tracks Invariant Contract:`);
    console.log(`       - Status Code: ${res.status} (Expected 201)`);
    console.log(`       - Computed SHA256: ${res.data?.sha256}`);
    console.log(`       - Classified Provenance: ${res.data?.provenanceType} (RECORDED_GPS)`);
    console.log(`       - Isolation: Only RawTrack created, zero routes auto-created: ${noAutoRoute}`);
    if (!ok) allPassed = false;
  } catch (err) {
    console.log(`[FAIL] POST /tracks (Error: ${err.message})`);
    allPassed = false;
  }

  // 7. POST /runtime-snapshots
  try {
    const snapPayload = {
      areaId: 'area_zijinshan',
      routeId: 'route_zj_s12_a',
      observedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 3600000).toISOString(),
      hazardLevel: 'NORMAL',
      trailStatus: 'OPEN',
      sourceName: 'Validation Sentinel Unit'
    };
    const res = await request({
      ...baseOptions,
      path: '/runtime-snapshots',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, snapPayload);

    const ok = res.status === 201 && res.data?.snapshot?.id !== undefined;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] POST /runtime-snapshots (Status: ${res.status}, ID: ${res.data?.snapshot?.id})`);
    if (!ok) allPassed = false;
  } catch (err) {
    console.log(`[FAIL] POST /runtime-snapshots (Error: ${err.message})`);
    allPassed = false;
  }

  console.log('\n================================================================');
  console.log(`OVERALL CONTRACT SIGNALS: ${allPassed ? 'ALL CONTRACT SIGNALS VALIDATED (PASS)' : 'CONTRACT VALIDATION FAILED'}`);
  console.log('================================================================');
}

runValidation().catch(console.error);
