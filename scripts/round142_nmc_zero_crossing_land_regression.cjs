'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const src=fs.readFileSync('src/utils/NmcForecastProduct.ts','utf8');
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const start=src.indexOf('const LABEL_H = 76;'),end=src.indexOf('function layoutLabels(',start);
assert(start>=0 && end>start);
const ctx={Math,MAP:{x:22,y:102,w:1248,h:819},clamp:(n,l,h)=>Math.min(h,Math.max(l,n))};
vm.createContext(ctx);
vm.runInContext(transpile(src.slice(start,end).replace('export function planNmcCallouts','function planNmcCallouts'))+'\nthis.plan=planNmcCallouts;',ctx);
const crosses=(a,b,c,d)=>{
 const cp=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
 return cp(a,b,c)*cp(a,b,d)<-1e-5 && cp(c,d,a)*cp(c,d,b)<-1e-5;
};
const overlaps=(a,b,g=7)=>a.x<b.x+b.w+g&&a.x+a.w+g>b.x&&a.y<b.y+b.h+g&&a.y+a.h+g>b.y;
const linePairs=(a,b)=>{
 for(let i=1;i<a.route.length;i++)for(let j=1;j<b.route.length;j++)
  if(crosses(a.route[i-1],a.route[i],b.route[j-1],b.route[j]))return 1;
 return 0;
};
let total=0;
const patterns=[
 (i)=>({x:1130-i*52,y:735-i*40}),
 (i)=>({x:1090-70*i,y:685-(i>4?i*28:0)}),
 (i)=>({x:1000-i*45+90*Math.sin(i*.7),y:730-i*37+70*Math.sin(i*.42)}),
 (i)=>({x:930-i*46+28*Math.sin(i*.8),y:685-i*38+105*Math.sin(i*.48)})
];
for(const [scenario,shape] of patterns.entries()){
 const count=scenario===1?7:11;
 const anchors=Array.from({length:count},(_,i)=>({lead:i*12,width:135,...shape(i)}));
 const forecast=anchors.slice(1).map((a,i)=>({a:{x:anchors[i].x,y:anchors[i].y},b:{x:a.x,y:a.y}}));
 const cone=anchors.map((a,i)=>({x:a.x,y:a.y,r:3+i*5}));
 const obstacles={history:[{a:{x:1185,y:765},b:{x:anchors[0].x,y:anchors[0].y}}],forecast,cone};
 const boxes=ctx.plan(anchors,obstacles);
 assert.strictEqual(boxes.length,count,'all callouts should be present');
 for(let i=0;i<boxes.length;i++){
  assert(boxes[i].x>=34 && boxes[i].x+boxes[i].w<=1258);
  assert(boxes[i].y>=217 && boxes[i].y+boxes[i].h<=911);
  assert(boxes[i].route.length>=2);
  for(let j=0;j<i;j++){
   assert(!overlaps(boxes[i],boxes[j]),`callout box overlap case=${scenario}`);
   assert(!linePairs(boxes[i],boxes[j]),`leader crossing case=${scenario}, ${boxes[i].lead}/${boxes[j].lead}`);
  }
  total++;
 }
}
// Verify the renderer retains land drawing even if only the independently loaded
// country plate is available, and western Pacific map framing keeps Asia visible.
assert(src.includes('const landFeatures = o.landGeoJson?.features?.length ? o.landGeoJson.features'));
assert(src.includes('if(base >= 120 && base <= 185 && lonMin >= 115 && lonMax <= 193)'));
for(const name of ['product_land_wide_v3.geojson','product_countries_highdetail_v3.geojson'])
 assert(fs.statSync('public/data/'+name).size>500000,`missing real geography: ${name}`);
console.log(`ROUND142 NMC zero-crossing leaders, nonoverlapping labels, real-GeoJSON land-data checks: PASS (${total} callouts, four geometries)`);
