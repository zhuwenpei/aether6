/** AETHER 4.3.13 Round29 dedicated mobile workstation regression. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

assert.equal(JSON.parse(read('package.json')).version, '4.3.13');
assert(read('index.html').includes('AETHER 4.3.13'));

const app = read('src/App.tsx');
assert(app.includes('AetherMobileChrome'), 'dedicated mobile chrome is not mounted');
assert(app.includes('AetherMobileTransport'), 'dedicated mobile transport is not mounted');
assert(app.includes('document.body.classList.remove("legacy-mobile-ui")'), 'legacy mobile geometry must be retired');
assert(app.includes('mobileMode={useLegacyMobileUi}'), 'mobile mode must reach drawer/product workstations');
assert(app.includes('aether-mobile-root'), 'mobile root viewport class missing');

const mobileChrome = read('src/components/AetherMobileChrome.tsx');
for (const marker of ['aether-mobile-header','aether-mobile-statusrail','aether-mobile-overflow','MOBILE WORKSTATION']) {
  assert(mobileChrome.includes(marker), `mobile chrome marker missing: ${marker}`);
}
const transport = read('src/components/AetherMobileTransport.tsx');
for (const marker of ['aether-mobile-transport','aether-mobile-timeline','SIMULATION TIME','onStepBackward','onStepForward']) {
  assert(transport.includes(marker), `mobile transport marker missing: ${marker}`);
}

const drawer = read('src/components/ControlDrawer.tsx');
assert(drawer.includes('mobileMode?: boolean'), 'drawer mobile mode prop missing');
assert(drawer.includes('aether-mobile-drawer'), 'dedicated full-screen mobile drawer shell missing');
assert(drawer.includes('aether-mobile-drawer-tabs'), 'dedicated mobile tab rail missing');
assert(drawer.includes('aether-mobile-touch-help'), 'phone-specific touch help missing');
assert(drawer.includes('navigator.vibrate?.(10)'), 'long-press reorder haptics must remain');

const product = read('src/components/ForecastImageModal.tsx');
assert(product.includes('mobileMode?: boolean'), 'product mobile mode prop missing');
for (const marker of ['aether-mobile-product-workstation','aether-mobile-product-header','aether-mobile-product-nav','aether-mobile-product-settings','aether-mobile-product-title']) {
  assert(product.includes(marker), `mobile product marker missing: ${marker}`);
}

const css = read('src/index.css');
for (const marker of [
  'Round 29', '.aether-mobile-header', '.aether-mobile-statusrail', '.aether-mobile-transport',
  '#control-drawer-sidebar.aether-mobile-drawer', '.aether-mobile-product-workstation',
  '.aether-mobile-product-nav', '--aether-vvh', 'env(safe-area-inset-bottom'
]) assert(css.includes(marker), `mobile CSS marker missing: ${marker}`);

for (const file of ['src/App.tsx','src/components/AetherMobileChrome.tsx','src/components/AetherMobileTransport.tsx','src/components/ControlDrawer.tsx','src/components/ForecastImageModal.tsx']) {
  const result = ts.transpileModule(read(file), {
    fileName:file, reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}
  });
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${file} syntax: ${errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('; ')}`);
}
console.log('round29_regression PASS: dedicated phone chrome/transport/drawer/product workstation wired');
