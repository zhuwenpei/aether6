/** Round144: exercise the production TS archive module, including gzip/file IO. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const archiveSource = fs.readFileSync('src/utils/SimulationArchive.ts', 'utf8');
const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const drawerSource = fs.readFileSync('src/components/ControlDrawer.tsx', 'utf8');
const engineSource = fs.readFileSync('src/simulation/Engine.ts', 'utf8');
const compiled = ts.transpileModule(archiveSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true
});
assert.equal(compiled.diagnostics?.length || 0, 0, 'archive should transpile');
const sandbox = {
  exports: {}, console, Date, JSON, Blob, Response, CompressionStream, DecompressionStream,
  Uint8Array, Object, Array, Number, String, Math, Error, Set, Map, Promise
};
vm.createContext(sandbox);
vm.runInContext(compiled.outputText, sandbox);
const lib = sandbox.exports;
// Also execute the exact RNG implementation, not an approximated copy.
const rngBegin = engineSource.indexOf('export class SeededRandom');
const rngEnd = engineSource.indexOf('const clamp01', rngBegin);
assert(rngBegin >= 0 && rngEnd > rngBegin);
const rngJs = ts.transpileModule(engineSource.slice(rngBegin, rngEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const rngRealm = { exports: {}, Math, Number, Error };
vm.createContext(rngRealm);
vm.runInContext(rngJs, rngRealm);
const SeededRandom = rngRealm.exports.SeededRandom;
const rng1 = new SeededRandom('exact-checkpoint');
for (let i = 0; i < 19; i++) rng1.next();
const rngSnapshot = rng1.getState();
const rng2 = new SeededRandom('exact-checkpoint');
rng2.setState(rngSnapshot);
for (let i = 0; i < 25; i++) assert.equal(rng2.next(), rng1.next(), 'checkpoint must preserve the NEXT random draw');
const archived = {
  typhoons: [
    { id: 'storm-a', name: '测试甲', lat: 20, lon: 140, vmax: 33.2, simHour: 24,
      history: [
        { simHour: 0, lat: 15, lon: 151, vmax: 15, configSnapshot: { manualForecastRoute: [{ lat: 17, lon: 149 }] } },
        { simHour: 24, lat: 20, lon: 140, vmax: 33.2, configSnapshot: { seed: 'custom' }, stationReadings: [{ station: 'Naha', wind: 23 }] }
      ] },
    { id: 'storm-b', name: '测试乙', lat: 28, lon: 129, vmax: 18, simHour: 24,
      history: [{ simHour: 12, lat: 24, lon: 135, vmax: 15 }, { simHour: 24, lat: 28, lon: 129, vmax: 18 }] }
  ],
  eventLogs: [{ id: 'log-1', time: '2026-10-08T02:00:00.000Z', type: 'info', simHour: 2, message: '生成台风' }],
  config: { seed: 'custom', drawnTrackRoute: [{ lat: 20, lon: 140 }, { lat: 27, lon: 125 }] },
  layers: { forecast: true, drawnForecastRoute: true, baseMap: 'jma' },
  currentHour: 13, maxHour: 24, totalSimMinutes: 780,
  startDate: '2026-10-08T00:00:00.000Z', seasonEnded: false, speed: 8, prngState: 129854, timelineCollapsed: false,
  genesisPos: { lat: 14, lon: 155 }, productPreferences: { forecast_forecastHours: '120' }
};
(async () => {
  const original = JSON.stringify(archived);
  const made = lib.makeSimulationArchive(archived);
  assert.equal(made.format, lib.AETHER_ARCHIVE_FORMAT);
  const asText = JSON.stringify(made);
  const plain = await lib.readSimulationArchiveFile(new Blob([asText]));
  assert.equal(JSON.stringify(plain.data), original);
  const zipped = await lib.createSimulationArchiveBlob(archived);
  const zippedData = await lib.readSimulationArchiveFile(zipped);
  assert.equal(JSON.stringify(zippedData.data), original);
  assert(zippedData.data.eventLogs[0].time instanceof Date, 'import must revive log timestamps to Date');
  assert.equal(JSON.stringify(archived), original, 'saving must not mutate active simulation');
  assert.equal(zippedData.data.typhoons[0].history[1].stationReadings[0].wind, 23);
  assert.equal(zippedData.data.currentHour, 13, 'replay cursor must be retained');
  assert.equal(zippedData.data.maxHour, 24, 'maximum recorded hour must be retained');
  assert.equal(zippedData.data.config.drawnTrackRoute.length, 2, 'drawn routes must be retained');
  const invalidCases = [
    '{bad-json}',
    JSON.stringify({ ...made, format: 'not-an-aether-file' }),
    JSON.stringify({ ...made, schemaVersion: 99 }),
    JSON.stringify({ ...made, data: { ...archived, currentHour: 40 } }),
    JSON.stringify({ ...made, data: { ...archived, prngState: -1 } }),
    JSON.stringify({ ...made, data: { ...archived, eventLogs: [{ id: 'bad', time: 'not-a-date', type: 'info', message: 'x', simHour: 1 }] } }),
    JSON.stringify({ ...made, data: { ...archived, typhoons: [archived.typhoons[0], archived.typhoons[0]] } }),
    JSON.stringify({ ...made, data: { ...archived, productPreferences: { aether_terms_accepted_v1: '1' } } })
  ];
  for (const bad of invalidCases) {
    assert.rejects(() => lib.readSimulationArchiveFile(new Blob([bad])), /AETHER|无效|不匹配|不兼容|损坏/);
  }
  await assert.rejects(() => lib.readSimulationArchiveFile(new Blob([])), /存档为空/);
  await assert.rejects(() => lib.readSimulationArchiveFile(new Blob([new Uint8Array([0x1f, 0x8b, 1, 2, 3])])), /解压失败/);
  assert(appSource.includes('readSimulationArchiveFile(file)') && appSource.includes('setIsPlaying(false)'));
  assert(appSource.includes('setMaxHour(data.maxHour)') && appSource.includes('setStartDate(new Date(data.startDate))'));
  assert(appSource.includes('engineRef.current.restorePrngState(data.prngState)'));
  assert(appSource.includes('localStorage.setItem("typhoon_sim_state_prng"'));
  assert.equal(zippedData.data.prngState, 129854, 'exact PRNG state must survive transfer');
  assert(drawerSource.includes('btn-save-simulation-archive') && drawerSource.includes('btn-open-simulation-archive'));
  assert(drawerSource.includes('aria-live="polite"') && drawerSource.includes('type="file"'));
  console.log('ROUND144 COMPLETE SIMULATION ARCHIVE: PASS');
  console.log('JSON and gzip round-trip, full history/config, version rejection, corruption checks, UI entrypoints: PASS');
  console.log('Exact seeded PRNG checkpoint next-25-draw equivalence: PASS');
  console.log(`gzip sample bytes=${zipped.size}; plain=${new Blob([asText]).size}`);
})().catch(err => { console.error(err); process.exitCode = 1; });
