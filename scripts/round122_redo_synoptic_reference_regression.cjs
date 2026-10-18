const fs = require('fs');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const src = fs.readFileSync('src/utils/SynopticWindPressureMap.ts', 'utf8');

assert(src.includes('const REFERENCE_COLORBAR_TICKS = [7, 16, 25, 34, 40, 46, 52, 58, 64, 80, 96, 110, 125, 140, 155] as const;'), 'reference tick thresholds missing');
assert(src.includes('const REFERENCE_WIND_BAND_RGB: Rgb[] = ['), 'exact reference band table missing');
assert(src.includes('[127, 255, 253], [112, 237, 239], [95, 223, 226]'), '7-16 kt sampled cyan triplet missing');
assert(src.includes('[168, 1, 255], [183, 34, 255], [195, 70, 255]'), '64-80 kt sampled purple triplet missing');
assert(src.includes('[231, 71, 82], [204, 57, 79], [178, 40, 72]'), '140-155 kt sampled red triplet missing');
assert(src.includes('const REFERENCE_WIND_OVER_155_RGB: Rgb = [152, 25, 68];'), 'over-155 sampled colour missing');
assert(src.includes('const q = clamp((speedKt - lo) / Math.max(1e-6, hi - lo), 0, 0.999999);'), 'nonlinear threshold interpolation missing');
assert(src.includes('const sub = Math.min(2, Math.floor(q * 3));'), 'three cells per labelled interval missing');
assert(!src.includes('REFERENCE_WIND_BIN_KT'), 'old fixed-2kt reference scale still present');
assert(src.includes('const totalCells = 44;'), '44-cell reference legend geometry missing');
assert(src.includes('const y = by + cellH * (43 - i * 3);'), 'equal-height reference tick placement missing');

assert(src.includes('barbSpacingPx: 42, barbColor: "rgba(18,18,18,0.46)"') || src.includes('barbSpacingPx: 42, barbColor: "rgba(14,14,14,0.64)"'), 'reference barb density/opacity calibration missing');
assert(src.includes('const spacing = Math.max(36 * S, style.barbSpacingPx * S);'), 'fixed screen-regular barb spacing missing');
assert(src.includes('Do not blue-noise scatter, jitter, stagger, collision-delete, or adaptively shrink symbols.'), 'regular-grid barb intent missing');
assert(!src.includes('const g1=0.7548776662466927;'), 'old R2 scattered barb placement still present');
assert(src.includes('const staff = 21.85 * S;') || src.includes('const staff = 21.00 * S;') || src.includes('const staff = 21.00 * S * glyphScale;'), 'measured reference staff length missing');
assert(src.includes('const fullFeather = 11.50 * S;') || src.includes('const fullFeatherNormal = 9.75 * S;') || src.includes('const fullFeatherNormal = 9.75 * S * glyphScale;'), 'measured reference feather geometry missing');
assert(src.includes('const fullForward = 3.30 * S;') || src.includes('const fullFeatherForward = 4.05 * S;') || src.includes('const fullFeatherForward = 4.05 * S * glyphScale;'), 'reference feather angle calibration missing');
assert(src.includes('ctx.lineCap = "butt";') && src.includes('ctx.lineJoin = "miter";'), 'reference line cap/join missing');

console.log('ROUND122 REDO synoptic reference regression: PASS');
