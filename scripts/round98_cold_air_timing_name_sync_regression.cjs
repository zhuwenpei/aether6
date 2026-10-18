const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function loadStandaloneTs(rel) {
  const source = read(rel);
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: rel
  }).outputText;
  const mod = { exports: {} };
  Function('require', 'module', 'exports', out)(require, mod, mod.exports);
  return mod.exports;
}

assert.ok(/^6\.0\.(2[2-9]|[3-9]\d)$/.test(require(path.join(root, 'package.json')).version), 'unexpected post-ROUND98 version');

const timing = loadStandaloneTs('src/simulation/ColdAirTiming.ts');
assert.equal(timing.COLD_AIR_CENTER_CONTACT_DELAY_HOURS, 0);
assert.equal(timing.getColdAirCenterContactHour(12), 12);

const identity = loadStandaloneTs('src/utils/TyphoonIdentity.ts');
const live = {
  id: 'storm-1', name: '新名称', officialNumber: '2708', seasonOrdinal: 8,
  history: [{ simHour: 0, name: '旧名称' }, { simHour: 3, name: '旧名称' }],
  forecastPath: [{ simHour: 0, name: '旧名称' }]
};
const merged = identity.mergeTyphoonStateWithCurrentIdentity(live, { simHour: 3, name: '旧名称', officialNumber: '2601' });
assert.equal(merged.name, '新名称', 'archived name overwrote live identity');
assert.equal(merged.officialNumber, '2708', 'archived number overwrote live identity');
const synced = identity.syncTyphoonNameIntoSnapshots(live, '再命名');
assert.equal(synced.name, '再命名');
assert.ok(synced.history.every((h) => h.name === '再命名'), 'history snapshots did not receive renamed identity');
assert.ok(synced.forecastPath.every((h) => h.name === '再命名'), 'forecast snapshots did not receive renamed identity');

const field = read('src/simulation/SynopticWindField.ts');
assert.ok(field.includes('getColdAirCenterContactHour(arrivalHour)'), 'wind field does not use shared centre-contact clock');
assert.ok(field.includes('centerContactHour'), 'cold-air centre-contact hour missing from event anchor');
assert.ok(field.includes('resolveSynopticStormAtHour(typhoon, initHour, centerContactHour, config)'), 'contact centre is not resolved at configured arrival time');
assert.ok(!field.includes('strongCoreLagKm'), 'legacy delayed strong-core lag remains');
assert.ok(field.includes('(centerContactHour - validHour) * propagationKmh'), 'cold-air front is not advanced on the centre-contact clock');

const engine = read('src/simulation/Engine.ts');
assert.ok(engine.includes('getColdAirCenterContactHour(coldAirArrivalHour)'), 'intensity forcing is not synchronized to wind-field centre contact');
assert.ok(engine.includes('currentSimHourFloat - coldAirCenterContactHour'), 'intensity response still begins at the old arrival marker');

const app = read('src/App.tsx');
assert.ok(app.includes('syncTyphoonNameIntoSnapshots'), 'rename handler does not synchronize cached history/forecast identity');
assert.ok(app.includes('setVideoExportTyphoon((prev) => patchSnapshot(prev))'), 'open video export snapshot remains stale after rename');
assert.ok(app.includes('setReportModalTyphoon((prev) => patchSnapshot(prev))'), 'open report snapshot remains stale after rename');
assert.ok(app.includes('冷空气强风前锋将抵达台风中心并同步开始影响强度'), 'cold-air scheduling feedback does not document same-time contact');

for (const rel of [
  'src/components/ForecastImageModal.tsx',
  'src/components/MapView.tsx',
  'src/utils/SynopticWindPressureMap.ts',
  'src/utils/VideoRenderEngine.ts',
  'src/utils/JtwcForecastProduct.ts',
  'src/simulation/DrawnTrackBranch.ts'
]) {
  const src = read(rel);
  assert.ok(src.includes('mergeTyphoonStateWithCurrentIdentity'), `${rel} can still let historical identity overwrite the current name`);
}

console.log('ROUND98 cold-air timing/name synchronization compatibility regression: PASS');
