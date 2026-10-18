const fs = require('fs');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '6.0.28');

const engine = read('src/simulation/Engine.ts');
const vortex = read('src/simulation/TropicalCycloneVortex.ts');
const precip = read('src/simulation/PrecipitationModel.ts');
const types = read('src/types.ts');
const status = read('src/utils/StormStatus.ts');
const cps = read('src/utils/CyclonePhaseSpaceProduct.ts');
const app = read('src/App.tsx');

// Split the normal poleward ET path from irreversible cold-air warm-core destruction.
for (const token of [
  'const etNoIntensification = coldAirWarmCoreDestroyed;',
  'const manualEtBurst = !!ty.forcedRapidIntensification && !coldAirWarmCoreDestroyed',
  'const baroclinicWindTarget = 16.5 + 14.0 * etBaroclinicGate',
  'const baroclinicBurstPhase = smoothstep01((extrTransition - 0.38) / 0.26)',
  'if (coldAirWarmCoreDestroyed) {\n        newVmax = Math.min(ty.vmax, newVmax);',
  'if (forecastWarmCoreDestroyed && vmaxDeltaPerHour > 0)',
  'if (forecastWarmCoreDestroyed) currentVmax = Math.min(preEtAdjustmentVmax, currentVmax);'
]) assert.ok(engine.includes(token), `ROUND104 split-path token missing: ${token}`);

assert.ok(!engine.includes('coldAirWarmCoreDestroyed || priorEtTransition >= 0.46'), 'normal ET is still trapped by old no-intensification gate');
assert.ok(!engine.includes('forecastWarmCoreDestroyed || forecastExtrTransition >= 0.46'), 'forecast normal ET is still trapped by old no-intensification gate');

// Explicit tropical -> subtropical -> frontal ET structural stages.
assert.ok(types.includes('| "subtropical_cyclone"'), 'subtropical structure mode missing');
assert.ok(engine.includes('else if (priorEtTransition >= 0.34) structureMode = "subtropical_cyclone";'), 'subtropical stage classification missing');
assert.ok(engine.includes('else if (priorEtTransition >= 0.72) structureMode = "extratropical_transition";'), 'late frontal-transition stage missing');
assert.ok(status.includes('>= 0.34) return "副热带气旋"'), 'status does not expose subtropical stage');
assert.ok(cps.includes('SUBTROPICAL · UPPER COLD / LOWER WARM'), 'CPS does not expose upper-cold/lower-warm subtropical thermodynamics');

// Wind field: subtropical is front-free with an outer wind maximum; fronts only mature later.
for (const token of [
  'const subtropicalOnset = smooth01((et - 0.28) / 0.24);',
  'const frontalPhase = smooth01((et - 0.68) / 0.22);',
  'const peripheralTarget = state.vmax * (0.72 + 0.18 * subtropicalPhase) * peripheralRing;',
  'if (frontalPhase > 0.01) {',
  'const frontalWindTarget = state.vmax * (0.68 + 0.16 * frontalPhase) * frontalRadial *'
]) assert.ok(vortex.includes(token), `ROUND104 vortex lifecycle token missing: ${token}`);
assert.ok(precip.includes('const frontalLifecycleGate = coldAirRemnantLow') && precip.includes(': smooth01(clamp(((state.extrTransition ?? 0) - 0.68) / 0.20, 0, 1));'), 'frontal rain is not delayed until late ET / remnant branch is not excluded');
assert.ok(precip.includes('structureMode === "subtropical_cyclone" ? 0.64 : 0'), 'subtropical precipitation morphology missing');

// Manual burst UI must only be locked by irreversible warm-core destruction.
assert.ok(app.includes('const etBurstBlocked = !!nextTy.coldAirWarmCoreDestroyed;'), 'manual burst still blocked for normal ET');
assert.ok(app.includes('const extratropicalBurstBlocked = !!activeTy && !!activeTy.coldAirWarmCoreDestroyed;'), 'rapid menu still blocks normal ET');
assert.ok(app.includes('手动爆发会转化为斜压能量驱动的受动爆发'), 'UI does not explain baroclinic burst conversion');

// Numeric phase sanity: subtropical stage has no fronts; mature ET has fronts.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = v => { const x = clamp(v, 0, 1); return x*x*(3-2*x); };
function phase(et) {
  const subOn = smooth((et - 0.28) / 0.24);
  const front = smooth((et - 0.68) / 0.22);
  return { sub: clamp(subOn * (1 - 0.82 * front), 0, 1), front };
}
const tropical = phase(0.15);
const subtropical = phase(0.50);
const lateTransition = phase(0.75);
const extratropical = phase(0.92);
assert.ok(tropical.sub < 0.01 && tropical.front < 0.01);
assert.ok(subtropical.sub > 0.75 && subtropical.front < 0.01, JSON.stringify(subtropical));
assert.ok(lateTransition.sub > 0.25 && lateTransition.front > 0.20, JSON.stringify(lateTransition));
assert.ok(extratropical.front > 0.95, JSON.stringify(extratropical));

