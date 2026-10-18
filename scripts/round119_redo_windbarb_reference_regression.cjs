const fs = require('fs');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const src = fs.readFileSync('src/utils/SynopticWindPressureMap.ts','utf8');

assert(src.includes('barbSpacingPx: 30, barbColor: "rgba(22,22,22,0.58)"'), 'HMON reference density/opacity calibration missing');
assert(src.includes('barbSpacingPx: 31, barbColor: "rgba(30,30,30,0.54)"'), 'HWRF reference density/opacity calibration missing');
assert(src.includes('const baseScale=1.65;'), 'reference-calibrated barb scale missing');
assert(src.includes('const minScale=1.18;') && src.includes('const shrinkStep=0.08;'), 'adaptive collision shrink calibration missing');
assert(src.includes('const collisionPad=Math.max(0.55*S,0.45);'), 'collision margin calibration missing');
assert(src.includes('const desiredCount=Math.max(120,Math.floor(mapArea/(nominalSpacing*nominalSpacing)*0.94));'), 'denser target population missing');
assert(src.includes('const candidateCount=Math.min(9000,Math.max(desiredCount*8,1600));'), 'expanded candidate pool missing');
assert(src.includes('const g1=0.7548776662466927;') && src.includes('const g2=0.5698402909980532;'), 'non-grid R2 placement missing');
assert(!src.includes('const cols = Math.max(12, Math.floor(MAP.w / style.barbSpacingPx));'), 'regular grid placement returned');
assert(src.includes('const REFERENCE_WIND_BIN_KT = 2;'), 'ROUND118 hard 2-kt colour bins were lost');
console.log('ROUND119 redo wind-barb reference regression: PASS');
