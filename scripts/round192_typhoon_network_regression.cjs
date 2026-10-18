/* R192 standalone checks; no React/Leaflet install needed. */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const base=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(base,file),'utf8');
const page=read('src/components/TyphoonNetworkSimulator.tsx'),css=read('src/components/TyphoonNetworkSimulator.css'),env=read('.env.example');
const tests=[];
const run=(name,fn)=>{try{fn();tests.push({name,status:'PASS'});console.log('PASS',name)}catch(e){tests.push({name,status:'FAIL',error:String(e)});console.log('FAIL',name,String(e));}};
const validSyntax=(file)=>{const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.equal(source.parseDiagnostics.length,0,source.parseDiagnostics.map(e=>String(e.messageText)).join('|'));};
for(const file of ['src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkData.ts','src/components/ForecastImageModal.tsx','src/App.tsx'])run('TS/TSX parse '+file,()=>validSyntax(file));
const utilSrc=read('src/utils/TyphoonNetworkData.ts');const moduleExports={};
vm.runInNewContext(ts.transpileModule(utilSrc,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
  {exports:moduleExports,require:(s)=>s.includes('Engine')?{getWindForceCategory:()=>7,materializeForecastPath:()=>[]}:{}});
const {networkPointColor,NETWORK_FORECAST_STYLE}=moduleExports;
const a=page.indexOf('export function networkForecastDotColor('),b=page.indexOf('/** Small flat SVG center/dot',a);
const compiled=ts.transpileModule(page.slice(a,b),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const colors={};vm.runInNewContext(compiled,{exports:colors,networkPointColor});
for (const w of [12,20,27,35,46,62]) run(`forecast intensity ${w} m/s same as historical`,()=>assert.equal(colors.networkForecastDotColor({vmax:w}),networkPointColor(w)));
run('weak dissipated vortex remains gray; strong physical wind stays strength-colored',()=>{assert.equal(colors.networkForecastDotColor({vmax:3,category:'已消散'}),'#8e8e8e');assert.equal(colors.networkForecastDotColor({vmax:62,category:'已消散'}),networkPointColor(62));});
run('forecast agency identity remains 4-color',()=>assert.deepEqual(Array.from(NETWORK_FORECAST_STYLE,x=>x.agency),['中国','日本','美国','韩国']));
run('OSM forecast lines use agency colors',()=>assert(page.includes('color:segment.color,weight:2,dashArray')));
run('OSM forecast dots use intensity',()=>assert(page.includes('fillColor:networkForecastDotColor(point)')&&page.includes('radius:NETWORK_DOT_RADIUS_PX')));
run('Baidu forecast lines use agency colors',()=>assert(page.includes('strokeColor:segment.color,strokeWeight:2,strokeStyle')));
run('Baidu forecast dots use intensity',()=>assert(page.includes('baiduStrengthIcon(BMap,networkForecastDotColor(f))')));
run('Petal forecast lines use agency colors',()=>assert(page.includes('strokeColor:segment.color,strokeWeight:2,strokeLineDash:[2,7]')));
run('Petal forecast dots use intensity',()=>assert(page.includes('strengthDotSvg(networkForecastDotColor(fix),NETWORK_DOT_DIAMETER_PX)')));
run('top summary right aligned at all sizes',()=>assert(css.includes('text-align:right!important')&&css.includes('.tn-ticker div{text-align:right!important')));
run('top caption has neither stroke nor text shadow',()=>assert(css.includes('-webkit-text-stroke:0!important')&&css.includes('text-shadow:none!important')));
run('mobile reference toolbar resized',()=>assert(css.includes('height:46px!important')&&css.includes('.tn-header-title{font-size:clamp(20px,5.4vw,26px)')));
run('map picker shows all 4 explicit providers',()=>{for (const v of ["selectProvider('osm')","selectProvider('baidu')","selectProvider('petal')","selectProvider('offline')"])assert(page.includes(v),v);});
run('OSM default',()=>assert(page.includes("useState<'osm'|'baidu'|'petal'|'offline'>('osm')")));
run('Petal uses official Map Kit JS API and no unofficial tile URLs',()=>{
  assert(page.includes('https://mapapi.cloud.huawei.com/mapjs/v1/api/js?callback='));
  assert(!page.includes('petalmaps.com/tiles/'));
});
run('Petal configuration and explanatory fallback',()=>{
  assert(page.includes('VITE_PETAL_MAPS_KEY')&&env.includes('VITE_PETAL_MAPS_KEY='));
  assert(page.includes('Petal Maps 需要华为 Map Kit Web API Key'));
});
run('Petal waits for viewport before HWMap construction',()=>{
  const providerIndex=page.indexOf("setProvider('petal');");
  const mapIndex=page.indexOf('new sdk.HWMap(',providerIndex);
  assert(mapIndex>providerIndex && page.slice(providerIndex,mapIndex).includes('await raf();await raf()'));
});
run('Petal markers popup attached to geographic point',()=>assert(page.includes('new sdk.HWInfoWindow')&&page.includes('info.open(marker)')));
run('Petal center, land-only winds and re-entry supported',()=>{
  assert(page.includes("if(stage!=='map'||provider!=='petal'"));
  assert(page.includes('if(shouldDrawNetworkWindRadii(fix))'));
  assert(page.includes('map.setCenter?.({lat:fix.lat,lng:fix.lon})'));
});
run('Petal overlays cleaned when switching or unmounting',()=>assert(page.includes('petalStaticRef.current.forEach(x=>x?.setMap?.(null))')&&page.includes('petalDynamicRef.current.forEach(x=>x?.setMap?.(null))')));
run('no simulation state mutations',()=>assert(!/\bsetTyphoons\b|\bsetConfig\b|\bwriteSimulationArchive\b/.test(page)));
run('playback unchanged',()=>assert(page.includes('187.5')&&page.includes('cmaBoundedNetworkHistory(storm,startDate,currentHour)')));
run('NMC core unchanged',()=>assert(page.includes('drawNmcForecastProductCooperative(')));
const fail=tests.filter(x=>x.status==='FAIL');const result={round:192,tests:tests.length,passed:tests.length-fail.length,failed:fail.length,results:tests,generated:new Date().toISOString()};
fs.writeFileSync(path.join(base,'ROUND192_VALIDATION.json'),JSON.stringify(result,null,2));
console.log(`R192 ${result.passed}/${result.tests} PASS`);if(fail.length)process.exitCode=1;
