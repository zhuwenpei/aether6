'use strict';
const fs=require('fs');
const vm=require('vm');
const assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const src=fs.readFileSync('src/utils/NmcForecastProduct.ts','utf8');
const begin=src.indexOf('const LABEL_H = 76;');
const end=src.indexOf('function layoutLabels(',begin);
assert(begin>=0&&end>begin);
const code=ts.transpileModule(src.slice(begin,end).replace('export function planNmcCallouts','function planNmcCallouts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const ctx={Math,Set,Map,MAP:{x:22,y:102,w:1248,h:819},clamp:(x,a,b)=>Math.min(b,Math.max(a,x))};
vm.createContext(ctx);
vm.runInContext(code+'\nthis.plan=planNmcCallouts;',ctx);
const cp=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const crosses=(a,b,c,d)=>cp(a,b,c)*cp(a,b,d)<-1e-5&&cp(c,d,a)*cp(c,d,b)<-1e-5;
const overlap=(a,b,g=8)=>a.x<b.x+b.w+g&&a.x+a.w+g>b.x&&a.y<b.y+b.h+g&&a.y+a.h+g>b.y;
const cases=[
 (i)=>({x:1130-i*52,y:735-i*40}),
 (i)=>({x:1090-70*i,y:685-(i>4?i*28:0)}),
 (i)=>({x:1000-i*45+90*Math.sin(i*.7),y:730-i*37+70*Math.sin(i*.42)}),
 (i)=>({x:930-i*46+28*Math.sin(i*.8),y:685-i*38+105*Math.sin(i*.48)}),
 (i)=>({x:690+65*Math.cos(i*.7),y:500+82*Math.sin(i*.7)})
];
let checked=0;
for(let caseNumber=0;caseNumber<cases.length;caseNumber++){
 const anchors=Array.from({length:caseNumber===1?7:11},(_,i)=>({lead:i*12,width:135,...cases[caseNumber](i)}));
 const forecast=anchors.slice(1).map((a,i)=>({a:{x:anchors[i].x,y:anchors[i].y},b:{x:a.x,y:a.y}}));
 const cone=anchors.map((a,i)=>({x:a.x,y:a.y,r:3+i*5}));
 const before=Date.now();
 const layout=ctx.plan(anchors,{forecast,cone,history:[{a:{x:1200,y:805},b:{x:anchors[0].x,y:anchors[0].y}}]});
 assert(Date.now()-before<2500,'label planning unexpectedly slow');
 assert.strictEqual(layout.length,anchors.length,'missing information box');
 for(const a of layout){
  assert.strictEqual(a.route.length,2,'leader is not straight');
  assert(a.x>=34&&a.y>=217&&a.x+a.w<=1258&&a.y+a.h<=911);
  const original=anchors.find(p=>p.lead===a.lead);
  assert(Math.hypot(a.route[0].x-original.x,a.route[0].y-original.y)<1e-8);
  for(const b of layout){
   if(a===b)continue;
   assert(!overlap(a,b),`boxes overlap ${caseNumber}: ${a.lead}/${b.lead}`);
   assert(!crosses(a.route[0],a.route[1],b.route[0],b.route[1]),`leaders cross ${caseNumber}: ${a.lead}/${b.lead}`);
  }
  checked++;
 }
}
// Check that the drawing implementation uses a single segment, not an elbow.
assert(src.includes('const route=[here,end]; // straight line only, by construction'));
assert(src.includes('adaptiveChartSlots(anchor.width,ordered,cone)') && src.includes('chartSlots(anchor.width)'));
assert(src.includes('cmaNmcAssessment(pt.vmax, pt.category)'));
assert(src.includes('const landFeatures = o.landGeoJson?.features?.length ? o.landGeoJson.features'));
console.log(`ROUND143 ordered outer map slots / strictly straight leaders / no overlaps: PASS (${checked} labels, 5 scenarios)`);
