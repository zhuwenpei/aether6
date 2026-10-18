const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (s, needle, label) => assert.ok(s.includes(needle), `${label} missing: ${needle}`);
const lacks = (s, needle, label) => assert.ok(!s.includes(needle), `${label} must not contain: ${needle}`);

const pkg = JSON.parse(read('package.json'));
const types = read('src/types.ts');
const defaults = read('src/config/DefaultSettings.ts');
const app = read('src/App.tsx');
const drawer = read('src/components/ControlDrawer.tsx');
const tutorial = read('src/components/AetherTutorial.tsx');
const forecast = read('src/components/ForecastImageModal.tsx');
const report = read('src/components/TyphoonReportModal.tsx');
const reportSummary = read('src/components/TyphoonReport.tsx');
const rainfall = read('src/utils/ObservedRainfallMap.ts');
const jtwc = read('src/utils/JtwcForecastProduct.ts');
const map = read('src/components/MapView.tsx');
const identity = read('src/utils/TyphoonDisplayName.ts');
const engine = read('src/simulation/Engine.ts');

assert.strictEqual(pkg.version, '4.1.4');
assert.strictEqual(pkg.scripts['test:release-4.1.4'], 'node scripts/release_4_1_4_regression.cjs');
has(engine, 'TyphoonSim/4.1.4', 'Engine User-Agent');

// 1. Observed rainfall is always 24 h; the switchable UI/state is gone.
lacks(forecast, 'rainfallWindow', 'ForecastImageModal');
has(forecast, 'windowHours: 24', 'fixed 24 h observed rainfall');
has(forecast, '统计窗口固定为过去 24 小时', 'fixed-window UI');

// 2. Retire the 3.7.8 new-environment panels and debug tab without deleting the backend migration fields.
lacks(drawer, 'newEnvironmentPanelsEnabled', 'ControlDrawer new environment UI');
lacks(drawer, 'SynopticEnvironment', 'ControlDrawer new environment preset imports');
lacks(drawer, '{ id: "debug", label: "调试"', 'ControlDrawer debug tab');
lacks(tutorial, '#tab-select-debug', 'tutorial debug reference');
has(app, 'newEnvironmentPanelsEnabled: false', 'saved-config migration guard');
has(app, 'newEnvironmentPhysicsEnabled: false', 'new-physics disable guard');

// 3. Canonical simulated-time YYNN cyclone identity.
has(types, 'officialNumber?: string;', 'Typhoon official number');
has(drawer, 'id="input-typhoon-number"', 'editable cyclone sequence');
has(identity, 'export function getTyphoonOfficialNumber', 'official number helper');
has(identity, 'export function getTyphoonYearCode', 'simulated-year helper');
has(app, 'nextTyphoon.officialNumber', 'genesis official number');
has(reportSummary, '["正式编号", getTyphoonOfficialNumber', 'summary report identity sync');
has(jtwc, 'getTyphoonOfficialNumber(typhoon, startDate)', 'JTWC identity sync');

// Runtime-check the YY prefix regeneration, including a simulated-year rollover.
const idJs = ts.transpileModule(identity, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: 'TyphoonDisplayName.ts', reportDiagnostics: true
});
assert.strictEqual((idJs.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const idMod = { exports: {} };
vm.runInNewContext(idJs.outputText, {
  module: idMod, exports: idMod.exports,
  require: (id) => {
    if (id.includes('CmaOperationalClock')) return { isCmaTyphoonProductTime: () => true };
    return {};
  },
  Math, Date, Number, String
});
const { getTyphoonOfficialNumber } = idMod.exports;
assert.strictEqual(getTyphoonOfficialNumber({ simHour: 0, seasonStartHour: 0, seasonOrdinal: 12, officialNumber: '9912', history: [] }, new Date('2026-07-01T00:00:00Z')), '2612');
assert.strictEqual(getTyphoonOfficialNumber({ simHour: 48, seasonStartHour: 48, seasonOrdinal: 12, officialNumber: '2612', history: [] }, new Date('2026-12-31T00:00:00Z')), '2712');

// 4. Full-life rainfall report, same legend/palette as observed rainfall legend 2, optional track,
// national China frame, and exact spatial candidate acceleration.
has(report, '"intensity" | "track" | "landfall" | "rainfall"', 'rainfall report type');
has(report, 'fullTrackProduct: true', 'full-life rainfall mode');
has(report, 'legendStyle: "extreme_reference", mapPalette: "palette2"', 'legend 2 rainfall palette');
has(report, '中国（含港澳台）', 'China rainfall domain');
has(report, '叠加全程台风路径（黑线）', 'rainfall track overlay control');
has(rainfall, 'domainMode?: "auto" | "china";', 'rainfall domain mode');
has(rainfall, 'showTrackOverlay?: boolean;', 'rainfall track overlay');
has(rainfall, 'const snapshotBuckets: number[][]', 'exact spatial snapshot index');
has(rainfall, 'const candidateSnapshots = snapshotBuckets', 'candidate-index use');

// 5. NMC framing ignores the full genesis track and uses only recent analysed motion.
has(forecast, 'const recentHistoryStartHour = currentHour - 36;', 'NMC recent-history bound');
has(forecast, 'h.simHour >= recentHistoryStartHour', 'NMC recent-history fitting');
has(forecast, 'h.simHour >= currentHour - 36', 'NMC displayed recent history');

// 6. JTWC complete uncertainty envelope, sensible frame, 4-quadrant 34/50/64 radii and label layout.
has(jtwc, '...coneLeft, ...coneRight, ...terminalArc', 'JTWC cone bounds');
has(jtwc, 'coneCenters.forEach', 'JTWC swept uncertainty disks');
has(jtwc, 'polygon = [...coneLeft', 'JTWC closed uncertainty polygon');
has(jtwc, 'active.r7', 'JTWC 34 kt quadrants');
has(jtwc, 'active.r10', 'JTWC 50 kt quadrants');
has(jtwc, 'active.r12', 'JTWC 64 kt quadrants');
has(jtwc, 'for (let b = 0; b < 360; b += 2)', 'JTWC smooth asymmetric wind polygons');
has(jtwc, 'const candidates = [', 'JTWC label collision candidates');
has(jtwc, 'overlapArea(box, o)', 'JTWC label collision scoring');
has(jtwc, 'currentHour - 48', 'JTWC recent-history framing');

// 7. Procedural near-surface radar layer: visible switch + standard dBZ legend, no bitmap texture.
has(types, 'radarReflectivity?: boolean;', 'radar layer type');
has(defaults, 'radarReflectivity: false', 'radar layer default');
has(drawer, 'radarReflectivity', 'radar layer switch');
has(map, 'computeGroundRadarReflectivity', 'procedural radar calculation');
has(map, 'getRadarReflectivityColor', 'radar dBZ palette');
has(map, 'RADAR_LEGEND_BANDS', 'radar legend');
has(map, '近地层模拟 · 程序计算', 'procedural radar legend note');
has(map, 'activeRadarTyphoons', 'multi-cyclone radar composite');
lacks(map, 'radarTexture', 'radar bitmap texture');

for (const doc of ['UPDATE_NOTES_4.1.4.md', 'RESEARCH_BASIS_4.1.4.md']) {
  assert.ok(fs.existsSync(path.join(root, doc)), `${doc} missing`);
}

console.log('PASS release_4_1_4_regression');
