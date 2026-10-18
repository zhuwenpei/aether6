const fs = require('fs');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read = (p) => fs.readFileSync(p, 'utf8');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const pkg = JSON.parse(read('package.json'));
assert(pkg.version === '5.2.31', 'version must be 5.2.31');

const engine = read('src/simulation/Engine.ts');
const app = read('src/App.tsx');
const map = read('src/components/MapView.tsx');
const modal = read('src/components/ForecastImageModal.tsx');
const city = read('src/utils/CityEmergencyModel.ts');
const video = read('src/utils/VideoRenderEngine.ts');
const types = read('src/types.ts');

// Standard forecast must be geometry-only on the simulation thread.
assert(engine.includes('export function calculateForecastTrackPath'), 'missing geometry-only standard forecast helper');
assert(engine.includes('return calculateForecastPath(typhoon, config, targetHours, fastMode, false, true)'), 'track helper must invoke pathOnly=true');
assert(engine.includes('newForecastPath = calculateForecastTrackPath(updatedTy, config, 120, true)'), 'live engine still materializes standard forecast intensity');
assert(!app.includes('calculateForecastPath('), 'App must not call full standard forecast intensity integrator');
assert(map.includes('calculateForecastTrackPath('), 'live map fallback must remain geometry-only');

const pathOnlyAt = engine.indexOf('if (pathOnly) {');
const fullPhysicsAt = engine.indexOf('// Full physics intensity engine evaluation along forecast path');
assert(pathOnlyAt > 0 && fullPhysicsAt > pathOnlyAt, 'pathOnly escape must occur before forecast intensity physics');
assert(engine.slice(pathOnlyAt, fullPhysicsAt).includes('intensityDeferred: true'), 'deferred standard path must be explicitly marked');
assert(engine.slice(pathOnlyAt, fullPhysicsAt).includes('vmax: Number.NaN') && engine.slice(pathOnlyAt, fullPhysicsAt).includes('pmin: Number.NaN'), 'live standard path must not expose fake intensity');

// Every hourly archive is a complete forecast reconstruction seed, including configuration.
assert(engine.includes('const { history: _historyForArchive, ...completeForecastSeed } = updatedTy as any'), 'complete live state is not archived as forecast seed');
assert(engine.includes('...completeForecastSeed') && engine.includes('configSnapshot: snapshotSimulationConfig(config)'), 'history seed/config snapshot missing');
assert(engine.includes('configSnapshot: snapshotSimulationConfig(config),\n        drawnRouteProgressKm'), 'live cyclone does not retain current config snapshot between archive hours');
assert(engine.includes('manualDryAirRegions: config.manualDryAirRegions?.map') && engine.includes('manualShearRegions: config.manualShearRegions?.map'), 'engine config snapshot drops manual environmental forcing');
assert(app.includes('manualDryAirRegions: cfg.manualDryAirRegions?.map') && app.includes('manualShearRegions: cfg.manualShearRegions?.map'), 'App config snapshot drops manual environmental forcing');
assert(types.includes('intensityDeferred?: boolean'), 'forecast-path persistence type lacks deferred marker');

// Target/forecast-peak controls are archived without needlessly recomputing geometry/intensity.
assert(app.includes('Forecast-peak edits do not change geometry.') && app.includes('Target-intensity edits do not change geometry.'), 'intensity-control edits still rebuild forecast geometry');
assert(app.includes('applyConfigPatch({ maxIntensityLimitEnabled: true, autoAdjustIntensity: e.target.checked })'), 'auto target toggle bypasses historical config persistence');
assert(app.includes('applyConfigPatch({ maxIntensityLimitEnabled: true, maxIntensityLimit: val })'), 'target slider bypasses historical config persistence');

// Product generation must hydrate intensity from saved state/config + archived geometry.
assert(modal.includes('const historicalConfig = activeHistoryState?.configSnapshot || baseConfigProps'), 'historical product config is not restored from issue archive');
assert(modal.includes('materializeForecastPath('), 'forecast image products do not materialize deferred intensity');
assert(modal.includes('...activeState,\n      active: !(activeState as any).dissipated'), 'one forecast product still rebuilds from lat/lon/intensity only');
assert(video.includes('resolveVideoForecastPath') && video.includes('materializeForecastPath(seed, issueConfig, horizon, geometry)'), 'video product does not hydrate deferred standard intensity');
assert(city.includes('forecastIntensityDeferred') && city.includes('const pointVmax = forecastIntensityDeferred ? Number(ty.vmax || 0)'), 'live city warning path cannot tolerate deferred standard intensity');

// Syntax-check all touched TypeScript/TSX units.
const files = [
  'src/simulation/Engine.ts', 'src/App.tsx', 'src/components/MapView.tsx',
  'src/components/ForecastImageModal.tsx', 'src/utils/JtwcForecastProduct.ts',
  'src/utils/CityEmergencyModel.ts', 'src/utils/VideoRenderEngine.ts', 'src/types.ts'
];
for (const f of files) {
  const out = ts.transpileModule(read(f), {
    fileName: f,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
  });
  const errors = (out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert(errors.length === 0, `${f} transpile errors: ${errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`);
}

console.log('Round 77 deferred forecast reconstruction regression: PASS');
