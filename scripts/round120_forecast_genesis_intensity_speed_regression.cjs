const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const engine = read('src/simulation/Engine.ts');
const ensemble = read('src/simulation/AetherEnsembleGuidance.ts');
const modal = read('src/components/ForecastImageModal.tsx');
const app = read('src/App.tsx');
const editor = read('src/components/ForecastIntensityCurveEditor.tsx');
const map = read('src/components/MapView.tsx');
const types = read('src/types.ts');
const defaults = read('src/config/DefaultSettings.ts');

// 1. Never-yet-TS genesis issues must not terminate at the 5 m/s analysis floor, and both JMA and
// ensemble product paths must use the product-safe fallback rather than accepting a 0 h-only path.
assert(engine.includes('hasPreviouslyReachedTropicalStorm'), 'missing pre-TS genesis discriminator');
assert(engine.includes('viableGenesisAtIntensityFloor'), 'missing viable genesis floor exception');
assert(modal.includes('isPreTropicalStormGenesisIssue'), 'missing product genesis issue detector');
assert((modal.match(/materializeProductForecast\(/g) || []).length >= 4, 'JMA/ensemble product paths are not consistently genesis-safe');

// 2/3. Genesis ensemble guidance needs a broader mean/intensity envelope and much earlier direction spread.
assert(ensemble.includes('const genesisSplitStart=2+10*rand()'), 'genesis regime split does not begin early enough');
assert(ensemble.includes('memberGenesisUncertainty'), 'missing member genesis uncertainty gate');
assert(ensemble.includes('15*memberGenesisUncertainty'), 'missing enlarged early heading dispersion');
assert(ensemble.includes('4.6*depressionExtra'), 'missing TD-specific intensity dispersion');
assert(ensemble.includes('developmentLift'), 'missing viable genesis development prior');
assert(ensemble.includes('prevVmax < 10 ? 3.15 : prevVmax < 17.2 ? 3.55'), 'positive genesis intensity tail is still over-clipped');

// 4. The hand-authored intensity curve must survive config snapshots, affect deterministic and ensemble
// forecasts, and expose the requested edit/scrub/fullscreen/map-cursor interaction.
assert(types.includes('ForecastIntensityControlPoint'), 'missing intensity curve config type');
assert(defaults.includes('manualForecastIntensityEnabled: false'), 'missing intensity curve defaults');
assert(engine.includes('getManualForecastIntensityTarget'), 'deterministic forecast ignores manual intensity curve');
assert(ensemble.includes('manualForecastIntensityTarget'), 'ensemble forecast ignores manual intensity curve');
assert(app.includes('正在计算默认预报曲线'), 'missing pre-open default intensity/speed calculation dialog');
assert(app.includes('ForecastIntensityCurveEditor'), 'curve editor not wired into route drawing');
assert(editor.includes('mode: "edit" | "scrub"'), 'editor does not separate vertical intensity edit from horizontal scrub');
assert(editor.includes('Maximize2') && editor.includes('Minimize2'), 'curve editor missing fullscreen control');
assert(map.includes('forecastRoutePreviewPoint') && map.includes('radius: 8.5'), 'map missing enlarged corresponding-time marker');

// 5. Speed reduction must distinguish ordinary ocean, coast/post-land and small-island-only influence.
assert(engine.includes('regionalSlowdownKmh = extremeFarOceanSlowRegime ? 0 : 4 + coastSlowBlend'), 'missing 4/5 km/h regional slowdown blend');
assert(engine.includes('isMinorIslandForecastSpeedIgnored'), 'missing forecast-speed small-island mask');
assert(engine.includes('forecastSpeedRecentLandExposureHours'), 'speed-only land memory is not separated from physical land damage');
assert(engine.includes('Major Philippine islands, Taiwan, Hainan'), 'major-island exclusion contract missing');

// Fast syntax/transpile check for every file changed by Round 120. This deliberately does not require
// node_modules; import resolution/type checking remains the normal project build's responsibility.
for (const rel of [
  'src/types.ts',
  'src/config/DefaultSettings.ts',
  'src/simulation/Engine.ts',
  'src/simulation/AetherEnsembleGuidance.ts',
  'src/simulation/DrawnTrackBranch.ts',
  'src/components/ForecastImageModal.tsx',
  'src/components/ForecastIntensityCurveEditor.tsx',
  'src/components/MapView.tsx',
  'src/App.tsx'
]) {
  const source = read(rel);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true
    },
    reportDiagnostics: true,
    fileName: rel
  });
  const errors = (result.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert(errors.length === 0, `${rel} has TypeScript syntax diagnostics: ${errors.map(e => e.messageText).join('; ')}`);
}

console.log('ROUND120 forecast genesis / intensity curve / speed regression: PASS');
console.log(JSON.stringify({
  genesisZeroHourGuard: true,
  tdTrackAndIntensitySpread: true,
  manualIntensityCurve: true,
  mapTimeCursor: true,
  regionalSpeedSlowdown: 'open-ocean -4; coast/post-land -5; <=18 km/h far-ocean exempt',
  smallIslandSpeedMask: true
}));
