const fs = require('fs');
const assert = require('assert');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const editor = fs.readFileSync('src/components/ForecastIntensityCurveEditor.tsx', 'utf8');
const engine = fs.readFileSync('src/simulation/Engine.ts', 'utf8');
const css = fs.readFileSync('src/index.css', 'utf8');
const launch = fs.readFileSync('src/components/AetherLaunchSequence.tsx', 'utf8');
const forecastModal = fs.readFileSync('src/components/ForecastImageModal.tsx', 'utf8');
const reportModal = fs.readFileSync('src/components/TyphoonReportModal.tsx', 'utf8');

// Explicit body portals break out of #typhoon-app-container's paint containment.
assert(app.includes('createPortal(\n          <div className="pro-route-toolbar'), 'drawing toolbar must be body portaled');
assert(app.includes('</div>, document.body'), 'drawing toolbar must attach to document.body');
assert(app.includes('createPortal(\n          <ForecastIntensityCurveEditor'), 'intensity editor must be body portaled');
assert(css.includes('body.aether-mobile-ui .pro-route-toolbar {') &&
  css.includes('var(--aether-vvw, 100vw) / 2') && css.includes('max-width: calc(var(--aether-vvw, 100vw) - 16px'),
  'mobile toolbar must fit actual visual viewport');
assert(css.includes('body.aether-mobile-ui [aria-label="预报强度曲线编辑器"].forecast-curve-fullscreen'),
  'mobile curve fullscreen geometry missing');

// 240h editing is generated on demand, not during the simulation's 3-hour forecast updates.
assert(app.includes('calculateForecastTrackPath(mainTy, curveConfig, 240)'), 'explicit editor geometry horizon');
assert(app.includes('materializeForecastPath(mainTy, curveConfig, 240, geometry)'), 'explicit editor intensity horizon');
assert(app.includes('leadHour <= 240; leadHour += 3'), 'early-termination tail must preserve editable 240h axis');
assert(editor.includes('samples[samples.length - 1]?.leadHour || 240'), 'editor UI max horizon');
assert(app.includes('liveForecastMode: needsLiveForecastGeometry(layersRef.current) ? "preview" : "off"'),
  'on-demand normal simulation must remain off/preview');
assert(!forecastModal.includes('240 小时（扩展模拟）') && forecastModal.includes('120 小时'),
  'Round134 intentionally restores original product horizons');
assert(engine.includes('let manualAuthority = 0.88 + 0.10 * smoothstep01(h / 18);'), 'manual strength authority too weak');
assert(engine.includes('if (forecastWarmCoreDestroyed && deltaToManualTarget > 0) manualAuthority = 0;'),
  'irreversible warm-core destruction guard must remain');

// No generated met product may offer a target=_blank button.
for (const [name, source] of [['forecast product', forecastModal], ['typhoon report', reportModal]]) {
  assert(!source.includes('在新标签页打开'), `${name} has legacy open tab button`);
  assert(!source.includes('target = "_blank"'), `${name} has legacy new-tab action`);
  assert(source.includes('onClick={handleDownloadActual}'), `${name} must retain download action`);
}

// Launch author page has only exact attribution and actual restarts show it again.
const authorBlock = launch.match(/<div className="aether-launch__author"[\s\S]+?<\/div>/);
assert(authorBlock && authorBlock[0].includes('<div>Bilibili 晚风渡山月</div>'), 'exact centered author label missing');
assert(!launch.includes('AETHER TYPHOON SIMULATION SYSTEM'), 'extra subtitle still shown');
assert(!launch.includes('开发者：'), 'extra author-prefix still shown');
assert(app.includes('wasDiscarded') && app.includes('aether_background_pending'),
  'background tab restore must suppress the startup animation');
assert(app.includes('const showLaunchAuthor = true;') && !app.includes('aether_author_seen_v1'),
  'author must show on genuine new startup without once-per-install gate');
console.log('ROUND133 retained mobile controls / 240h editor / product download / lifecycle: PASS');
