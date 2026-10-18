const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read = (p) => fs.readFileSync(p, 'utf8');

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '6.0.34', 'ROUND111 package version mismatch');
const blendSrc = read('src/simulation/WindVectorBlend.ts');
const envSrc = read('src/simulation/SynopticEnvironment.ts');
const fieldSrc = read('src/simulation/SynopticWindField.ts');
const solverSrc = read('src/simulation/WindBoundaryLayerSolver.ts');
const mapSrc = read('src/utils/SynopticWindPressureMap.ts');

assert(blendSrc.includes('radialCapture * (0.34 + 0.66 * strengthCapture)'), 'radially bounded cyclone capture missing');
assert(blendSrc.includes('const speedCapture = smooth01(radialCapture / 0.18)'), 'outer-annulus speed taper missing');
assert(!blendSrc.includes('Math.hypot(vSpeed, retainedBackground)'), 'old RSS background/vortex speed inflation returned');
assert(fieldSrc.includes('const tcBackgroundGate = backgroundRestoreGate(lat, lon, storms)'), 'TC-aware environmental target fade missing');
assert(fieldSrc.includes('0.16 + 0.84 * tcBackgroundGate'), 'marine minimum target is not faded inside cyclone');
assert(envSrc.includes('const eastTurn = smooth((lon - (cLon - 1.5)) / 3.0)'), 'cross-equatorial longitude turn is not continuous');
assert(!envSrc.includes('(lon > cLon ? 2.2 : -0.5)'), 'old cross-equatorial hard longitude switch remains');
assert(solverSrc.includes('sampleVelocityForTargetSurface'), 'surface-aware semi-Lagrangian sampler missing');
assert(solverSrc.includes('sampleOceanOnlyBilinear'), 'ocean-only backtrace sampling missing');
assert(mapSrc.includes('const rasterW = Math.max(MAP.w, Math.round(mapW));'), 'full-resolution ROUND109 wind raster was lost');
assert(mapSrc.includes('ctx.imageSmoothingEnabled=true;'), 'high-quality raster interpolation was lost');

function loadStandalone(file) {
  const src = read(file);
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports,module,require){${js}\n})(module.exports,module,require)`, {
    module, exports: module.exports, require, console, Math, Map, Float32Array, Uint8Array,
    setTimeout, clearTimeout, DOMException, performance
  });
  return module.exports;
}

// Capture must be zero at/beyond the radial edge; this is the direct regression for the long
// one-sided high-wind wedge mechanism found in the screenshots.
const { blendEnvironmentIntoCyclone } = loadStandalone('src/simulation/WindVectorBlend.ts');
const backgroundSpeed = Math.hypot(9, 3);
for (const r of [420, 450, 520]) {
  const out = blendEnvironmentIntoCyclone({
    backgroundU: 9, backgroundV: 3, vortexU: 0, vortexV: 18,
    distanceKm: r, captureInnerKm: 80, captureOuterKm: 420
  });
  assert(out.capture < 1e-10, `capture leaked beyond outer radius at ${r} km: ${out.capture}`);
  assert(Math.abs(out.speedMs - backgroundSpeed) < 1e-7, `outer field failed to return to background at ${r} km: ${out.speedMs}`);
}
const inner = blendEnvironmentIntoCyclone({ backgroundU: 9, backgroundV: 3, vortexU: 0, vortexV: 18, distanceKm: 180, captureInnerKm: 80, captureOuterKm: 420 });
assert(inner.capture > 0.65, 'inner cyclone capture became too weak');
assert(inner.speedMs >= 17.8 && inner.speedMs <= 18.7, `inner vortex magnitude not preserved: ${inner.speedMs}`);

// Opposing vectors must still avoid the old annular cancellation calm.
for (const r of [380, 280, 180, 100, 60]) {
  const out = blendEnvironmentIntoCyclone({ backgroundU: 7.5, backgroundV: 0, vortexU: -7.5, vortexV: 0, distanceKm: r, captureInnerKm: 80, captureOuterKm: 420 });
  assert(out.speedMs >= 7.0, `vector cancellation calm at ${r} km: ${out.speedMs}`);
}

// Cross-equatorial flow must no longer jump several m/s on one longitude column.
const { getSynopticAtmosState } = loadStandalone('src/simulation/SynopticEnvironment.ts');
const cfg = { newAtmosPreset: 'equatorial_crossflow', newAtmosAnomalyScale: 1, newAtmosHumidityBias: 0, newAtmosShearScale: 1, newAtmosCycleOffsetHours: 0 };
let prev = null, maxLonJump = 0;
for (let lon = 98; lon <= 153; lon += 0.02) {
  const s = getSynopticAtmosState(3.5, lon, cfg, 0);
  if (prev) maxLonJump = Math.max(maxLonJump, Math.hypot(s.u850 - prev.u850, s.v850 - prev.v850));
  prev = s;
}
assert(maxLonJump < 0.10, `cross-equatorial longitude seam remains: ${maxLonJump.toFixed(3)} m/s per 0.02deg`);

console.log('ROUND111 synoptic artifact hardening regression: PASS');
console.log(JSON.stringify({ backgroundSpeedMs: +backgroundSpeed.toFixed(3), innerCapture: +inner.capture.toFixed(3), innerSpeedMs: +inner.speedMs.toFixed(2), maxCrossEquatorialJumpMs: +maxLonJump.toFixed(3) }));
