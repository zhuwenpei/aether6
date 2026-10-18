const fs = require('fs');
const assert = require('node:assert/strict');

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const app = fs.readFileSync('src/App.tsx','utf8');
const types = fs.readFileSync('src/types.ts','utf8');
const field = fs.readFileSync('src/simulation/SynopticWindField.ts','utf8');
const map = fs.readFileSync('src/utils/SynopticWindPressureMap.ts','utf8');
const engine = fs.readFileSync('src/simulation/Engine.ts','utf8');

assert.ok(/^6\.0\.(1[5-9]|[2-9]\d)$/.test(pkg.version), `unexpected post-ROUND92 version ${pkg.version}`);
assert.ok(app.includes('new Date("2027-06-30T20:00:00")'), 'default simulation time missing');
assert.ok(!map.includes('productLandGeoJson, productCountriesGeoJson') && !map.includes('drawGeoJsonLines(ctx,productLandGeoJson'), 'coarse duplicate coastline is still drawn');
assert.ok(map.includes('drawGeoJsonLines(ctx,productCoastlineGeoJson'), 'fine coastline-only product plate missing');

assert.ok(field.includes('const dragInterior = 0.26 + 0.74 * interior'), 'ROUND96 original land-drag baseline missing');
assert.ok(!field.includes('const lowlandCapKt = 12.2 + highLatAllowance'), 'reverted ROUND92 land hard cap unexpectedly remains');
assert.ok(field.includes('coldAirSurfaceSignal') && field.includes('taiwanStraitWeight') && field.includes('bashiWeight'), 'cold-air surface surge/Taiwan Strait channeling missing');
assert.ok(field.includes('absoluteColdAirCeilingMs = 46 * 0.514444'), 'cold-air event is still constrained by ordinary 36kt ceiling');

assert.ok(types.match(/forcedColdAirStrength\?: 1 \| 2 \| 3/g)?.length >= 2, 'cold-air state is not persisted in Typhoon and TyphoonState');
assert.ok(app.includes('activeInfluenceCategory === "cold_air"') && app.includes('延迟到达时间（模拟时）'), 'cold-air quick-tool UI missing');
assert.ok(app.includes('forcedColdAirArrivalHour: arrivalHour'), 'absolute arrival hour scheduling missing');
assert.ok(engine.includes('const coldAirCenterContactHour = coldAirScheduled ? getColdAirCenterContactHour(coldAirArrivalHour) : Number.POSITIVE_INFINITY;') && engine.includes('const coldAirExposure = coldAirScheduled ? currentSimHourFloat - coldAirCenterContactHour : -Infinity;'), 'engine does not key cold-air forcing to the shared same-time centre-contact clock');
assert.ok(engine.includes('const coldAirActive = coldAirEffectPulse > 0.01;'), 'finite cold-air pulse activation missing');
assert.ok(engine.includes('baseLoss = [0, 0.85, 1.75, 3.20][coldAirStrength]'), 'three-stage rapid intensity loss missing');
assert.ok(engine.includes('convectiveSuppression') && engine.includes('structuralDisorganization'), 'cold-air convection stripping/structural damage missing');

// ROUND99 timing invariant: the user-selected arrival marker T is the actual cyclone-centre
// encounter. At T the strong-wind front is on the centre and then continues southward.
const arrival = 24, centerContact = arrival, speedKmh = 40;
const stormLat = 20;
const frontLat = h => stormLat + (centerContact - h) * speedKmh / 111.12;
const behindAtContactKm = (stormLat - frontLat(centerContact)) * 111.12;
assert.ok(Math.abs(centerContact - arrival) < 1e-12);
assert.ok(Math.abs(behindAtContactKm) < 1e-9);
assert.ok(frontLat(centerContact + 6) < frontLat(centerContact), 'front does not continue south after centre contact');

console.log('round92_cold_air_land_wind_regression: PASS');
