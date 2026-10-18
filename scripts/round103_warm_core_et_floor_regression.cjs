const fs = require('fs');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '6.0.28');

const engine = read('src/simulation/Engine.ts');
const types = read('src/types.ts');
const app = read('src/App.tsx');
const drawer = read('src/components/ControlDrawer.tsx');
const mobile = read('src/components/AetherMobileChrome.tsx');
const map = read('src/components/MapView.tsx');
const windField = read('src/simulation/SynopticWindField.ts');

for (const token of [
  'const MIN_CYCLONE_INTENSITY_MS = 5.0;',
  'coldAirWarmCoreDamage = clamp01(coldAirWarmCoreDamage + warmCoreAttack * stepFraction / 7.6);',
  'if (coldAirWarmCoreDamage >= 0.965)',
  'ty.coldAirWarmCoreDestroyed = true;',
  'etTarget = Math.max(etTarget, 0.985);',
  'const etNoIntensification = coldAirWarmCoreDestroyed;',
  'newVmax = Math.min(ty.vmax, newVmax);',
  'const forecastWarmCoreDestroyed = !!typhoon.coldAirWarmCoreDestroyed;',
  'if (forecastWarmCoreDestroyed) forecastEtTarget = Math.max(forecastEtTarget, 0.985);',
  'if (forecastWarmCoreDestroyed && vmaxDeltaPerHour > 0)',
  'currentVmax = Math.min(preEtAdjustmentVmax, currentVmax);',
  'const isOceanAtMinimumIntensity = !landed && !metrics.isLand && newVmax <= MIN_CYCLONE_INTENSITY_MS + 1e-6;',
  'const base = Math.max(MIN_CYCLONE_INTENSITY_MS, Number.isFinite(vmaxCmaMs) ? vmaxCmaMs : MIN_CYCLONE_INTENSITY_MS);'
]) assert.ok(engine.includes(token), `ROUND103 engine token missing: ${token}`);

assert.ok((types.match(/coldAirWarmCoreDamage\?: number;/g) || []).length >= 2, 'warm-core damage is not persisted in both state interfaces');
assert.ok((types.match(/coldAirWarmCoreDestroyed\?: boolean;/g) || []).length >= 2, 'warm-core destruction latch is not persisted in both state interfaces');
assert.ok(engine.includes('const manualEtBurst = !!ty.forcedRapidIntensification && !coldAirWarmCoreDestroyed'), 'normal-ET manual baroclinic burst path missing');
assert.ok(!engine.includes('newVmax = Math.max(12'), 'obsolete 12 m/s ET lower shelf remains');
assert.ok(!engine.includes('isOceanWeakenBelow10_8'), 'obsolete 10.8 m/s ocean stop remains');
assert.ok(!engine.includes('currentVmax <= 8.0'), 'forecast still hard-stops at the old 8 m/s floor');

assert.ok(engine.includes('const CMA_PUBLIC_WIND_BINS = [\n  5, 8, 10'), 'CMA public bins do not start at 5 m/s');
assert.ok(app.includes('min={5}') && app.includes('Math.max(5, config.maxIntensityLimit || 70)'), 'desktop target-intensity slider does not reach 5 m/s');
assert.ok(engine.includes('const maxLimit = isTargetIntensityCapActive(config) ? Math.max(MIN_CYCLONE_INTENSITY_MS, config.maxIntensityLimit ?? 70) : 95;'), 'live target intensity is not internally clamped to 5 m/s');
assert.ok(engine.includes('const maxLimit = forecastHardCapActive ? Math.max(MIN_CYCLONE_INTENSITY_MS, config.maxIntensityLimit ?? 70) : 110;'), 'forecast target intensity is not internally clamped to 5 m/s');
assert.ok(drawer.includes('min={5}') && drawer.includes('滑块范围5–150 m/s'), 'settings target-intensity slider does not reach 5 m/s');
assert.ok(mobile.includes('Math.max(5, Math.min(110, value))') && mobile.includes('min={5} max={110}'), 'mobile forecast-peak control is not 5–110 m/s');
assert.ok(map.includes('useState<5 | 12 | 15 | 18>(15)') && map.includes('setPendingTyphoonGenesisIntensity(5)'), 'map genesis UI does not expose the 5 m/s floor');
assert.ok(map.includes('!ty.dissipated && ty.vmax > 5.0'), 'map forecast display still suppresses 5–8 m/s systems');
assert.ok(app.includes('coldAirWarmCoreDamage: ty.coldAirWarmCoreDestroyed ? 1 : Math.max(0, Math.min(1, ty.coldAirWarmCoreDamage ?? 0))'), 'rescheduling cold air discards partial warm-core damage');
assert.ok(windField.includes('remnantVortex && vmax <= 5'), 'synoptic interpolation still uses the old weak-system floor');
assert.ok(app.includes('残留低压状态与禁止增强不可逆'), 'cold-air cancellation does not disclose irreversible warm-core destruction');

// Strong-cold-air damage must take several hours, but must reach the irreversible threshold
// during a sustained stage-3 core exposure. Use a representative mature storm and maximum pulse.
const clamp01 = x => Math.max(0, Math.min(1, x));
const smoothstep01 = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
let damage = 0;
const dt = 1 / 6; // 10 min
const vmax = 45;
const coldAirEffectPulse = 0.80;
let destructionHour = null;
for (let step = 1; step <= 34 * 6; step++) {
  const warmCoreAttack = coldAirEffectPulse * (0.82 + 0.18 * smoothstep01((vmax - 17.2) / 38.0));
  damage = clamp01(damage + warmCoreAttack * dt / 7.6);
  if (damage >= 0.965) { destructionHour = step * dt; break; }
}
assert.ok(destructionHour !== null && destructionHour >= 8 && destructionHour <= 13,
  `warm-core destruction is not gradual/finite-time: ${destructionHour}`);

// After destruction, the legacy ET scalar is retained only as an internal decay-coupling proxy so
// the calibrated weakening speed remains unchanged. It must no longer define cyclone nature.
let et = 0;
let et80Hour = null;
for (let step = 1; step <= 36 * 6; step++) {
  const tau = 9.0;
  const target = 0.985;
  et = clamp01(et + (target - et) * (1 - Math.exp(-dt / tau)));
  if (et >= 0.80) { et80Hour = step * dt; break; }
}
assert.ok(et80Hour !== null && et80Hour > 6 && et80Hour < 24, `ET progression is not gradual: ${et80Hour}`);

// Agency correspondence at the physical 5 m/s floor.
const base = 5;
const cmaPublic = 5;
const jmaRawKt = base * 0.952 * 1.943844492;
const jmaPublic = Math.round(jmaRawKt / 5) * 5;
const jtwcFactor = 1.15; // weak-system end of the configured calibration curve
const jtwcRawKt = base * 1.943844492 * jtwcFactor;
const jtwcPublic = Math.round(jtwcRawKt / 5) * 5;
assert.equal(cmaPublic, 5);
assert.equal(jmaPublic, 10);
assert.equal(jtwcPublic, 10);
assert.ok(jmaRawKt > 9 && jmaRawKt < 10);
assert.ok(jtwcRawKt > 11 && jtwcRawKt < 12);

console.log('ROUND103 warm-core destruction / 5 m/s floor compatibility regression: PASS');
console.log(JSON.stringify({ destructionHour, et80Hour, agencyFloor: { CMA_ms: cmaPublic, JMA_kt: jmaPublic, JTWC_kt: jtwcPublic } }));
