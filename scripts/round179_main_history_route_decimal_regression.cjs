'use strict';
/** Round179: copied FULL history must stay attached at every historical issue,
 * regardless of where the mobile playback cursor stood when Copy was pressed.
 * A future tail must be integrated FROM the last observation, never translated
 * from a separate forecast initialised at the earlier issue. NMC labels must
 * never expose floating-point noise from an issue/legacy peak slider. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=(()=>{try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const read=p=>fs.readFileSync(p,'utf8');
const compile=(code,name)=>ts.transpileModule(code,{fileName:name,
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const physicsFile='src/simulation/PreSimulationReference.ts';
const m={exports:{}};
vm.runInNewContext(compile(read(physicsFile),physicsFile),{module:m,exports:m.exports,
 require:k=>{throw Error('unknown import '+k)},Math,Number,Map,Set,Error,Array,Object});
const guidance=m.exports;
const radii={ne:110,se:110,sw:110,nw:110};
const make=h=>({simHour:h,lat:h<140?12+h*.065:21.1+(h-140)*.085,
 lon:h<140?153-h*.21:123.6+(h-140)*.035,
 vmax:h<40?15+h*.72:h<150?43.8+h*.12:57-(h-150)*.075,
 pmin:1000-h*.2,category:'强台风',speed:20,direction:300,rmw:25,
 r7:radii,r10:radii,r12:radii,landed:false,dissipated:false});
const history=Array.from({length:273},(_,h)=>make(h));
// Previously the user had earlier, unrelated guide/cancel markers in the
// historical archive. Copying the main simulation should supersede them all.
history[75].preSimulationReference={version:1,stormId:'R179',issueHour:75,authority:1,
 completedLeadHour:1,fixes:[{leadHour:0},{leadHour:1}]};
history[82].preSimulationReferenceCleared=true;
history[179].forecastPath=[{simHour:180,lat:77,lon:33,previewOnly:false}];
const source={id:'R179',name:'达维',history,preSimulationReference:history[75].preSimulationReference};
const copied=guidance.copyMainHistoryToForecast(source);
assert.equal(copied.history.length,273);
assert.equal(copied.preSimulationReference.issueHour,0,
 'playback cursor at 179h must not truncate the first 179 recorded hours');
assert.equal(copied.preSimulationReference.completedLeadHour,272);
assert.equal(copied.history[0].preSimulationReference,copied.preSimulationReference);
assert(copied.history.every((h,i)=>i===0 || !h.preSimulationReference));
assert(copied.history.every((h,i)=>i===0 || !h.preSimulationReferenceCleared));
assert(copied.history.every(h=>Array.isArray(h.forecastPath)&&h.forecastPath.length===0));
assert.equal(source.history[179].forecastPath[0].lat,77,'must not mutate original history');
for(const issueHour of [0,24,94,179,210]){
 const issue={...copied.history[issueHour],id:'R179',history:copied.history,
  preSimulationReference:copied.preSimulationReference};
 const ref=guidance.issuePreSimulationReference(issue,issueHour);
 assert.equal(ref,copied.preSimulationReference,'copied guidance was lost at issue '+issueHour);
 const expected=Math.min(120,272-issueHour);
 const actual=guidance.mainHistoryForecastFixes(ref,issueHour,issue,120);
 assert(actual && actual.length===expected+1);
 for(let i=0;i<=expected;i++){
  const recorded=history[issueHour+i];
  assert(Math.abs(actual[i].lat-recorded.lat)<1e-9,'wrong latitude at '+issueHour+'+'+i);
  assert(Math.abs(actual[i].lon-recorded.lon)<1e-9,'wrong longitude at '+issueHour+'+'+i);
  assert(Math.abs(actual[i].vmax-recorded.vmax)<1e-9,'wrong intensity at '+issueHour+'+'+i);
 }
}
const engineText=read('src/simulation/Engine.ts');
const ast=ts.createSourceFile('Engine.ts',engineText,ts.ScriptTarget.ES2022,true);
const decl=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='materializeForecastPath');
assert(decl);
const extracted={};let physicsCalls=[];
const ctx={module:{exports:extracted},exports:extracted,issuePreSimulationReference:guidance.issuePreSimulationReference,
 mainHistoryForecastFixes:guidance.mainHistoryForecastFixes,
 rebasePreSimulationReference:guidance.rebasePreSimulationReference,
 blendPreSimulationForecast:guidance.blendPreSimulationForecast,
 calculateForecastTrackPath:(seed,cfg,h)=>{
  physicsCalls.push({type:'geometry',issue:seed.simHour,lat:seed.lat,lon:seed.lon,horizon:h});
  return [{simHour:0,lat:seed.lat,lon:seed.lon}];
 },
 calculateForecastPath:(seed,cfg,h)=>{
  physicsCalls.push({type:'intensity',issue:seed.simHour,lat:seed.lat,lon:seed.lon,horizon:h});
  return Array.from({length:Math.ceil(h)+1},(_,i)=>({simHour:i,
   lat:seed.lat+i*.05,lon:seed.lon+i*.06,vmax:seed.vmax-i*.01,pmin:seed.pmin+i*.06,
   category:'强台风'}));
 },landGeoJson:undefined,checkPointOnLandGeoJson:()=>false,
 TyphoonCategory:{TD:'热带低压',TS:'热带风暴',STS:'强热带风暴',TY:'台风',STY:'强台风',SuperTY:'超强台风',ET:'温带气旋',RL:'残留低压',DS:'已消散'},
 Array,Math,Number,Object,Map,Set,Error};
vm.runInNewContext(compile(decl.getText(ast)+'\nmodule.exports.run=materializeForecastPath','engine_func.ts'),ctx);
const run=extracted.run;
// The full 120 hours from +94 are already archived: zero forecast re-runs.
let issue={...copied.history[94],id:'R179',history:copied.history,preSimulationReference:copied.preSimulationReference};
let generated=run(issue,{},120,[]);
assert.equal(physicsCalls.length,0,'complete recorded route still recomputed');
assert.equal(generated[120].lat,history[214].lat);
// An issue at +179 has only 93 known hours. The final 27 hours must
// begin from the genuine +272 location, not from +179 with a 24h offset.
issue={...copied.history[179],id:'R179',history:copied.history,preSimulationReference:copied.preSimulationReference};
generated=run(issue,{},120,[]);
assert.equal(generated[93].lon,history[272].lon);
assert.equal(generated[94].simHour,94);
assert(Math.abs(generated[94].lat-(history[272].lat+.05))<1e-8,
 'future location did not originate at actual last observed state');
assert.equal(physicsCalls.length,2);
assert(physicsCalls.every(c=>c.issue===272&&Math.abs(c.lon-history[272].lon)<1e-9 && c.horizon===27),
 'tail physical model must start from actual final observation');
assert.equal(generated.length,121);
// Check text rendering helper through its actual (extracted) TS implementation.
const nmc=read('src/utils/NmcForecastProduct.ts');
const tree=ts.createSourceFile('NmcForecastProduct.ts',nmc,ts.ScriptTarget.ES2022,true);
const names=['isNmcExtratropical','category','classification','cmaNmcAssessment'];
const funcs=tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));
assert.equal(funcs.length,names.length);
const assess={exports:{}};
vm.runInNewContext(compile(funcs.map(f=>f.getText(tree)).join('\n')+'\nmodule.exports.check=cmaNmcAssessment','nmc_check.ts'),{
 module:assess,exports:assess.exports,Number,Math,
 PALETTE:{et:'#999',td:'#ff0',ts:'#0ff',sts:'#0a0',ty:'#fa0',sty:'#f0f',super:'#f00'},
 getAgencyIntensity:v=>({value:v}),getWindForceCategory:v=>v>=62?17:v>=51?16:12,
 });
const check=assess.exports.check;
assert.equal(check(67.63333099702145,'超强台风').wind,68);
assert.equal(check(67.63333099702145,'超强台风').wind,68);
assert.equal(check(67.63333099702145,'超强台风').wind,68,
 'legacy exact float must never bypass public wind reporting');
assert.equal(check(61.5,'超强台风').wind,62,'manual peak labels must display integer CMA public winds');
const modal=read('src/components/ForecastImageModal.tsx');
assert(modal.includes('const requestedPeak = Math.max(Math.ceil(Number(issue.vmax)),Math.round(nmcCustomPeak));'));
assert(modal.includes('history: copiedMainHistory ? (typhoon.history || [])'));
const app=read('src/App.tsx');
assert(app.includes('copyMainHistoryToForecast(storm)'));
console.log('ROUND179 PASS: all recorded issues exact, cursor-independent copy, stale references cleared, terminal continuation seeded at +272, NMC public-bin labels');
