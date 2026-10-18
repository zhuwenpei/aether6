const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(`Round37 regression failed: ${message}`); };

const pkg = JSON.parse(read('package.json'));
const engine = read('src/simulation/Engine.ts');
const app = read('src/App.tsx');
const types = read('src/types.ts');
const guidance = read('src/simulation/AetherEnsembleGuidance.ts');
const drawer = read('src/components/ControlDrawer.tsx');

assert(pkg.version === '4.3.20', 'package version must be 4.3.20');
assert(pkg.scripts['test:round37'] === 'node scripts/round37_regression.cjs', 'round37 npm regression entry missing');

// Large-scale drawn forecast route is more authoritative on the deterministic reference.
assert(engine.includes('config.manualForecastRouteWeight ?? 0.84'), 'new default manual route weight missing');
assert(engine.includes('Math.min(0.97, config.manualForecastRouteWeight'), 'manual route cap was not raised');
assert(app.includes('manualForecastRouteWeight: Math.max(0.88'), 'freshly drawn forecast route does not receive higher weight');
assert(types.includes('defaults to 0.84') && types.includes('0 - 0.97'), 'manual route weight contract not updated');

// Waypoint spacing is a dimensionless, route-relative speed cue. It must not encode a fixed time interval.
assert(engine.includes('getForecastFrameworkSpacingSpeedFactor'), 'route spacing speed helper missing');
assert(engine.includes('local / median') && engine.includes('spacingSpeedFactor'), 'relative spacing normalization missing');
assert(engine.includes('never as a clock') || engine.includes('never means "one point = N hours"'), 'fixed-hour interpretation guard missing');
assert(!engine.includes('waypoint spacing never changes translation speed'), 'obsolete spacing-disabled behavior still documented');
assert(drawer.includes('相对快慢') && drawer.includes('不会把每段点距固定解释成若干小时'), 'UI does not explain relative spacing behavior');

// Ensemble dispersion remains independent of manual-route weight. Guidance should consume the resulting
// reference trajectory but must not scale its model/member spread by manualForecastRouteWeight.
assert(!guidance.includes('manualForecastRouteWeight'), 'ensemble spread is coupled to manual route weight');
assert(guidance.includes('shapeScale=') && guidance.includes('sigmaKm='), 'independent model/member spread mechanism missing');
assert(drawer.includes('不会因为手绘路径权重提高而被压窄'), 'dispersion independence is not explained in UI');

console.log('Round 37 regression: OK');
