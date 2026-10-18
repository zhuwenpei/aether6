/* R197 integrated feature regression: assets, CMA timing, map inputs, NMC overlays. */
const fs=require('fs'),assert=require('node:assert/strict'),vm=require('vm'),path=require('path');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const page=read('src/components/TyphoonNetworkSimulator.tsx'),css=read('src/components/TyphoonNetworkSimulator.css');
const data=read('src/utils/TyphoonNetworkData.ts');let tests=[];
function t(name,fn){try{fn();tests.push({name,pass:true});console.log('PASS',name);}catch(e){tests.push({name,pass:false,error:String(e)});console.log('FAIL',name,e)}}
for(const f of ['src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkData.ts'])
 t('Syntax: '+f,()=>{let tree=ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.equal(tree.parseDiagnostics.length,0)});
const sandbox={exports:{},module:{exports:{}},require:()=>({getWindForceCategory:x=>Math.round(x/3),materializeForecastPath:()=>[]})};
const js=ts.transpileModule(data,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(js,sandbox);const api=sandbox.exports;
t('CMA common 6h short and 12h extended validity',()=>assert.deepEqual(Array.from(api.NETWORK_CMA_FORECAST_LEADS),[6,12,18,24,30,36,42,48,54,60,66,72,84,96,108,120]));
t('Every agency uses exactly CMA visible leads',()=>{
 const issue={simHour:84},lead=[...Array(40)].map((_,i)=>({simHour:issue.simHour+3*(i+1),vmax:20}));
 for(const agency of ['中国','美国','日本','韩国']){
  const forecast={agency,color:'#fff',fixes:lead};let v=api.networkVisibleForecastFixes(forecast,issue);
  assert.deepEqual(Array.from(v,p=>p.simHour-84),[6,12,18,24,30,36,42,48,54,60,66,72,84,96,108,120]);
  assert.equal(api.networkForecastSegments(issue,forecast).length,16);
 }
});
t('19:00 Beijing entry produces preceding 17:00 CMA issue',()=>{
 const start=new Date('2026-10-17T00:00:00Z');
 // 19:00 BJT is 11:00 UTC, meaning 11 simHour from midnight UTC.
 const h=api.previousCmaPublicHour(start,11,11);assert.equal(h,9);
 const utcHour=start.getTime()/3600000+h;assert.equal((utcHour+8)%24,17);
});
t('Public slot never ahead of simulated time',()=>{
 const start=new Date('2026-10-17T00:00:00Z');for(let x=0;x<400;x++){
  const cap=api.previousCmaPublicHour(start,x,x);assert(cap<=x+1e-7);assert(x-cap>=-1e-7&&x-cap<3+1e-7);
 }
});
t('32x replay with 3h steps; interruption skips to final',()=>{
 assert(page.includes('93.75'));assert(page.includes('setFrame(product.history.length-1);setPlaying(false)'));
 assert(page.includes("'pointerdown','wheel','touchstart'"));
 assert(page.includes('setFrame(0);playbackSkippedRef.current=false'));
 assert(page.includes('finishReplay();setStage(\'reference\')'));
});
t('Blue hollow icon originates from uploaded assets',()=>{
 const files=fs.readdirSync(path.join(root,'public/network-icons'));
 for(const n of ['cyclone-blue.png','reference-white.png','cyclone-weak.webp','cyclone-super.webp'])assert(files.includes(n));
 assert(page.includes('src="/network-icons/reference-white.png"'));
 assert(page.includes('/network-icons/cyclone-blue.png'));
});
t('Centroid aligned stationary strength-colored center + counterclockwise 0.5Hz',()=>{
 assert(css.includes('animation:tn-cyclone-counterclockwise 2s linear infinite'));
 assert(css.includes('to{transform:rotate(-360deg)}'));
 assert(css.includes('background:var(--tn-intensity'));
 assert(css.includes('left:50%;top:50%'));
});
t('Three providers show dynamic animated cyclone marker',()=>{
 assert(page.includes('html:cycloneHtml(fix)'));
 assert(page.includes('new BMap.Icon(cycloneAsset(p.vmax,p.category)'));
 assert(page.includes('icon:{url:cycloneAsset(fix.vmax,fix.category)'));
 assert(page.includes('image:cycloneAsset(fix.vmax,fix.category)'));
});
t('AMap: credentials, official SDK, coordinate conversion and fallback',()=>{
 assert(page.includes('https://webapi.amap.com/maps?v=2.0'));
 assert(page.includes('VITE_AMAP_JS_KEY'));
 assert(page.includes('VITE_AMAP_SERVICE_HOST'));
 assert(page.includes('toAmapPosition('));
 assert(page.includes('new AMap.Map('));
 assert(page.includes("selectProvider('amap')"));
 assert(page.includes('requestId!==switchIdRef.current'));
 assert(read('.env.example').includes('VITE_AMAP_JS_KEY='));
});
t('AMap forecasts, labels and coastline-independent wind rings',()=>{
 assert(page.includes('new A.Polyline('));assert(page.includes('new A.Polygon('));
 assert(page.includes('new A.Marker('));assert(page.includes('new A.Text('));
 assert(page.includes('shouldDrawNetworkWindRadii(fix)'));
});
t('NMC reference requests full overlay suite',()=>{
 for(const fld of ['overlayNationalBorders:true','overlayChinaProvinces:true','overlayRivers:true','chinaLandTint:true','showInfoBoxes:true','showCenterBox:true','showForecastBox:true'])assert(page.includes(fld));
 assert(page.includes('loadNmcOptionalGeography(true,true)'));
 assert(page.includes('drawNmcForecastProductCooperative('));
});
t('CMA forecast markers and guidance lines are larger/bolder',()=>{
 assert(page.includes("radius:f.agency==='中国'?8:NETWORK_DOT_RADIUS_PX"));
 assert(page.includes("weight:f.agency==='中国'?3:2"));
 assert(page.includes("fc.agency==='中国'?17:NETWORK_DOT_DIAMETER_PX"));
 assert(page.includes("forecast.agency==='中国'?3:2"));
 assert(page.includes("agency==='中国'&&[6,12,24,36,48,60,72,96,120]"));
});
t('No physics engine mutation and original agency identity lines',()=>{
 assert(!page.includes('setTyphoons('));
 assert(page.includes('networkForecastSegments(product.issue,forecast)'));
 assert(page.includes('networkForecastDotColor'));
});
t('Authentic map icon images are rendered without icon background mask',()=>{
 assert(!css.includes('.tn-reference-art{background:#fff'));
 assert(css.includes('background:transparent!important'));
});
const fail=tests.filter(x=>!x.pass);const out={round:197,passed:tests.length-fail.length,total:tests.length,failed:fail.length,tests};
fs.writeFileSync(path.join(root,'ROUND197_VALIDATION.json'),JSON.stringify(out,null,2));console.log(`R197 ${out.passed}/${out.total}`);
if(fail.length)process.exitCode=1;
