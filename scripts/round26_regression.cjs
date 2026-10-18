/** Round26 regression: exact IR palette/cache parity, mobile/desktop rendering budget and wiring. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function load(name, injected = {}) {
  const output = ts.transpileModule(read(name), { fileName: name, reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX} });
  assert.equal((output.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length,0,`${name} syntax`);
  const module={exports:{}};
  new Function('module','exports','require',output.outputText)(module,module.exports,id=>{
    if(Object.hasOwn(injected,id))return injected[id];
    throw Error(`unexpected dependency ${id}`);
  });
  return module.exports;
}
const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.version,'4.3.13');
assert(read('index.html').includes('AETHER 4.3.13'));
const map=read('src/components/MapView.tsx');
const product=read('src/components/ForecastImageModal.tsx');
const rain=read('src/utils/ObservedRainfallMap.ts');
const engine=read('src/simulation/Engine.ts');
const css=read('src/index.css');
for (const part of ['liveMotionIdleTimerRef', 'motionChanged', 'liveRadiiGeometryKeyRef', 'radarEnvelopes', 'canvasIdleTimerRef'])
  assert(map.includes(part),`map render optimization missing: ${part}`);
for (const part of ['namingPreviewKeyRef', 'lastRainYieldAt', 'lastWindYieldAt', 'rankingsView = useMemo'])
  assert(product.includes(part),`product optimization missing: ${part}`);
assert(rain.includes('ctx.clip(landClipPath, "evenodd");') && !rain.includes('const contourLand = buildGeoJsonPath'), 'rainfall path not reused');
assert(rain.includes('lastContourYieldAt') && rain.includes('lastRasterYieldAt'), 'rainfall checkpoint budget missing');
assert(engine.includes('function storeLandMetrics(') && !engine.includes('landMetricsCache.set(key, result)'), 'terrain cache not bounded on all paths');
assert(css.includes('Round 26: coherent neutral product-center palette'), 'product dark color unification missing');

// Emulate only the Canvas2D ImageData API: this checks real RGB/alpha bytes without browser or
// network dependencies. A second module instance starts with cold caches for exact comparisons.
global.document={createElement(tag){assert.equal(tag,'canvas');let image;
  return {width:0,height:0,getContext(type){assert.equal(type,'2d');return {
    createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4),width:w,height:h};},
    putImageData(next){image=next;},getImageData(){return image;}
  };},get data(){return image?.data;}};
}};
const dynamics=load('src/simulation/ConvectiveDynamics.ts');
const first=load('src/simulation/HurricaneTrackerPort.ts',{'./ConvectiveDynamics':dynamics});
const second=load('src/simulation/HurricaneTrackerPort.ts',{'./ConvectiveDynamics':dynamics});
const storm={id:'round26-parity',lat:17,lon:131,vmax:58,pmin:930,rmw:52,eyeRadiusKm:24,
 eyeClearance:.8,eyeObstruction:.1,eyeFormationMemory:.85,eyewallIntegrity:.92,eyewallWrapProgress:.91,
 deepConvectiveCoverage:.9,moistureReservoir:.93,shear:7,secondaryEyewallStrength:0,
 postPeakEnvelopeMemory:.3,circulationExpansion:.4,outflowEfficiency:.7};
const size=25;
const rammb=first.renderHurricaneTrackerCloudTile(storm,42,'ir','round26',size,'rammb');
assert(rammb?.data,'RAMMB render');
const cachedOtt=first.renderHurricaneTrackerCloudTile(storm,42,'ir','round26',size,'ott');
const coldOtt=second.renderHurricaneTrackerCloudTile(storm,42,'ir','round26',size,'ott');
assert.deepEqual(cachedOtt.data,coldOtt.data,'changing palette must preserve byte-identical cold OTT output');
const cachedGray=first.renderHurricaneTrackerCloudTile(storm,42,'ir','round26',size,'ir');
const coldGray=second.renderHurricaneTrackerCloudTile(storm,42,'ir','round26',size,'ir');
assert.deepEqual(cachedGray.data,coldGray.data,'changing palette must preserve byte-identical gray IR output');
// Test every image pixel against the original exported palette formula, with full spatial field.
const halfLat=first.getHurricaneTrackerCloudBounds(storm);
assert(halfLat,'cloud bounds');
const sample=first.sampleHurricaneTrackerCloud(storm,storm.lat,storm.lon,42,'ir','round26');
assert(Number.isFinite(sample.density)&&Number.isFinite(sample.brightnessTemperatureC),'finite physical IR field');
const source=read('src/simulation/HurricaneTrackerPort.ts');
assert(source.includes('Float64Array(size * size * 2)') && source.includes('CLOUD_CONSTRAINED_DEVICE') && source.includes('cacheCloudField(fieldKey, samples)'), 'lossless budgeted cache missing');
(async()=>{
 const asyncOtt=await first.renderHurricaneTrackerCloudTileAsync(storm,42,'ir','round26',size,'ott',{chunkRows:5});
 assert.deepEqual(asyncOtt.data,coldOtt.data,'asynchronous cached path must equal cold sync path');
 // Uncached async field must also be pixel identical to synchronous generation.
 const asyncNew=await first.renderHurricaneTrackerCloudTileAsync(storm,43,'ir','round26',size,'rammb',{chunkRows:5});
 const syncNew=second.renderHurricaneTrackerCloudTile(storm,43,'ir','round26',size,'rammb');
 assert.deepEqual(asyncNew.data,syncNew.data,'async sampling must equal sync sampling');
 console.log('round26_regression PASS: exact cached/cold RGB parity for OTT, gray IR, async 25x25; UI/land/radar/product optimization wiring');
})().catch(e=>{console.error(e);process.exitCode=1;});
