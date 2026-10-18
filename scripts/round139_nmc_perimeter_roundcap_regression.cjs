'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const src=fs.readFileSync('src/utils/NmcForecastProduct.ts','utf8');
const start=src.indexOf('const LABEL_H = 76;');
const stop=src.indexOf('function layoutLabels(',start);
assert(start>=0 && stop>start,'Round139 perimeter layout missing');
const code=ts.transpileModule(src.slice(start,stop).replace('export function planNmcCallouts','function planNmcCallouts'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
}).outputText;
const context={Math,MAP:{x:22,y:102,w:1248,h:819},clamp:(v,lo,hi)=>Math.min(hi,Math.max(lo,v))};
vm.createContext(context);
vm.runInContext(code+'\nthis.planNmcCallouts=planNmcCallouts;this.calloutConnector=calloutConnector;',context);
const overlaps=(a,b,space=7)=>a.x<b.x+b.w+space && a.x+a.w+space>b.x && a.y<b.y+b.h+space && a.y+a.h+space>b.y;
const paths=[
  // NW path (120h), westward 72h, recurvature, and a dense slow-moving cluster.
  Array.from({length:11},(_,i)=>({lead:i*12,x:1080-47*i+Math.sin(i*.6)*18,y:720-38*i,width:133})),
  Array.from({length:7},(_,i)=>({lead:i*12,x:1140-88*i,y:625-Math.max(0,i-2)*42,width:132})),
  Array.from({length:11},(_,i)=>({lead:i*12,x:1000-110*Math.sin(i*.4)-40*i,y:720-260*Math.sin(i*.6),width:137})),
  Array.from({length:11},(_,i)=>({lead:i*12,x:685+Math.cos(i*.7)*60,y:495+Math.sin(i*.7)*49,width:145})),
];
let checks=0;
for(const path of paths){
  const result=Array.from(context.planNmcCallouts(path));
  const again=Array.from(context.planNmcCallouts(path));
  assert.deepEqual(JSON.parse(JSON.stringify(result)),JSON.parse(JSON.stringify(again)),'layout must be deterministic');
  assert.equal(result.length,path.length,'all lead times must have labels');
  const distinctX=new Set(result.map(b=>Math.round(b.x/12))).size;
  const distinctY=new Set(result.map(b=>Math.round(b.y/12))).size;
  assert(distinctX>=Math.min(4,path.length-1),`layout still looks like two fixed rails: ${distinctX} unique x`);
  assert(distinctY>=Math.min(4,path.length-1),`layout still looks like a fixed row: ${distinctY} unique y`);
  for(let i=0;i<result.length;i++){
    const r=result[i];
    assert(r.x>=22 && r.x+r.w<=1270 && r.y>=102 && r.y+r.h<=921,`outside map: ${JSON.stringify(r)}`);
    for(let j=0;j<i;j++)assert(!overlaps(r,result[j]),`overlap: ${path.length}, ${i}/${j}`);
    const anchor=path.find(p=>p.lead===r.lead);
    const touch=context.calloutConnector({x:anchor.x,y:anchor.y},r);
    assert(touch.x>=r.x-.1 && touch.x<=r.x+r.w+.1 && touch.y>=r.y-.1 && touch.y<=r.y+r.h+.1,'line must attach to near edge');
    checks++;
  }
}
// The forecast cone must no longer use a self-crossing outline and
// translucent disk overlays. Only one alpha composition is allowed.
// Round141 shares cone geometry between drawing and callout avoidance. The
// original Round139 assertions remain intact; load that helper alongside renderer.
const cone=src.slice(src.indexOf('function getNmcConeSections('),src.indexOf('function drawHistory('));
assert(cone.includes("document.createElement('canvas')"),'offscreen union mask missing');
assert(cone.includes('brush.arc(x,y,r,0,Math.PI*2)'),'circular end-cap missing');
assert(cone.includes('ctx.globalAlpha=.49') && cone.includes('ctx.drawImage(mask,MAP.x,MAP.y)'),'one-time opacity compositing missing');
assert(!cone.includes('ctx.quadraticCurveTo('),'pointed quadratic cap remains');
assert(!cone.includes('ctx.closePath()'),'self intersecting cone polygon remains');
// Execute the real envelope function with an instrumented brush and output ctx.
const envJs=ts.transpileModule(cone,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
let drawn=0;let draws=0;let minRadius=Infinity,maxRadius=0;let alpha=NaN;
const brush={translate(){},beginPath(){},arc(x,y,r){assert(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(r));assert(r>=0);drawn++;minRadius=Math.min(r,minRadius);maxRadius=Math.max(r,maxRadius)},fill(){},set fillStyle(v){this._fill=v}};
const canvas={width:0,height:0,getContext:()=>brush};
const drawing={save(){},restore(){},set globalAlpha(v){alpha=v},drawImage(mask,x,y){assert.equal(mask,canvas);assert.equal(x,22);assert.equal(y,102);draws++;}};
const envCtx={Math,MAP:{x:22,y:102,w:1248,h:819},clamp:(v,lo,hi)=>Math.min(hi,Math.max(lo,v)),document:{createElement:()=>canvas}};
vm.createContext(envCtx);vm.runInContext(envJs+'\nthis.renderEnvelope=renderEnvelope;',envCtx);
const tr=Array.from({length:121},(_,i)=>({simHour:i,lat:20+i*.09+8*Math.sin(i/19),lon:145+i*.1+9*Math.cos(i/29)}));
const project=(lat,lon)=>({x:(lon-110)*17,y:(50-lat)*18});
envCtx.renderEnvelope(drawing,tr,project,lon=>lon,0);
assert(drawn>121 && maxRadius>minRadius && maxRadius>20,'tapering circle union not rendered');
assert.equal(draws,1,'color should be composited only once');
assert.equal(alpha,.49,'reference NMC probability cone opacity changed');
console.log('ROUND139 NMC 4-way scattered callouts + no collisions + rounded swept cone: PASS ('+checks+' boxes, '+drawn+' circle stamps)');
