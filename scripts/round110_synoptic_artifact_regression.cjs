const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read = (p) => fs.readFileSync(p, 'utf8');

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '6.0.33', 'ROUND110 package version mismatch');
const envSrc = read('src/simulation/SynopticEnvironment.ts');
const fieldSrc = read('src/simulation/SynopticWindField.ts');
const mapSrc = read('src/utils/SynopticWindPressureMap.ts');

assert(!envSrc.includes('lat < curveLat ? 1 : -1'), 'monsoon trough still contains a one-latitude vector flip');
assert(!envSrc.includes('lat < curveLat ? 1 : -0.18'), 'monsoon 850-hPa wind still flips abruptly at the trough axis');
assert(!envSrc.includes('lat < target ? 2.1 : -1.4'), 'ITCZ meridional wind still flips abruptly at one latitude');
assert(envSrc.includes('const crossAxis = smooth((lat - (curveLat - 1.35)) / 2.70)'), 'finite-width monsoon convergence transition missing');
assert(envSrc.includes('const crossAxis = smooth((lat - (target - 1.10)) / 2.20)'), 'finite-width ITCZ transition missing');
assert(fieldSrc.includes('if (!landMask[k]) {\n        // ROUND110: only marine environmental flow is hard-capped before the fluid solve'), 'pre-solver land hard-cap removal missing');
assert(fieldSrc.includes('const terrainWakeExposure = new Float32Array(terrainWake)'), 'raw wake exposure diagnostic missing');
assert(fieldSrc.includes('cycloneCaptureWeight[k] = Math.max'), 'cyclone-capture diagnostic missing');
assert(fieldSrc.includes('const crossSurfaceFactor = landMask[k] ? 0.18 : 0.06'), 'surface-aware coastal smoothing missing');
assert(fieldSrc.includes('const maxDeficit = (0.24 - 0.13 * stormProtection)'), 'bounded ocean-wake recovery missing');
assert(mapSrc.includes('const rasterW = Math.max(MAP.w, Math.round(mapW));'), 'ROUND109 full-resolution raster sampling was lost');
assert(mapSrc.includes('ctx.imageSmoothingEnabled=true;'), 'ROUND109 interpolation was lost');

function loadStandalone(file) {
  const src = read(file);
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports,module,require){${js}\n})(module.exports,module,require)`, { module, exports: module.exports, require, console, Math, Map, Float32Array, Uint8Array, setTimeout, clearTimeout, DOMException, performance });
  return module.exports;
}

// Numeric continuity: a 0.02-degree step must not see the old 6-8 m/s sign-flip jump.
const { getSynopticAtmosState } = loadStandalone('src/simulation/SynopticEnvironment.ts');
for (const preset of ['wnp_monsoon_ridge', 'equatorial_crossflow', 'monsoon_gyre']) {
  const cfg = { newAtmosPreset: preset, newAtmosAnomalyScale: 1, newAtmosHumidityBias: 0, newAtmosShearScale: 1, newAtmosCycleOffsetHours: 0 };
  let prev = null, maxJump = 0;
  for (let lat = -2; lat <= 24; lat += 0.02) {
    const s = getSynopticAtmosState(lat, 118, cfg, 0);
    if (prev) maxJump = Math.max(maxJump, Math.hypot(s.u850 - prev.u850, s.v850 - prev.v850));
    prev = s;
  }
  assert(maxJump < 0.20, `${preset} still has a narrow low-level vector seam: ${maxJump.toFixed(3)} m/s per 0.02deg`);
}

// Synthetic island advection test: demonstrate why pre-solver land clipping created long blue wakes.
const { solveWindBoundaryLayer } = loadStandalone('src/simulation/WindBoundaryLayerSolver.ts');
async function syntheticIsland(preCapIsland) {
  const nx = 71, ny = 31, n = nx * ny;
  const slp = new Float32Array(n).fill(1010);
  const u = new Float32Array(n).fill(20), v = new Float32Array(n);
  const cd = new Float32Array(n).fill(0.0013), h = new Float32Array(n).fill(780);
  const pen = new Float32Array(n), tx = new Float32Array(n), ty = new Float32Array(n);
  const isLand = new Uint8Array(n), elevation = new Float32Array(n), relief = new Float32Array(n), sx = new Float32Array(n), sy = new Float32Array(n), wake = new Float32Array(n);
  for (let j = 13; j <= 17; j++) for (let i = 22; i <= 25; i++) {
    const k = j * nx + i;
    isLand[k] = 1; cd[k] = 0.0035; h[k] = 900;
    if (preCapIsland) u[k] = 6;
  }
  const sol = await solveWindBoundaryLayer({
    geometry: { nx, ny, lon0: 100, lat0: 12, stepDeg: 0.1 }, slpHpa: slp, initialU: u, initialV: v,
    surface: { dragCoefficient: cd, boundaryLayerDepthM: h, terrainPenalty: pen, terrainDeflectX: tx, terrainDeflectY: ty, isLand, elevationM: elevation, localReliefM: relief, slopeEastMPerKm: sx, slopeNorthMPerKm: sy, terrainWake: wake },
    maxIterations: 100
  });
  const j = 15; let min = Infinity;
  for (let i = 26; i <= 55; i++) min = Math.min(min, Math.hypot(sol.u[j * nx + i], sol.v[j * nx + i]));
  return min;
}

(async () => {
  const oldStyleWakeMin = await syntheticIsland(true);
  const newStyleWakeMin = await syntheticIsland(false);
  assert(oldStyleWakeMin < 12, `synthetic control no longer reproduces old long-wake mechanism: ${oldStyleWakeMin}`);
  assert(newStyleWakeMin > 16.5, `removing pre-solver island cap did not repair downstream wake: ${newStyleWakeMin}`);
  assert(newStyleWakeMin - oldStyleWakeMin > 5.5, 'island-wake improvement is too small');
  console.log('ROUND110 synoptic artifact regression: PASS');
  console.log(JSON.stringify({ oldStyleWakeMinMs: +oldStyleWakeMin.toFixed(2), newStyleWakeMinMs: +newStyleWakeMin.toFixed(2) }));
})().catch((err) => { console.error(err); process.exit(1); });
