const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(`Round33 regression failed: ${message}`); };

const pkg = JSON.parse(read('package.json'));
const app = read('src/App.tsx');
const map = read('src/components/MapView.tsx');
const mobileChrome = read('src/components/AetherMobileChrome.tsx');
const mobileTransport = read('src/components/AetherMobileTransport.tsx');
const drawer = read('src/components/ControlDrawer.tsx');

assert(pkg.version === '4.3.17', 'package version must be 4.3.17');
assert(pkg.scripts['test:round33'] === 'node scripts/round33_regression.cjs', 'round33 npm regression entry missing');

// Mobile draw mode is desktop-only again.
assert(mobileChrome.includes('aria-label="台风状态与影响"') && mobileChrome.includes('onClick={onInfluence}'), 'mobile top-right quick influence button not restored');
assert(!mobileChrome.includes('onDrawMode') && !mobileChrome.includes('drawModeActive'), 'mobile chrome still exposes draw mode');
assert(!mobileTransport.includes('onOpenDrawMode') && !mobileTransport.includes('<Route'), 'mobile transport still exposes draw mode');
assert(app.includes('!useLegacyMobileUi && config.controlMode === "draw"'), 'draw-track toolbar is not desktop-only');
assert(app.includes('if (!useLegacyMobileUi || configRef.current.controlMode !== "draw") return;'), 'mobile draw-mode safety fallback missing');
assert(drawer.includes('desktopDevice && <div className="rounded-xl border border-white/20 bg-white/5 p-3 space-y-2">'), 'draw-mode selector is not desktop-only');
assert(drawer.includes('CUSTOM_CHOICES.filter((item) => item.id !== "joystick")'), 'mobile custom controls can still expose draw mode');

// Live visual interpolation remains 60 fps while preserving asymmetric four-quadrant radii.
assert(map.includes('const targetFrameMs = 1000 / 60'), 'live visual target must remain 60 fps');
assert(map.includes('buildQuadrantOffsets') && map.includes('interpolateWindQuadrants'), 'quadrant-radii interpolation helpers missing');
assert(!map.includes('fastCircularRadii') && !map.includes('mobile-live-circle'), 'mobile mean-radius circle fallback survived');
assert(map.includes('kind: "polygon", layer, level'), 'live four-quadrant polygon layers missing');
assert(map.includes('radiiMotion.current = { r7: nextR7, r10: nextR10, r12: nextR12 }'), 'wind-radii values are not interpolated per frame');
assert(map.includes('const radiiInterval = config.followMainTyphoon ? 0'), 'follow mode must update radii every emitted visual frame');
assert(map.includes('Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05'), 'follow-camera dead-zone was not reduced to frame-level motion');
assert(!map.includes('degraded ? 6 : touchFirst ? 4.25 : 1.75'), 'old jump-producing camera dead-zone survived');

console.log('Round 33 regression: OK');
