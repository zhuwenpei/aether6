'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
let passed=0;function test(name,fn){return Promise.resolve().then(fn).then(()=>{passed++;console.log('PASS',name);});}
function modGeo(mock){
 const code=ts.transpileModule(read('src/utils/NmcOptionalGeography.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};
 const g={fetch:mock,AbortController,Date,setTimeout,clearTimeout,console,URL};
 new Function(...Object.keys(g),'module','exports',code)(...Object.values(g),m,m.exports);return m.exports;
}
const pt=(name)=>({type:'Feature',geometry:{type:'Polygon',coordinates:[[[115,35],[116,35],[116,36],[115,35]]]},properties:{'地名':name,name}});
const prov={type:'FeatureCollection',features:[pt('北京'),pt('上海')]};
const river=JSON.parse(read('public/data/nmc_rivers.geojson'));
const response=(data)=>({ok:true,headers:{get:()=> 'application/geo+json'},text:async()=>JSON.stringify(data)});
(async()=>{
 await test('R205 其他机构直径恰为 CMA 的 25%',()=>{
  const s=read('src/components/TyphoonNetworkSimulator.tsx');
  const constants={};for(const key of ['NETWORK_DOT_DIAMETER_PX','NETWORK_CMA_DOT_DIAMETER_PX','NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX','NETWORK_OTHER_DOT_STROKE_PX']){
   const m=s.match(new RegExp(`export const ${key}=([^;]+);`));assert(m,key);constants[key]=m[1];
  }
  const values=new Function(`const NETWORK_DOT_DIAMETER_PX=${constants.NETWORK_DOT_DIAMETER_PX};const NETWORK_CMA_DOT_DIAMETER_PX=${constants.NETWORK_CMA_DOT_DIAMETER_PX};return [NETWORK_CMA_DOT_DIAMETER_PX,${constants.NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX},${constants.NETWORK_OTHER_DOT_STROKE_PX}];`)();
  assert.equal(values[0],10);assert.equal(values[1],2.5);assert(values[2]<0.2);
  assert(s.includes("f.agency==='中国'?NETWORK_CMA_DOT_RADIUS_PX:NETWORK_OTHER_AGENCY_DOT_RADIUS_PX"));
 });
 await test('R205 原始河流离线 GeoJSON 完整可解析并保持线型',()=>{
  assert.equal(river.type,'FeatureCollection');assert(river.features.length>4000);
  assert(river.features.every(f=>f.geometry.type==='LineString'||f.geometry.type==='MultiLineString'));
 });
 await test('R205 省界本地优先且与水系并行加载',async()=>{
  const urls=[];const m=modGeo(async url=>{urls.push(url);return response(String(url).includes('provinces')?prov:river);});
  const data=await m.loadNmcOptionalGeography(true,true);
  assert.equal(data.provinces.features.length,2);assert(data.rivers.features.length>3500 && data.rivers.features.length<=river.features.length);
  assert.equal(urls.length,2);assert(!urls.some(u=>String(u).includes('https://cdn')));
  await m.loadNmcOptionalGeography(true,true);assert.equal(urls.length,2,'successful cache');
 });
 await test('R205 本地省界 404 后在线镜像回退并缓存',async()=>{
  const urls=[];const m=modGeo(async url=>{urls.push(String(url));return String(url).startsWith('https://')?response(prov):{ok:false,status:404};});
  const data=await m.loadNmcOptionalGeography(true,false);
  assert.equal(data.errors.length,0);assert.equal(data.provinces.features.length,2);
  assert.equal(urls.length,2);assert(urls[1].includes('cn-atlas'));
 });
 await test('R205 省界两级源失败仍不影响离线水系',async()=>{
  const m=modGeo(async url=>String(url).includes('nmc_rivers')?response(river):{ok:false,status:404});
  const data=await m.loadNmcOptionalGeography(true,true);
  assert.equal(data.provinces,null);assert(data.rivers.features.length>3500 && data.rivers.features.length<=river.features.length);
  assert.match(data.errors.join(''),/省界/);
 });
 await test('R205 水系独立绘制时间，不受底图6s计时影响',()=>{
  const s=read('src/utils/NmcForecastProduct.ts');
  assert(s.includes("if (o.overlayRivers && o.riversGeoJson?.features)"));
  assert(s.includes("detailLayerAllowed(detailStarted,'水系')"));
  assert(s.includes("detailLayerAllowed(detailStarted,'省界')"));
  assert(s.includes('detailLayerBudgetMs=2350'));
 });
 await test('R205 不注入虚构省界；构建时仅下载校验合法数据',()=>{
  const build=read('scripts/prepare_nmc_provinces.mjs');
  assert(build.includes("v.features.length>=25"));
  assert(build.includes('!installed'));assert(build.includes('process.exit(0)'));
  assert.equal(JSON.parse(read('package.json')).scripts.prebuild,'node scripts/prepare_nmc_provinces.mjs');
 });
 for(const f of ['src/components/TyphoonNetworkSimulator.tsx','src/utils/NmcOptionalGeography.ts','src/utils/NmcForecastProduct.ts','src/components/ForecastImageModal.tsx']){
  await test('TS/TSX syntax '+f,()=>{
   const src=ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,f.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
   assert.equal(src.parseDiagnostics.length,0,src.parseDiagnostics.map(x=>x.messageText).join('|'));
  });
 }
 console.log(`R205 ${passed}/${passed} PASS`);
 fs.writeFileSync(path.join(root,'ROUND205_TEST_RESULTS.json'),JSON.stringify({round:205,passed,total:passed},null,2));
})().catch(e=>{console.error('FAIL',e);process.exitCode=1;});
