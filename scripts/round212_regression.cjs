'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
let ts;try{ts=require('typescript')}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}
const root=path.resolve(__dirname,'..');const read=n=>fs.readFileSync(path.join(root,n),'utf8');
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS',name)};
const simulator=read('src/components/TyphoonNetworkSimulator.tsx');
const css=read('src/components/TyphoonNetworkSimulator.css');
const station=read('src/components/StationHistory.tsx');
const map=read('src/components/MapView.tsx');
const nmc=read('src/utils/NmcForecastProduct.ts');
const standalone=read('src/utils/TyphoonNetworkStandaloneExport.ts');
const reportRenderer=read('src/utils/StationReportRenderer.ts');
const reportModal=read('src/components/StationReportModal.tsx');
for(const file of ['src/components/TyphoonNetworkSimulator.tsx','src/components/StationHistory.tsx','src/components/MapView.tsx','src/components/StationReportModal.tsx','src/utils/StationReportRenderer.ts','src/utils/NmcForecastProduct.ts','src/utils/TyphoonNetworkStandaloneExport.ts']){
 test(`TypeScript parser: ${file}`,()=>{const text=read(file),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.equal(source.parseDiagnostics.length,0,source.parseDiagnostics.map(x=>x.messageText).join('\n'));});
}
test('provider menu exposes Gaode, ordinary OSM, and OSM Night',()=>{
 assert.match(simulator,/useState<'amap'\|'osm'\|'osm-night'>\('amap'\)/);
 for(const id of ["id:'amap'","id:'osm'","id:'osm-night'"])assert(simulator.includes(id),id);
 assert.match(simulator,/id="tn-network-switch"/);assert.match(simulator,/id="tn-provider-menu"/);
});
test('day/night shortcut switches only Gaode and OSM Night',()=>{
 assert.match(simulator,/onClick=\{\(\)=>setBasemap\(value=>value==='amap'\?'osm-night':'amap'\)\}/);
 assert.match(simulator,/className:basemap==='osm-night'\?'tn-osm-night-tiles':'tn-osm-day-tiles'/);
 assert.match(simulator,/if\(basemap!=='amap'\)map\.setView\(\[/);
});
test('default map remains Gaode',()=>assert.match(simulator,/useState<'amap'\|'osm'\|'osm-night'>\('amap'\)/));
test('right controls reduced and lowered; replay button reduced',()=>{
 assert.match(css,/\.tn-right-tools\{[\s\S]*?top:67%!important;gap:5px!important/);
 assert.match(css,/\.tn-floating-button\{[\s\S]*?width:38px!important;height:38px!important/);
 assert.match(css,/\.tn-replay-button\{[\s\S]*?width:46px!important;height:46px!important/);
 assert.match(css,/\.tn-floating-button img\{[\s\S]*?object-fit:fill!important/);
});
test('forecast labels slightly heavier but still thinly outlined',()=>{
 assert.match(css,/\.tn-map svg \.tn-geo-lead\{[\s\S]*?stroke-width:\.85px!important;font-weight:600!important/);
 assert.match(simulator,/font-weight':'600'/);assert.match(simulator,/stroke-width':'0\.85'/); // Inline SVG values match the scoped CSS calibration.
});
test('wind ring fill is slightly stronger and active status is lighter',()=>{
 assert.match(simulator,/fillOpacity:\.13/);assert.match(css,/\.tn-status-active,[\s\S]*?font-weight:500!important/);
 assert.match(standalone,/ctx\.globalAlpha=\.11;ctx\.fill\(\)/);assert.match(standalone,/#state\{color:#e50019;text-align:center;font-weight:500/);
});
test('station detail title is clickable and edits the full station title',()=>{
 assert.match(station,/点击修改站点名称/);assert.match(station,/aria-label="气象站完整显示名称"/);
 assert.match(station,/typhoon_station_custom_title_\$\{station\.id\}/);
 assert.match(station,/localStorage\.setItem\(stationTitleStorageKey, next\)/);
 assert.match(station,/aether:station-name-changed/);
});
test('station popup uses saved title and safely inserts it into map popup',()=>{
 assert.match(map,/typhoon_station_custom_title_\$\{stationName\}/);
 assert.match(map,/escapeStationPopupText\(data\.stationDisplayName\)/);
 assert.match(map,/stationNameRevisionRef\.current !== stationNameRevision/);
 assert.match(map,/speed, stationNameRevision\]/);
 assert.match(station,/displayTitle: stationTitle/);
 assert.match(reportRenderer,/station\.displayTitle \|\| `\$\{station\.name\}气象站`/);
 assert.match(reportModal,/station\.displayTitle \|\| station\.name/);
});
test('standalone uses the smaller square controls and lighter active marker',()=>{
 assert.match(standalone,/#right\{[\s\S]*?top:67%/);assert.match(standalone,/width:38px;height:38px/);
 assert.match(standalone,/#left \.control\{width:46px;height:46px/);
 assert.match(standalone,/object-fit:fill/);assert.match(standalone,/ctx\.font='600 9px Arial,Microsoft YaHei,sans-serif'/);
});
test('NMC cone factor has a smooth, monotonic late widening profile',()=>{
 const start=nmc.indexOf('export function nmcPreWesterliesConeFactor('),end=nmc.indexOf('function getNmcConeSections(',start);
 assert(start>=0&&end>start);
 const compiled=ts.transpileModule(nmc.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const context={exports:{},Math,Number,clamp:(n,lo,hi)=>Math.min(hi,Math.max(lo,n))};vm.runInNewContext(compiled,context);
 const factor=context.exports.nmcPreWesterliesConeFactor,radius=context.exports.nmcUncertaintyRadiusKm,track=[{lat:18,lon:120,simHour:0},{lat:20,lon:130,simHour:120}];
 assert.equal(factor(track,60),1);assert.equal(factor(track,90),.9);assert.equal(factor(track,120),.8);
 assert.equal(radius(track,0),0);assert(radius(track,.25)>0);let previous=radius(track,0);
 for(let lead=.25;lead<=120;lead+=.25){const current=radius(track,lead);assert(current>previous-1e-9,`cone radius fell at ${lead}h`);previous=current;}
 assert(radius(track,12)<50 && radius(track,12)>35);assert(radius(track,60.25)>radius(track,60));
 assert.equal(factor(track,120.01),.8);assert.equal(factor([{lat:32,lon:120,simHour:0},{lat:33,lon:130,simHour:120}],120),1); // midlatitude tracks retain the original cone.
});
const report={round:'R212',passed,total:passed,checks:passed,generatedAt:new Date().toISOString()};
fs.writeFileSync(path.join(root,'ROUND212_STATIC_TEST_RESULTS.json'),JSON.stringify(report,null,2));
console.log(`R212 ${passed}/${passed} PASS`);
