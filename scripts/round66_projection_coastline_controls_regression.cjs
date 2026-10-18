const fs = require('fs');
const path = require('path');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const read = p => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const video = read('src/utils/VideoRenderEngine.ts');
const videoUi = read('src/components/VideoExportModal.tsx');
const wiki = read('src/utils/WikiTrackMapProduct.ts');
const report = read('src/components/TyphoonReportModal.tsx');
const projection = read('src/utils/MapProjection.ts');
const engine = read('src/simulation/Engine.ts');
const loader = read('src/simulation/NaturalEarthLoader.ts');
const app = read('src/App.tsx');
const chrome = read('src/components/AetherMobileChrome.tsx');
const map = read('src/components/MapView.tsx');

assert(videoUi.includes('jmaAzimuthalEqualAreaProjection'), 'JMA LAEA toggle missing');
assert(video.includes('createLambertAzimuthalEqualAreaProjector') && video.includes('useJmaAzimuthalProjection'), 'JMA LAEA renderer missing');
assert(video.includes('drawRasterBasemapLambertAzimuthalEqualArea') && video.includes('const effectiveBaseMap: VideoExportConfig["baseMap"] = exportConfig.baseMap'), 'LAEA mode does not reproject the selected basemap');
assert(video.includes('ctx.arc(c.x, c.y, radiusPx'), 'JMA wind circles are not preserved as screen-space circles');
assert(projection.includes('Lambert Azimuthal Equal-Area') && projection.includes('createPlateCarreeProjector'), 'projection helpers missing');

assert(report.includes('wikiEquirectangularProjection') && report.includes('report_wikiEquirectangularProjection'), 'Wiki Plate Carree toggle/persistence missing');
assert(wiki.includes('useEquirectangularProjection') && wiki.includes('drawBlueMarble2004Equirectangular'), 'Wiki equirectangular basemap path missing');
assert(wiki.includes('Preview intentionally uses a simplified offline coastline'), 'Wiki preview is not explicitly coarse/offline');

assert(engine.includes('const stickMagnitude = clamp01(Math.hypot(effectiveDx, effectiveDy))') && engine.includes('const environmentalShare = 1 - smoothstep01(stickMagnitude)'), 'continuous all-direction joystick blending missing');
assert(!engine.includes('etControlFreedom') && !engine.includes('meridionalRelease'), 'obsolete ET-dependent joystick restriction still present');
assert(engine.includes('forecastExtrTransition < 0.96') && engine.includes('southwardFloor'), 'forecast ET meridional release missing');
assert(engine.includes('Math.max(-20, Math.min(88, newLat))') && engine.includes('Math.max(65, Math.min(220, newLon))'), 'expanded live-domain bounds missing');
assert(engine.includes('currentLon >= 218.0'), 'old east-boundary termination was not moved');

for (const f of [
  'public/data/simulation_land_asymmetric_v2.geojson',
  'public/data/simulation_countries_asymmetric_v2.geojson',
  'public/data/product_land_wide_v2.geojson',
  'public/data/product_countries_wide_v2.geojson'
]) assert(fs.existsSync(f), `missing GIS dataset ${f}`);
assert(loader.includes('simulation_land_asymmetric_v2.geojson'), 'live expanded coastline is not loaded');
assert(loader.includes('product_land_wide_v2.geojson'), 'wide product coastline is not loaded');
assert(loader.includes('PRODUCT_COASTLINE_RENDER_MARGIN_DEG = 35'), 'product coastline margin is not 35 degrees');
const liveLoadBody = loader.slice(loader.indexOf('export async function loadNaturalEarthData'), loader.indexOf('let productLoadPromise'));
assert(!liveLoadBody.includes('product_land_wide_v2') && !liveLoadBody.includes('productCountriesGeoJson'), 'live loader can reach product GIS data');

function bounds(file) {
  const geo = JSON.parse(read(file));
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,points=0;
  const walk = n => {
    if (!Array.isArray(n)) return;
    if (n.length >= 2 && typeof n[0] === 'number' && typeof n[1] === 'number') {
      minX=Math.min(minX,n[0]); minY=Math.min(minY,n[1]); maxX=Math.max(maxX,n[0]); maxY=Math.max(maxY,n[1]); points++; return;
    }
    n.forEach(walk);
  };
  for (const f of geo.features || []) walk(f.geometry?.coordinates);
  return {minX,minY,maxX,maxY,points};
}
const live = bounds('public/data/simulation_land_asymmetric_v2.geojson');
const product = bounds('public/data/product_land_wide_v2.geojson');
assert(live.points > 60000, `live coastline unexpectedly sparse: ${live.points}`);
assert(product.points > live.points, `product coastline is not wider/denser: ${product.points} <= ${live.points}`);
assert(loader.includes('west: 30') && loader.includes('south: -55') && loader.includes('eastWrapped: -140'), '35-degree product envelope constants missing');

for (const src of [app, chrome, map]) {
  assert(!/isDryAirDrawing|isShearDrawing|dryAirDraft|shearDraft|onDryAirPoint|onShearPoint|绘制干空气|绘制强风切/.test(src), 'manual dry-air/shear placement UI/runtime still present');
}
assert(app.includes('manualDryAirRegions = []') && app.includes('manualShearRegions = []'), 'legacy saved manual environment regions are not cleared');

console.log('Round 66 projection/coastline/control regression: PASS');
console.log({ live, product });
