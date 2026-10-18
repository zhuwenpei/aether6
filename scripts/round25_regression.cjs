/** Round25: version bump and Mangkhut-sequence cloud realism terms compile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function load(name, injected = {}) {
  const result = ts.transpileModule(read(name), { fileName: name, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.equal((result.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0, `${name} syntax`);
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputText)(module, module.exports, id => {
    if (Object.hasOwn(injected, id)) return injected[id];
    throw Error(`unexpected runtime import ${id} from ${name}`);
  });
  return module.exports;
}
assert.equal(JSON.parse(read('package.json')).version, '4.3.13');
assert(read('index.html').includes('AETHER 4.3.13'));
const source = read('src/simulation/HurricaneTrackerPort.ts');
for (const token of ['formativeShield', 'majorWnpTyphoon', 'polewardOutflowShield', 'expandedEyeBase']) {
  assert(source.includes(token), `${token} present`);
}
const dynamics = load('src/simulation/ConvectiveDynamics.ts');
const cloud = load('src/simulation/HurricaneTrackerPort.ts', {'./ConvectiveDynamics': dynamics});
const formativeStorm = {
  id:'mangkhut-formative', lat:12.5, lon:146.2, vmax:25, pmin:994, rmw:85, shear:8,
  deepConvectiveCoverage:.55, moistureReservoir:.74, dryAirCoreExposure:.12, terrainCoreLandFraction:0,
  eyeRadiusKm:0, eyeClearance:.05, eyeObstruction:.85, eyeFormationMemory:.14, eyewallIntegrity:.20,
  eyewallWrapProgress:.24, secondaryEyewallStrength:0, ewrcState:'none', ewrcIsFailure:false, ewrcProgress:0,
  postPeakEnvelopeMemory:0, circulationExpansion:.10, outflowEfficiency:.45
};
const matureStorm = {
  id:'mangkhut-mature', lat:16.5, lon:124.8, vmax:72, pmin:905, rmw:62, shear:6,
  deepConvectiveCoverage:.92, moistureReservoir:.96, dryAirCoreExposure:.03, terrainCoreLandFraction:0,
  eyeRadiusKm:42, eyeClearance:.96, eyeObstruction:.03, eyeFormationMemory:.97, eyewallIntegrity:.95,
  eyewallWrapProgress:.96, secondaryEyewallStrength:.62, ewrcState:'recovering_success', ewrcIsFailure:false, ewrcProgress:.44,
  postPeakEnvelopeMemory:.52, circulationExpansion:.68, outflowEfficiency:.90
};
const formative = cloud.sampleHurricaneTrackerCloud(formativeStorm, 12.9, 146.45, 18, 'ir', 'round25-formative');
const core = cloud.sampleHurricaneTrackerCloud(matureStorm, 16.5, 124.8, 72, 'ir', 'round25-core');
const canopy = cloud.sampleHurricaneTrackerCloud(matureStorm, 19.0, 127.6, 72, 'ir', 'round25-canopy');
for (const sample of [formative, core, canopy]) {
  assert(Number.isFinite(sample.density) && Number.isFinite(sample.brightnessTemperatureC), 'finite IR sample');
}
assert(canopy.density > 0.01, 'poleward canopy should be represented');
console.log('round25_regression PASS:', JSON.stringify({
  formativeDensity:+formative.density.toFixed(3),
  coreTempC:+core.brightnessTemperatureC.toFixed(1),
  canopyDensity:+canopy.density.toFixed(3),
  canopyTempC:+canopy.brightnessTemperatureC.toFixed(1)
}));
