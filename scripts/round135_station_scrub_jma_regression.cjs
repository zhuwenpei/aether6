const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
let ts;
try { ts = require('typescript'); } catch {
  ts = require(require('node:path').join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript'));
}
const read = (filename) => fs.readFileSync(filename, 'utf8');
const stationSrc = read('src/utils/StationReportRenderer.ts');
const stationModal = read('src/components/StationReportModal.tsx');
const stationDetail = read('src/components/StationHistory.tsx');
const app = read('src/App.tsx');
const timeline = read('src/components/Timeline.tsx');
const mobile = read('src/components/AetherMobileTransport.tsx');
const map = read('src/components/MapView.tsx');
const palette = read('src/utils/LocalVectorBasemaps.ts');
const video = read('src/utils/VideoRenderEngine.ts');
const videoModal = read('src/components/VideoExportModal.tsx');
const report = read('src/components/TyphoonReportModal.tsx');
const controls = read('src/components/ControlDrawer.tsx');
// Execute the exact production name-selection function, not a reimplementation.
const ast = ts.createSourceFile('StationReportRenderer.ts', stationSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const impl = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'getStationReportObservationTarget');
assert(impl, 'observation resolver is exported');
const source = impl.getText(ast);
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
const getName = vm.runInNewContext(`${javascript}\ngetStationReportObservationTarget`, { PRE_NAMING_TD_LABEL: '热带低压', exports: {} });
const names = { officialTyphoonName: '整个风季', namingHour: null, observedStorms: [
  { firstHour: 0, lastHour: 120, officialName: '海葵', namingHour: 12 },
  { firstHour: 140, lastHour: 310, officialName: '苏拉', namingHour: 150 }
] };
for (const [hour, expected] of [[0,'热带低压'],[11,'热带低压'],[12,'海葵'],[100,'海葵'],[130,'整个风季'],[140,'热带低压'],[149,'热带低压'],[150,'苏拉'],[250,'苏拉'],[320,'整个风季']]) {
  assert.equal(getName(names, hour), expected, `observed cyclone at ${hour}h`);
}
assert.equal(getName({ officialTyphoonName:'苏拉', namingHour: 150 },149),'热带低压');
assert.equal(getName({ officialTyphoonName:'苏拉', namingHour: 150 },150),'苏拉');
assert(stationSrc.includes('observedStorms.push({') && stationSrc.includes('getStationReportObservationTarget(dataset, clampedHour)'));
assert(stationModal.includes('buildSeasonStationReportDataset('), 'whole-season station report must use fixed resolver');
assert(stationDetail.includes('观测对象：{getTyphoonDisplayName(ty, currentHour, startDate)}'), 'live station target must follow naming latch');
// Slider keeps the thumb responsive, separate center from heavy archive geometry, and flushes on release.
assert(app.includes('setTimelineSeekPreview(mode === "preview")'));
assert(app.includes('timelineSeekPreview={timelineSeekPreview}'));
for (const x of [timeline, mobile]) assert(x.includes('"preview"') && x.includes('"commit"'));
assert(map.includes('if (timelineSeekPreview) return;'));
assert(map.includes('historicalPlayback, timelineSeekPreview, layers.track'), 'heavy track effect must rebuild on commit');
assert(map.includes('typhoons, timelineSeekPreview, currentHour, historicalPlayback, layers.forecast'), 'forecast must refresh after commit');
assert(map.includes('typhoons, timelineSeekPreview, config.capsuleSize'), 'station markers must refresh after commit');
assert(map.includes('if (historicalPlayback) {'), 'center retains discrete replay state');
// JMA map style is a unified operational blue-water/green-land/vector path palette.
for (const color of ['#1963CA','#59965A','#EEF537','#CB3045','#F8FBFC']) assert(palette.includes(color));
assert(controls.includes('if (style === "JMA") onLayersChange({ baseMap: "jma" })'));
assert(map.includes('config.agencyStyle === "JMA" ? "jma" : layers.baseMap'));
assert(report.includes('JMA_PRODUCT_COLORS.ocean') && report.includes('JMA_PRODUCT_COLORS.land') && report.includes('JMA_PRODUCT_COLORS.grid'));
assert(video.includes('const effectiveBaseMap: VideoExportConfig["baseMap"] = jmaProductMap ? "jma" : exportConfig.baseMap;'));
assert(video.includes('if (exportConfig.showGrid || jmaProductMap)'));
assert(video.includes('exportConfig.replayStyle !== "himawari8_observation"'), 'satellite observation style must stay independent');
assert(videoModal.includes('baseMap: "jma", showGrid: true'), 'JMA preset must match forecast color plate');
console.log('ROUND135 station naming / lightweight timeline seek / unified JMA map regression: PASS');
