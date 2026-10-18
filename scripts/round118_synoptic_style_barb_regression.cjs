const fs=require('fs');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg)};
const src=fs.readFileSync('src/utils/SynopticWindPressureMap.ts','utf8');

// New reference styles must use the same "interpolate meteorology then hard-quantize colour" idea as default.
assert(src.includes('const REFERENCE_WIND_BIN_KT = 2;'),'2-kt hard colour bins missing');
assert(src.includes('const REFERENCE_WIND_2KT_RGB'),'precomputed discrete reference palette missing');
assert(src.includes('Math.floor(speed / REFERENCE_WIND_BIN_KT)'),'display colour is not hard-quantised');
assert(src.includes('先插值风速、后量化着色'),'reference style hard-colour intent missing');
assert(!src.includes('Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),\n        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),\n        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t)\n      ];\n    }\n  }\n  return stops[stops.length - 1].rgb;\n}\n\nfunction formatUtc'), 'continuous per-pixel RGB interpolation still active');

// Wind barb size/collision/distribution behavior.
assert(src.includes('const baseScale=3.0;'),'reference wind barbs are not 3x');
assert(src.includes('const minScale=2.10;') && src.includes('const shrinkStep=0.15;'),'adaptive small-step collision shrink missing');
assert(src.includes('referenceWindBarbBounds(') && src.includes('referenceBarbBoundsOverlap('),'actual barb bounds collision logic missing');
assert(src.includes('referenceBarbBoundsInsideMap('),'map-edge collision protection missing');
assert(src.includes('const g1=0.7548776662466927;') && src.includes('const g2=0.5698402909980532;'),'low-discrepancy non-grid placement missing');
assert(!src.includes('const cols = Math.max(12, Math.floor(MAP.w / style.barbSpacingPx));'),'old column-grid placement still present');
assert(!src.includes('const rows = Math.max(8, Math.floor(MAP.h / style.barbSpacingPx));'),'old row-grid placement still present');
assert(src.includes('chosenScale-=shrinkStep;'),'collision does not reduce symbol size incrementally');

console.log('ROUND118 redo synoptic style/barb regression: PASS');
