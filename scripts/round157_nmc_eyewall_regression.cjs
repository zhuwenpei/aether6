'use strict';
const fs=require('fs');const vm=require('vm');const assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const nmc=fs.readFileSync('src/utils/NmcForecastProduct.ts','utf8');
const a=nmc.indexOf('const LABEL_H = 76;'),b=nmc.indexOf('function layoutLabels(',a);
assert(a>=0&&b>a);
const code=ts.transpileModule(nmc.slice(a,b).replace('export function planNmcCallouts','function planNmcCallouts'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const ctx={Math,Set,Map,MAP:{x:22,y:102,w:1248,h:819},clamp:(x,a,b)=>Math.max(a,Math.min(b,x))};
vm.createContext(ctx);vm.runInContext(code+'\nthis.plan=planNmcCallouts;',ctx);
const cross=(a,b,c,d)=>{const f=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);return f(a,b,c)*f(a,b,d)<-1e-5&&f(c,d,a)*f(c,d,b)<-1e-5;};
const overlap=(a,b)=>a.x<b.x+b.w+8&&b.x<a.x+a.w+8&&a.y<b.y+b.h+8&&b.y<a.y+a.h+8;
let checked=0,avg=0;
for(const scenario of [
 (i)=>({x:860-34*i,y:700-36*i}),
 (i)=>({x:870-32*i+36*Math.sin(i*.7),y:690-34*i}),
 (i)=>({x:900-53*i,y:680-18*i+60*Math.sin(i*.8)})]){
 const anchors=Array.from({length:11},(_,i)=>({lead:i*12,width:i%3===0?160:128,...scenario(i)}));
 const forecast=anchors.slice(1).map((pt,i)=>({a:{x:anchors[i].x,y:anchors[i].y},b:{x:pt.x,y:pt.y}}));
 const cone=anchors.map((p,i)=>({x:p.x,y:p.y,r:i*8+5}));
 const start=Date.now(),boxes=ctx.plan(anchors,{forecast,cone});
 assert(Date.now()-start<2800,'NMC label calculation too slow');
 assert.equal(boxes.length,anchors.length,'lost labels');
 for(const box of boxes){
  assert.equal(box.route.length,2);
  assert(box.x>=34&&box.x+box.w<=1258&&box.y>=217&&box.y+box.h<=911);
  avg+=Math.hypot(box.route[1].x-box.route[0].x,box.route[1].y-box.route[0].y);
  for(const other of boxes){if(box===other)continue;assert(!overlap(box,other),'overlap');assert(!cross(...box.route,...other.route),'cross');}
  checked++;
 }
}
const eye=fs.readFileSync('src/simulation/TropicalCycloneVortex.ts','utf8');
const js=ts.transpileModule(eye,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll('export ', '');
const vctx={Math};vm.createContext(vctx);vm.runInContext(js+'\nthis.inner=synopticInnerCoreRmw;this.sample=sampleTropicalCycloneVortex;',vctx);
const base={lat:21,lon:127,vmax:53,pmin:943,rmw:160,r7:{ne:300,se:300,sw:300,nw:300},simHour:200,direction:300,speed:16};
const f=vctx.inner;
const healthy={...base,eyeType:'large_round',eyePhase:'clear',eyewallIntegrity:.9,dryAirCoreExposure:0,giantEyeOuterWallMemory:0,ewrcFailureMode:'none',ewrcState:'none'};
const failed={...base,eyeType:'broken',eyePhase:'blocked',dryAirCoreExposure:.72,giantEyeOuterWallMemory:.95,ewrcFailureMode:'inner_collapse_outer_stalls',ewrcState:'recovering_failure'};
const dry={...base,eyeType:'gap',eyePhase:'blocked',dryAirCoreExposure:.87,giantEyeOuterWallMemory:0,ewrcFailureMode:'none',ewrcState:'none'};
assert.equal(f(healthy),160,'complete eye must not be reshaped by failure guard');
assert(f(failed)<=49,'failed EWRC inner core still too wide');
assert(f(dry)<=49,'dry-air damaged eye still too wide');
assert.equal(f({...failed,rmw:90,vmax:16,eyeType:'none',eyePhase:'none'}),90,'weak failed-EWRC remnant incorrectly compacted');
const env={slp:1012,shearU:0,shearV:0,westerlyStrength:0};
for(const st of [healthy,failed,dry])for(const off of [0,.2,.4,.8,1.3,2]){
 const sample=vctx.sample(st.lat,st.lon+off,st,env);
 assert(Number.isFinite(sample.tangentialMs)&&Number.isFinite(sample.pressureHpa),'invalid vortex');
}
const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
assert(!engine.includes('radiusTarget = Math.max(radiusTarget, 38 + 82 * giantEyeOuterWallMemory)'));
assert(engine.includes('const radiusCeiling = damagedEye ? 38.0 : 55.0'));
const syn=fs.readFileSync('src/simulation/SynopticWindField.ts','utf8');
assert(syn.includes('synopticInnerCoreRmw(storm.state)') && syn.includes('synopticInnerCoreRmw(s.state)'));
console.log(`ROUND157 PASS: ${checked} NMC callouts, 3 tracks, avg leader ${(avg/checked).toFixed(0)}px; failed EWRC ${f(failed).toFixed(1)}km, dry eye ${f(dry).toFixed(1)}km, intact ${f(healthy).toFixed(1)}km`);
