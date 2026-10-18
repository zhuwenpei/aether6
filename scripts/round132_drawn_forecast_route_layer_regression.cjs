const fs = require('fs');
const assert = require('assert');

const app = fs.readFileSync('src/App.tsx', 'utf8');
const drawer = fs.readFileSync('src/components/ControlDrawer.tsx', 'utf8');
const map = fs.readFileSync('src/components/MapView.tsx', 'utf8');
const defaults = fs.readFileSync('src/config/DefaultSettings.ts', 'utf8');
const types = fs.readFileSync('src/types.ts', 'utf8');

assert(types.includes('drawnForecastRoute?: boolean'), 'ActiveLayers display flag missing');
assert(defaults.includes('drawnForecastRoute: false'), 'drawn route layer must default off');

assert(drawer.includes('const hasConfirmedDrawnForecastRoute = (config.drawnTrackRoute?.length || 0) >= 2;'), 'route availability gate missing');
assert(drawer.includes('{ key: "drawnForecastRoute", label: "手绘大体预报路径", disabled: !hasConfirmedDrawnForecastRoute }'), 'layer option or disabled state missing');
assert(drawer.includes('disabled={!!ov.disabled}'), 'disabled checkbox enforcement missing');
assert(drawer.includes('请先绘制并确认手绘大体预报路径'), 'disabled hint missing');

assert(app.includes('if ((config.drawnTrackRoute?.length || 0) >= 2 || !layers.drawnForecastRoute) return;'), 'stale layer auto-reset guard missing');
assert(app.includes('drawnForecastRoute: false'), 'route-clear layer reset missing');

assert(map.includes('!isForecastRouteDrawing && layers.drawnForecastRoute && confirmedRoute.length >= 2'), 'confirmed route visibility gate missing');
assert(map.includes('const confirmedRoute = config.drawnTrackRoute || [];'), 'confirmed route source missing');
assert(map.includes('color: "#67e8f9"'), 'confirmed route display style missing');
assert(map.includes('layers.drawnForecastRoute, mapInitialized'), 'map redraw dependency missing');

// The display-only hand-drawn layer must not become a reason to run live 120h forecast physics.
const demandGate = app.match(/const needsLiveForecastGeometry = \(layers: ActiveLayers\): boolean =>\s*([^;]+);/);
assert(demandGate, 'live forecast demand gate missing');
assert(!demandGate[1].includes('drawnForecastRoute'), 'drawn route display must not trigger forecast computation');

console.log('ROUND132 drawn forecast route display layer regression: PASS');
