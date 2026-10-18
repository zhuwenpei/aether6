const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(`Round34 regression failed: ${message}`); };

const pkg = JSON.parse(read('package.json'));
const map = read('src/components/MapView.tsx');
const joy = read('src/components/VirtualJoystick.tsx');
const css = read('src/index.css');
const app = read('src/App.tsx');
const mobileChrome = read('src/components/AetherMobileChrome.tsx');

assert(pkg.version === '4.3.18', 'package version must be 4.3.18');
assert(pkg.scripts['test:round34'] === 'node scripts/round34_regression.cjs', 'round34 npm regression entry missing');

// Phone forecast-framework editing: single-finger Leaflet drag + stationary single-tap node placement.
assert(map.includes('const mobileForecastDrawing = touchFirst && isForecastRouteDrawing'), 'mobile forecast drawing branch missing');
assert(map.includes('map.dragging.enable()') && map.includes('map.touchZoom.enable()'), 'mobile drawing does not preserve pan/pinch navigation');
assert(map.includes('Phone forecast-route drawing is intentionally different from desktop'), 'phone/desktop route-drawing distinction missing');
assert(map.includes('onForecastRoutePointRef.current?.(e.latlng.lat, e.latlng.lng)'), 'single-tap route node placement hook missing');

// Mobile live-draw mode must remain removed after Round 33.
assert(mobileChrome.includes('aria-label="台风状态与影响"'), 'mobile influence shortcut was not retained');
assert(!mobileChrome.includes('onDrawMode'), 'mobile live draw shortcut returned unexpectedly');
assert(app.includes('!useLegacyMobileUi && config.controlMode === "draw"'), 'desktop-only live draw toolbar guard missing');

// Lower phone controls: slightly larger joystick, lifted baseline and lower visual opacity.
assert(joy.includes('const diameter = compact ? 116 : 164'), 'phone joystick was not enlarged');
assert(css.includes('AETHER 4.3.18 / Round 34'), 'round34 final mobile CSS override missing');
assert(css.includes('max(10px,env(safe-area-inset-bottom,0px)) + 10px'), 'mobile transport/joystick baseline was not lifted');
assert(css.includes('rgba(41,45,53,.39)') && css.includes('rgba(14,17,22,.30)'), 'joystick transparency refinement missing');

// Forecast-route confirmation toolbar must be centered independently of desktop Tailwind geometry.
assert(css.includes('body.aether-mobile-ui .pro-route-toolbar') && css.includes('left:50% !important') && css.includes('transform:translateX(-50%) !important'), 'mobile route confirmation toolbar is not explicitly centered');
assert(css.includes('width:max-content !important') && css.includes('max-width:calc(100vw - 24px) !important'), 'mobile route toolbar width guard missing');

console.log('Round 34 regression: OK');