// CPS thermodynamics sanity: upper core flips cold before lower core.
function therm(et, warm=0.36, vmax=28, core=0.35, outflow=0.45, disorg=0.35, stripping=0.35, westerlyHours=0.45) {
  const iw = clamp((vmax - 12) / 55, 0, 1);
  const upper = smooth((et - 0.28) / 0.30);
  const lower = smooth((et - 0.58) / 0.30);
  const vtl = clamp(18 + 78*warm + 22*iw + 12*core - 38*upper - 100*lower - 18*disorg - 10*westerlyHours, -150, 250);
  const vtu = clamp(8 + 82*warm + 24*outflow + 12*iw - 118*upper - 42*lower - 24*stripping - 14*westerlyHours, -150, 250);
  return { vtl, vtu };
}
const stTherm = therm(0.50);
const etTherm = therm(0.88, 0.10, 28, 0.15, 0.35, 0.65, 0.70, 0.8);
assert.ok(stTherm.vtl > 0 && stTherm.vtu < 0, `subtropical vertical thermal structure wrong: ${JSON.stringify(stTherm)}`);
assert.ok(etTherm.vtl < 0 && etTherm.vtu < 0, `extratropical cold core wrong: ${JSON.stringify(etTherm)}`);


// Execute the actual vortex sampler and verify that the wind maximum migrates continuously:
// eyewall/inner core -> far peripheral subtropical ring -> frontal corridor.
const ts = require('typescript');
const vm = require('vm');
const vortexJs = ts.transpileModule(vortex, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const vortexModule = { exports: {} };
vm.runInNewContext(vortexJs, { module: vortexModule, exports: vortexModule.exports, require, console, Math }, { filename: 'TropicalCycloneVortex.js' });
const sampleVortex = vortexModule.exports.sampleTropicalCycloneVortex;
const baseState = {
  lat: 30, lon: 135, vmax: 32, pmin: 985, direction: 35, speed: 36, rmw: 36, simHour: 24,
  r7: { ne: 270, se: 230, sw: 210, nw: 250 },
  r10: { ne: 150, se: 135, sw: 120, nw: 140 },
  r12: { ne: 95, se: 88, sw: 80, nw: 90 }, landed: false, dissipated: false
};
const env = { slp: 1012, shearU: 12, shearV: 8, westerlyStrength: 0.85 };
function scanWind(et) {
  const state = { ...baseState, extrTransition: et };
  let best = { wind: -1, r: 0, b: 0 };
  for (let r = 10; r <= 420; r += 5) {
    for (let b = 0; b < 360; b += 10) {
      const br = b * Math.PI / 180;
      const lat = state.lat + r * Math.cos(br) / 111.12;
      const lon = state.lon + r * Math.sin(br) / (111.12 * Math.cos(state.lat * Math.PI / 180));
      const q = sampleVortex(lat, lon, state, env);
      const wind10m = Math.hypot(q.u, q.v) * 0.86;
      if (wind10m > best.wind) best = { wind: wind10m, r, b };
    }
  }
  return best;
}
const tropicalWind = scanWind(0.10);
const subtropicalWind = scanWind(0.50);
const extratropicalWind = scanWind(0.92);
assert.ok(tropicalWind.r <= 60, `tropical max wind left eyewall/inner core: ${JSON.stringify(tropicalWind)}`);
assert.ok(subtropicalWind.r >= 120, `subtropical max wind did not migrate far outward: ${JSON.stringify(subtropicalWind)}`);
assert.ok(extratropicalWind.r >= 140, `ET max wind did not remain on broad/frontal band: ${JSON.stringify(extratropicalWind)}`);
const motion = baseState.direction * Math.PI / 180;
const sm = Math.hypot(env.shearU, env.shearV);
const axisX = 0.68 * Math.sin(motion) + 0.32 * env.shearU / sm;
const axisY = 0.68 * Math.cos(motion) + 0.32 * env.shearV / sm;
const warmFrontBearing = (Math.atan2(axisX, axisY) * 180 / Math.PI + 78 + 360) % 360;
const angleDiff = (a,b) => Math.abs(((a-b+540)%360)-180);
assert.ok(angleDiff(extratropicalWind.b, warmFrontBearing) <= 35 || angleDiff(extratropicalWind.b, (warmFrontBearing + 127) % 360) <= 35,
  `ET strongest wind is not aligned with a frontal corridor: best=${JSON.stringify(extratropicalWind)} warmFront=${warmFrontBearing}`);

console.log('ROUND104 subtropical / ET split regression: PASS');
console.log(JSON.stringify({ tropical, subtropical, lateTransition, extratropical, stTherm, etTherm, tropicalWind, subtropicalWind, extratropicalWind }));
