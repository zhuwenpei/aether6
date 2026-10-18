const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const assert = require('node:assert/strict');

function loadTsModule(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, require, console, Math, setTimeout, clearTimeout, DOMException, Float32Array, Uint8Array };
  vm.runInNewContext(`(function(exports,module,require){${js}\n})(module.exports,module,require)`, sandbox, { filename: file });
  return module.exports;
}

const presetMod = loadTsModule('src/simulation/SynopticEnvironmentalWindModel.ts');
const blendMod = loadTsModule('src/simulation/WindVectorBlend.ts');
const vortexMod = loadTsModule('src/simulation/TropicalCycloneVortex.ts');
const solverMod = loadTsModule('src/simulation/WindBoundaryLayerSolver.ts');
const fieldSrc = fs.readFileSync('src/simulation/SynopticWindField.ts', 'utf8');
const renderSrc = fs.readFileSync('src/utils/SynopticWindPressureMap.ts', 'utf8');

const { diagnoseSynopticEnvironmentalWindTarget } = presetMod;
const { blendEnvironmentIntoCyclone } = blendMod;
const { sampleTropicalCycloneVortex } = vortexMod;
const { solveWindBoundaryLayer } = solverMod;

function avgBox(name, lat0, lat1, lon0, lon1, monsoonMode) {
  const vals = [];
  for (let lat = lat0; lat <= lat1 + 1e-9; lat += 1) {
    for (let lon = lon0; lon <= lon1 + 1e-9; lon += 1) {
      const texture = Math.max(-1, Math.min(1, 0.38 * Math.sin(lat * 0.73 + lon * 0.11) + 0.22 * Math.cos(lat * 0.29 - lon * 0.17)));
      const activity = Math.max(0, Math.min(1, 0.38 + 0.22 * Math.sin(lat * 0.19 + lon * 0.07)));
      let monsoon = 0.08, cross = 0.06;
      if (monsoonMode === 'active') {
        monsoon = 0.78 + 0.12 * Math.sin(lat * 0.21 + lon * 0.14);
        cross = 0.62 + 0.12 * Math.cos(lat * 0.17 - lon * 0.09);
      }
      vals.push(diagnoseSynopticEnvironmentalWindTarget({
        lat, lon, isLand: false,
        monsoonFlow: monsoon, crossEquatorialFlow: cross,
        backgroundTexture: texture, synopticActivity: activity
      }).target10mKt);
    }
  }
  vals.sort((a, b) => a - b);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const result = {
    name,
    avg,
    min: vals[0],
    p10: vals[Math.floor(vals.length * 0.10)],
    p90: vals[Math.floor(vals.length * 0.90)],
    max: vals[vals.length - 1]
  };
  return result;
}

const regions = [
  avgBox('WNP sample', 12, 28, 135, 160, 'quiet'),
  avgBox('Philippine Sea sample', 8, 22, 125, 145, 'quiet'),
  avgBox('East China Sea sample', 24, 33, 122, 130, 'quiet'),
  avgBox('South China Sea sample', 5, 20, 108, 120, 'quiet'),
  avgBox('Active monsoon sample', 5, 20, 108, 120, 'active')
];
for (const r of regions) {
  assert.ok(r.min >= 4 - 1e-9, `${r.name} fell below 4 kt global marine floor`);
  assert.ok(r.max <= 36 + 1e-9, `${r.name} exceeded 36 kt global marine ceiling`);
}
const quiet = regions.slice(0, 4);
assert.ok(quiet.every(r => r.avg >= 10 && r.avg <= 16.5), 'ordinary marine background no longer clusters near 10-16 kt');
assert.ok(regions[4].max > 16, 'organized monsoon corridor no longer enters fast 16-36 kt tail');

// Environment-to-vortex turning must not produce vector-cancellation annular calms.
for (const r of [500, 380, 280, 180, 100, 60]) {
  const out = blendEnvironmentIntoCyclone({
    backgroundU: 7.5, backgroundV: 0,
    vortexU: -7.5, vortexV: 0,
    distanceKm: r, captureInnerKm: 80, captureOuterKm: 420
  });
  assert.ok(out.speedMs >= 6.65, `vacuum calm at ${r} km: ${out.speedMs.toFixed(2)} m/s`);
}
const outerTurn = blendEnvironmentIntoCyclone({ backgroundU: 7.5, backgroundV: 0, vortexU: 0, vortexV: 8, distanceKm: 420, captureInnerKm: 80, captureOuterKm: 450 });
const innerTurn = blendEnvironmentIntoCyclone({ backgroundU: 7.5, backgroundV: 0, vortexU: 0, vortexV: 28, distanceKm: 80, captureInnerKm: 80, captureOuterKm: 450 });
assert.ok(innerTurn.capture > outerTurn.capture, 'cyclone capture does not increase inward');
assert.ok(innerTurn.speedMs > outerTurn.speedMs, 'inner circulation failed to dominate speed');

