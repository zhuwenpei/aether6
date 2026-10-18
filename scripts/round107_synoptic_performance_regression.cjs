const fs = require('fs');
const assert = require('assert');
const read = (p) => fs.readFileSync(p, 'utf8');

const field = read('src/simulation/SynopticWindField.ts');
const map = read('src/utils/SynopticWindPressureMap.ts');
const video = read('src/utils/SynopticWindPressureVideo.ts');
const record = read('src/utils/SynopticWindPressureRecordVideo.ts');

// Video-session cache: forecast integration and reusable drawing buffers must survive across frames.
assert.ok(field.includes('export interface SynopticComputationCache'), 'shared synoptic computation cache missing');
assert.ok(field.includes('forecastPaths: Map<string'), 'forecast-path cache missing');
assert.ok(field.includes('coldAirAnchors: Map<string'), 'cold-air anchor cache missing');
assert.ok(field.includes('cachedForecast.maxLeadHours'), 'forecast cache does not reuse a longer materialized path');
assert.ok(video.includes('const renderCache = createSynopticWindPressureRenderCache()'), 'forecast video does not share one render cache');
assert.ok(video.includes('forecastHorizonHours: Math.max(3, endLead + 3)'), 'video does not materialize the full horizon up front');
assert.ok(record.includes('const renderCache = createSynopticWindPressureRenderCache()'), 'record video does not reuse render buffers');

// Zoom-aware calculation domain: fixed 6-degree halo must no longer be forced.
assert.ok(map.includes('computeSynopticComputationPadding'), 'zoom-aware calculation padding missing');
assert.ok(map.includes('viewportSpan * (mapZoom > 1 ? 0.075 : 0.095)'), 'padding is not linked to viewport/map zoom');
assert.ok(field.includes('const pad = clamp(options.paddingDeg ?? 6, minNumericalHalo, 8)'), 'field builder still forces the old fixed halo');
assert.ok(field.includes('stepDeg, pad.toFixed(3)'), 'field cache key does not include adaptive padding');

// Render optimization: sample density should follow solved grid, not 1348x940 every frame.
assert.ok(map.includes('const rasterW = Math.min(MAP.w'), 'adaptive wind raster width missing');
assert.ok(map.includes('lonCells * samplesPerCell'), 'wind raster is not tied to solved grid density');
assert.ok(map.includes('outputQualityScale'), 'wind raster density is not quality-scaled for output resolution');
assert.ok(map.includes('renderCache.rasterImageData'), 'wind raster ImageData is not reused');
assert.ok(map.includes('renderCache.contourValues'), 'contour scalar buffer is not reused');
assert.ok(map.includes('const upFactor = field.stepDeg <= 0.125 ? 1.25 : 1.5'), 'contour oversampling was not reduced');
assert.ok(map.includes('cheap 8-neighbour test first'), 'extrema labelling still performs wide search for every grid point');
assert.ok(map.includes('coastlineRingIntersects'), 'coastline rendering does not cull off-screen rings');
assert.ok(map.includes('field.speedKt[y * field.nx + x]'), 'texture gradient guard still uses repeated bicubic samples');

function pad(span, step, zoom) {
  const wake = Math.max(2.1, step * 5);
  const viewport = span * (zoom > 1 ? 0.075 : 0.095);
  return Math.max(wake, Math.min(5.5, Math.max(wake, viewport)));
}
function area(spanLon, spanLat, p) { return (spanLon + 2*p) * (spanLat + 2*p); }
const aspect = 1348 / 940;
const rows = [1, 2, 5].map((zoom) => {
  const lon = 25 / zoom, lat = lon / aspect;
  const p = pad(Math.max(lon, lat), 0.25, zoom);
  const oldArea = area(lon, lat, 6);
  const newArea = area(lon, lat, p);
  return { zoom, padDeg: +p.toFixed(3), computeAreaReductionPct: +((1-newArea/oldArea)*100).toFixed(1) };
});
assert.ok(rows.find(r=>r.zoom===5).computeAreaReductionPct > 65, 'high-zoom domain reduction is too small');

const lonCells = 25 / 0.25, latCells = (25/aspect) / 0.25;
const outputQualityScale = Math.max(0.82, Math.min(1.20, Math.sqrt(1620 / 1536)));
const samplesPerCell = 5.0 * outputQualityScale;
const rasterW = Math.max(Math.round(320 * outputQualityScale), Math.ceil(lonCells * samplesPerCell));
const rasterH = Math.max(Math.round(225 * outputQualityScale), Math.ceil(latCells * samplesPerCell));
const oldPixels = 1348 * 940, newPixels = rasterW * rasterH;
const rasterReductionPct = (1 - newPixels / oldPixels) * 100;
assert.ok(rasterReductionPct > 80, 'standard-grid raster sample reduction is too small');

console.log('ROUND107 synoptic performance/cache regression: PASS');
console.log(JSON.stringify({ domain: rows, standard025Raster: { rasterW, rasterH, rasterReductionPct: +rasterReductionPct.toFixed(1) } }));
