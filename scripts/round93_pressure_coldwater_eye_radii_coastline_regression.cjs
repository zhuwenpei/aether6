const fs = require('fs');
const path = require('path');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const read = p => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const pkg = JSON.parse(read('package.json'));
const app = read('src/App.tsx');
const types = read('src/types.ts');
const engine = read('src/simulation/Engine.ts');
const transition = read('src/simulation/CirculationSizeTransition.ts');
const vortex = read('src/simulation/TropicalCycloneVortex.ts');
const map = read('src/utils/SynopticWindPressureMap.ts');
const loader = read('src/simulation/NaturalEarthLoader.ts');

assert(/^6\.0\.(1[6-9]|[2-9]\d)$/.test(pkg.version), `unexpected post-ROUND93 version ${pkg.version}`);

// Pressure variation is product-only and continuous in simulation time.
assert(vortex.includes('pressureMicroVariation') && vortex.includes('state.simHour'), 'equal-intensity pressure micro-variation missing');
assert(vortex.includes('statePmin + pressureMicroVariation'), 'product pmin does not consume micro-variation');
assert(vortex.includes('deficitForB = clamp(poc - safePmin'), 'Holland gradient is inconsistent with varied product pmin');

// ROUND94 intentionally reverted the ROUND93 eye-centering/rounding experiment.
for (const token of ['matureEyeSymmetry','innerEyeRoundGate','eyeCenteredTranslationGate','innerEyeAsymmetryRetention']) {
  assert(!vortex.includes(token), `reverted ROUND93 eye token unexpectedly returned: ${token}`);
}

// Cold-water quick tool and engine forcing.
for (const token of ['cold_water','冷水区','coldWaterDurationHours','coldWaterTemperatureC','handleScheduleColdWater']) assert(app.includes(token), `cold-water UI missing ${token}`);
for (const token of ['forcedColdWaterTemperatureC','forcedColdWaterStartHour','forcedColdWaterEndHour','forcedColdWaterDurationHours']) {
  assert(types.includes(token), `cold-water type missing ${token}`);
  assert(engine.includes(token), `cold-water physics/snapshot missing ${token}`);
}
assert(engine.includes('if (forcedColdWaterActive) sstVal = Math.max(0, Math.min(30, forcedColdWaterTemperature));'), 'safe forced cold-water SST boundary missing');
assert(engine.includes('getOHC(newLat, newLon, config, sstVal, currentSimHourFloat)'), 'OHC not recalculated from forced SST');

// Circulation target is 0..unbounded and no legacy general cap survives.
assert(app.includes('const target = Math.max(0, Math.round(rawTarget))'), 'UI target still has positive minimum');
assert(app.includes('min={0}') && app.includes('数值输入无上限'), '0/unbounded circulation UI missing');
assert(transition.includes('Math.max(0, finiteOr(config?.circulationSizeReferenceKm'), 'transition still clamps reference above zero');
assert(engine.includes('if (preferenceScale <= 1e-9) return { ne: 0, se: 0, sw: 0, nw: 0 }'), 'zero-radius target does not collapse radii');
assert(!engine.includes('resolvedR7Limit'), 'legacy user-radius hard ceiling still present');

// Coastline-only plate and eastward +30-degree coverage.
assert(loader.includes('eastWrapped: -110'), 'product coastline east edge was not extended to 110W');
assert(loader.includes('product_land_wide_v3.geojson'), 'extended product land plate not loaded');
assert(loader.includes('product_coastline_fine_v5.geojson'), 'fine land-derived coastline plate not loaded');
assert(map.includes('productCoastlineGeoJson'), 'wind-pressure map does not use coastline-only source');
assert(!map.includes('productCountriesGeoJson'), 'wind-pressure map still renders country polygons/borders');

const land = JSON.parse(read('public/data/product_land_wide_v3.geojson'));
const coast = JSON.parse(read('public/data/product_coastline_fine_v5.geojson'));
let eastPoints = 0, minEast = Infinity, maxEast = -Infinity;
const walk = node => {
  if (!Array.isArray(node)) return;
  if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
    const [lon,lat] = node;
    if (lon >= -140 && lon <= -110 && lat >= -55 && lat <= 90) { eastPoints++; minEast=Math.min(minEast,lon); maxEast=Math.max(maxEast,lon); }
    return;
  }
  node.forEach(walk);
};
for (const f of land.features || []) walk(f.geometry?.coordinates);
assert(eastPoints > 5000, `eastward 30-degree coastline extension too sparse: ${eastPoints}`);
assert(minEast <= -139.9 && maxEast >= -110.1, `east extension does not span -140..-110: ${minEast}..${maxEast}`);
assert(coast?.aether_meta?.source_land === 'product_land_wide_v3.geojson', 'coastline is not sourced directly from fine product land');
assert(coast?.aether_meta?.country_borders_used === false, 'country/admin polygons still participate in coastline source');

console.log('ROUND93 pressure/cold-water/eye/radii/coastline regression: PASS');
console.log(JSON.stringify({ eastPoints, eastSpan:[minEast,maxEast], coastFeatures:(coast.features||[]).length }));
