const fs=require('fs');
const assert=require('node:assert/strict');
const {route}=require('./cold_air_path_numeric.cjs');
const read=p=>fs.readFileSync(p,'utf8');
const pkg=JSON.parse(read('package.json'));
const loader=read('src/simulation/NaturalEarthLoader.ts');
const map=read('src/utils/SynopticWindPressureMap.ts');
const field=read('src/simulation/SynopticWindField.ts');
const engine=read('src/simulation/Engine.ts');
const app=read('src/App.tsx');
assert.ok(/^6\.0\.(2[0-9]|[3-9]\d)$/.test(pkg.version),`unexpected post-ROUND97 version ${pkg.version}`);
assert.ok(loader.includes('product_coastline_fine_v5.geojson'),'fine coastline v5 is not loaded');
assert.ok(!loader.includes('product_coastline_only_v4.geojson'),'legacy coastline fallback remains');
assert.ok(map.includes('drawGeoJsonLines(ctx,productCoastlineGeoJson,project'),'wind-pressure map missing coastline-only draw');
assert.ok(!map.includes('productCountriesGeoJson'),'wind-pressure renderer still imports country/admin polygons');
const coast=JSON.parse(read('public/data/product_coastline_fine_v5.geojson'));
assert.equal(coast?.aether_meta?.country_borders_used,false);
assert.ok((coast.features||[]).length>1000,'fine coastline plate unexpectedly sparse');
for(const token of [
  'buildColdAirEventAnchors','const centerContactHour = getColdAirCenterContactHour(arrivalHour)',
  'resolveSynopticStormAtHour(typhoon, initHour, centerContactHour, config)','contactLat: state.lat',
  'const frontLat = contactLat + (centerContactHour - validHour) * propagationKmh / 111.12',
  'coldAirPathwaySignal','meridionalWeight','rearFadeDeg','southLoss',
  'const oceanKt = [0, 24, 28, 32][strength]',
  'const blend = clamp((0.70 + 0.09 * coldAir.strength) * coldAir.weight, 0, 0.96)'
]) assert.ok(field.includes(token),`cold-air passage token missing: ${token}`);
assert.ok(app.includes('渤海和西日本海两支同时南下'),'quick-tool description does not describe corrected dual-source path');
for(const token of [
  'const coldAirDurationHours = coldAirScheduled ? [0, 18, 26, 34][coldAirStrength] : 0;',
  'const coldAirRelease = coldAirExposure >= 0',
  'const coldAirPulse = coldAirScheduled && coldAirExposure >= 0 && coldAirExposure <= coldAirDurationHours',
  'forcedDecayTotal -= baseLoss * (0.72 + 0.55 * intensityLoad) * pulse;'
]) assert.ok(engine.includes(token),`finite cold-air forcing token missing: ${token}`);
const arrival=24,contactLat=24,speed=34;
const front=h=>contactLat+(arrival-h)*speed/111.12;
assert.ok(Math.abs(front(arrival)-contactLat)<1e-12);
assert.ok(front(arrival+6)<front(arrival));
assert.ok(route(39,120).weight>.95 && route(39,130.5).weight<.68,'dual-source geometry is not preserved');
assert.ok(route(29,124.5).weight>.97,'East-China-Sea merge collapsed');
assert.ok(route(17,118).weight>route(17,130).weight*2,'South-China-Sea branch no longer outlives Philippine-Sea branch');
console.log('round97_coastline_cold_air_passage_regression: PASS');
