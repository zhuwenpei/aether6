'use strict';
/** Round151: all Round149/150 eye-wall product calculation changed back to R148. */
const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert');
const wind = fs.readFileSync('src/simulation/SynopticWindField.ts');
const actualSha = crypto.createHash('sha256').update(wind).digest('hex');
const round148Sha = 'bb2b95d9c05742654261b3ec5678d957fdc0caa278b8d383e741930afc8b22b0';
assert.strictEqual(actualSha, round148Sha, 'SynopticWindField must be BYTE-IDENTICAL to Round148');
assert(!fs.existsSync('src/simulation/SynopticCoreRepair.ts'), 'remove the R149/150 eye repair module entirely');
const windText = wind.toString('utf8');
assert(!/repairSynopticCoreVectors|SynopticCoreRepair|synopticCoreRepair/.test(windText));
assert(!/eyeRadiusKm.*toFixed\(2\).*eyewallIntegrity/.test(windText));
// Round149/150 product layout, manual crop, aspect-ratio support retained.
const map=fs.readFileSync('src/utils/SynopticWindPressureMap.ts','utf8');
const app=fs.readFileSync('src/App.tsx','utf8');
const vid=fs.readFileSync('src/utils/SynopticWindPressureVideo.ts','utf8');
assert(map.includes('synopticProductLayout') && map.includes('synopticCropProject'));
assert(map.includes('if (layout.portrait)') && map.includes('synopticCropLatitudeAtRow'));
assert(app.includes('synopticCropLayout.mapAspect'));
assert(vid.includes('aspectRatio: options.aspectRatio'));
console.log('ROUND151 native R148 eye/eyewall calculation restored (exact SHA-256), R149+ crop/aspect retained: PASS');
