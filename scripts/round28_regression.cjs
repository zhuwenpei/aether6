/** AETHER 4.3.13 Round28 mobile UI/touch adaptation regression. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

assert.equal(JSON.parse(read('package.json')).version, '4.3.13');
assert(read('index.html').includes('AETHER 4.3.13'));
assert(read('index.html').includes('viewport-fit=cover'));
assert(read('index.html').includes('interactive-widget=resizes-content'));

const app = read('src/App.tsx');
assert(app.includes('visualViewport'), 'VisualViewport integration missing');
assert(app.includes('aether-mobile-ui'), 'mobile body class missing');
assert(app.includes('--aether-vvh') && app.includes('--aether-keyboard'), 'mobile viewport CSS variables missing');
assert(app.includes('compact={useLegacyMobileUi}'), 'compact mobile joystick wiring missing');

const chrome = read('src/components/AetherDesktopChrome.tsx');
assert(chrome.includes('storminc-mobile-actions'), 'mobile top actions missing');
assert(chrome.includes('storminc-mobile-more-menu'), 'mobile more menu missing');
assert(chrome.includes('mobileMoreOpen'), 'mobile more menu state missing');

const drawer = read('src/components/ControlDrawer.tsx');
assert(drawer.includes('control-drawer-mobile-scrim'), 'mobile drawer scrim missing');
assert(drawer.includes('control-drawer-mobile-handle'), 'mobile drawer handle missing');
assert(drawer.includes('--drawer-drag-y'), 'drawer touch drag transform missing');
assert(drawer.includes('navigator.vibrate?.(10)'), 'tab long-press haptic feedback missing');
assert(drawer.includes('scrollLeft+=12') && drawer.includes('scrollLeft-=12'), 'tab edge auto-scroll missing');
assert(drawer.includes('scrollIntoView'), 'active tab auto-centering missing');

const map = read('src/components/MapView.tsx');
assert(map.includes('touchFirst ? 24 : 12'), 'mobile track hit target enlargement missing');
assert(map.includes('navigator.vibrate'), 'mobile map haptic feedback missing');
assert(map.includes('touchFirst ? 620 : 500'), 'touch long-press threshold missing');

const joystick = read('src/components/VirtualJoystick.tsx');
assert(joystick.includes('compact?: boolean'), 'compact joystick prop missing');
assert(joystick.includes('compact ? 132 : 164'), 'compact joystick dimensions missing');

const product = read('src/components/ForecastImageModal.tsx');
assert(product.includes('station-ranking-page'), 'mobile station ranking hook missing');
assert(product.includes('forecast-product-overlay'), 'mobile product overlay hook missing');
const station = read('src/components/StationHistory.tsx');
assert((station.match(/isAnimationActive=\{false\}/g) || []).length >= 4, 'station charts should disable mobile-costly entry animation');

const css = read('src/index.css');
for (const token of [
  'Round 28', 'body.aether-mobile-ui', '.storminc-mobile-actions',
  '.control-drawer-mobile-scrim', '.control-drawer-mobile-handle',
  '.icwc-product-sidebar', 'safe-area-inset-bottom', 'aether-mobile-landscape',
  'aether-keyboard-open'
]) assert(css.includes(token), `mobile CSS marker missing: ${token}`);

const changed = [
  'src/App.tsx','src/components/AetherDesktopChrome.tsx','src/components/VirtualJoystick.tsx',
  'src/components/ControlDrawer.tsx','src/components/MapView.tsx','src/components/AetherTutorial.tsx',
  'src/components/AetherTermsModal.tsx','src/components/ForecastImageModal.tsx',
  'src/components/VideoExportModal.tsx','src/components/AircraftReconModal.tsx','src/components/StationHistory.tsx'
];
for (const file of changed) {
  const result = ts.transpileModule(read(file), {
    fileName:file, reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}
  });
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${file} syntax: ${errors.map(e=>e.messageText).join('; ')}`);
}
console.log(`round28_regression PASS: ${changed.length} mobile-facing TS/TSX files + viewport/CSS wiring`);
