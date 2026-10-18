'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert').strict;
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
function evaluate(code, extra={}){
 const result=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true});
 assert.equal(result.diagnostics?.length||0,0);
 const ctx={Math,Number,Array,Map,WeakMap, ...extra};vm.createContext(ctx);vm.runInContext(result.outputText,ctx);return ctx;
}
const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
const b=engine.indexOf('function frameworkDistanceKm('), e=engine.indexOf('/**\n * User forecast frameworks are usually drawn',b);
assert(b>=0 && e>b);
const speed=evaluate(engine.slice(b,e)+'\nthis.factor=getForecastFrameworkSpacingSpeedFactor;',{
 clamp01:v=>Math.max(0,Math.min(1,v)),smoothstep01:v=>{const x=Math.max(0,Math.min(1,v));return x*x*(3-2*x);}
}).factor;
const route=(lons)=>lons.map(lon=>({lat:20,lon}));
const irregular=route([155,154.7,154.699,154.698,154.45,154.43,154.1,153.95]);
const dense=route([155,154.99,154.98,154.97,154.96,154.95,154.94,154.93]);
const stall=route([155,154.7,154.5,154.499999,154.499998,154.499997,154.3,154.1]);
const tripleTap=route([155,154.7,154.5,154.499999,154.499998,154.3,154.1]);
for(const normal of [irregular,dense]) for(const f of [0,.1,.3,.5,.7,.9,1]) assert.equal(speed(normal,f),1,'normal close points are neutral');
assert(speed(tripleTap,.55)<0.30,'three exactly colocated taps must be understood as a stop');
assert(speed(stall,.55)<0.3,`intentional repeated-location stall must slow: ${speed(stall,.55)}`);
assert(speed(stall,0)>0.90 && speed(stall,1)>0.90,'stall does not apply to whole route');
assert(engine.includes('manualRouteTempoFactor = guide.spacingSpeedFactor;'));
assert(engine.includes('stallIntent > 0.10 ? 0.08 : 0.92'));
assert(engine.includes('manualRouteTempoFactor < 0.90') && engine.includes('regimeLow * 0.72'));
const nmcSource=fs.readFileSync('src/utils/NmcMapViewport.ts','utf8');
const g=evaluate(nmcSource.replace(/export /g,'')+'\nthis.buildNmcGeoFrame=buildNmcGeoFrame;this.nmcProjectPoint=nmcProjectPoint;this.nmcUnwrapLongitude=nmcUnwrapLongitude;');
const map={x:22,y:102,w:1248,h:819};
const current={lat:20,lon:140,simHour:100};
const history=[{lat:15,lon:175,simHour:4},{lat:18,lon:160,simHour:55},{lat:19.4,lon:142,simHour:76},{lat:20,lon:141,simHour:94}];
const forecast=[{lat:22,lon:137,simHour:112},{lat:24,lon:132,simHour:124}];
const sea={features:[]};
const big={features:[{geometry:{type:'Polygon',coordinates:[[[130,19],[145,19],[145,27],[130,27],[130,19]]]}}]};
const sFrame=g.buildNmcGeoFrame(current,history,forecast,sea,map);
const lFrame=g.buildNmcGeoFrame(current,history,forecast,big,map);
for(const key of ['minLon','maxLon','minMercY','maxMercY'])assert.equal(sFrame[key],lFrame[key],'same NMC viewport regardless of land');
assert.equal(sFrame.includesHistory,true);
const at=(p,f)=>g.nmcProjectPoint(p.lat,g.nmcUnwrapLongitude(p.lon,current.lon),f,map);
assert(at(history[0],sFrame).x>map.x+map.w,'far-old history must be clipped');
for(const p of [...history.slice(2),current,...forecast]){const xy=at(p,sFrame);assert(xy.x>=map.x&&xy.x<=map.x+map.w&&xy.y>=map.y&&xy.y<=map.y+map.h);}
const syn=fs.readFileSync('src/utils/SynopticWindPressureMap.ts','utf8');
const a=syn.indexOf('const SYNOPTIC_STYLE_SPECS:'),z=syn.indexOf('const clamp =',a);assert(a>0&&z>a);
const specs=evaluate(syn.slice(a,z)+'\nthis.s=SYNOPTIC_STYLE_SPECS;',{
 REFERENCE_COLORBAR_TICKS:[7,16,25,34,40,46,52,58,64,80,96,110,125,140,155]
}).s;
assert.equal(specs.hmon.barbSpacingPx,33);assert.equal(specs.hwrf.barbSpacingPx,36);
assert(specs.hmon.barbGlyphScale>specs.hwrf.barbGlyphScale);
assert(specs.hmon.barbStrokePx>specs.hwrf.barbStrokePx);
const li=syn.indexOf('function referencePanelLayout('),le=syn.indexOf('const FONT_STACK',li);
const layoutHelper=fs.readFileSync('src/utils/SynopticProductLayout.ts','utf8');
const layoutEngine=evaluate(layoutHelper.replace(/export /g,'')+'\nthis.compute=synopticProductLayout;').compute;
const layouts=evaluate(syn.slice(li,le)+'\nthis.layout=referencePanelLayout;', {synopticProductLayout:layoutEngine});
assert(layouts.layout('hmon').map.h>layouts.layout('hwrf').map.h);
assert(layouts.layout('hwrf').map.h>layouts.layout('default').map.h);
assert(syn.includes('const spacing = Math.max(23 * S, style.barbSpacingPx * S)'));
assert(syn.includes("styleSpec.headerVariant === 'hmon'"));
// Exercise the actual drawing functions with a lightweight Canvas stub. HMON
// must paint materially more glyphs than HWRF, not merely define new metadata.
const first=syn.indexOf('function drawReferenceWindBarb('), last=syn.indexOf('export async function drawSynopticWindPressureMap(',first);
assert(first>=0 && last>first);
const barbRuntime=evaluate(syn.slice(first,last)+'\nthis.draw=drawReferenceWindBarbs;',{
 MAP:{x:62,y:65,w:1348,h:940},
 clamp:(v,lo,hi)=>Math.max(lo,Math.min(hi,v)),
 sampleWindVectorAndSpeedAtLonLat:()=>({u:20,v:20,speedKt:55}),
 yieldUi:async()=>undefined
});
function fakeCanvas(){const c={n:0,feathers:0};for(const k of ['save','restore','beginPath','arc','moveTo','lineTo','stroke','closePath'])c[k]=()=>{};c.fill=()=>{c.feathers++};return c;}
(async()=>{
 const bounds={lonMin:110,lonMax:130,latMin:10,latMax:30};
 const a=fakeCanvas(),b=fakeCanvas();
 // Count saved glyphs via fill() for 50kt pennants.
 await barbRuntime.draw(a,{},bounds,()=>({x:0,y:0}),specs.hmon,1,layouts.layout('hmon').map);
 await barbRuntime.draw(b,{},bounds,()=>({x:0,y:0}),specs.hwrf,1,layouts.layout('hwrf').map);
 assert(a.feathers>b.feathers*1.30,`HMON should be denser (${a.feathers} vs ${b.feathers})`);
 console.log('ROUND148 synthetic 55-kt real wind-barb strokes:',JSON.stringify({hmon:a.feathers,hwrf:b.feathers}));
})().catch(e=>{console.error(e);process.exitCode=1});
console.log('ROUND148 explicit waypoint dwell vs ordinary density / all-stage NMC nearshore crop / distinct HMON-HWRF mesh and panel geometry: PASS');
