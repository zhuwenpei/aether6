const fs = require('fs');
const path = require('path');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const read = p => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const geo = JSON.parse(read('public/data/product_land_wide_v2.geojson'));
const natural = read('src/simulation/NaturalEarthLoader.ts');
const seam = read('src/utils/ProductCoastlineDrawing.ts');

assert(natural.includes('PRODUCT_COASTLINE_DETAIL_BOUNDS'), 'detailed product coastline bounds missing');
assert(natural.includes('west: 30') && natural.includes('south: -55') && natural.includes('eastWrapped: -140') && natural.includes('north: 90'), 'wide product belt constants incorrect');
assert(natural.includes('high-density') || natural.includes('genuinely detailed'), 'loader documentation still treats outer product data as generic low-res fallback');
assert(seam.includes('not a substitute for map coverage'), 'seam suppression is still described as the primary coverage fix');

let total=0, core=0, extension=0, fallback=0;
let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity;
const walk = node => {
  if (!Array.isArray(node)) return;
  if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
    const [lon,lat]=node; total++;
    minLon=Math.min(minLon,lon);maxLon=Math.max(maxLon,lon);minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat);
    const inCore = lon >= 65 && lon <= 180 && lat >= -20 && lat <= 90;
    const inExpanded = (lon >= 30 && lon <= 180 && lat >= -55 && lat <= 90) || (lon >= -180 && lon <= -140 && lat >= -55 && lat <= 90);
    if (inCore) core++; else if (inExpanded) extension++; else fallback++;
    return;
  }
  node.forEach(walk);
};
for (const f of geo.features || []) walk(f.geometry?.coordinates);

assert(core > 65000, `adjusted live-region detail was degraded: ${core} points`);
// v18 had only ~499 points in this belt; Round 56 must contain actual detailed geometry.
assert(extension > 5000, `35-degree product extension is still too sparse: ${extension} points`);
assert(total > 80000, `product coastline overall density unexpectedly low: ${total}`);
assert(minLon <= -179 && maxLon >= 179 && minLat <= -49 && maxLat >= 81, 'wide product coverage was lost');

console.log('Round 56 / current wide product coastline regression: PASS');
console.log(JSON.stringify({ total, core, extension, fallback, bounds:[minLon,minLat,maxLon,maxLat] }));
