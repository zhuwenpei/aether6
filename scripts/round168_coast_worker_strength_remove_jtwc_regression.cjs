'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const read=p=>fs.readFileSync(p,'utf8');
const compile=p=>{const result=ts.transpileModule(read(p),{fileName:p,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);return result.outputText};
const p={exports:{}};
vm.runInNewContext(compile('src/simulation/PreSimulationReference.ts'),{module:p,exports:p.exports,Math,Number,Set,Map,Error});
const {buildPreSimulationReference,blendPreSimulationForecast,issuePreSimulationReference,rebasePreSimulationReference}=p.exports;
const radii=n=>({ne:n,se:n,sw:n,nw:n});
const fix=(h,lon,v,land=false)=>({simHour:h,lat:22,lon,vmax:v,pmin:1010-v*1.3,direction:90,speed:44,landed:land,dissipated:false,rmw:30,category:'台风',r7:radii(180),r10:radii(100),r12:radii(50)});
const sandbox=Array.from({length:25},(_,h)=>fix(h,120+.4*h,38+Math.min(h*1.4,22)));
const ref=buildPreSimulationReference({id:'strong',history:sandbox},0);
const ordinary=Array.from({length:25},(_,h)=>fix(h,120+.4*h,38+Math.min(h*.30,7)));
const high=blendPreSimulationForecast(ordinary,ref,24);
const baseline=blendPreSimulationForecast(ordinary,{...ref,authority:0},24);
assert(high[12].vmax>baseline[12].vmax+7,`reference had no meaningful wind influence: ${high[12].vmax} vs ${baseline[12].vmax}`);
assert(high[12].vmax<sandbox[12].vmax+2,'forecast must not unphysically overshoot the sandbox');
assert(high[12].pmin<baseline[12].pmin,'stronger guided winds must imply lower central pressure');
assert.deepEqual(high.map(x=>x.lon),baseline.map(x=>x.lon),'adjusting strength weight unexpectedly changes geographic route');
// Path remains spatially referenced for a slowly moving storm even after the
// sandbox clock horizon, but never references a distant basin or old issue.
const slow={id:'strong',preSimulationReference:ref,history:[]};
assert(issuePreSimulationReference(slow,29),'slower storm discarded spatially valid guidance at old clock horizon');
assert(rebasePreSimulationReference(ref,29,{lat:22,lon:128})?.fixes.length>=2,'slow storm cannot resume its real spatial intensity profile');
assert.equal(rebasePreSimulationReference(ref,29,{lat:50,lon:140}),undefined,'stale remote route should not be restored');
assert.equal(issuePreSimulationReference(slow,80),undefined,'expired sandbox reference must not survive indefinitely');
const landGuidance=buildPreSimulationReference({id:'land',history:[fix(0,120,46),fix(1,120.4,45),fix(2,120.8,43,true),fix(3,121.2,40,true),fix(4,121.6,37,true),fix(5,122,33,true)]},0);
const landBase=Array.from({length:6},(_,h)=>fix(h,120+.4*h,h===0?46:48+h*.4,h>=2));
const landed=blendPreSimulationForecast(landBase,landGuidance,5,{isLandAt:(_lat,lon)=>lon>=120.8});
for(let h=3;h<=5;h++){
 assert(landed[h].vmax<landed[h-1].vmax+1e-5,'strength guidance manufactured an inland intensification');
 assert(landed[h].pmin>=landed[h-1].pmin-1e-5,'central pressure fell despite inland weakening');
}
const modal=read('src/components/ForecastImageModal.tsx');
assert(!modal.includes('drawJtwcForecastProduct')&&!modal.includes('setImageStyle("jtwc_forecast")'));
assert(!fs.existsSync('src/utils/JtwcForecastProduct.ts'));
assert(modal.includes('if (stored === "jtwc" || stored === "jtwc_forecast") return "standard"'),'persisted JTWC tab must migrate safely');
assert(modal.includes('nmcCoarseIntensity ? \'adaptive\' : \'round164\''),'NMC coarse strength switch must be preserved');
const workerSource=read('src/workers/ForecastSandboxWorker.ts');
assert(workerSource.includes('loadNaturalEarthData()'),'worker missing its own independent land-loader initialization');
assert(workerSource.includes('getLandMetrics(31.2,121.5).isLand'),'worker missing loaded-land validation');
let clock=0,queue=[],messages=[],engineSteps=0,resolveLoad;
let landLoaderDone=false,loadSuccess=true;
const loaderPromise=new Promise(resolve=>resolveLoad=resolve);
class StubEngine {
 constructor(){this.prng=0;}
 restorePrngState(n){this.prng=n;}
 capturePrngState(){return this.prng;}
 stepSimulation([storm],_config,h){engineSteps++;this.prng++;
   const history=Math.abs(h-Math.round(h))<1e-5?[...storm.history,{simHour:h}]:storm.history;
   return {updatedTyphoons:[{...storm,simHour:h,history,landed:true}],logs:[]};}
}
const self={postMessage:message=>messages.push(message),onmessage:null};
const sandboxContext={module:{exports:{}},exports:{},self,Math,Number,Date,Error,console,Promise,
 performance:{now:()=>clock},setTimeout:fn=>{queue.push(fn);return queue.length;},clearTimeout:()=>{}};
sandboxContext.require=module=>{
 if(module.endsWith('Engine'))return {TyphoonEngine:StubEngine,getLandMetrics:(lat,lon)=>({isLand:lat===31.2&&lon===121.5})};
 if(module.endsWith('NaturalEarthLoader'))return {loadNaturalEarthData:()=>loaderPromise,getLoaderState:()=>({landLoaded:landLoaderDone,countriesLoaded:landLoaderDone})};
 throw Error('unexpected mock: '+module);
};
vm.runInNewContext(compile('src/workers/ForecastSandboxWorker.ts'),sandboxContext);
const send=x=>self.onmessage({data:x});
const advance=(count=80)=>{for(let i=0;i<count;i++){clock+=16;const cb=queue.shift();if(cb)cb();}};
const start={type:'start',token:11,seed:'unit-test',randomState:5,storm:{simHour:0,active:true,history:[{simHour:0}]},config:{},hour:0,startDate:'2026-10-12T00:00:00Z',speed:8};
async function verify(){
 send(start);advance(30);
 assert.equal(engineSteps,0,'worker stepped without land data (all land physics disabled)');
 send({type:'pause',token:11,pauseId:1});
 landLoaderDone=true;resolveLoad(true);await Promise.resolve();await Promise.resolve();
 advance(30);
 assert.equal(engineSteps,0,'paused start accidentally resumed after asynchronous land load');
 send({...start,token:12});await Promise.resolve();await Promise.resolve();
 advance(100);
 assert(engineSteps>0,'worker did not resume with validated terrestrial data');
 send({type:'pause',token:12,pauseId:2});
 assert(messages.at(-1).type==='paused','worker did not acknowledge pause');
 assert.equal(Math.round(messages.at(-1).hour*6),engineSteps,'worker physics steps skipped or duplicated');
 assert(messages.some(m=>m.historyDelta?.length>0),'worker broke incremental history transfer');
 console.log('ROUND168 PASS: dedicated worker geography gate/pause race, strengthened spatial reference, mainland decay, removed JTWC product, NMC isolation');
}
verify().catch(e=>{console.error(e);process.exitCode=1});
