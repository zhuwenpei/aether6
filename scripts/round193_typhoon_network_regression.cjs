/* Round193: executes color key, visible-node straight segments, local GeoJSON basemap and legacy invariants.
 * Uses the globally installed TypeScript parser; requires no npm install or external map services. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const items=[];
function test(name,fn){try{fn();items.push({name,status:'PASS'});console.log('PASS',name)}catch(e){items.push({name,status:'FAIL',detail:String(e)});console.error('FAIL',name,e.message)}}
const getSource=file=>ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
for(const p of ['src/utils/TyphoonNetworkData.ts','src/utils/TyphoonNetworkOfflineMap.ts','src/components/TyphoonNetworkSimulator.tsx','src/components/ForecastImageModal.tsx','src/App.tsx']){
 test('TS/TSX syntax '+p,()=>assert.equal(getSource(p).parseDiagnostics.length,0));
}
const data={};
vm.runInNewContext(ts.transpileModule(read('src/utils/TyphoonNetworkData.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
 {exports:data,require:()=>({getWindForceCategory:x=>Math.floor(x/4),materializeForecastPath:()=>[]})});
const {networkPointColor:color,networkHistorySegments:histSegments,networkVisibleForecastFixes:visible,networkForecastSegments:forecastSegments,NETWORK_STRENGTH_LEGEND:legend}=data;
const palette=[[6,'#00ce3a'],[18,'#0639f5'],[28,'#ff8b12'],[35,'#ff161d'],[40,'#ff161d'],[45,'#eb08dd'],[53,'#8320d6']];
for(const [wind,expected] of palette)test(`${wind} m/s matches sampled reference-strength bin`,()=>assert.equal(color(wind),expected));
test('six disjoint strength bins, 0..Infinity',()=>{assert.equal(legend.length,6);for(let i=1;i<legend.length;i++)assert.equal(legend[i-1].max,legend[i].min);assert.equal(legend[0].min,0);assert.equal(legend.at(-1).max,Infinity);});
for(const value of [NaN,Infinity,-Infinity,-3])test(`invalid wind speed ${value} neutral gray`,()=>assert.equal(color(value),'#8e8e8e'));
test('obsolete dissipated tag does not recolor real hurricane strength',()=>assert.equal(color(62,'已消散'),color(62)));
test('weak dissipated category has neutral gray',()=>assert.equal(color(3,'已消散'),'#8e8e8e'));
test('forecast agency identity still 4 names and distinct line colors',()=>assert.equal(new Set(data.NETWORK_FORECAST_STYLE.map(x=>x.color)).size,4));
const mk=(i)=>({simHour:i*3,lat:20+i*i*.33,lon:120+i*1.3,vmax:15+i*3,pmin:1000-i*2,category:'台风'});
const track=Array.from({length:7},(_,i)=>mk(i));
const fc={agency:'中国',color:'#a12bf2',fixes:track.slice(1)};
test('history segments exactly N-1, no hidden intermediate vertices',()=>{const s=histSegments(track);assert.equal(s.length,6);for(let i=0;i<s.length;i++){assert.equal(s[i].from,track[i]);assert.equal(s[i].to,track[i+1]);assert.equal(s[i].color,color(track[i+1].vmax));}});
test('historical segment single-point history has no lines',()=>assert.equal(histSegments(track.slice(0,1)).length,0));
test('forecast dots retain every other 3h prediction',()=>assert.deepEqual(Array.from(visible(fc),x=>x.simHour),[3,9,15]));
test('forecast straight segments touch visible dots ONLY',()=>{
 const shown=[track[0],...visible(fc)],edges=forecastSegments(track[0],fc);
 assert.equal(edges.length,3);
 for(let i=0;i<edges.length;i++){assert.equal(edges[i].from,shown[i]);assert.equal(edges[i].to,shown[i+1]);assert.equal(edges[i].color,fc.color);}
});
test('no prediction means no forecast edges',()=>assert.equal(forecastSegments(track[0],{...fc,fixes:[]}).length,0));
const page=read('src/components/TyphoonNetworkSimulator.tsx'),css=read('src/components/TyphoonNetworkSimulator.css'),geoSrc=read('src/utils/TyphoonNetworkOfflineMap.ts');
test('all THREE SDKs use segment factories for both track kinds',()=>{
 assert.equal((page.match(/for\(const segment of networkHistorySegments\(/g)||[]).length,3);
 assert.equal((page.match(/for\s*\(const segment of networkForecastSegments\(/g)||[]).length,3);
});
test('no forecast full hidden-vertex polyline remains',()=>{
 assert(!page.includes('...f.fixes.map(p=>[p.lat,p.lon]'));
 assert(!page.includes('fc.fixes.map(f=>toBaiduPoint'));
 assert(!page.includes('path:[product.issue,...forecast.fixes]'));
});
test('Leaflet produces literal two-point unsmoothed lines',()=>{
 assert.equal((page.match(/smoothFactor:0/g)||[]).length,3); // history, forecast and high-resolution wind ring
 assert(page.includes('[[segment.from.lat,segment.from.lon],[segment.to.lat,segment.to.lon]]'));
});
test('Baidu receives pairs, not a longer polyline',()=>assert(page.includes('toBaiduPoint(BMap,segment.from.lon,segment.from.lat),toBaiduPoint(BMap,segment.to.lon,segment.to.lat)')));
test('Petal receives segment endpoints only',()=>assert(page.includes('path:[{lat:segment.from.lat,lng:segment.from.lon},{lat:segment.to.lat,lng:segment.to.lon}]')));
test('forecast markers still use intensity, not agency',()=>{
 assert(page.includes('fillColor:networkForecastDotColor(point)'));
 assert(page.includes('baiduStrengthIcon(BMap,networkForecastDotColor(f))'));
 assert(page.includes('strengthDotSvg(networkForecastDotColor(fix),NETWORK_DOT_DIAMETER_PX)'));
});
test('no UI label 生效中',()=>assert(!page.includes('生效中')));
test('dissipated status remains supported',()=>assert(page.includes('【已停编】')));
test('CMA 3h boundary and initial-only autoplay untouched',()=>{assert(page.includes('cmaBoundedNetworkHistory(storm,startDate,currentHour)'));assert(page.includes('187.5'));assert(page.includes('if(stage===\'reference\'){setStage(\'map\');}else onClose()'));});
test('land-center wind circle suppression untouched',()=>assert(page.includes('if(landGeoJson?.features?.length)return !checkPointOnLandGeoJson')));
test('OSM, Baidu, Petal, Offline provider menu retained',()=>{for(const mode of ['osm','baidu','petal','offline'])assert(page.includes(`selectProvider('${mode}')`),mode)});
test('reference RGB sea/land sampled exactly',()=>{assert(geoSrc.includes("sea:'#a1d2fd'"));assert(geoSrc.includes("land:'#ffffff'"));});
test('offline loads only locally packaged resources on demand',()=>{
 for(const fname of ['product_land_wide_v3.geojson','product_countries_highdetail_v3.geojson']){
   assert(fs.existsSync(path.join(root,'public/data',fname)));
   const obj=JSON.parse(read('public/data/'+fname));assert(obj.features.length>100);
   assert(geoSrc.includes(fname));
 }
 assert(geoSrc.includes("BASE_URL"));assert(!geoSrc.includes('https://'));
});
test('offline polygons beneath cyclone overlays even when fetched later',()=>{
 assert(page.includes("map.createPane('tn-offline-ground')"));
 assert(page.includes("groundPane.style.zIndex='210'"));
 assert(geoSrc.includes("pane:'tn-offline-ground'"));
});
test('offline fetch cache and stale request cancellation',()=>{
 assert(geoSrc.includes('if(cached)return Promise.resolve(cached)'));
 assert(geoSrc.includes('if(pending)return pending'));
 assert(page.includes('if(cancelled||leafletRef.current!==map)return'));
});
test('offline layer active for frames/rings also',()=>assert(page.includes("(provider!=='osm'&&provider!=='offline')")));
test('map styling image-inspired with no PNG/screenshots as basemap',()=>{assert(css.includes('.tn-offline-basemap'));assert(!geoSrc.includes('.jpg')&&!geoSrc.includes('.png'));});
test('NMC unchanged call; no physical mutations',()=>{assert(page.includes('drawNmcForecastProductCooperative('));assert(!page.includes('setTyphoons('));});
// Operational protected files must be byte-for-byte identical to R192 baseline.
const original=path.resolve(root,'../aether_r192_work');
for(const file of ['src/simulation/Engine.ts','src/utils/NmcForecastProduct.ts','src/utils/StrikeProbabilityField.ts','src/simulation/AetherEnsembleGuidance.ts','src/utils/SimulationArchive.ts']){
 test('protected source byte-identical '+file,()=>assert.deepEqual(fs.readFileSync(path.join(root,file)),fs.readFileSync(path.join(original,file))));
}

async function runAsync(){
  // Runtime test of static GeoJSON loader and the renderer layer API via stub Leaflet.
  const template=geoSrc.replace("((import.meta as any).env?.BASE_URL||'/')","('/')");
  const js=ts.transpileModule(template,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  let calls=0;const layers=[];
  const mockL={canvas:options=>({options}),layerGroup:()=>({elements:[],addTo(){return this}}),
    geoJSON:(geo,opts)=>({addTo:layer=>{layer.elements.push({geo,opts});return layer}})};
  const imp={exports:{},require:(name)=>name==='leaflet'?{__esModule:true,default:mockL}:null,
    fetch:async u=>{calls++;assert(u.startsWith('/data/'),u);const fname=u.split('/').at(-1);return {ok:true,json:async()=>JSON.parse(read('public/data/'+fname))};}}
  vm.runInNewContext(js,imp);
  const off=imp.exports;
  const d1=await off.loadNetworkOfflineGeography(),d2=await off.loadNetworkOfflineGeography();
  test('offline geometry runtime uses two local fetches only',()=>{assert.equal(calls,2);assert.equal(d1,d2);});
  test('offline vector geometry is genuine and nonempty',()=>{assert(d1.land.features.length>1000);assert(d1.borders.features.length>100);});
  const layer=off.createNetworkOfflineLayer(d1);
  test('offline renderer creates land + political borders layers',()=>{assert.equal(layer.elements.length,2);assert.equal(layer.elements[0].geo,d1.land);assert.equal(layer.elements[1].geo,d1.borders);});
  test('offline style renders exactly sampled sea-adjacent white land',()=>{
    const style=layer.elements[0].opts.style();assert.equal(style.fillColor,'#ffffff');assert.equal(style.renderer.options.pane,'tn-offline-ground');
  });
  test('offline border lines do not flood land',()=>{assert.equal(layer.elements[1].opts.style().fillOpacity,0);});
  const fail=items.filter(x=>x.status==='FAIL');
  const output={round:193,tests:items.length,passed:items.length-fail.length,failed:fail.length,results:items,generated:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'ROUND193_VALIDATION.json'),JSON.stringify(output,null,2));
  console.log(`R193 ${output.passed}/${output.tests} PASS`);if(fail.length)process.exitCode=1;
}
runAsync().catch(e=>{console.error(e);process.exitCode=1});
