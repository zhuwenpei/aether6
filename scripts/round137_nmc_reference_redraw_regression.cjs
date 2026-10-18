const assert = require('node:assert/strict');
const fs = require('node:fs');
const modal = fs.readFileSync('src/components/ForecastImageModal.tsx', 'utf8');
const chart = fs.readFileSync('src/utils/NmcForecastProduct.ts', 'utf8');
const standardOnly = modal.split('const drawStandardMapOnCanvas = async')[1].split('// Pre-generate a 1167x667 land mask array')[0];
// Entire old NMC canvas implementation must be gone, not masked with a cosmetic overlay.
assert(modal.includes('import { drawNmcForecastProduct }'), 'new independent NMC renderer must be imported');
assert(modal.includes('const drawStandardMapOnCanvas = async'), 'existing UI export entry must be retained');
assert(modal.includes('drawNmcForecastProduct({'), 'standard product must use the new renderer');
assert(!modal.includes('const getNmcConeRadiusKm ='), 'legacy NMC cone algorithm has not been removed');
assert(!modal.includes('buildCalloutBubblePath'), 'legacy speech-bubble code has not been removed');
assert(!standardOnly.includes('if (false && countriesGeoJson'), 'legacy hidden countries branch has not been removed');
assert(modal.includes('materializeProductForecast(issueStorm, config, forecastHours'), 'formal product must hydrate real forecast intensity on demand');
assert(modal.includes('imageStyle === "standard" ? "NMC 路径概率预报图"'), 'NMC product UI name not updated');
assert(chart.includes('const BASE_W = 1295;') && chart.includes('const BASE_H = 1103;'), 'reference canvas aspect changed');
assert(chart.includes('const MAP: Rect = { x: 22, y: 102, w: 1248, h: 819 };'), 'reference map frame changed');
for (const phrase of ['概率预报图', '北京时', '台风中心未来可能经过的区域', '强热带风暴', '温带气旋', '非官方发布']) {
  assert(chart.includes(phrase), `NMC required title / legend / disclaimer missing: ${phrase}`);
}
assert(chart.includes('for(let h=12;h<=o.forecastHours;h+=12)'), '12-hour product node boxes must be reconstructed from forecast data');
assert(chart.includes('isCmaTyphoonProductTime'), 'historical business dots must use CMA clock');
assert(chart.includes('ctx.setTransform(scale,0,0,scale,0,0)'), 'preview/export must share scaled canvas coordinates');
assert(chart.includes('const frame=buildGeoFrame(all,o.current)'), 'map must frame live data rather than hard-coded example geometry');
assert(chart.includes('drawGridMargins(ctx,frame,project)'), 'map coordinate axes are missing');
assert(chart.includes('drawLegend(ctx,forecast)'), 'three-column, two-row legend is missing');
assert(!chart.includes('GS (2019) 3082号'), 'a simulated product must not claim a real approval identifier');
assert(modal.includes('return [24, 48, 72, 96, 120].includes(stored) ? stored : 120;'), 'product horizons changed');
console.log('ROUND137 NMC reference-layout full-redraw regression: PASS');
