const fs=require('fs');
const vm=require('vm');
const assert=require('assert').strict;
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
function loadTs(path,extra={}){
  const src=fs.readFileSync(path,'utf8');
  const result=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  assert.equal(result.diagnostics?.length||0,0,`${path} transpiles`);
  const scope={exports:{},console,Math,Date,JSON,Blob,Response,CompressionStream,DecompressionStream,Uint8Array,Set,Map,WeakMap,...extra};
  vm.createContext(scope);vm.runInContext(result.outputText,scope);
  return scope.exports;
}
const g=loadTs('src/utils/NmcMapViewport.ts');
const map={x:22,y:102,w:1248,h:819};
const realLand=JSON.parse(fs.readFileSync('public/data/product_land_wide_v3.geojson','utf8'));
assert(g.nmcForecastTouchesSignificantLand({lat:18,lon:128},[{lat:18,lon:125},{lat:18,lon:121}],realLand),'real Luzon crossing must count');
assert(g.nmcForecastTouchesSignificantLand({lat:23,lon:131},[{lat:24,lon:121}],realLand),'real Taiwan crossing must count');
assert(!g.nmcForecastTouchesSignificantLand({lat:26.2,lon:130},[{lat:26.2,lon:127.5},{lat:26.2,lon:125.5}],realLand),'small Okinawa island must not flip viewport');
const sea={type:'FeatureCollection',features:[]};
const noLandCurrent={lat:17,lon:151};
const history=[{lat:13,lon:178},{lat:15,lon:170},{lat:16,lon:161}];
const forecast=[{lat:19,lon:147},{lat:25,lon:140},{lat:31,lon:136}];
const open=g.buildNmcGeoFrame(noLandCurrent,history,forecast,sea,map);
assert(open.includesHistory && !open.significantLandfall);
const projected=(p,f)=>g.nmcProjectPoint(p.lat,g.nmcUnwrapLongitude(p.lon,(f.minLon+f.maxLon)/2),f,map);
for(const p of [noLandCurrent,...history,...forecast]){
  const xy=projected(p,open);assert(xy.x>=map.x-0.00001 && xy.x<=map.x+map.w+0.00001 && xy.y>=map.y-0.00001&&xy.y<=map.y+map.h+0.00001,'entire history plus forecast is in frame');
}
const island=(cx,cy,half)=>({type:'Feature',geometry:{type:'Polygon',coordinates:[[[cx-half,cy-half],[cx+half,cy-half],[cx+half,cy+half],[cx-half,cy+half],[cx-half,cy-half]]]}});
const tiny={type:'FeatureCollection',features:[island(141,25,.15)]};
assert(!g.nmcForecastTouchesSignificantLand({lat:25,lon:150},[{lat:25,lon:138}],tiny));
const big={type:'FeatureCollection',features:[island(141,25,1.1)]};
assert(g.nmcForecastTouchesSignificantLand({lat:25,lon:150},[{lat:25,lon:138}],big));
const landFrame=g.buildNmcGeoFrame({lat:25,lon:150},[{lat:25,lon:180},{lat:24,lon:170}],[{lat:25,lon:138}],big,map);
assert(landFrame.significantLandfall&&!landFrame.includesHistory);
assert(projected({lat:25,lon:180},landFrame).x>map.x+map.w,'distant HISTORY should be omitted after landfall');
for(const p of [{lat:25,lon:150},{lat:25,lon:138}]){let xy=projected(p,landFrame);assert(xy.x>=map.x&&xy.x<=map.x+map.w);}
for(const lat of [0,10,25,40,65]) assert(Math.abs(g.nmcInverseMercatorY(g.nmcMercatorY(lat))-lat)<1e-10);
const f=g.buildNmcGeoFrame({lat:20,lon:140},[],[{lat:40,lon:160}],sea,map);
const a=projected({lat:20,lon:140},f),b=projected({lat:20,lon:141},f),c=projected({lat:21,lon:140},f);
const scaleX=Math.hypot(b.x-a.x,b.y-a.y), scaleY=Math.hypot(c.x-a.x,c.y-a.y)/(g.nmcMercatorY(21)-g.nmcMercatorY(20));
assert(Math.abs(scaleX-scaleY)<1e-8,'Mercator scale should be identical in X/Y');
(async()=>{
 const archive=loadTs('src/utils/SimulationArchive.ts');
 const data={typhoons:[{id:'demo',name:'测试台风',lat:25,lon:140,vmax:32,history:[{simHour:0,lat:22,lon:148,vmax:22},{simHour:12,lat:25,lon:140,vmax:32}]}],eventLogs:[],config:{seed:'42'},layers:{},currentHour:12,maxHour:12,totalSimMinutes:720,startDate:'2026-10-08T00:00:00.000Z',seasonEnded:false,speed:1,prngState:123,timelineCollapsed:false,genesisPos:{lat:22,lon:148}};
 const blob=await archive.createSimulationArchiveBlob(data,'readable');
 const text=await blob.text();
 assert(text.startsWith('{\n  "format": "aether.complete-simulation"'));
 const parsed=JSON.parse(text); assert(parsed.aiEditingGuide&&parsed.aiEditingGuide.sections['data.config']);
 assert.equal(parsed.data.typhoons[0].history.length,2);
 parsed.data.typhoons[0].history[1].vmax=33;
 const edited=await archive.readSimulationArchiveFile(new Blob([JSON.stringify(parsed)]));
 assert.equal(edited.data.typhoons[0].history[1].vmax,33,'AI edited data can be read by simulator');
 const compressed=await archive.createSimulationArchiveBlob(data,'compressed');
 assert.equal((await archive.readSimulationArchiveFile(compressed)).data.currentHour,12);
 console.log('ROUND145 NMC viewport: open sea full-history, significant-land crop, minor islands filtered, Mercator aspect: PASS');
 console.log('ROUND145 readable AI-editable JSON + gzip backward compatibility: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
