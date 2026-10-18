const fs = require('fs');
const assert = require('assert');

const engine = fs.readFileSync('src/simulation/Engine.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const map = fs.readFileSync('src/components/MapView.tsx', 'utf8');
const types = fs.readFileSync('src/types.ts', 'utf8');

// Runtime simulation must be able to suppress forecast work completely.
assert(engine.includes('liveForecastMode?: "full" | "preview" | "off"'), 'stepSimulation forecast mode missing');
assert(engine.includes('if (liveForecastMode === "off") {\n          // No forecast-derived layer is visible.'), 'off mode must skip issue generation');
assert(engine.includes('let newForecastPath = liveForecastMode === "off" ? [] : ty.forecastPath;'), 'off mode must not carry stale live path');

// The main App must select forecast work from visible forecast-derived layers, not geography.
assert(app.includes('layers.forecast || layers.forecastCone || layers.hurricaneTrackerModels'), 'forecast demand layer gate missing');
const stepDispatches = [...app.matchAll(/liveForecastMode: needsLiveForecastGeometry\(layersRef\.current\) \? "preview" : "off"/g)].length;
assert(stepDispatches >= 2, 'both live loop and one-hour step must pass forecast demand mode');

// Preview path is geometry-only and advances in 3-hour chunks: 120h => 40 forecast integration steps.
assert(engine.includes('calculateLiveForecastTrackPath'), 'live preview wrapper missing');
assert(engine.includes('return calculateForecastPath(typhoon, config, targetHours, true, false, true, undefined, 3);'), 'live preview must use 3-hour integration');
assert(engine.includes('const stepSizeHours = pathOnly ? Math.max(1, Math.min(6, integrationStepHours)) : 1;'), 'formal physics must retain 1-hour step');
assert(engine.includes('previewOnly: stepSizeHours > 1 ? true : undefined'), 'preview geometry marker missing');
assert(types.includes('previewOnly?: boolean'), 'preview marker type missing');

// Product generation must reject coarse preview geometry and rebuild full 1-hour geometry.
assert(engine.includes('!geometryPath.some((point) => point?.previewOnly)'), 'product hydration must reject preview-only geometry');
assert(engine.includes('reusableGeometry || calculateForecastTrackPath(typhoon, config, targetHours, true)'), 'product hydration must rebuild full geometry');

// Live map fallbacks must also use the coarse preview path; otherwise one render can reintroduce a 120-step stall.
assert(!map.includes('calculateForecastTrackPath('), 'MapView must not run full forecast integrator');
assert(map.includes('calculateLiveForecastTrackPath(modelStorm, config, 168)'), 'multi-model live fallback must be preview');
assert(map.includes('calculateLiveForecastTrackPath(ty, config, 120)'), 'cone live fallback must be preview');

// App should have only the explicit intensity-editor full-path calculation left.
const appFullForecastCalls = [...app.matchAll(/calculateForecastTrackPath\(/g)].length;
assert.strictEqual(appFullForecastCalls, 1, `unexpected full forecast calls in App: ${appFullForecastCalls}`);
assert(app.includes('const geometry = calculateForecastTrackPath(mainTy, curveConfig, 240);'), 'extended 240h intensity editor full forecast calculation must remain explicit');

console.log('ROUND131 on-demand forecast performance regression: PASS');
console.log(JSON.stringify({
  hiddenLayerForecastStepsPerIssue: 0,
  livePreviewStepsPer120hIssue: 40,
  previousLiveStepsPer120hIssue: 120,
  previewReduction: '66.7%',
  formalProductIntegrationHours: 1,
  productRebuildsPreviewGeometry: true
}));
