const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const engine = read('src/simulation/Engine.ts');
const drawer = read('src/components/ControlDrawer.tsx');
const mapView = read('src/components/MapView.tsx');
const defaults = read('src/config/DefaultSettings.ts');
const types = read('src/types.ts');
const synopticSource = read('src/simulation/SynopticEnvironment.ts');

function mustContain(source, needle, label) {
  assert(source.includes(needle), `${label}: missing ${needle}`);
}

assert.strictEqual(packageJson.version, '3.7.8', 'package version must be 3.7.8');
mustContain(engine, 'TyphoonSim/3.7.8', 'Engine User-Agent');

// Independent A/B gates: panels/layers and physics are separate and both default OFF.
mustContain(defaults, 'newEnvironmentPanelsEnabled: false', 'default panel gate');
mustContain(defaults, 'newEnvironmentPhysicsEnabled: false', 'default physics gate');
mustContain(drawer, '启用新气象和海洋预设 / 设置面板', 'debug panel toggle');
mustContain(drawer, '启用新气象 / 海洋对台风影响', 'debug physics toggle');
mustContain(drawer, '旧版气象预设 · 完全独立保留', 'legacy atmosphere preserved');
mustContain(drawer, '旧版海洋预设 · 完全独立保留', 'legacy ocean preserved');
mustContain(drawer, '{config.newEnvironmentPanelsEnabled && (', 'new panels gated independently');

const layerKeys = [
  'newSubtropicalHigh','newMonsoonTrough','newMonsoonLow','newItcz','newWesterlyJet',
  'newWesterlyTrough','newWesterlyRidge','newCutoffLow','newUpperColdLow','newTropicalHigh',
  'newContinentalHigh','newLowLatEasterlies','newMidLatWesterlies','newCrossEquatorialFlow',
  'newMonsoonFlow','newMeanFlow','newBetaEffect','newDryAir','newWindShear','newSstDetailed','newOhcDetailed'
];
for (const key of layerKeys) {
  mustContain(types, `${key}?: boolean`, `ActiveLayers ${key}`);
  mustContain(defaults, `${key}: false`, `default layer ${key}`);
  mustContain(drawer, `\"${key}\"`, `layer UI ${key}`);
}

// New physics must replace thermodynamic environment only when requested.
for (const fn of ['getSynopticOceanState','getSynopticAtmosState']) mustContain(engine, fn, 'Engine synoptic integration');
mustContain(engine, 'if (config.newEnvironmentPhysicsEnabled && fullSynopticSteering)', 'forecast/full steering gate');
mustContain(engine, 'getSynopticWesterlyLiveContribution', 'live-only westerly contribution');
mustContain(engine, 'return { u: synW.u * gate * 0.42, v: synW.v * gate * 0.42 };', 'live new steering isolation');
mustContain(engine, '!!config.newEnvironmentPhysicsEnabled', 'forecast full steering invocation');
mustContain(mapView, 'configRef.current.newEnvironmentPanelsEnabled && (', 'new diagnostic render gate');

