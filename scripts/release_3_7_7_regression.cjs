const fs = require('fs');
const path = require('path');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const read = (p) => fs.readFileSync(p, 'utf8');

const pkg = JSON.parse(read('package.json'));
const app = read('src/App.tsx');
const defaults = read('src/config/DefaultSettings.ts');
const splash = read('src/components/AetherLaunchSequence.tsx');
const css = read('src/index.css');
const map = read('src/components/MapView.tsx');
const station = read('src/components/StationEmergencyDetail.tsx');
const capability = read('src/utils/DisasterPreparednessModel.ts');
const city = read('src/utils/CityEmergencyModel.ts');
const engine = read('src/simulation/Engine.ts');
const natural = read('src/simulation/NaturalEarthLoader.ts');
const terrain = read('src/utils/StormTerrainBasemap.ts');
const rain = read('src/simulation/PrecipitationModel.ts');
const forecastModal = read('src/components/ForecastImageModal.tsx');
const observedRain = read('src/utils/ObservedRainfallMap.ts');

assert(pkg.version === '3.7.7', 'package version is not 3.7.7');
assert(engine.includes('TyphoonSim/3.7.7 (Meteorological-Simulation-App)'), 'engine network User-Agent version not updated');

// 1) Station bulletin localization + monochrome product layout.
for (const locale of ['vietnam','thailand','malaysia','indonesia','singapore','cambodia','laos','northkorea','guam','brunei']) {
  assert(station.includes(`${locale}: {`), `local bulletin copy missing: ${locale}`);
}
assert(station.includes('resolveBulletinLocale') && station.includes('localizeTyphoonName'), 'bulletin locale/name resolver missing');
assert(station.includes('const black = "#111111", dark = "#303030", gray = "#6a6a6a", pale = "#d7d7d7", white = "#ffffff"'), 'monochrome bulletin palette missing');
const canvasBlock = station.slice(station.indexOf('function generateBulletinCanvas'), station.indexOf('function StationBulletinImageMaker'));
assert(canvasBlock.includes('ctx.fillStyle = white') && canvasBlock.includes('ctx.strokeStyle=pale'), 'bulletin canvas is not using the monochrome layout');
assert(!/#(?:dc2626|ef4444|f59e0b|e11d48|be123c)/i.test(canvasBlock), 'colored warning palette leaked into bulletin canvas');
assert(station.includes('Valenzuela') && station.includes('Hà Nội') && station.includes('กรุงเทพมหานคร'), 'key local place translations missing');

// 2) Foreground resume must repair scroll + Leaflet gesture state.
for (const event of ['visibilitychange','focus','pageshow','app-foreground-restored']) {
  assert(app.includes(event) || map.includes(event), `foreground recovery event missing: ${event}`);
}
assert(app.includes('-webkit-overflow-scrolling') && app.includes('touch-action') && app.includes('pointer-events'), 'page scroll state restore missing');
assert(map.includes('map.dragging.disable()') && map.includes('map.dragging.enable()'), 'Leaflet drag rebind missing');
assert(map.includes('(map.touchZoom as any).disable()') && map.includes('(map.touchZoom as any).enable()'), 'Leaflet pinch-zoom rebind missing');
assert(map.includes('map.invalidateSize({ pan: false, animate: false })'), 'Leaflet size restore missing');

// 3) Continuous season is not the default.
assert(defaults.includes('seasonModeEnabled: false'), 'season mode default must be off');

// 4) Creator card only on first successful entry.
assert(app.includes('aether_author_seen_v1') && app.includes('showLaunchAuthor'), 'first-entry author persistence missing');
assert(app.includes('localStorage.setItem(AETHER_AUTHOR_SEEN_STORAGE_KEY, "1")'), 'author-seen marker is not persisted');
assert(splash.includes('showAuthor &&'), 'splash author card is not conditional');

// 5) Shared regional warning/disaster capability affects both warnings and casualty protection.
for (const profile of ['japan','china','philippines','vietnam','thailand','malaysia','indonesia','cambodiaLaos','northKorea']) {
  assert(capability.includes(`${profile}: {`), `disaster profile missing: ${profile}`);
}
for (const field of ['missedReportRate','underReportRate','falseAlarmRate','bulletinDelayHours','warningReliability','responseCapacity','evacuationCapacity','infrastructureResilience']) {
  assert(capability.includes(field), `capability field missing: ${field}`);
}
assert(capability.includes('evaluateWarningOperationalOutcome') && capability.includes('"missed"') && capability.includes('"underreported"') && capability.includes('"false_alarm"'), 'warning anomalies missing');
assert(city.includes('evaluateWarningOperationalOutcome') && city.includes('getDisasterCapabilityProfile(station.lat, station.lon, station.country)'), 'public warnings are not connected to shared capability model');
assert(engine.includes('getLandfallCountryGeoJson(lat, lon)?.country') && engine.includes('getDisasterCapabilityProfile(lat, lon, countryHint)'), 'casualty model is not country-aware through shared capability model');
assert(engine.includes('institutionalWarningLoss') && engine.includes('responseDelayPenalty') && engine.includes('effectivePreparedness'), 'warning/response limitations are not connected to casualties');

// 6) Wide product-only coastline is lazy and does not replace the live RBush plate.
assert(natural.includes('loadProductNaturalEarthData') && natural.includes('product_land_extended.geojson') && natural.includes('product_countries_extended.geojson'), 'product coastline loader missing');
assert(natural.includes('this never touches the RBush trees used by the live model'), 'product/live GIS separation guard missing');
assert(forecastModal.includes('if (!isOpen) return;') && forecastModal.includes('loadProductNaturalEarthData()'), 'forecast generator does not lazily gate the extended coastline');
assert(observedRain.includes('await loadProductNaturalEarthData()'), 'observed-rainfall product is not using extended coastline');

function coordBounds(geo) {
  let minLon=Infinity, minLat=Infinity, maxLon=-Infinity, maxLat=-Infinity, points=0;
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      const lon=node[0], lat=node[1];
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        minLon=Math.min(minLon,lon); maxLon=Math.max(maxLon,lon); minLat=Math.min(minLat,lat); maxLat=Math.max(maxLat,lat); points++;
      }
      return;
    }
    for (const child of node) walk(child);
  };
  for (const f of geo.features || []) walk(f.geometry?.coordinates);
  return {minLon,minLat,maxLon,maxLat,points};
}
for (const file of ['public/data/product_land_extended.geojson','public/data/product_countries_extended.geojson']) {
  assert(fs.existsSync(file), `missing product GIS file: ${file}`);
  const geo=JSON.parse(read(file));
  const b=coordBounds(geo);
  assert(b.points > 1000, `product GIS coordinates too sparse: ${file}`);
  assert(b.minLon <= -170 && b.maxLon >= 170 && b.minLat <= -80 && b.maxLat >= 80,
    `product GIS does not provide near-global coverage: ${file} ${JSON.stringify(b)}`);
}

