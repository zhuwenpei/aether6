const fs = require('fs');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const src = fs.readFileSync('src/utils/SynopticWindPressureMap.ts', 'utf8');

assert(src.includes('ROUND125: the standard reference uses much flatter 50-kt pennants'), 'ROUND125 pennant calibration note missing');
assert(src.includes('const pennantNormal = 6.35 * S * glyphScale;'), 'flattened pennant normal span missing');
assert(src.includes('const pennantBase = 4.75 * S * glyphScale;'), 'shorter pennant base missing');
assert(src.includes('const pennantApexBack = 2.30 * S * glyphScale;'), 're-centered shallow pennant apex missing');
assert(src.includes('const pennantAdvance = 4.95 * S * glyphScale;'), 'tight pennant spacing missing');
assert(src.includes('const fullFeatherNormal = 9.75 * S * glyphScale;'), '10-kt feather geometry was unintentionally changed');
assert(src.includes('const halfFeatherNormal = 5.35 * S * glyphScale;'), '5-kt half-feather geometry was unintentionally changed');
assert(src.includes('const glyphScale = 1.18;'), 'ROUND124 barb size increase was lost');
assert((src.match(/barbColor: "rgba\(14,14,14,0\.64\)"/g) || []).length === 2, 'ROUND124 barb opacity was lost');

const staff = 21.00;
const normal = 6.35;
const base = 4.75;
const apexBack = 2.30;
const advance = 4.95;
assert(normal / staff < 0.31, 'pennant is still too tall relative to staff');
assert(base / staff < 0.23, 'pennant footprint is still too long along staff');
assert(advance - base <= 0.21, 'adjacent pennants are not packed tightly enough');
assert(Math.abs(apexBack - base / 2) < 0.1, 'pennant apex is no longer centered over its compact base');

console.log('ROUND125 flattened/tight pennant regression: PASS');
