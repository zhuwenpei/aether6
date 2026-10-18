'use strict';
/** Round173: covered weakening, disabled NMC peak reference, transfers, TD labels, render branding. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const src=p=>fs.readFileSync(p,'utf8');
function load(file, inject='', modules={}){
 const js=ts.transpileModule(src(file)+inject,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext(js,{module:mod,exports:mod.exports,require:p=>{
   if(p in modules)return modules[p];throw Error('Unmocked module '+p);
 },Math,Number,Date,Set,Map,Error,Array,Object}, {filename:file});
 return mod.exports;
}
const physics=load('src/simulation/PreSimulationReference.ts');
const makeFix=(h,v,lat,lon)=>({simHour:h,lat,lon,vmax:v,pmin:1020-v*1.5,
 category:v>=51?'超强台风':'强台风',landed:false,speed:24,direction:300,rmw:25,
 r7:{ne:100,se:100,sw:100,nw:100},r10:{ne:50,se:50,sw:50,nw:50},r12:{ne:20,se:20,sw:20,nw:20}});
// Confirmed track starts at 72, reaches 58, then decays all the way to 45.
const winds=[72,71,69,66,63,60,58,55,52,49,45];
const history=winds.map((v,i)=>makeFix(i*6,v,17+i*.6,150-i));
const hourly=[];
for(let i=0;i<history.length-1;i++)for(let k=0;k<6;k++){
 const a=history[i],b=history[i+1],t=k/6;
 hourly.push(makeFix(i*6+k,a.vmax+(b.vmax-a.vmax)*t,a.lat+(b.lat-a.lat)*t,a.lon+(b.lon-a.lon)*t));
}
hourly.push(history.at(-1));
const storm={id:'round173',history:hourly};
const reference=physics.buildPreSimulationReference(storm,0);
assert.equal(reference.completedLeadHour,60);
const ordinary=Array.from({length:61},(_,h)=>makeFix(h, h<18?72-h*.8:70,
  17+h*.6/6,150-h/6));
const guided=physics.blendPreSimulationForecast(ordinary,reference,120,{isLandAt:()=>false});
for(const hour of [18,24,30,36,42,48,54,60]){
 const p=guided.find(p=>p.simHour===hour),seen=reference.fixes.find(f=>f.leadHour===hour);
 assert(p&&seen,'fix available '+hour);
 assert(p.vmax<=seen.vmax+.76,`no unexpected re-intensification at ${hour}h: ${p.vmax} v ${seen.vmax}`);
 assert(p.vmax>=5,'no invalid wind');
}
assert(guided.at(-1).vmax<50,'no 70 m/s plateau at landfall');
// Reference reissue respects historical time and does not leak to earlier issues.
const issue=physics.issuePreSimulationReference({id:'round173',history:[{simHour:0,preSimulationReference:reference}],preSimulationReference:reference},10);
assert(issue&&issue.fixes.length>1);
assert(!physics.issuePreSimulationReference({id:'round173',history:[{simHour:15,preSimulationReference:reference}]},-1));
const nmc=load('src/utils/NmcForecastProduct.ts',`\nexport const __nmcAssessmentForTest = cmaNmcAssessment;`,{
 '../simulation/Engine':{getAgencyIntensity:(v)=>({value:v}),getWindForceCategory:(v)=>v>=17?8:7},
 '../simulation/CmaOperationalClock':{getSimulationBeijingDate:()=>new Date()},
 './ProductCoastlineDrawing':{strokeProductCoastlineRing:()=>{}},
 './NmcMapViewport':{buildNmcGeoFrame:()=>({}),nmcProjectPoint:()=>({})},
 './NmcOptionalGeography':{shouldDrawNmcRiver:()=>true}
});
assert.equal(nmc.__nmcAssessmentForTest(15.724488411640234,'热带低压').wind,16,'TD labels must be clean integer');
assert.equal(nmc.__nmcAssessmentForTest(61.5,'超强台风').wind,62,'NMC manual peaks must be rounded to integer public wind');
const chart=src('src/utils/NmcForecastProduct.ts');
assert(chart.includes("ctx.fillText('WMC', 1261, 56)"));
assert(chart.includes('模拟产品，仅供娱乐'));
assert(!/fillText\(['\"]AETHER/.test(chart));
const app=src('src/App.tsx'),sandbox=src('src/components/ForecastPreSimulation.tsx'),modal=src('src/components/ForecastImageModal.tsx');
assert(app.includes('applyCurrentSimulationToForecast')&&app.includes("copyMainHistoryToForecast(storm)"));
assert(sandbox.includes('window.confirm(')&&sandbox.includes('onConfirm(ref,copy?'));
assert(app.includes('engineRef.current.restorePrngState(copyToMain.prngState)'));
assert(app.includes('mergedHistory')&&app.includes('totalSimMinutesRef.current=end*60'));
assert(modal.includes('const applyImagePeak = nmcCustomPeakEnabled;'), 'explicit NMC override must not be blocked by confirmed sandbox');
const worker=src('src/workers/ForecastSandboxWorker.ts');
assert(worker.includes('performance.now()-lastPublishedAt>=330'));
for(const file of ['src/utils/EnsembleReferenceProducts.ts','src/utils/SynopticWindPressureMap.ts',
  'src/components/ForecastImageModal.tsx','src/components/TyphoonReportModal.tsx']){
 const f=src(file);
 assert(!/fillText\([^\n]*\bAETHER\b/.test(f),`legacy AETHER drawing remains: ${file}`);
}
console.log('ROUND173 PASS: physical weakening after confirmed peak, NMC TD/peak labels, transfer/PRNG contracts, image/ensemble/video labels, worker IPC budget');
