'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..'); const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sim=read('src/components/TyphoonNetworkSimulator.tsx');
const util=read('src/utils/TyphoonNetworkData.ts');
const css=read('src/components/TyphoonNetworkSimulator.css');
const global=read('src/index.css');
const stand=read('src/utils/TyphoonNetworkStandaloneExport.ts');
let count=0;function check(label,fn){try{fn();count++;console.log('PASS',label)}catch(e){console.error('FAIL',label);throw e}}
for(const file of ['src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkData.ts','src/utils/TyphoonNetworkStandaloneExport.ts']){
 check('TS parser '+file,()=>{const sf=ts.createSourceFile(file,read(file),99,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.equal(sf.parseDiagnostics.length,0)});
}
check('Other agency hit disks lie under ALL visible forecast markers',()=>{
 const first=sim.indexOf('Hit targets are kept BELOW all visible dots');
 const hit=sim.indexOf('const hit=L.circleMarker',first),history=sim.indexOf('const marker=L.circleMarker',hit),foreign=sim.indexOf('if(f.agency===\'中国\'||!f.fixes.length)continue;',history),cma=sim.indexOf('const cmaForecast=orderedForecasts.find',foreign);
 assert(first>=0&&hit>first&&history>hit&&foreign>history&&cma>foreign);
});
check('CMA 14px hit disk is ABOVE non-CMA visual dots and UNDER CMA actual dot',()=>{
 const foreign=sim.indexOf('const mark=L.circleMarker',sim.indexOf('const marker=L.circleMarker'));
 const hit=sim.indexOf('const cmaHit=L.circleMarker',foreign),dot=sim.indexOf('const mark=L.circleMarker',hit);
 assert(foreign>=0 && hit>foreign && dot>hit);
 assert.match(sim.slice(hit,dot),/radius:NETWORK_OTHER_AGENCY_HIT_RADIUS_PX/);
 assert.match(sim.slice(hit,dot),/openLeafletDetails\(point,'中国'\)/);
 assert.match(sim.slice(dot,dot+580),/NETWORK_CMA_DOT_RADIUS_PX/);
});
check('CMA point and non-CMA points continue using intensity colors, original visible radii and 0.48px outline',()=>{
 assert.match(sim,/NETWORK_DOT_DIAMETER_PX=9/);
 assert.match(sim,/NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX=4/);
 assert.match(sim,/NETWORK_CMA_DOT_STROKE_PX=0\.48/);
 assert.match(sim,/networkForecastDotColor\(point\)/);
});
const raw=ts.transpileModule(util,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const mockEngine={getWindForceCategory:(v)=>v<17.2?7:v<24.5?8:v<32.7?10:v<41.5?12:v<51?14:v<56.1?16:17,materializeForecastPath:()=>[3,6,9,12].map(h=>({lat:14+h/10,lon:130-h/15,simHour:h,vmax:42.47,pmin:960,r7:{ne:100,se:90,sw:80,nw:70},r10:{ne:0,se:0,sw:0,nw:0},r12:{ne:0,se:0,sw:0,nw:0}}))};
const sandbox={exports:{},module:{exports:{}},require(name){if(name==='../simulation/Engine')return mockEngine;throw new Error('unknown module '+name)},Math,Date,Number,console};sandbox.module.exports=sandbox.exports;
vm.runInNewContext(raw,sandbox,{filename:'TyphoonNetworkData.cjs'});
const {toCmaPublishedWindSpeed:snap,buildNetworkForecasts:build}=sandbox.exports;
check('CMA wind publication ladder discretizes only Chinese simulated forecast series',()=>{
 const r=build({lat:14,lon:130,vmax:42.47,simHour:0,pmin:960}, {history:[]}, {a:1});
 assert.equal(r.length,4);assert.equal(r[0].agency,'中国');
 assert(r[0].fixes.length);
 assert(r[0].fixes.every(f=>sandbox.exports.CMA_PUBLIC_WIND_SPEED_LEVELS_MPS.includes(f.vmax)));
 assert(r.slice(1).some(a=>a.fixes.some(f=>!sandbox.exports.CMA_PUBLIC_WIND_SPEED_LEVELS_MPS.includes(f.vmax))));
 assert.equal(snap(42.47),42);assert.equal(snap(43.5),45);assert.equal(snap(54),55);assert.equal(snap(62.3),62);
 assert.equal(snap(Number.NaN),0);
});
check('History records and storm physical model are not mutated by CMA discretisation',()=>{
 const original={lat:14,lon:130,vmax:42.47,simHour:0,pmin:960}, storm={history:[original]};
 build(original,storm,{a:1});assert.equal(original.vmax,42.47);assert.equal(storm.history[0].vmax,42.47);
});
check('Global charcoal button rules exclude typhoon network controls',()=>{
 assert.match(global,/#root :is\(button,select,input,textarea,\[role="button"\]\):not\(\.leaflet-control-zoom-in\):not\(\.leaflet-control-zoom-out\):not\(\.tn-viewport button\)/);
});
check('Header white action artwork has high-specificity transparent overrides',()=>{
 for(const id of ['tn-network-share','tn-network-history']){assert(sim.includes('id="'+id+'"'));assert(css.includes('#tn-network-'+id.split('-').at(-1)));}
 assert(css.includes('background-color:transparent!important'));
});
check('Bottom-three controls preserve original image aspect and never clip their frame',()=>{
 const tail=css.slice(css.indexOf('/* R213: safeguard'));
 assert.match(tail,/\.tn-floating-button\{[\s\S]*?overflow:visible!important/);
 assert.match(tail,/\.tn-floating-button img\{[\s\S]*?object-fit:contain!important/);
 assert.match(stand,/object-fit:contain;aspect-ratio:auto/);
});
check('Forecast label line outlines increased without extra grey rectangles',()=>{
 assert.match(css,/stroke-width:1\.10px!important/);assert.match(stand,/ctx\.lineWidth=1\.1/);
 assert(!sim.includes('const label=L.divIcon'));
});
check('No typhoon warning lines added to app',()=>{
 assert(!sim.includes('warningLine24h'));assert(!sim.includes('warningLine48h'));
});
check('Round212 basemap controls remain intact',()=>{
 assert(sim.includes("id:'amap'"));assert(sim.includes("id:'osm'"));assert(sim.includes("id:'osm-night'"));
 assert(sim.includes("value==='amap'?'osm-night':'amap'"));
});
check('CMA tap overlays do not alter 32x replay or cyclone rendering',()=>{
 assert(sim.includes('NETWORK_REPLAY_HORIZONTAL_SPAN_KM=1000'));assert(sim.includes('geographicCyclone('));
});
const report={round:'R213',passed:count,total:count,ts:'2026-10-18T00:40:00-07:00',warningLines:'Found coordinates via public sources, not implemented'};
fs.writeFileSync(path.join(root,'ROUND213_TEST_RESULTS.json'),JSON.stringify(report,null,2));
console.log('R213 '+count+'/'+count+' PASS');
