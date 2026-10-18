const fs = require('fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('vm');
const read = p => fs.readFileSync(p, 'utf8');
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '6.0.28');

const engine = read('src/simulation/Engine.ts');
const types = read('src/types.ts');
const vortex = read('src/simulation/TropicalCycloneVortex.ts');
const precip = read('src/simulation/PrecipitationModel.ts');
const status = read('src/utils/StormStatus.ts');
const app = read('src/App.tsx');

// Nature split: only the 32 kt / stage-3 warm-core-destruction path becomes a remnant low.
assert.ok(types.includes('RL = "残留低压"'), 'remnant-low category missing');
assert.ok(types.includes('| "cold_air_remnant_low"'), 'remnant-low structure mode missing');
assert.ok(engine.includes('if (coldAirWarmCoreDestroyed) structureMode = "cold_air_remnant_low";'), 'destroyed warm core still enters subtropical/ET structure mode');
assert.ok(engine.includes('category = TyphoonCategory.RL;'), 'destroyed warm core is not classified as remnant low');
assert.ok(status.includes('return "残留低压云团"'), 'status panel does not expose remnant-low nature');
assert.ok(app.includes('不进入副热带/温带气旋阶段'), 'UI does not explain the strong-cold-air remnant outcome');

// Preserve the existing weakening calibration. ROUND105 changes cyclone nature / field only.
for (const token of [
  'const coldAirImpactScale = coldAirStrength === 3 ? 0.80 : 1.0;',
  'const baseLoss = [0, 0.85, 1.75, 3.20][coldAirStrength];',
  'forcedDecayTotal -= baseLoss * (0.72 + 0.55 * intensityLoad) * pulse;',
  'coldAirWarmCoreDamage = clamp01(coldAirWarmCoreDamage + warmCoreAttack * stepFraction / 7.6);'
]) assert.ok(engine.includes(token), `cold-air weakening calibration changed unexpectedly: ${token}`);

// Internal ET scalar may remain for decay coupling, but it may not create ET nature or ET stop rules.
assert.ok(engine.includes('if (!coldAirWarmCoreDestroyed && extrTransition >= 0.8)'), 'live ET timer is not isolated from remnant-low path');
assert.ok(engine.includes('!coldAirWarmCoreDestroyed && etHours >= 12.0'), 'live ET stop-numbering still applies to remnant low');
assert.ok(engine.includes('if (!forecastWarmCoreDestroyed && forecastExtrTransition >= 0.8)'), 'forecast ET timer is not isolated from remnant-low path');
assert.ok(engine.includes('if (forecastWarmCoreDestroyed) category = TyphoonCategory.RL;'), 'forecast still labels destroyed warm core as ET');

// No fronts/subtropical annulus in the wind or rainfall products after destruction.
assert.ok(vortex.includes('const et = coldAirRemnantLow ? 0 : clamp(state.extrTransition || 0, 0, 1);'), 'wind field still applies ET morphology to remnant low');
assert.ok(vortex.includes('redistribute the wind product into a broad, ragged remnant-low cloud/wind shield'), 'remnant wind morphology missing');
assert.ok(precip.includes('const westerlyTransition = coldAirRemnantLow ? 0 : clamp(Math.max('), 'remnant cloud field can still generate ET conveyor/frontal morphology');
assert.ok(precip.includes('const frontalLifecycleGate = coldAirRemnantLow'), 'frontal rainfall gate does not block remnant low');

// Execute actual vortex sampler. A destroyed 30 m/s tropical vortex must lose its eyewall peak,
// remain much weaker in the closed circulation product, and not jump to the ET frontal radius.
const vortexJs = ts.transpileModule(vortex, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(vortexJs, { module: mod, exports: mod.exports, require, console, Math }, { filename: 'TropicalCycloneVortex.js' });
const sample = mod.exports.sampleTropicalCycloneVortex;
const base = {
  lat: 25, lon: 128, vmax: 30, pmin: 985, direction: 210, speed: 18, rmw: 35, simHour: 24,
  r7: { ne: 250, se: 230, sw: 220, nw: 240 }, r10: { ne: 140, se: 130, sw: 120, nw: 135 },
  r12: { ne: 90, se: 85, sw: 78, nw: 88 }, landed: false, dissipated: false,
  extrTransition: 0.95, coldAirExposureHours: 16
};
const env = { slp: 1014, shearU: 10, shearV: 5, westerlyStrength: 0.85 };
function scan(state) {
  let best = { wind: -1, r: 0, b: 0 };
  for (let r = 5; r <= 400; r += 5) for (let b = 0; b < 360; b += 10) {
    const br = b * Math.PI / 180;
    const lat = state.lat + r * Math.cos(br) / 111.12;
    const lon = state.lon + r * Math.sin(br) / (111.12 * Math.cos(state.lat * Math.PI / 180));
    const q = sample(lat, lon, state, env);
    const wind = Math.hypot(q.u, q.v) * 0.86;
    if (wind > best.wind) best = { wind, r, b };
  }
  return best;
}
const tropical = scan({ ...base, extrTransition: 0, coldAirWarmCoreDestroyed: false });
const normalEt = scan({ ...base, coldAirWarmCoreDestroyed: false });
const remnant = scan({ ...base, coldAirWarmCoreDestroyed: true });
assert.ok(tropical.r <= 60, `control tropical eye-wall maximum moved unexpectedly: ${JSON.stringify(tropical)}`);
assert.ok(normalEt.r >= 140, `control ET frontal/outer maximum missing: ${JSON.stringify(normalEt)}`);
assert.ok(remnant.r >= 70 && remnant.r <= 135, `remnant maximum should be broad/diffuse rather than eyewall or frontal: ${JSON.stringify(remnant)}`);
assert.ok(remnant.wind < tropical.wind * 0.75, `closed remnant vortex did not collapse enough in wind product: ${JSON.stringify({tropical, remnant})}`);

console.log('ROUND105 strong-cold-air remnant-low regression: PASS');
console.log(JSON.stringify({ tropical, normalEt, remnant }));
