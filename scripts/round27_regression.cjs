/** Round 27: desktop gestures, archived-branch continuity and product/UI integration. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '4.3.13');
assert(read('index.html').includes('4.3.13'));
const app = read('src/App.tsx'), map = read('src/components/MapView.tsx');
const engine = read('src/simulation/Engine.ts'), drawer = read('src/components/ControlDrawer.tsx');
const timeline = read('src/components/Timeline.tsx'), product = read('src/components/ForecastImageModal.tsx');
const css = read('src/index.css'), player = read('src/components/MusicPlaylist.tsx');
assert(!app.includes('import TyphoonStatusCard') && !app.includes('<TyphoonStatusCard'), 'status card must be removed');
assert(!fs.existsSync(path.join(root,'src/components/TyphoonStatusCard.tsx')), 'unused status-card module must be removed');
assert(map.includes('now - previousTime <= 370') && map.includes('e.button !== 1') && map.includes('middlePanRef.current.moved = false'), 'stationary double middle-click required; old drag state cleared');
assert(map.includes('if (desktopMouse)') && map.includes('(pointer: fine)'), 'desktop triple-left genesis disabled, touch remains');
assert(map.includes('trackInspectorHtml(state, label)') && map.includes('setContent(trackInspectorHtml(state,'), 'click and hover use identical inspector function');
assert(app.includes('seekHourDelta(-1)') && app.includes('seekHourDelta(1)'), 'one-hour arrow seeks');
for (const code of ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0']) assert(app.includes(`${code}: [`),`${code} missing influence shortcut`);
assert(drawer.includes('addEventListener("wheel", wheel, { passive: false })'), 'nonpassive horizontal wheel handler');
assert(drawer.includes('onTabPointerDown') && drawer.includes('setTabOrder(prev =>') && drawer.includes('420'), 'tabs reorder mouse/touch');
assert(drawer.includes('id="panel-custom"') && drawer.includes('CUSTOM_CHOICES') && drawer.includes('localStorage.setItem("aether_custom_options_v1"'), 'custom menu and persistence');
assert(drawer.includes('<MusicPlaylist />') && player.includes('URL.createObjectURL') && player.includes('URL.revokeObjectURL'), 'local uploaded playlist cleaned up');
assert(product.includes('ensembleBlackLines') && product.includes('checked={ensembleBlackLines}'), 'black ensemble line toggle');
assert(timeline.includes('isTerminationReport ? "报告" : "停编"') && app.includes('setSummaryReportTyphoon(typhoonsRef.current[0]'), 'finished storm opens report');
assert(css.includes('#root .storminc-dock, #root #simulation-timeline-collapsed') && css.includes('background:transparent !important'), 'dock transparent');
assert(!/Math\.min\(800,\s*[^)]*circulationSizeReferenceKm/.test(engine) && engine.includes('referenceKm * 1.18'), 'wind radius manual cap lifted');
assert(app.includes('reweightLiveWindRadiiForPreference') && app.includes('applyConfigPatch({ circulationSizeReferenceKm: val })'), 'wind radius input applies instantly');
assert(engine.includes('reweightLiveWindRadiiForPreference') && engine.includes('const resolvedR7Limit'), 'wind envelope stage applies configured radius');
assert(engine.includes('const uiIntervalMs') === false && app.includes('physicsWorkMs > 9'), 'display work adaptively throttled outside physics');
assert(css.includes('aether-track-hover-popup'), 'click inspector style');
assert(read('src/simulation/PrecipitationModel.ts').includes('0.18 * landfallRainMemory'), 'landfall rain memory reduced modestly');
function load(rel) {
  const compiled=ts.transpileModule(read(rel),{fileName:rel,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  assert(!(compiled.diagnostics||[]).some(d=>d.category===ts.DiagnosticCategory.Error),`${rel} must transpile`);
  const module={exports:{}};
  new Function('module','exports','require',compiled.outputText)(module,module.exports,()=>({}));
  return module.exports;
}
const route=load('src/simulation/DrawnTrackBranch.ts');
const track=load('src/simulation/DrawnTrack.ts');
const archived=[{lat:11,lon:121},{lat:11,lon:125},{lat:13,lon:127}];
const at=track.advanceDrawnTrack(archived,0,24,8);
const state={simHour:8,lat:at.lat,lon:at.lon,drawnRouteProgressKm:at.progressKm,dissipated:false,
  configSnapshot:{drawnTrackRoute:archived,manualForecastRoute:[]}};
const owner={id:'owner',history:[{simHour:0,lat:11,lon:121,dissipated:false},state,
  {simHour:40,lat:13,lon:127,dissipated:false}],lat:13,lon:127,active:true,drawnRouteProgressKm:900};
const newRoute=[...archived,{lat:14,lon:129}];
const extension=route.branchWithExistingDrawnRoute([owner],8,{controlMode:'draw',drawnTrackRoute:newRoute});
assert.deepEqual(extension.config.drawnTrackRoute,newRoute,'explicit appended node should not be discarded');
assert.equal(extension.storms[0].drawnRouteProgressKm,at.progressKm,'extension preserves archived cursor');
const different=[{lat:24,lon:142},{lat:25,lon:145}];
const restored=route.branchWithExistingDrawnRoute([owner],8,{controlMode:'draw',drawnTrackRoute:different});
assert.deepEqual(restored.config.drawnTrackRoute,archived,'unrelated future path cannot overwrite historical branch route');
const next=track.advanceDrawnTrack(restored.config.drawnTrackRoute,restored.storms[0].drawnRouteProgressKm,24,1/6);
assert(route.drawnRouteDistanceKm(next,restored.storms[0])<=4.1,'restored branch cannot teleport on first physics step');
console.log('round27_regression PASS: gestures, route snapshots+continuation, keyboard, menu, reports, sizes and adaptive display');
