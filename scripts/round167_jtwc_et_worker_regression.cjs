'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const read=(p)=>fs.readFileSync(p,'utf8');
const compile=(p)=>ts.transpileModule(read(p),{fileName:p,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const ctxNmc={module:{exports:{}},exports:null,Math,Number,Set,Map,Date};ctxNmc.exports=ctxNmc.module.exports;
ctxNmc.require=(p)=>{
 if(p.endsWith('Engine'))return {getAgencyIntensity:v=>({value:v}),getWindForceCategory:v=>v>=17?8:6};
 if(p.endsWith('CmaOperationalClock'))return {isCmaTyphoonProductTime:()=>true};
 if(p.endsWith('ProductCoastlineDrawing'))return {strokeProductCoastlineRing:()=>{}};
 if(p.endsWith('NmcMapViewport'))return {buildNmcGeoFrame:()=>({minLon:120,maxLon:150,minLat:10,maxLat:40}),nmcProjectPoint:()=>({x:0,y:0})};
 if(p.endsWith('NmcOptionalGeography'))return {shouldDrawNmcRiver:()=>true};
 throw Error(p);
};
vm.runInNewContext(compile('src/utils/NmcForecastProduct.ts'),ctxNmc);
const {selectNmcIssuedForecast,isNmcExtratropical}=ctxNmc.module.exports;
assert(isNmcExtratropical('温带气旋')&&isNmcExtratropical('ET')&&!isNmcExtratropical('台风'));
const f=(h,cat='台风')=>({simHour:h,lat:25+h*.15,lon:140+h*.2,vmax:40,category:cat});
const normal=selectNmcIssuedForecast(f(0),[f(6),f(12),f(18),f(24),f(36)],0,48);
assert.equal(normal.at(-1).simHour,36,'ordinary forecast truncated without ET');
const et=selectNmcIssuedForecast(f(0),[f(6),f(12),f(18,'温带气旋'),f(24,'温带气旋'),f(36,'温带气旋')],0,48);
assert.equal(et.at(-1).simHour,18,'NMC failed to stop at FIRST ET advisory');
assert.equal(et.at(-1).category,'温带气旋','first ET marker must be grey, not intermediate tropical');
assert(et.filter(p=>isNmcExtratropical(p.category)).length===1,'NMC produced multiple ET fixes');
const weakening=selectNmcIssuedForecast(f(0),[{...f(12),vmax:13},f(18,'温带气旋'),f(24,'温带气旋')],0,48);
assert.equal(weakening.at(-1).simHour,18,'old tropical force-7 stop suppressed a forecast ET symbol');

const pastEt=selectNmcIssuedForecast(f(0,'温带气旋'),[f(6,'温带气旋')],0,24);
assert.equal(pastEt.length,1,'already extratropical forecast should not continue as tropical');
const chart=read('src/utils/NmcForecastProduct.ts');
assert(chart.includes('etLegend = forecast.some(p=>isNmcExtratropical(p.category))'));
// Round168 intentionally deletes the dedicated JTWC forecast graphic.
// Round167's NMC/Worker behaviors remain regression-controlled; the deleted
// chart is now covered by a negative assertion rather than old visual checks.
const modal=read('src/components/ForecastImageModal.tsx');
assert(!modal.includes('drawJtwcForecastProduct'));
assert(!modal.includes('setImageStyle("jtwc_forecast")'));
assert(!fs.existsSync('src/utils/JtwcForecastProduct.ts'));
let clock=0,queue=[],sent=[];
class Engine {
  constructor() {this.prng=0;}
  restorePrngState(p){this.prng=p;}
  capturePrngState(){return this.prng;}
  stepSimulation([s],_config,h){this.prng++;
    const history=Math.abs(h-Math.round(h))<1e-4?[...s.history,{simHour:h}]:s.history;
    return {updatedTyphoons:[{...s,history,simHour:h}],logs:[]};
  }
}
const mockSelf={postMessage:message=>sent.push(message),onmessage:null};
const ctx={module:{exports:{}},exports:null,Math,Number,Date,self:mockSelf,
  performance:{now:()=>clock},setTimeout:fn=>{queue.push(fn);return queue.length;},clearTimeout:()=>{},Error,console};ctx.exports=ctx.module.exports;
ctx.require=p=>{if(p.endsWith('Engine'))return {TyphoonEngine:Engine,getLandMetrics:(lat,lon)=>({isLand:lat===31.2&&lon===121.5})};if(p.endsWith('NaturalEarthLoader'))return {loadNaturalEarthData:()=>Promise.resolve(true),getLoaderState:()=>({landLoaded:true,countriesLoaded:true})};throw Error(p)};
vm.runInNewContext(compile('src/workers/ForecastSandboxWorker.ts'),ctx);
const send=x=>mockSelf.onmessage({data:x});
send({type:'start',token:3,seed:'a',randomState:5,storm:{simHour:0,active:true,history:[{simHour:0}]},config:{},hour:0,startDate:'2026-10-12T00:00:00Z',speed:8});
Promise.resolve().then(()=>{
for(let i=0;i<120;i++){clock+=16;const f=queue.shift();if(f)f();}
send({type:'pause',token:3,pauseId:22});
const prev=sent.filter(m=>m.type==='snapshot');const stopped=sent.at(-1);
assert(prev.length>1,'worker never streamed snapshots');
assert.equal(stopped.type,'paused');assert.equal(stopped.pauseId,22);
assert(stopped.prngState>5,'worker did not advance physics');
assert.equal(Math.round(stopped.hour*6),stopped.prngState-5,'physics steps skipped or duplicated');
assert(prev.every(m=>!('history' in m.storm)),'full archive cloned in every worker frame');
const deltas=sent.flatMap(m=>m.historyDelta||[]);
assert.equal(deltas.length,Math.floor(stopped.hour+1e-5),'hourly archive delta was lost/repeated');
assert(deltas.every((h,i)=>Math.round(h.simHour)===i+1),'hourly archive out of order');
console.log(`ROUND167 (revised for Round168) PASS: NMC one-ET terminal and conditional legend, removed JTWC graphic, sandbox worker ${stopped.prngState-5} exact 10-minute steps with history deltas`);
}).catch(e=>{console.error(e);process.exitCode=1});
