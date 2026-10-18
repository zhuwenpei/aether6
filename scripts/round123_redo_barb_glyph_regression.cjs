const fs = require('fs');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const src = fs.readFileSync('src/utils/SynopticWindPressureMap.ts', 'utf8');

// Preserve the ROUND122 REDO reference palette / grid work.
assert(src.includes('const REFERENCE_WIND_BAND_RGB: Rgb[] = ['), 'reference band palette missing');
assert(src.includes('const totalCells = 44;'), '44-cell equal-height reference legend missing');
assert(src.includes('barbSpacingPx: 42, barbColor: "rgba(18,18,18,0.46)"') || src.includes('barbSpacingPx: 42, barbColor: "rgba(14,14,14,0.64)"'), 'reference barb mesh calibration missing');
assert(src.includes('const spacing = Math.max(36 * S, style.barbSpacingPx * S);'), 'fixed reference barb mesh missing');

// ROUND123 REDO measured feather geometry.
assert(src.includes('ROUND123 REDO: glyph geometry re-measured'), 'ROUND123 REDO geometry note missing');
assert(src.includes('const staff = 21.00 * S;') || src.includes('const staff = 21.00 * S * glyphScale;'), 'measured staff length missing');
assert(src.includes('const fullFeatherNormal = 9.75 * S;') || src.includes('const fullFeatherNormal = 9.75 * S * glyphScale;'), 'full feather normal component missing');
assert(src.includes('const fullFeatherForward = 4.05 * S;') || src.includes('const fullFeatherForward = 4.05 * S * glyphScale;'), 'full feather forward component missing');
assert(src.includes('const halfFeatherNormal = 5.35 * S;') || src.includes('const halfFeatherNormal = 5.35 * S * glyphScale;'), 'half feather normal component missing');
assert(src.includes('const halfFeatherForward = 2.20 * S;') || src.includes('const halfFeatherForward = 2.20 * S * glyphScale;'), 'half feather forward component missing');
assert(src.includes('const featherSpacing = 4.20 * S;') || src.includes('const featherSpacing = 4.20 * S * glyphScale;'), 'feather spacing missing');
assert(src.includes('a.x + px * fullFeatherNormal + dx * fullFeatherForward'), 'full feather endpoint geometry missing');
assert(src.includes('a.x + px * halfFeatherNormal + dx * halfFeatherForward'), 'half feather endpoint geometry missing');

// Pennants must be a separate broad triangle, with the apex pulled back toward the base midpoint.
assert(src.includes('const pennantNormal = 9.55 * S;') || src.includes('const pennantNormal = 9.55 * S * glyphScale;') || src.includes('const pennantNormal = 6.35 * S * glyphScale;'), 'pennant normal span missing');
assert(src.includes('const pennantBase = 6.30 * S;') || src.includes('const pennantBase = 6.30 * S * glyphScale;') || src.includes('const pennantBase = 4.75 * S * glyphScale;'), 'pennant staff-side base missing');
assert(src.includes('const pennantApexBack = 3.05 * S;') || src.includes('const pennantApexBack = 3.05 * S * glyphScale;') || src.includes('const pennantApexBack = 2.30 * S * glyphScale;'), 'pennant centered-apex offset missing');
assert(src.includes('const pennantAdvance = 6.95 * S;') || src.includes('const pennantAdvance = 6.95 * S * glyphScale;') || src.includes('const pennantAdvance = 4.95 * S * glyphScale;'), 'pennant spacing missing');
assert(src.includes('const baseFront = along(cursor);') && src.includes('const baseRear = along(cursor + pennantBase);'), 'pennant base construction missing');
assert(src.includes('baseFront.x + px * pennantNormal - dx * pennantApexBack'), 'pennant apex centering geometry missing');
assert(!src.includes('a.x + px * fullFeather + dx * fullForward'), 'old shared feather/pennant geometry returned');
assert(!src.includes('const fullForward = 0.95 * S;'), 'discarded ROUND123 near-perpendicular feather geometry returned');

console.log('ROUND123 REDO barb glyph reference regression: PASS');
