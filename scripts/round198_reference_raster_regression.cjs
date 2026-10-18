const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'src/components/TyphoonNetworkSimulator.tsx'),'utf8');
const modulePath=path.join(root,'src/utils/TyphoonNetworkReferenceRaster.ts');
const code=fs.readFileSync(modulePath,'utf8');
const transpiled=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context={exports:{},require:(id)=>{throw new Error('Unexpected runtime import '+id)},console};
vm.runInNewContext(transpiled,context);
const mod=context.exports;
const sourceRef=fs.readFileSync(path.join(root,'validation/round198_reference_webtoapp_source.txt'),'utf8');
let count=0;
const ok=(description,fn)=>{try{fn();count++;console.log('PASS',description)}catch(e){console.error('FAIL',description,e.stack);process.exitCode=1;}};
const exists=(text)=>assert.ok(src.includes(text),text);
ok('reference style uses identical four official Gaode host numbers',()=>{
  assert.match(sourceRef,/webrd01\.is\.autonavi\.com/);
  for(let i=1;i<=4;i++)assert.ok(sourceRef.includes('webrd0'+i+'.is.autonavi.com'));
});
ok('URL matches style 8 scale 1 raster of source',()=>{
  const template=mod.REFERENCE_RASTER_TILE_URL;
  assert.ok(template.startsWith('https://webrd0{s}.is.autonavi.com/appmaptile?'));
  for(const p of ['lang=zh_cn','size=1','scale=1','style=8','x={x}','y={y}','z={z}'])assert.ok(template.includes(p));
});
ok('source alias truly refers to GaoDe rather than Baidu servers',()=>{
  assert.ok(!/bdimg|map\.baidu/.test(mod.REFERENCE_RASTER_TILE_URL));
  assert.match(mod.REFERENCE_RASTER_CREDIT,/高德/);
});
ok('raster provider guard',()=>{
  assert.equal(mod.isReferenceRasterProvider('baidu'),true);
  assert.equal(mod.isReferenceRasterProvider('amap'),true);
  for(const x of ['petal','osm','offline','other'])assert.equal(mod.isReferenceRasterProvider(x),false);
});
ok('both names create a Leaflet raster layer with four subdomains',()=>{
  for(const prov of ['amap','baidu']){
    let seen;
    const leaflet={tileLayer:(url,options)=>{seen={url,options};return seen}};
    const result=mod.createReferenceRasterLayer(leaflet,prov);
    assert.equal(result.url,mod.REFERENCE_RASTER_TILE_URL);
    assert.equal(Array.from(result.options.subdomains).join(','),'1,2,3,4');
    assert.equal(result.options.tileSize,256);
    assert.ok(!result.options.crossOrigin); // crossOrigin needs CORS headers some tile hosts do not send.
  }
});
ok('identity geo display for OSM, Petal and offline',()=>{
  for(const prov of ['osm','offline','petal']){
    const p=Array.from(mod.referenceBasemapLocation(prov,120,30,()=>[120.01,30.01]));
    assert.deepEqual(p,[30,120]);
  }
});
ok('GaoDe tile coordinate conversion Mainland both provider slots',()=>{
  for(const prov of ['baidu','amap']){
    const p=Array.from(mod.referenceBasemapLocation(prov,120,30,()=>[120.01,30.02]));
    assert.deepEqual(p,[30.02,120.01]);
  }
});
ok('R198 map imports the raster utility',()=>exists('createReferenceRasterLayer'));
ok('both map slots use Leaflet, not SDK containers',()=>exists("provider==='osm'||provider==='offline'||isReferenceRasterProvider(provider)"));
ok('raster source replaces tile layer without changing state',()=>{exists('const rasterLayer=createReferenceRasterLayer(L,provider)');exists('rasterLayer.addTo(map)')});
ok('provider switch does not require a JS key',()=>{
  assert.doesNotMatch(src,/VITE_AMAP_JS_KEY|VITE_BAIDU_MAP_AK/);
  assert.doesNotMatch(src,/webapi\.amap\.com\/maps|api\.map\.baidu\.com\/api/);
});
ok('switch to tile modes is synchronous and does not call SDK',()=>{
  const p=src.slice(src.indexOf('const selectProvider='),src.indexOf('const openPetalDetails='));
  assert.match(p,/isReferenceRasterProvider\(next\)/);
  assert.doesNotMatch(p,/loadBaiduApi|loadAmapApi/);
});
ok('Map draw always converts live center',()=>exists('L.marker(displayPoint(fix.lon,fix.lat)'));
ok('map click popup stays anchored to displayed dot',()=>exists('popup.setLatLng(displayPoint(fix.lon,fix.lat))'));
ok('historical positions convert before drawing',()=>exists('L.circleMarker(displayPoint(p.lon,p.lat)'));
ok('agency dots convert and retain intensity colors',()=>exists('L.circleMarker(displayPoint(point.lon,point.lat)'));
ok('CMA labels convert and retain lead text',()=>exists('L.marker(displayPoint(point.lon,point.lat)'));
ok('polygon vertices convert for raster coast offsets',()=>exists('windRing(fix,field).map(([lat,lon])=>displayPoint(lon,lat))'));
ok('32x replay center converts and remains instant',()=>exists('map.panTo(displayPoint(fix.lon,fix.lat),{animate:false})'));
ok('tile failures fall back to OSM',()=>{exists("rasterLayer.on('tileerror'"); exists("setProvider('osm')")});
ok('Petal standalone SDK is still available',()=>exists('loadPetalMapsApi'));
ok('OSM keeps its dedicated tile URL',()=>exists('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'));
ok('reference map entry uses accurate provider disclosure',()=>exists('参考程序“百度”图源（实际高德）'));
ok('raster copyright is not misattributed to Baidu',()=>exists('REFERENCE_RASTER_CREDIT'));
ok('legacy non-working sdk references removed',()=>assert.doesNotMatch(src,/baiduMapRef|amapMapRef|baiduReady|amapReady|openBaiduDetails|openAmapDetails/));
ok('only map files changed; simulation sources remain read-only',()=>assert.doesNotMatch(src,/(?:storm\.history|storm\.config)\s*=/));
console.log('R198',count,'/26',process.exitCode?'FAIL':'PASS');
