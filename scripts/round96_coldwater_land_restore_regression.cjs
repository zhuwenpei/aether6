const fs = require('fs');
const assert = require('node:assert/strict');

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const engine = fs.readFileSync('src/simulation/Engine.ts','utf8');
const field = fs.readFileSync('src/simulation/SynopticWindField.ts','utf8');

assert.ok(/^6\.0\.(19|2[0-9]|[3-9]\d)$/.test(pkg.version), `unexpected post-ROUND96 version ${pkg.version}`);

// Cold-water live-step path must not call an undefined clamp helper. This was the immediate-pause root cause.
assert.ok(engine.includes('if (forcedColdWaterActive) sstVal = Math.max(0, Math.min(30, forcedColdWaterTemperature));'), 'safe cold-water temperature bound missing');
assert.equal((engine.match(/forcedColdWaterActive\) sstVal = clamp\(/g) || []).length, 0, 'undefined clamp() remains in cold-water path');
assert.equal((engine.match(/forcedColdWaterActive\) sstVal = Math\.max\(0, Math\.min\(30, forcedColdWaterTemperature\)\);/g) || []).length, 2, 'both cold-water SST application points must use the safe bound');

// Restore the originally uploaded 6.0.14 land attenuation mechanics exactly at the three points later changed in ROUND92.
assert.ok(field.includes('const dragInterior = 0.26 + 0.74 * interior'), 'original 26% first-land-cell drag coupling not restored');
assert.ok(field.includes('const targetFloor = backgroundTarget10mMs[k] * (landMask[k] ? 0.96 : 0.99);'), 'original land background target floor not restored');
assert.ok(field.includes('const restore = restoreGate * (landMask[k] ? (0.58 + 0.28 * deficit) : (0.90 + 0.08 * deficit));'), 'original land background restore gain not restored');
assert.ok(!field.includes('const lowlandCapKt = 12.2 + highLatAllowance'), 'ROUND92 land hard cap still present');
assert.ok(!field.includes('const elevPenalty = 0.48 * smooth01((elevationM[k] - 80) / 1900)'), 'ROUND92 elevation hard-cap block still present');

// These literal coefficients are the recorded 6.0.14 baseline retained by ROUND96. Keeping this
// regression self-contained avoids depending on an external extraction directory.
for (const needle of [
  'const dragInterior = 0.26 + 0.74 * interior',
  'const targetFloor = backgroundTarget10mMs[k] * (landMask[k] ? 0.96 : 0.99);',
  'const restore = restoreGate * (landMask[k] ? (0.58 + 0.28 * deficit) : (0.90 + 0.08 * deficit));'
]) assert.ok(field.includes(needle), `6.0.14 land baseline missing: ${needle}`);

// Cold-air event remains available; only generic land attenuation was reverted.
assert.ok(field.includes('coldAirSurfaceSignal') && field.includes('taiwanStraitWeight') && field.includes('bashiWeight'), 'cold-air event was accidentally removed');
assert.ok(field.includes('absoluteColdAirCeilingMs = 46 * 0.514444'), 'cold-air marine ceiling was accidentally removed');

console.log('round96_coldwater_land_restore_regression: PASS');
