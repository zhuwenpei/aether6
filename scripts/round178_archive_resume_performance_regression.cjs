/** Round178: real archive validator/JSON round-trip + the production hourly snapshot projector. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root = process.cwd();
function loadTs(relative) {
  const content = fs.readFileSync(`${root}/${relative}`, 'utf8');
  const result = ts.transpileModule(content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.equal(result.diagnostics?.length || 0, 0, `bad syntax: ${relative}`);
  const realm = { exports: {}, Date, JSON, Blob, Response, CompressionStream, DecompressionStream, Uint8Array, Object, Array, Number, String, Math, Error, Set, Map, Promise, console };
  vm.createContext(realm);
  vm.runInContext(result.outputText, realm, { filename: relative });
  return realm.exports;
}
const arch = loadTs('src/utils/SimulationArchive.ts');
const historySeed = loadTs('src/utils/HistorySnapshot.ts');
const engine = fs.readFileSync('src/simulation/Engine.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
assert(engine.includes('makeHourlyHistorySeed(updatedTy)'), 'physics engine must use tested seed projector');
assert(!engine.includes('const { history: _historyForArchive, ...completeForecastSeed }'), 'old full-state projector must be removed');
assert(app.includes('localRecoveryDisabledRef.current || snapshotTyphoons.length === 0'), 'disabled local autosave must never serialize history');
assert(app.includes('clearLocalRecovery()'), 'discard partial stale recovery slots');
assert(app.includes('skipOversizedLocalRecovery(file.size, importedSnapshotCount)'), 'oversized imported JSON must skip blocking localStorage');
assert(arch.skipOversizedLocalRecovery(20 * 1024 * 1024, 50));
assert(arch.skipOversizedLocalRecovery(10, 901));
assert(!arch.skipOversizedLocalRecovery(1024, 40));
function quad(n) {return {ne:n,se:n,sw:n,nw:n};}
const issueHour=10;
const fixes=Array.from({length:121},(_,leadHour)=>({leadHour,lat:15+leadHour*0.02,lon:130-leadHour*0.06,vmax:Math.max(12,37-leadHour*0.12),pmin:985,speed:15,rmw:35,r7:quad(120),r10:quad(50),r12:quad(0)}));
const ref={version:1,stormId:'R178',issueHour,completedLeadHour:120,authority:1,origin:'main-history',fixes};
const history=Array.from({length:11},(_,simHour)=>({simHour,lat:15,lon:130,vmax:32}));
history[issueHour]={...history[issueHour],preSimulationReference:ref};
let current = {id:'R178',name:'回档继续模拟',lat:15,lon:130,vmax:32,simHour:10,preSimulationReference:ref,preSimulationReferenceCleared:false,history};
for(let h=11;h<=130;h++) {
  const projected = historySeed.makeHourlyHistorySeed(current);
  assert(!Object.hasOwn(projected,'preSimulationReference'));
  assert(!Object.hasOwn(projected,'preSimulationReferenceCleared'));
  assert(!Object.hasOwn(projected,'history'));
  current={...current,simHour:h,lat:15+h*0.01,vmax:32+h*0.01,history:[...current.history,{...projected,simHour:h,lat:15+h*0.01,vmax:32+h*0.01}]};
}
assert.strictEqual(current.preSimulationReference,ref,'live storm keeps active guidance');
assert.strictEqual(current.history[10].preSimulationReference,ref,'original issue preserved');
assert(current.history.slice(11).every(h=>!h.preSimulationReference),'later observation cannot contain issue reference');
const data={
 typhoons:[current],eventLogs:[{id:'e1',time:new Date('2027-07-01T00:00:00Z'),simHour:2,type:'info',message:'事件'}],
 config:{seed:'round178'},layers:{forecast:true},currentHour:130,maxHour:130,totalSimMinutes:7800,startDate:'2027-07-01T00:00:00.000Z',
 seasonEnded:false,speed:8,prngState:3911,timelineCollapsed:false,genesisPos:{lat:15,lon:130}
};
(async()=>{
  const blob=await arch.createSimulationArchiveBlob(data,'readable');
  assert(blob.size>0);
  const imported=await arch.readSimulationArchiveFile(blob);
  assert.equal(imported.data.typhoons[0].history.length,131);
  assert.equal(imported.data.typhoons[0].history[10].preSimulationReference.issueHour,10);
  assert.equal(imported.data.typhoons[0].history[130].preSimulationReference,undefined);
  const again=await arch.createSimulationArchiveBlob(imported.data,'compressed');
  const parsed=await arch.readSimulationArchiveFile(again);
  assert.equal(parsed.data.typhoons[0].history[130].simHour,130);
  assert.equal(parsed.data.prngState,3911);
  assert(!arch.skipOversizedLocalRecovery(again.size,130),'short gzip backup should keep ordinary local recovery');
  const invalid={...data,typhoons:[{...current,history:current.history.map((h,i)=>i===11?{...h,preSimulationReference:ref}:h)}]};
  assert.throws(()=>arch.makeSimulationArchive(invalid),/起报时刻|预模拟预报/,'invalid issue replication must remain rejected');
  const bloated=JSON.stringify(invalid).length;
  assert(bloated>JSON.stringify(data).length + 5000,'each erroneous reference replicates real weight');
  console.log('ROUND178 ARCHIVE RESUME: PASS');
  console.log(`JSON/gzip re-export after 120 continued hours: PASS, one issue only; simulated invalid prior copy rejected; local recovery size decisions checked; archive=${blob.size} bytes`);
})().catch(e=>{console.error(e); process.exitCode=1;});