// 7) Terrain and coast use the same land mask.
assert(terrain.includes('await loadNaturalEarthData()'), 'terrain texture does not await the live coastline');
assert(terrain.includes('checkPointOnLandGeoJson(latByY[y], lonByX[x])'), 'terrain is not clipped to the coastline mask');

// 8-9) Rain footprint tightening + inland-stalled core/coast handoff.
assert(rain.includes('remoteTaperStart = 178 + 39 * sizeFromRadii + 14 * circulationExpansion'), 'outer rainfall taper was not tightened');
assert(rain.includes('maxRainRadius = 418 + 66 * sizeFromRadii + 32 * moistureTransport + 27 * circulationExpansion'), 'maximum generic rain radius was not tightened');
assert(rain.includes('stalledInlandCoreRain') && rain.includes('stalledCoreMaturity'), 'inland stalled-core rainfall mechanism missing');
assert(rain.includes('stalledInlandCoastRelease') && rain.includes('postLandfallCoastalRetention'), 'coastal-to-inland rainfall handoff missing');
assert(observedRain.includes('0.90 * (rc.inlandMesoscaleTrainingCell || 0)') && observedRain.includes('0.44 * (rc.coastalFrictionConvergence || 0)'), '24 h rainfall focus diagnostics still favor old coastal convergence over inland training');

// 10) Minimal premium AETHER splash: no icon/background bitmap.
assert(splash.includes('AETHER 3.7.7 launch sequence') && splash.includes('aether-launch__wordmark-svg'), '3.7.7 wordmark splash missing');
assert(!splash.includes('<image') && !/\.png|\.jpe?g|\.webp/i.test(splash), 'splash contains a bitmap/image reference');
assert(!splash.includes('aether-launch__mark') && !splash.includes('aether-launch__storm'), 'old launch icon/storm scene remains');
assert(css.includes('.aether-launch') && css.includes('background: #000'), 'pure black splash field missing');
assert(css.includes('aether-launch__wordmark-aura') && css.includes('aether-launch__light-sweep'), 'wordmark glow/sweep effects missing');
assert(!fs.existsSync('public/aether-launch-cloud-reference.webp'), 'obsolete splash cloud bitmap still bundled');

console.log('release_3_7_7_regression: PASS');
