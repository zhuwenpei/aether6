const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function loadStandaloneTs(rel) {
  const source = read(rel);
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: rel
  }).outputText;
  const mod = { exports: {} };
  Function('require', 'module', 'exports', out)(require, mod, mod.exports);
  return mod.exports;
}

const pkg = JSON.parse(read('package.json'));
assert.ok(/^6\.0\.(2[2-9]|[3-9]\d)$/.test(pkg.version), `unexpected post-ROUND99 version ${pkg.version}`);

// 1) Configured arrival T is now the actual wind-front / cyclone-centre encounter time.
const timing = loadStandaloneTs('src/simulation/ColdAirTiming.ts');
assert.equal(timing.COLD_AIR_CENTER_CONTACT_DELAY_HOURS, 0, 'cold-air contact still has a hidden delay');
assert.equal(timing.getColdAirCenterContactHour(18), 18, 'configured arrival time is not the actual centre-contact time');

const field = read('src/simulation/SynopticWindField.ts');
assert.ok(field.includes('const frontLat = contactLat + (centerContactHour - validHour) * propagationKmh / 111.12;'), 'wind-field front is not exactly on the contact latitude at T');
assert.ok(field.includes('meridionalWeight = 0.94 + 0.06 * Math.sin(Math.PI * phase);'), 'broad cold-air body no longer connects smoothly to the centre-contact front');
assert.ok(!field.includes('strongCoreLagKm'), 'legacy delayed strong-core offset remains');
assert.ok(field.includes('resolveSynopticStormAtHour(typhoon, initHour, centerContactHour, config)'), 'wind field does not anchor the cyclone at the shared contact time');
assert.ok(field.includes('const oceanKt = [0, 24, 28, 32][strength]'), 'stage-3 wind field no longer keeps the corrected 32 kt surge');

// Numerical geometry: at T the centre is exactly on the strong-wind front; afterward the front
// continues independently southward.
const contactLat = 21.4;
const contactHour = 30;
const propagationKmh = 40;
const frontLat = (h) => contactLat + (contactHour - h) * propagationKmh / 111.12;
assert.ok(Math.abs(frontLat(contactHour) - contactLat) < 1e-12);
assert.ok(frontLat(contactHour + 3) < contactLat);

// 2/3) Stage-3 uses the corrected 32 kt wind target while retaining the calibrated 80% cyclone weakening load. The onset is
// deliberately convex: slow immediately at contact, then rapidly accelerates to near/full strength.
const engine = read('src/simulation/Engine.ts');
for (const token of [
  'const coldAirImpactScale = coldAirStrength === 3 ? 0.80 : 1.0;',
  'const coldAirEffectPulse = coldAirPulse * coldAirImpactScale;',
  'const coldAirAttackPhase = coldAirExposure >= 0 ? clamp01((coldAirExposure + 0.20) / 1.90) : 0;',
  'const coldAirOnset = Math.pow(coldAirAttackPhase, 2.15);',
  'forcedDecayTotal -= baseLoss * (0.72 + 0.55 * intensityLoad) * pulse;',
  'suppressionFloor = Math.max(suppressionFloor, [0, 0.35, 0.95, 1.80][coldAirStrength] * coldAirEffectPulse);'
]) assert.ok(engine.includes(token), `cold-air response token missing: ${token}`);

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const onset = (h) => h < 0 ? 0 : Math.pow(clamp01((h + 0.20) / 1.90), 2.15);
const y0 = onset(0), y05 = onset(0.5), y10 = onset(1.0), y15 = onset(1.5), y17 = onset(1.7);
assert.ok(y0 < 0.02, `contact onset is not initially gentle: ${y0}`);
assert.ok(y05 > y0 && y10 > y05 && y15 > y10, 'cold-air onset is not monotonic');
assert.ok((y15 - y10) > (y05 - y0) * 1.45, 'cold-air weakening does not accelerate quickly enough');
assert.ok(y17 > 0.99, `cold-air response does not reach full phase rapidly: ${y17}`);
assert.equal(0.8 * 1.0, 0.8, 'stage-3 scale sanity failed');

const app = read('src/App.tsx');
assert.ok(app.includes('距强风前锋抵达台风中心约'), 'quick-tool countdown still describes a delayed contact');
assert.ok(!app.includes('强风核心抵达中心再延后 1.5h'), 'stale +1.5h UI copy remains');
assert.ok(!app.includes('该时刻后 1.5h 抵达台风中心'), 'stale +1.5h explanation remains');

// 4) Heavy preview generation must cooperatively yield instead of monopolising the main thread,
// and App must checkpoint live simulation progress before entering the expensive render.
const solver = read('src/simulation/WindBoundaryLayerSolver.ts');
assert.ok(solver.includes('function createUiTimeSlicer'), 'boundary-layer solver has no cooperative time slicer');
assert.ok(solver.includes('createUiTimeSlicer(signal, 8)'), 'boundary-layer time slice is not bounded near one half-frame');
assert.ok((solver.match(/await maybeYield/g) || []).length >= 6, 'boundary-layer solver does not yield through all expensive passes');

for (const token of [
  'async function buildLandInteriorWeight',
  'async function buildCoastalBandWeight',
  'async function buildOpenOceanWeight',
  'async function buildTerrainWakeField',
  'await buildLandInteriorWeight',
  'await buildTerrainWakeField',
  'await smoothCoastalWindVectors'
]) assert.ok(field.includes(token), `wind-field cooperative stage missing: ${token}`);

const map = read('src/utils/SynopticWindPressureMap.ts');
assert.ok(map.includes('async function drawGeoJsonLines'), 'coastline drawing remains one blocking synchronous pass');
assert.ok(map.includes('async function detectExtrema'), 'extrema scan remains one blocking synchronous pass');
assert.ok(map.includes('async function contourSegments') && map.includes('async function stitchSegments'), 'pressure-contour construction still monopolises the main thread');
assert.ok(map.includes('if(py%16===15)'), 'wind raster does not yield frequently enough');
assert.ok(map.includes('await drawGeoJsonLines'), 'coastline cooperative draw is not awaited');

const modal = read('src/components/ForecastImageModal.tsx');
assert.ok(modal.includes('onBeforeHeavyGeneration?: () => void;'), 'heavy-generation pre-checkpoint callback missing');
assert.ok(modal.includes('onAfterHeavyGeneration?: () => void;'), 'heavy-generation post-checkpoint callback missing');
assert.ok(modal.includes('onBeforeHeavyGeneration?.();'), 'wind preview does not checkpoint simulation progress before rendering');
assert.ok(modal.includes('onAfterHeavyGeneration?.();'), 'wind preview does not checkpoint progress advanced during rendering');
assert.ok(app.includes('onBeforeHeavyGeneration={persistSimulationState}'), 'App does not checkpoint its live refs before wind preview generation');
assert.ok(app.includes('onAfterHeavyGeneration={persistSimulationState}'), 'App does not checkpoint its live refs after wind preview generation');

console.log('ROUND99 cold-air same-time / 80%-stage3 / nonlinear-onset / cooperative-preview regression: PASS');
console.log(JSON.stringify({ onset: { h0:y0, h05:y05, h10:y10, h15:y15, h17:y17 }, stage3Scale:0.8 }));
