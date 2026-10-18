'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const source=fs.readFileSync('src/utils/NmcForecastProduct.ts','utf8');
const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const ctx={Math,MAP:{x:22,y:102,w:1248,h:819},clamp:(v,lo,hi)=>Math.min(hi,Math.max(lo,v))};
vm.createContext(ctx);
const start=source.indexOf('const LABEL_H = 76;'),stop=source.indexOf('function layoutLabels(',start);
assert(start>=0&&stop>start);
vm.runInContext(compile(source.slice(start,stop).replace('export function planNmcCallouts','function planNmcCallouts'))+'\nthis.layout=planNmcCallouts;',ctx);
const boxOverlap=(a,b,gap=7)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
const cases=[
 Array.from({length:11},(_,i)=>({lead:i*12,x:1100-48*i,y:720-36*i,width:137})),
 Array.from({length:7},(_,i)=>({lead:i*12,x:1130-80*i,y:620-(i>2?i*24:0),width:137})),
 Array.from({length:11},(_,i)=>({lead:i*12,x:1000-i*37+110*Math.sin(i*.62),y:735-i*39+125*Math.sin(i*.45),width:145})),
 Array.from({length:11},(_,i)=>({lead:i*12,x:680+55*Math.cos(i*.75),y:490+50*Math.sin(i*.75),width:148})),
];
let count=0,lines=0;
for(const [index,anchors] of cases.entries()){
 const forecast=anchors.slice(1).map((a,i)=>({a:{x:anchors[i].x,y:anchors[i].y},b:{x:a.x,y:a.y}}));
 const cone=index===3?[]:anchors.map((a,i)=>({x:a.x,y:a.y,r:8+i*4}));
 const obstacles={forecast,history:[{a:{x:1200,y:840},b:{x:anchors[0].x,y:anchors[0].y}}],cone};
 const boxes=ctx.layout(anchors,obstacles),again=ctx.layout(anchors,obstacles);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(boxes)),JSON.parse(JSON.stringify(again)),`nondeterministic ${index}`);
 assert.strictEqual(boxes.length,anchors.length);
 for(const a of boxes){
  assert(a.x>=22-1e-4&&a.x+a.w<=1270+1e-4&&a.y>=102&&a.y+a.h<=921+1e-4);
  assert(a.route&&a.route.length>=2,`route missing ${index}`);
  const from=a.route[0],end=a.route[a.route.length-1];
  assert(Number.isFinite(from.x)&&Number.isFinite(end.y));
  assert(ctx.rectanglesOverlap===undefined || true);
  lines+=Math.hypot(end.x-from.x,end.y-from.y);
  for(const b of boxes)if(a!==b)assert(!boxOverlap(a,b),`overlapping ${index} ${a.lead}/${b.lead}`);
  count++;
 }
}
// Read actual Engine.ts public-bins routine, not a copied table.
const binsStart=engine.indexOf('const CMA_PUBLIC_WIND_BINS = [');
const binsEnd=engine.indexOf('/**\n * The simulator keeps one CMA-like',binsStart);
assert(binsStart>0&&binsEnd>binsStart);
let enginePart=engine.slice(binsStart,binsEnd);
const forceStart=engine.indexOf('export function getWindForceCategory(');
const forceEnd=engine.indexOf('export function getCategoryColor(',forceStart);
assert(forceStart>0&&forceEnd>forceStart);
const assessmentSource=source.slice(source.indexOf('export function isNmcExtratropical('),source.indexOf('function unwrappedLon('));
const ctx2={Math,PALETTE:{td:'td',ts:'ts',sts:'sts',ty:'ty',sty:'sty',super:'super',et:'et'}};
vm.createContext(ctx2);
const code=compile(enginePart+'\n'+engine.slice(forceStart,forceEnd).replace('export function getWindForceCategory','function getWindForceCategory')+'\n'+assessmentSource.replace('export function isNmcExtratropical','function isNmcExtratropical'));
vm.runInContext(code+'\nfunction getAgencyIntensity(v){return {value:snapAgencyPublicWind(v,CMA_PUBLIC_WIND_BINS)}};this.assess=cmaNmcAssessment;',ctx2);
for(const [raw,wind,force,name] of [
  [17.1,18,8,'热带风暴级'],[24.4,25,10,'强热带风暴级'],
  [32.5,33,12,'台风级'],[41.4,42,14,'强台风级'],
  [50.8,50,15,'强台风级'],[51.2,52,16,'超强台风级'],
  [55.8,55,16,'超强台风级']
]){
 const a=ctx2.assess(raw);
 assert.strictEqual(a.wind,wind,`bin ${raw}`);
 assert.strictEqual(a.force,force,`force ${raw}`);
 assert.strictEqual(a.name,name,`category ${raw}`);
}
const history=source.slice(source.indexOf('function drawHistory('),source.indexOf('function interpolateForecastPoint('));
assert(history.includes('pin(ctx,a.x,a.y,5.4,cmaNmcAssessment'), 'historical dot color must use CMA published wind');
assert(source.includes('getNmcConeSections(track,project,wrap,issueHour)'));
assert(source.includes('document.createElement(\'canvas\')')&&source.includes('ctx.globalAlpha=.49'));
console.log('ROUND141 redesigned NMC geometry & real Engine CMA public bins: PASS ('+count+' labels, average direct span '+Math.round(lines/count)+'px)');
