/** Round196 — matches screenshot-inspired point sizes, floating detail close,
 * stable header placement and smooth low-weight wind outlines.  No npm install. */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const page=read('src/components/TyphoonNetworkSimulator.tsx');
const css=read('src/components/TyphoonNetworkSimulator.css');
let passing=0;const results=[];
function test(name,fn){try{fn();results.push({name,result:'PASS'});passing++;console.log('PASS',name)}catch(e){results.push({name,result:'FAIL',error:String(e)});console.error('FAIL',name,e)}}
function matches(r,n){assert.equal((page.match(r)||[]).length,n)}
for(const f of ['src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkData.ts','src/utils/TyphoonNetworkOfflineMap.ts']){
 test(`${f}: valid syntax`,()=>{
  const sf=ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(sf.parseDiagnostics.length,0);
 });
}
const start=page.indexOf('export function windRing('),end=page.indexOf('const encode=',start);
const exp={};vm.runInNewContext(ts.transpileModule(page.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports:exp,landGeoJson:{features:[]},checkPointOnLandGeoJson:()=>false});
const fix={lat:22,lon:140,r7:{ne:525,se:413,sw:346,nw:460},r10:{ne:132,se:105,sw:94,nw:120},r12:{ne:71,se:58,sw:52,nw:65},landed:false};
const pts=exp.windRing(fix,'r7');
test('Wind arc sampled 0.75 degrees per 90-degree quadrant',()=>assert.equal(pts.length,484));
test('All arc nodes numeric and valid degrees',()=>assert(pts.every(([lat,lon])=>Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-85&&lat<=85&&lon>=-180&&lon<=180)));
test('Sector boundary arc endpoints join only along a parallel/meridian',()=>{
 for(const [i,j,k] of [[120,121,0],[241,242,1],[362,363,0],[483,0,1]])assert(Math.abs(pts[i][k]-pts[j][k])<1e-9,`${i} to ${j}`);
});
test('All four 90-degree circular arcs have smooth angular sampling',()=>{
 for(let q=0;q<4;q++){
  for(let step=0;step<120;step++){
   const a=pts[q*121+step],b=pts[q*121+step+1];
   const km=Math.hypot((a[0]-b[0])*111.195,(a[1]-b[1])*111.195*Math.cos(fix.lat*Math.PI/180));
   assert(km<=7.3,`unusually long arc edge ${q}:${step} (${km}km)`);
  }
 }
});
test('Input wind quadrant radius figures are not mutated',()=>{
 const before=JSON.stringify(fix);
 for(const f of ['r7','r10','r12'])exp.windRing(fix,f);
 assert.equal(JSON.stringify(fix),before);
});
test('Arc interpolation shared by Leaflet/Baidu/Petal',()=>matches(/windRing\((fix|p),field\)/g,3));
test('Wind outlines fine in all providers',()=>{
 assert(page.includes('weight:0.9,opacity:.92,lineJoin:\'round\',lineCap:\'round\',smoothFactor:0'));
 assert(page.includes('strokeWeight:1,strokeOpacity:.92'));
 assert(page.includes('strokeColor:color,strokeWeight:1,fillColor:'));
});
test('Over-land wind suppression preserved',()=>assert(page.includes('return !checkPointOnLandGeoJson(fix.lat,fix.lon)')));
test('Single 11px dot geometry constant',()=>{
 assert(page.includes('NETWORK_DOT_DIAMETER_PX=11'));
 assert(page.includes('NETWORK_DOT_RADIUS_PX=(NETWORK_DOT_DIAMETER_PX-1)/2'));
});
test('Leaflet history, forecast, and center all use same radius',()=>matches(/L\.circleMarker\(\[(p|point|fix)\.lat,(p|point|fix)\.lon\],\{radius:NETWORK_DOT_RADIUS_PX/g,3));
test('Leaflet all dot borders white and 1px',()=>matches(/radius:NETWORK_DOT_RADIUS_PX,color:'#ffffff',weight:1/g,3));
test('Baidu history forecast center share same icon helper',()=>{
 assert(page.includes('function baiduStrengthIcon('));
 for(const code of ['baiduStrengthIcon(BMap,networkPointColor(f.vmax,f.category))','baiduStrengthIcon(BMap,networkForecastDotColor(f))','baiduStrengthIcon(BMap,centerColor)'])assert(page.includes(code),code);
 assert(page.includes('anchor:new BMap.Size(size/2,size/2)'));
});
test('Petal history forecast current share one diameter',()=>{
 assert(page.includes('product.history.forEach(fix=>marker(fix))'));
 assert(page.includes('marker(fix,forecast.agency)'));
 assert(page.includes('strengthDotSvg(networkPointColor(fix.vmax,fix.category),NETWORK_DOT_DIAMETER_PX)'));
});
test('Special Petal label pin contains no tiny misleading colored dot',()=>{
 assert(!page.includes('strengthDotSvg(networkForecastDotColor(fix),1)'));
 assert(page.includes('data:image/svg+xml,%3Csvg%20xmlns'));
});
test('Flat strong-color circles, forecast agency solely controls line colors',()=>{
 assert(page.includes('fillColor:networkForecastDotColor(point)'));
 assert(page.includes('strokeColor:segment.color'));
 assert(page.includes('color:segment.color'));
});
test('Header grid gives centered title separate column',()=>{
 assert(css.includes('display:grid!important;grid-template-columns:51px 62px minmax(0,1fr) 51px!important'));
 assert(css.includes('.tn-header .tn-header-title{'));
 assert(css.includes('grid-column:3;grid-row:1'));
 assert(css.includes('grid-template-columns:45px 55px minmax(0,1fr) 44px!important'));
});
test('Reference tab retains center heading without switch button',()=>assert(page.includes('tn-header-reference')));
test('Icon only one reference entry, retained screenshot green block',()=>{
 assert(page.includes('aria-label="台风参考"'));
 assert(css.includes('.tn-header .tn-reference-link{grid-column:4'));
});
test('Visible unboxed small x located within detail card',()=>{
 assert(page.includes('className="tn-detail-close" aria-label="关闭打点详情">x</button>'));
 assert(css.includes('.tn-detail .tn-detail-close{'));
 assert(css.includes('background:transparent!important;color:#898989!important'));
 assert(css.includes('right:12px!important;top:10px!important'));
});
test('Click handler closes info card in all three map providers',()=>{
 assert(page.includes('onClickCapture={event=>{'));
 assert(page.includes("closest('.tn-detail-close')"));
 assert(page.includes('leafletRef.current?.closePopup()'));
 assert(page.includes('baiduMapRef.current?.closeInfoWindow?.()'));
 assert(page.includes('petalInfoRef.current?.close?.()'));
});
test('Leaflet native grey-square x suppressed, geographic tip remains',()=>{
 assert(page.includes('closeButton:false,offset:L.point(0,0)'));
 assert(page.includes('popup.setLatLng([fix.lat,fix.lon])'));
 assert(css.includes('.leaflet-popup-tip{background:#fff!important'));
});
test('Unchanged official replay and Cma cut-off controls',()=>{
 assert(page.includes('cmaBoundedNetworkHistory(storm,startDate,currentHour)'));
 assert(page.includes('187.5'));
});
test('Original OSM, Baidu, Petal, and offline map picker unaffected',()=>{
 for(const provider of ['osm','baidu','petal','offline'])assert(page.includes(`selectProvider('${provider}')`));
});
test('Reference NMC crash-safe renderer still used',()=>assert(page.includes('drawNmcForecastProductCooperative(')));
test('No cyclone state mutation introduced',()=>assert(!page.includes('setTyphoons(')));
const failures=results.length-passing;
const report={round:196,tests:results.length,passed:passing,failed:failures,results,generated:new Date().toISOString()};
fs.writeFileSync(path.join(root,'ROUND196_VISUAL_CONSISTENCY_VALIDATION.json'),JSON.stringify(report,null,2));
console.log(`ROUND196 ${passing}/${results.length} ${failures?'FAILED':'PASS'}`);
if(failures)process.exitCode=1;
