const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const app = fs.readFileSync('src/App.tsx','utf8');
const css = fs.readFileSync('src/index.css','utf8');
const nmc = fs.readFileSync('src/utils/NmcForecastProduct.ts','utf8');
// Drawing framework no longer exposes either a curve button or a curve calculation.
assert(app.includes('pro-route-toolbar') && app.includes('undoForecastRoutePoint'));
assert(!app.includes('openForecastIntensityEditor') && !app.includes('<ForecastIntensityCurveEditor'));
assert(!app.includes('forecastIntensityEditorStatus') && !app.includes('calculateForecastTrackPath(mainTy, curveConfig'));
assert(app.includes('manualForecastIntensityEnabled: false') && app.includes('manualForecastIntensityCurve: []'));
assert(app.includes('left-3 top-4') && app.includes('w-9 h-9'));
const leftCSS = css.slice(css.indexOf('/* Round138: compact, left-anchored'));
assert(leftCSS.includes('left: calc(var(--aether-vv-left') && leftCSS.includes('+ 225px'));
assert(leftCSS.includes('transform: none !important'));
// Run the actual TS layout planner, not a transcription of its mathematics.
// Round139 planner uses shared geometry helpers declared immediately above the export.
const begin = nmc.indexOf('const LABEL_H =');
const end = nmc.indexOf('function layoutLabels(',begin);
assert(begin>=0 && end>begin);
const snippet = ts.transpileModule(nmc.slice(begin,end).replace('export function planNmcCallouts','function planNmcCallouts'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
}).outputText;
const ctx = {Math, MAP:{x:22,y:102,w:1248,h:819}, clamp:(n,lo,hi)=>Math.min(hi,Math.max(lo,n))};
vm.createContext(ctx);vm.runInContext(snippet+'\nthis.plan=planNmcCallouts;',ctx);
const intersects = (a,b)=>a.x<b.x+b.w+3 && a.x+a.w+3>b.x && a.y<b.y+b.h+3 && a.y+a.h+3>b.y;
for (const count of [1,3,7,11]) for (let scenario=0;scenario<5;scenario++) {
 const anchors = Array.from({length:count},(_,i)=>({
  x: scenario===0?590+i*41:scenario===1?740+Math.sin(i)*85:scenario===2?420+Math.cos(i*.8)*250:scenario===3?1120-i*72:650,
  y: scenario===0?790-i*55:scenario===1?430+Math.sin(i*.3)*110:scenario===2?450+Math.cos(i*.7)*190:scenario===3?220+i*47:560,
  width:scenario===1?130:144, lead:i*12
 }));
 const boxes=ctx.plan(anchors);
 assert.strictEqual(boxes.length,count);
 for (let i=0;i<boxes.length;i++){
  const a=boxes[i];assert(a.x>=22-1 && a.x+a.w<=1270+1 && a.y>=102 && a.y+a.h<=921+1,`off map: ${JSON.stringify(a)}`);
  for(let j=0;j<i;j++) assert(!intersects(a,boxes[j]),`overlapping ${scenario},${count}: ${JSON.stringify([a,boxes[j]])}`);
 }
}
console.log('ROUND138 compact left toolbar + on-demand curve removal + NMC non-overlapping callouts: PASS');
