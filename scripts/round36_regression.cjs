const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(`Round36 regression failed: ${message}`); };

const pkg = JSON.parse(read('package.json'));
const engine = read('src/simulation/Engine.ts');
const guidance = read('src/simulation/AetherEnsembleGuidance.ts');
const map = read('src/components/MapView.tsx');
const forecast = read('src/components/ForecastImageModal.tsx');
const drawer = read('src/components/ControlDrawer.tsx');

assert(pkg.version === '4.3.19', 'package version must be 4.3.19');
assert(pkg.scripts['test:round36'] === 'node scripts/round36_regression.cjs', 'round36 npm regression entry missing');

// Deterministic/manual-framework forecast speed: derived from synoptic magnitude + route geometry,
// then audited against actual geographic displacement.
assert(engine.includes('curvatureDeg: number') && engine.includes('speedFactor: number'), 'framework speed diagnostics missing');
assert(engine.includes('curvaturePenalty') && engine.includes('alignmentFactor') && engine.includes('westerlyRouteBoost'), 'manual framework speed mechanism missing');
assert(engine.includes('realizedForecastSpeedKmh') && engine.includes('greatCircleDistanceKm(previousForecastLat'), 'forecast speed is not reconciled with realized displacement');
assert(drawer.includes('框架转弯曲率') && drawer.includes('急转弯时适度减速'), 'manual-route speed behavior is not explained in UI');

// Ensemble tracks receive explicit speed/bearing diagnostics from their own 3-hour geography, so
// model/member translation speeds can diverge independently.
assert(guidance.includes('speed?:number') && guidance.includes('direction?:number'), 'guidance point speed/bearing fields missing');
assert(guidance.includes('diagnoseTranslation') && guidance.includes('guidanceDistanceKm'), 'ensemble translation diagnosis missing');
assert(map.includes('移速均值') && map.includes('最大 ${Math.round(peakMotion)} km/h'), 'live multi-model tooltip speed summary missing');
assert(forecast.includes('meanSpeed') && forecast.includes('km/h'), 'ensemble product speed output missing');

// Westerly manual control keeps eastward advection but no longer scales away N/S joystick authority.
assert(engine.includes('manualMeridionalGain') && engine.includes('environmentalMeridionalShare'), 'westerly meridional control blend missing');
assert(engine.includes('vKmh = Math.max(-48, Math.min(48'), 'westerly speed cap does not preserve meridional joystick component');
assert(engine.includes('westerlyCapKmh = 65.0'), 'updated westerly manual speed cap missing');

// Long mobile tracks used hundreds of 0.2%-white interactive hit circles; stacked Canvas alpha
// produced the visible gray/white corridor. They must now be fully transparent.
assert(!map.includes('fillOpacity: 0.002'), 'legacy translucent hit targets still present');
assert(map.includes('thousands of overlapping 0.2%-white circles'), 'white-halo regression explanation missing');
assert(map.includes('color: "rgba(5,12,24,0.72)"'), 'multi-model underlay is still a white halo');

console.log('Round 36 regression: OK');
