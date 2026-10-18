'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert').strict;
let ts;
try { ts = require('typescript'); } catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
const engineSource = fs.readFileSync('src/simulation/Engine.ts','utf8');
const videoSource = fs.readFileSync('src/utils/VideoRenderEngine.ts','utf8');
assert(engineSource.includes('const needRecalcRadii = isExactlyOnThreeHour || !ty.r7 || !ty.r10 || !ty.r12;'));
assert(!engineSource.includes('manualCirculationTransitionActive || isExactlyOnThreeHour'));
assert(!engineSource.includes('if (ty.vmax < 13.9) r7 = { ne: 0, se: 0, sw: 0, nw: 0 };\n        if (ty.vmax < 24.5) r10 = { ne: 0, se: 0, sw: 0, nw: 0 };\n        if (ty.vmax < 32.7) r12 = { ne: 0, se: 0, sw: 0, nw: 0 };\n      }\n\n      const r7TouchesLand'));
assert(videoSource.includes('const issuedCenter = toScreen(issued.centerLat, issued.centerLon);'));
assert(videoSource.includes('const radiusPx = Math.max(1, Math.abs(e.x - issuedCenter.x));'));
const bins = [5,8,10,12,15,18,20,23,25,28,30,33,35,38,40,42,45,48,50,52,55,58,60,62,65,68,70,72,75,78,80,82,85,88,90,92,95,98,100,105,110,115];
const forceBounds=[.3,1.5,3.3,5.4,7.9,10.7,13.8,17.1,20.7,24.4,28.4,32.6,36.9,41.4,46.1,50.9,56];
const agency={getAgencyIntensity(v){return {value:v>115?Math.round(v):bins.reduce((best,b)=>Math.abs(b-v)<Math.abs(best-v)?b:best)}}, getWindForceCategory(v){let force=0;for(const threshold of forceBounds){if(v<threshold)break;force++}return force}};
function load(file,imports={}){
 const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert.equal(output.diagnostics?.length||0,0,`${file} syntax`);
 const scope={exports:{}, require:(request)=>imports[request]||{}, console, Math, Date, Map, Set, WeakMap, Object, Array, Number};
 vm.createContext(scope); vm.runInContext(output.outputText,scope,{timeout:15000});return scope.exports;
}
const viewport=load('src/utils/NmcMapViewport.ts');
const renderer=load('src/utils/NmcForecastProduct.ts',{'../simulation/Engine':agency,'./NmcMapViewport':viewport,'../simulation/CmaOperationalClock':{},'./ProductCoastlineDrawing':{}});
const pt=(hour,wind,lat=20,lon=140)=>({simHour:hour,vmax:wind,lat,lon});
const start=pt(0,58);
let forecast=[pt(1,54),pt(12,40),pt(24,18),pt(30,16),pt(36,15),pt(48,10),pt(72,5)];
let issued=renderer.selectNmcIssuedForecast(start,forecast,0,72);
assert.equal(issued.at(-1).simHour,36,'next scheduled point must terminate after crossing force 7');
assert.equal(issued.at(-1).vmax,15);
issued=renderer.selectNmcIssuedForecast(pt(0,10),[pt(12,12),pt(24,18),pt(36,22),pt(48,15),pt(60,12)],0,72);
assert.equal(issued.at(-1).simHour,48,'genesis TD forecast must continue through intensification');
assert.equal(renderer.selectNmcIssuedForecast(start,[pt(12,15),pt(24,15)],0,72).at(-1).simHour,12);
const land=JSON.parse(fs.readFileSync('public/data/product_land_wide_v3.geojson','utf8'));
const current={lat:18,lon:125,simHour:80};
const history=Array.from({length:45},(_,i)=>({simHour:36+i,lat:16+i*.04,lon:132-i*.16}));
const future=Array.from({length:48},(_,i)=>({simHour:81+i,lat:18+(i+1)*.12,lon:125-(i+1)*.30}));
const map={x:22,y:102,w:1248,h:819};
const frame=viewport.buildNmcGeoFrame(current,history,future,land,map);
assert(frame.significantLandfall);
const toScreen=(p)=>viewport.nmcProjectPoint(p.lat,viewport.nmcUnwrapLongitude(p.lon,(frame.minLon+frame.maxLon)/2),frame,map);
for(const p of [current,...future]){const xy=toScreen(p);assert(xy.x>map.x&&xy.x<map.x+map.w&&xy.y>map.y&&xy.y<map.y+map.h)}
const end=future.at(-1),capKm=30+360*Math.pow((end.simHour-current.simHour)/120,1.27),d=capKm/(111.12*Math.cos(end.lat*Math.PI/180));
for(const [dx,dy] of [[d,0],[-d,0],[0,d],[0,-d]]){const xy=toScreen({...end,lat:end.lat+dy,lon:end.lon+dx});assert(xy.x>map.x&&xy.x<map.x+map.w&&xy.y>map.y&&xy.y<map.y+map.h,'cone terminal circle must remain inside the chart')}
const recent=history.filter(p=>p.simHour>=current.simHour-36);
assert(recent.every(p=>{const xy=toScreen(p);return xy.x>=map.x&&xy.x<=map.x+map.w&&xy.y>=map.y&&xy.y<=map.y+map.h}),'nearshore last 36h history should remain visible');
console.log('ROUND146: three-hour issued radii + fixed JMA video geometry + force-7 NMC termination + cone-fit + 36h history: PASS');