// Build the standalone synoptic module without npm/npx. SimulationConfig is type-only at runtime.
const transpiled = ts.transpileModule(synopticSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
  reportDiagnostics: true,
  fileName: 'SynopticEnvironment.ts',
});
const syntaxErrors = (transpiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.strictEqual(syntaxErrors.length, 0, 'SynopticEnvironment.ts must transpile without syntax errors');
const temp = path.join(os.tmpdir(), `aether-synoptic-${process.pid}.cjs`);
fs.writeFileSync(temp, transpiled.outputText);
const syn = require(temp);
try { fs.unlinkSync(temp); } catch {}

assert.strictEqual(syn.SYNOPTIC_5D_PHASE_DATABASE.length, 21, '5-day DB must have 21 six-hour samples including closure');
for (let i = 0; i < 21; i++) assert.strictEqual(syn.SYNOPTIC_5D_PHASE_DATABASE[i].hour, i * 6, '5-day DB cadence');
assert.strictEqual(syn.DRY_SHEAR_10D_KEYFRAMES.length, 41, '10-day dry/shear DB must have 41 samples including closure');
assert.strictEqual(syn.SYNOPTIC_OCEAN_REGION_DATABASE.length >= 16, true, 'detailed ocean region DB must contain >=16 named regions');
assert.strictEqual(syn.SYNOPTIC_ATMOS_PRESETS.length >= 6, true, 'atmosphere preset count');
assert.strictEqual(syn.SYNOPTIC_OCEAN_PRESETS.length >= 5, true, 'ocean preset count');

const baseConfig = {
  newEnvironmentPanelsEnabled: true,
  newEnvironmentPhysicsEnabled: true,
  newAtmosPreset: 'wnp_monsoon_ridge', newAtmosTimeOffsetHours: 0, newAtmosTimeFlowEnabled: true,
  newAtmosFrozenBaseHour: 0, newAtmosAnomalyScale: 1, newAtmosSteeringScale: 1,
  newAtmosShearScale: 1, newAtmosHumidityBias: 0,
  newOceanPreset: 'wnp_climatology_mesoscale', newOceanTimeOffsetHours: 0, newOceanTimeFlowEnabled: true,
  newOceanFrozenBaseHour: 0, newOceanSstBias: 0, newOceanOhcScale: 1, newOceanMesoscaleScale: 1,
  betaDriftEnabled: true, betaDriftScale: 1,
};
const finite = (x, label) => assert(Number.isFinite(x), `${label} must be finite; got ${x}`);
const maxStateDiff = (a,b,keys) => Math.max(...keys.map(k => Math.abs(a[k]-b[k])));
const atmosKeys = ['u850','v850','u500','v500','u200','v200','h500','rh700','slp','shear','meanU','meanV'];

// Numerical sweep: every preset, multiple WNP locations and process times.
for (const p of syn.SYNOPTIC_ATMOS_PRESETS) {
  const cfg = { ...baseConfig, newAtmosPreset: p.id };
  for (const lat of [-4, 5, 15, 25, 35, 45, 55]) {
    for (const lon of [96, 110, 125, 140, 155, 170, 180]) {
      for (const hour of [0, 6, 24, 60, 119.9, 120, 180, 239.9, 240]) {
        const s = syn.getSynopticAtmosState(lat, lon, cfg, hour);
        for (const k of atmosKeys) finite(s[k], `${p.id} ${lat}/${lon} h${hour} ${k}`);
        assert(s.h500 >= 5200 && s.h500 <= 6000, `h500 range ${s.h500}`);
        assert(s.rh700 >= 15 && s.rh700 <= 98, `RH700 range ${s.rh700}`);
        assert(s.slp >= 970 && s.slp <= 1045, `SLP range ${s.slp}`);
        assert(s.shear >= 0 && s.shear <= 85, `shear range ${s.shear}`);
      }
    }
  }
}
for (const p of syn.SYNOPTIC_OCEAN_PRESETS) {
  const cfg = { ...baseConfig, newOceanPreset: p.id };
  for (const lat of [0, 8, 18, 28, 38, 50]) {
    for (const lon of [98, 112, 126, 140, 154, 170, 179]) {
      for (const hour of [0, 30, 60, 119.9, 120]) {
        const s = syn.getSynopticOceanState(lat, lon, cfg, hour);
        finite(s.sst, `${p.id} SST`); finite(s.ohc, `${p.id} OHC`);
        assert(s.sst >= 8 && s.sst <= 33, `SST range ${s.sst}`);
        assert(s.ohc >= 0 && s.ohc <= 220, `OHC range ${s.ohc}`);
      }
    }
  }
}

// Periodicity: base synoptic geometry is 120 h, the separate dry/shear overlay extends the full
// atmosphere to a 240 h super-cycle. Ocean fields close exactly every 120 h.
for (const p of syn.SYNOPTIC_ATMOS_PRESETS) {
  const cfg = { ...baseConfig, newAtmosPreset: p.id };
  for (const [lat,lon] of [[12,118],[24,132],[36,148],[48,160]]) {
    const a = syn.getSynopticAtmosState(lat,lon,cfg,0);
    const b = syn.getSynopticAtmosState(lat,lon,cfg,240);
    assert(maxStateDiff(a,b,atmosKeys) < 1e-9, `${p.id} atmosphere must close at 240 h`);
    const l = syn.getSynopticAtmosState(lat,lon,cfg,119.99);
    const r = syn.getSynopticAtmosState(lat,lon,cfg,120.01);
    assert(maxStateDiff(l,r,atmosKeys) < 0.75, `${p.id} must be continuous through 120 h wrap`);
    const k0 = syn.getSynopticAtmosState(lat,lon,cfg,5.99);
    const k1 = syn.getSynopticAtmosState(lat,lon,cfg,6.01);
    assert(maxStateDiff(k0,k1,atmosKeys) < 0.75, `${p.id} must be smooth through 6 h keyframes`);
  }
}
for (const p of syn.SYNOPTIC_OCEAN_PRESETS) {
  const cfg = { ...baseConfig, newOceanPreset: p.id };
  for (const [lat,lon] of [[8,112],[18,132],[28,143],[38,150]]) {
    const a = syn.getSynopticOceanState(lat,lon,cfg,0);
    const b = syn.getSynopticOceanState(lat,lon,cfg,120);
    assert(Math.max(Math.abs(a.sst-b.sst),Math.abs(a.ohc-b.ohc)) < 1e-9, `${p.id} ocean must close at 120 h`);
    const l = syn.getSynopticOceanState(lat,lon,cfg,119.99);
    const r = syn.getSynopticOceanState(lat,lon,cfg,120.01);
    assert(Math.max(Math.abs(l.sst-r.sst),Math.abs(l.ohc-r.ohc)) < 0.2, `${p.id} ocean must be continuous through wrap`);
  }
}

// Frozen clocks must be independent of simulation time; flowing clocks must actually evolve.
const frozenAtmos = { ...baseConfig, newAtmosTimeFlowEnabled: false, newAtmosFrozenBaseHour: 37, newAtmosTimeOffsetHours: 5 };
assert(maxStateDiff(
  syn.getSynopticAtmosState(24,135,frozenAtmos,0),
  syn.getSynopticAtmosState(24,135,frozenAtmos,999), atmosKeys
) < 1e-12, 'frozen atmosphere must not advance with simulation time');
const frozenOcean = { ...baseConfig, newOceanTimeFlowEnabled: false, newOceanFrozenBaseHour: 43, newOceanTimeOffsetHours: -7 };
const fo0 = syn.getSynopticOceanState(19,134,frozenOcean,0), fo1 = syn.getSynopticOceanState(19,134,frozenOcean,999);
assert(Math.max(Math.abs(fo0.sst-fo1.sst), Math.abs(fo0.ohc-fo1.ohc)) < 1e-12, 'frozen ocean must not advance');
const flow0 = syn.getSynopticAtmosState(24,135,baseConfig,0), flow1 = syn.getSynopticAtmosState(24,135,baseConfig,30);
assert(maxStateDiff(flow0,flow1,atmosKeys) > 0.05, 'flowing atmosphere must evolve');
const oo0 = syn.getSynopticOceanState(19,134,baseConfig,0), oo1 = syn.getSynopticOceanState(19,134,baseConfig,30);
assert(Math.max(Math.abs(oo0.sst-oo1.sst), Math.abs(oo0.ohc-oo1.ohc)) > 0.01, 'flowing ocean must evolve');

console.log('release_3_7_8_regression: PASS');
