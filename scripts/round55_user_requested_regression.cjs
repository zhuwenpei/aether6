const fs = require('fs');
const path = require('path');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const read = p => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const map = read('src/components/MapView.tsx');
assert(/pendingGenesisIntensity/.test(map), 'genesis intensity state missing');
for (const v of [12,15,18]) assert(map.includes(`setPendingTyphoonGenesisIntensity(${v})`), `genesis option ${v} missing`);
assert(/onMapClickPlacementRef\.current\(point\.lat, point\.lon, pendingGenesisIntensity\)/.test(map), 'selected genesis intensity not forwarded');

const engine = read('src/simulation/Engine.ts');
assert(/requestedInitialVmax = 15\.0/.test(engine), 'spawn intensity parameter missing');
assert(/genesisIntensityHoldHours = initialVmax >= 17\.5 && initialVmax <= 18\.5 \? 3\.0 : 0/.test(engine), '18 m\/s hold shelf missing');
assert(/newVmax = Math\.min\(newVmax, genesisReference\)/.test(engine), 'genesis positive tendency cap missing');
assert(/genesisClassificationHoldActive/.test(engine) && /category = TyphoonCategory\.TD/.test(engine), 'genesis TD classification shelf missing');

const ens = read('src/simulation/AetherEnsembleGuidance.ts');
assert(/getGuidanceLandMetrics\(memberLat, memberLon/.test(ens), 'member-specific land sampling missing');
assert(/getGuidanceLandMetrics\(lat, lon/.test(ens), 'center-guidance land sampling missing');
assert(/function getGuidanceLandMetrics/.test(ens) && /getLandMetrics\(lat,lon/.test(ens), 'guidance land helper missing simulation/product coastline bridge');
assert(/landed:memberLanded/.test(ens) && /landed:guidanceLanded/.test(ens), 'guidance output does not carry actual member land state');
assert(/terrainExposure/.test(ens) && /landDecay/.test(ens), 'terrain-aware ensemble land decay missing');

const video = read('src/utils/VideoRenderEngine.ts');
assert(/windRadiiStyle === "JMA" \|\| !currentState\.landed/.test(video), 'JMA post-landfall wind radii gate missing');
assert((video.match(/calculateJmaWindCircleGeometry/g)||[]).length >= 3, 'shared JMA wind-radii geometry not used');
assert(/productLandGeoJson \|\| landGeoJson/.test(video), 'video does not prefer product coastline data');
assert(/2\.5 \+ level/.test(video), 'continuous/intermediate video zoom mapping missing');

const videoUi = read('src/components/VideoExportModal.tsx');
for (const v of ['1.5','2.5','3.5','4.5']) assert(videoUi.includes(`level: ${v}`), `video intermediate zoom ${v} missing`);
assert(/loadProductNaturalEarthData/.test(videoUi), 'video product coastline preload missing');

const rain = read('src/utils/ObservedRainfallMap.ts');
const chinaStart = rain.indexOf('if (domainMode === "china")');
const chinaEnd = rain.indexOf('// Fallback for a track with no China-sector samples.', chinaStart);
const china = rain.slice(chinaStart, chinaEnd);
assert(/wantLon=mapAspect\*latSpan/.test(china), 'China rainfall degree-space aspect correction missing');
assert(!/wantLon\s*=.*cos/.test(china), 'China rainfall branch still applies cosine to display aspect');

const seam = read('src/utils/ProductCoastlineDrawing.ts');
assert(/isProductCoastlineSeamSegment/.test(seam), 'product coastline seam suppression missing');
const chartFiles = [
  'src/components/ForecastImageModal.tsx',
  'src/components/TyphoonReportModal.tsx',
  'src/utils/ObservedRainfallMap.ts',
  'src/utils/EnsembleReferenceProducts.ts',
  'src/utils/JtwcForecastProduct.ts',
  'src/utils/WikiTrackMapProduct.ts'
];
for (const f of chartFiles) assert(read(f).includes('strokeProductCoastlineRing'), `seam-safe coastline stroke missing in ${f}`);

const product = JSON.parse(read('public/data/product_land_extended.geojson'));
const sim = JSON.parse(read('public/data/simulation_land_extended.geojson'));
function bounds(fc) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const walk = x => {
    if (Array.isArray(x) && x.length >= 2 && typeof x[0] === 'number' && typeof x[1] === 'number') {
      minX=Math.min(minX,x[0]); minY=Math.min(minY,x[1]); maxX=Math.max(maxX,x[0]); maxY=Math.max(maxY,x[1]);
    } else if (Array.isArray(x)) x.forEach(walk);
  };
  fc.features.forEach(f => f.geometry && walk(f.geometry.coordinates));
  return [minX,minY,maxX,maxY];
}
const pb = bounds(product), sb = bounds(sim);
assert(pb[0] <= -179 && pb[2] >= 179 && pb[1] <= -89 && pb[3] >= 80, `product coastline not global: ${pb}`);
assert(sb[0] <= 85.001 && sb[1] <= -19.999 && sb[2] >= 184.999 && sb[3] >= 69.999, `simulation coastline is not 5-degree expanded: ${sb}`);

console.log('Round 55 requested-fixes static regression: PASS');
console.log('product coastline bounds:', pb.join(', '));
console.log('simulation coastline bounds:', sb.join(', '));
