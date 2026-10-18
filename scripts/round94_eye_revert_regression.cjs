const fs = require('fs');
const path = require('path');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const read = p => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const pkg = JSON.parse(read('package.json'));
const vortex = read('src/simulation/TropicalCycloneVortex.ts');

assert(/^6\.0\.(1[7-9]|[2-9]\d)$/.test(pkg.version), `unexpected post-ROUND94 version ${pkg.version}`);

// ROUND93 item 1 must remain: product-only pressure micro-variation.
assert(vortex.includes('pressureMicroVariation'), 'pressure micro-variation was accidentally removed');
assert(vortex.includes('statePmin + pressureMicroVariation'), 'varied product pmin no longer applied');

// ROUND93 item 3 must be completely absent.
for (const token of [
  'matureEyeSymmetry',
  'innerEyeRoundGate',
  'pressureDistortionRetention',
  'eyeCenteredTranslationGate',
  'innerEyeAsymmetryRetention',
]) {
  assert(!vortex.includes(token), `ROUND93 eye-only token still present: ${token}`);
}

// Exact pre-ROUND93 inner-core formulas restored.
assert(vortex.includes(
  '1 + 0.30 * baroclinicShape * Math.cos(2 * (bearingRadForShape - baroclinicBearing))\n      + 0.06 * damage * Math.cos(bearingRadForShape - hollowBearing),\n    0.70, 1.38'
), 'pre-ROUND93 pressure-shape expression/bounds not restored');
assert(vortex.includes(
  'const translationWeight = Math.exp(-rawR / Math.max(140, r7Mean * 1.8));'
), 'pre-ROUND93 translation weighting not restored');
assert(vortex.includes(
  'const shearAsymmetry = 0.060 * (1 - 0.62 * strongCore);'
), 'pre-ROUND93 shear asymmetry not restored');

console.log('ROUND94 eye revert regression: PASS');