// Strong tropical-core symmetry should remain bounded even with deliberately lopsided input radii.
function pointAt(storm, bearing, rKm) {
  const a = bearing * Math.PI / 180;
  return {
    lat: storm.lat + Math.cos(a) * rKm / 111.12,
    lon: storm.lon + Math.sin(a) * rKm / (111.12 * Math.max(.2, Math.cos(storm.lat * Math.PI / 180)))
  };
}
const storm = {
  id: 'SYM', name: 'SYM', lat: 25, lon: 125, vmax: 58, pmin: 928, direction: 320, speed: 20, rmw: 30,
  r7: { ne: 360, se: 330, sw: 120, nw: 150 }, r10: { ne: 220, se: 205, sw: 75, nw: 95 }, r12: { ne: 125, se: 118, sw: 52, nw: 68 },
  category: 'SuperTY', landed: false, dissipated: false, extrTransition: 0, ewrcState: 'none', ewrcProgress: 0,
  active: true, history: [], simHour: 0
};
const env = { slp: 1010, shearU: 10, shearV: 3 };
const coreSpeeds = [45, 135, 225, 315].map(b => {
  const p = pointAt(storm, b, 75);
  const s = sampleTropicalCycloneVortex(p.lat, p.lon, storm, env);
  return Math.hypot(s.u, s.v);
});
assert.ok(Math.max(...coreSpeeds) / Math.min(...coreSpeeds) < 1.32, `strong-core squashing remains excessive: ${coreSpeeds}`);

// Synthetic coastline: a constant incoming flow over a flat coast must not accelerate into a ribbon.
(async () => {
  const nx = 31, ny = 19, n = nx * ny;
  const slp = new Float32Array(n).fill(1010);
  const u = new Float32Array(n).fill(8.0), v = new Float32Array(n);
  const cd = new Float32Array(n), h = new Float32Array(n).fill(800), pen = new Float32Array(n), tx = new Float32Array(n), ty = new Float32Array(n);
  const isLand = new Uint8Array(n), relief = new Float32Array(n), elevation = new Float32Array(n), sx = new Float32Array(n), sy = new Float32Array(n), wake = new Float32Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const land = i >= 16;
    isLand[k] = land ? 1 : 0;
    cd[k] = land ? 0.0026 : 0.0013;
  }
  const sol = await solveWindBoundaryLayer({
    geometry: { nx, ny, lon0: 118, lat0: 25, stepDeg: 0.25 }, slpHpa: slp, initialU: u, initialV: v,
    surface: { dragCoefficient: cd, boundaryLayerDepthM: h, terrainPenalty: pen, terrainDeflectX: tx, terrainDeflectY: ty, isLand, localReliefM: relief, elevationM: elevation, slopeEastMPerKm: sx, slopeNorthMPerKm: sy, terrainWake: wake },
    maxIterations: 72
  });
  let coastalMax = 0;
  for (let j = 2; j < ny - 2; j++) for (let i = 14; i <= 18; i++) coastalMax = Math.max(coastalMax, Math.hypot(sol.u[j * nx + i], sol.v[j * nx + i]));
  assert.ok(coastalMax <= 8.25, `flat coast accelerated into a ribbon: ${coastalMax.toFixed(2)} m/s`);

  // Static guards for the two diagnosed renderer/physics causes.
  assert.ok(fieldSrc.includes('landInteriorWeight') && fieldSrc.includes('dragInterior = 0.26') && fieldSrc.includes('solverSlopeEast'), 'coast-to-interior wind/terrain transition missing');
  assert.ok(!fieldSrc.includes('environmentShield'), 'subtractive environment shield returned');
  assert.ok(fieldSrc.includes('blendEnvironmentIntoCyclone'), 'progressive environment capture missing');
  assert.ok(renderSrc.includes('sampleWindSpeedAtLonLat') && renderSrc.includes('return clamp(rawKt'), 'bounded vector wind interpolation missing');

  console.log('ROUND85 GLOBAL-MODEL SAMPLE AVERAGES (kt)');
  for (const r of regions) console.log(`${r.name}: avg=${r.avg.toFixed(2)} p10=${r.p10.toFixed(2)} p90=${r.p90.toFixed(2)} min=${r.min.toFixed(2)} max=${r.max.toFixed(2)}`);
  console.log('round85_synoptic_wind_regression: PASS');
})().catch(err => { console.error(err); process.exit(1); });
