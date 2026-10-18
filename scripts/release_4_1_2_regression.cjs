const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const count = (s, needle) => s.split(needle).length - 1;
const mustContain = (s, needle, label) => assert.ok(s.includes(needle), `${label} missing: ${needle}`);
const mustNotContain = (s, needle, label) => assert.ok(!s.includes(needle), `${label} must not contain: ${needle}`);

const pkg = JSON.parse(read('package.json'));
const engine = read('src/simulation/Engine.ts');
const precip = read('src/simulation/PrecipitationModel.ts');
const synoptic = read('src/simulation/SynopticEnvironment.ts');
const forecastImage = read('src/components/ForecastImageModal.tsx');
const satellite = read('src/components/SatelliteCloudModal.tsx');
const types = read('src/types.ts');
const status = read('src/components/TyphoonStatusCard.tsx');
const report = read('src/components/TyphoonReportModal.tsx');
const recon = read('src/components/AircraftReconModal.tsx');
const readme = read('README.md');

assert.strictEqual(pkg.version, '4.1.2', 'package version must be 4.1.2');
assert.strictEqual(pkg.scripts['test:release-4.1.2'], 'node scripts/release_4_1_2_regression.cjs');
mustContain(readme, '# TyphoonSIM 4.1.2', 'README');
mustContain(engine, 'TyphoonSim/4.1.2', 'Engine User-Agent');

// 1. Live + forecast 18 m/s plain shelf must remain mirrored and the former 27 h ceiling removed.
assert.strictEqual(count(engine, 'Math.min(22.5,'), 2, '4.1.2 shelf ceiling must exist in live and forecast exactly twice');
mustNotContain(engine, 'Math.min(27.0,', 'old plain shelf ceiling');
mustContain(engine, '6.5\n            + 4.8 * marineOverlap', 'live shortened shelf calibration');
mustContain(engine, '6.5\n          + 4.8 * marineOverlap', 'forecast shortened shelf calibration');

// 2/5/6. Structure states and Dvorak/wind-size coupling.
mustContain(precip, 'export function estimateDvorakTNumber', 'Dvorak proxy');
mustContain(engine, 'expectedR7ForIntensity', 'wind-size structure coupling');
mustContain(engine, 'dvorakOrganization', 'Dvorak structure organization');
for (const mode of [
  'failed_eye_opening', 'sheared_convective_burst', 'landfall_intact_cdo',
  'landfall_broken_eyewall', 'binary_interaction_sheared', 'binary_merger_reorganizing'
]) {
  mustContain(types, `| "${mode}"`, `structure mode ${mode}`);
  assert.ok(status.includes(mode) || report.includes(mode) || recon.includes(mode), `UI label missing for ${mode}`);
}
mustContain(satellite, 'failed_eye_opening', 'satellite failed eye rendering');
mustContain(satellite, 'landfall_intact_cdo', 'satellite landfall intact CDO rendering');

// 3. Marine-overlap water-vapor conveyor survives only as a diagnosed optional state.
mustContain(types, 'marineMoistureLink?: number;', 'marine moisture state field');
mustContain(engine, 'const marineLinkTarget = metrics.isLand', 'marine moisture diagnosis');
mustContain(engine, 'centrePlainnessForMarineLink', 'plain terrain gate');
mustContain(precip, 'marineMoistureLink', 'precip marine moisture use');

// 4. Ground radar is not a direct IR/omega conversion anymore.
mustContain(precip, 'export function computeGroundRadarReflectivity', 'ground radar diagnostic');
mustContain(forecastImage, 'computeGroundRadarReflectivity(activeState, lat, lon', 'forecast dBZ radar use');
mustNotContain(forecastImage, 'omega * 6.8', 'legacy blanket dBZ formula');
mustContain(precip, 'stratiformCap', 'stratiform reflectivity cap');
mustContain(precip, 'localCoreCell', 'localized convective radar cells');
mustContain(precip, 'compactCorePeak', 'compact intense-core radar peak scaling');

// 7. Pairwise Fujiwhara + VWS + collision/merger state.
mustContain(engine, 'function diagnoseBinaryCycloneInteractions', 'binary interaction diagnosis');
mustContain(engine, 'far3dGate', '3D far-range interaction branch');
mustContain(engine, 'inducedShearKt', 'binary induced shear');
mustContain(engine, 'direct vortex collision / merger', 'collision merger block');
mustContain(engine, 'binaryMergerRecoveryHours', 'merger reorganization recovery');
mustContain(engine, 'const binaryResidualShearKt = binaryMergerRecoveryPrior > 0', 'post-merger residual shear memory');
mustContain(engine, 'const binaryEffectiveShearKt = Math.max(binaryInteraction.inducedShearKt, binaryResidualShearKt);', 'effective binary shear');
mustContain(types, 'absorbedCycloneCount?: number;', 'absorption history');

// 8. New-atmosphere forecast steering must be broad-scale and must not inherit legacy high speed floors.
mustContain(synoptic, 'const samples: Array<[number, number, number]>', 'broad steering stencil');
mustContain(synoptic, 'const radiusLat = 3.15 + 0.85 * deep;', 'steering averaging radius');
mustContain(synoptic, 'const steerCap = 11.0 + 9.0', 'broad-flow cap');
mustContain(engine, 'const minSpeed = config.newEnvironmentPhysicsEnabled ? 0.9 : 2.8;', 'new environment anti-stall floor');
mustContain(engine, 'if (config.newEnvironmentPhysicsEnabled) {\n      // 4.1.2: do not force a synoptically weak-flow storm up to 15-18 km/h.', 'new environment speed branch');
mustContain(engine, 'const gyreCurvatureU = config.newEnvironmentPhysicsEnabled', 'legacy gyre curvature isolation');
mustContain(engine, 'const trochoidalAmp = config.newEnvironmentPhysicsEnabled', 'new environment reduced wobble');
mustContain(engine, 'const tropicalRadiusKm = 180 + 120 * clamp01((speedKmh - 10) / 24);', 'new environment curvature-radius continuity');
mustContain(engine, 'const minCurvatureRadiusKm = inWesterliesZone ? Math.max(120, tropicalRadiusKm * 0.68) : tropicalRadiusKm;', 'new environment tight-loop guard');
assert.ok(count(engine, 'dvorakTNumber: estimateDvorakTNumber(newVmax)') >= 2, 'final state/history Dvorak T-number must follow final step intensity');
mustContain(readme, '约350–450 km半径', 'README final new-environment scale');

for (const doc of ['UPDATE_NOTES_4.1.2.md', 'RESEARCH_BASIS_4.1.2.md']) {
  assert.ok(fs.existsSync(path.join(root, doc)), `${doc} missing`);
}

console.log('PASS release_4_1_2_regression');
