const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const mustContain = (s, needle, label) => assert.ok(s.includes(needle), `${label} missing: ${needle}`);

const pkg = JSON.parse(read('package.json'));
const precip = read('src/simulation/PrecipitationModel.ts');
const forecastImage = read('src/components/ForecastImageModal.tsx');
const engine = read('src/simulation/Engine.ts');
const readme = read('README.md');

assert.strictEqual(pkg.version, '4.1.3', 'package version must be 4.1.3');
assert.strictEqual(pkg.scripts['test:release-4.1.3'], 'node scripts/release_4_1_3_regression.cjs');
mustContain(readme, '# TyphoonSIM 4.1.3', 'README');
mustContain(engine, 'TyphoonSim/4.1.3', 'Engine User-Agent');

// 4.1.3 radar/IR decoupling and precipitation-microphysics structure.
mustContain(precip, 'export interface GroundRadarDiagnostics', 'radar diagnostics interface');
mustContain(precip, 'export function computeGroundRadarDiagnostics', 'radar diagnostics function');
mustContain(precip, 'const stratiformOrganization = clamp(', 'explicit stratiform organization');
mustContain(precip, 'const warmRainDbPenalty = clamp(', 'warm tropical drop-spectrum penalty');
mustContain(precip, 'const hotTowerActivation = smooth01', 'compact-core hot tower gate');
mustContain(precip, 'const cdoStratiformShare = matureCdoScene', 'CDO stratiform share');
mustContain(precip, 'const broadCdoConvectiveFill = matureCdoScene', 'CDO convective fill separation');
mustContain(precip, 'const cdoStratiformBackground = matureCdoScene', 'CDO stratiform background rain');
mustContain(forecastImage, '近地层基本反射率 (dBZ) 模拟雷达拼图', 'basic-reflectivity product label');

// Execute the actual TypeScript radar diagnostic without installing/building the app.
const transpiled = ts.transpileModule(precip, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
  fileName: 'PrecipitationModel.ts'
});
const errors = (transpiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
assert.strictEqual(errors.length, 0, 'PrecipitationModel.ts must transpile without syntax errors');
const mod = { exports: {} };
vm.runInNewContext(transpiled.outputText, {
  module: mod,
  exports: mod.exports,
  require: (id) => { throw new Error(`unexpected runtime import in PrecipitationModel: ${id}`); },
  Math,
  console
}, { filename: 'PrecipitationModel.js' });
const { computeGroundRadarDiagnostics } = mod.exports;
assert.strictEqual(typeof computeGroundRadarDiagnostics, 'function');

function scan(state, rangeKm = 220, stepKm = 4) {
  const cos = Math.cos(state.lat * Math.PI / 180);
  let max = 0, echo = 0, ge45 = 0, ge50 = 0, ge55 = 0, ge60 = 0;
  for (let y = -rangeKm; y <= rangeKm; y += stepKm) {
    for (let x = -rangeKm; x <= rangeKm; x += stepKm) {
      const lat = state.lat + y / 111.12;
      const lon = state.lon + x / (111.12 * cos);
      const v = computeGroundRadarDiagnostics(state, lat, lon, {}).dbz;
      if (v <= 0) continue;
      echo++;
      max = Math.max(max, v);
      if (v >= 45) ge45++;
      if (v >= 50) ge50++;
      if (v >= 55) ge55++;
      if (v >= 60) ge60++;
    }
  }
  return {
    max,
    frac45: ge45 / Math.max(1, echo),
    frac50: ge50 / Math.max(1, echo),
    frac55: ge55 / Math.max(1, echo),
    frac60: ge60 / Math.max(1, echo)
  };
}

const yagiLike = {
  lat: 19.5, lon: 112.2, vmax: 68, rmw: 28,
  r7: { ne: 350, se: 330, sw: 310, nw: 360 },
  cdoDiameterKm: 260, coreCompactness: 0.48, eyewallIntegrity: 0.92,
  deepConvectiveCoverage: 0.38, convectiveBurstIndex: 0.18, rainbandDominance: 0.52,
  eyeRadiusKm: 12, eyeClearance: 0.92, lowLevelVortexIntegrity: 0.95,
  moistureReservoir: 0.88, innerCoreMoisture: 0.90, shear: 10,
  simHour: 96, structureMode: 'mature_eyewall'
};
const broad = scan(yagiLike);
assert.ok(broad.max >= 47 && broad.max <= 53, `broad intense core max should be low-50s, got ${broad.max.toFixed(1)}`);
assert.ok(broad.frac45 > 0 && broad.frac45 < 0.01, `45+ dBZ must remain localized in broad core: ${broad.frac45}`);
assert.ok(broad.frac50 < 0.003, `50+ dBZ must not blanket broad mature CDO: ${broad.frac50}`);
assert.strictEqual(broad.frac60, 0, 'broad Yagi-like CDO should not default to 60+ dBZ');

const compactViolent = scan({
  ...yagiLike,
  vmax: 87, rmw: 13,
  r7: { ne: 150, se: 140, sw: 135, nw: 160 },
  cdoDiameterKm: 130, coreCompactness: 0.96, eyewallIntegrity: 0.98,
  deepConvectiveCoverage: 0.70, convectiveBurstIndex: 0.85, rainbandDominance: 0.28,
  eyeRadiusKm: 6, eyeClearance: 0.97, shear: 5, simHour: 74
});
assert.ok(compactViolent.max >= 60 && compactViolent.max <= 65.1, `compact violent core should permit sparse 60+ dBZ, got ${compactViolent.max.toFixed(1)}`);
assert.ok(compactViolent.frac60 > 0 && compactViolent.frac60 < 0.004, `60+ dBZ should be sparse, got ${compactViolent.frac60}`);
assert.ok(compactViolent.frac55 < 0.01, `55+ dBZ should remain localized, got ${compactViolent.frac55}`);

const eye = computeGroundRadarDiagnostics(yagiLike, yagiLike.lat, yagiLike.lon, {});
assert.ok(eye.dbz < 10, `clear eye should be a low-echo hole, got ${eye.dbz.toFixed(1)} dBZ`);

for (const doc of ['UPDATE_NOTES_4.1.3.md', 'RESEARCH_BASIS_4.1.3.md']) {
  assert.ok(fs.existsSync(path.join(root, doc)), `${doc} missing`);
}

console.log('PASS release_4_1_3_regression', { broad, compactViolent, eyeDbz: eye.dbz });
