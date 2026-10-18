'use strict';const fs=require('node:fs'),assert=require('node:assert/strict');
const product=fs.readFileSync('src/utils/StrikeProbabilityProduct.ts','utf8');
const ui=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
const engine=fs.readFileSync('src/utils/StrikeProbabilityField.ts','utf8');
for(const term of ['computeStrikeFieldStripes','STRIKE_MAX_CELLS','streamedRaster','buildStrikeSiteIndex',
  'computeSiteProbabilityIndexed','raster.width=raster.height=0','实际栅格'])assert(product.includes(term),`missing ${term}`);
assert(ui.includes('strikeStreamingCell(strikeGridEstimate,strikeCellDeg)'), 'UI should match renderer streaming budget');
for(const term of ['STRIKE_STREAM_DESKTOP_CELLS = 80_000_000','STRIKE_STREAM_MOBILE_CELLS = 16_000_000',
 'maxBandRows','AbortSignal','aborted(opt.signal)','onStripe','firstRow','coreStart','coreEnd'])assert(engine.includes(term));
assert(!product.includes('stripeRaster.width=meta.nx'));
console.log('ROUND185 STRIKE STREAM WIRING PASS: striped engine, renderer sampling, exact coast, UI caps and cleanup');
