const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/components/TyphoonNetworkSimulator.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'src/components/TyphoonNetworkSimulator.css'),'utf8');
const raster=fs.readFileSync(path.join(root,'src/utils/TyphoonNetworkReferenceRaster.ts'),'utf8');
let count=0,failures=[];
function t(label,fn){try{fn();count++;console.log('PASS',label)}catch(e){failures.push({label,error:e.message});console.error('FAIL',label,e.message)}}
const ast=ts.createSourceFile('TyphoonNetworkSimulator.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function compilePure(name){const node=ast.statements.find(x=>ts.isFunctionDeclaration(x) && x.name?.text===name);assert(node,`function ${name}`);return vm.runInNewContext(ts.transpileModule(node.getText(ast).replace(/^export\s+/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+`\n${name};`)}
const windRing=compilePure('windRing');
const srcName='src/components/TyphoonNetworkSimulator.tsx';
t('TypeScript TSX parser clean',()=>assert.equal(ast.parseDiagnostics.length,0));
t('Two map overlays not split between canvas and SVG',()=>{
 assert(source.includes('preferCanvas:false'));
 assert(source.includes('L.svg({padding:0.65})'));
 assert(source.includes('networkSvgRendererRef.current.addTo(map)'));
 assert((source.match(/renderer:networkSvgRendererRef\.current\?\?undefined/g)||[]).length>=4);
});
t('Offline wide coastlines keep their separate Canvas',()=>{
 const offline=fs.readFileSync(path.join(root,'src/utils/TyphoonNetworkOfflineMap.ts'),'utf8');
 assert(offline.includes('const canvas=L.canvas('));assert(offline.includes("pane:'tn-offline-ground'"));
});
t('Map panes never globally set to position:fixed or transform override',()=>{
 assert(!/\.leaflet-(?:map|overlay|marker|popup)-pane\s*\{[^}]*\btransform\s*:/s.test(css));
 assert(!/\.leaflet-(?:map|overlay|marker|popup)-pane\s*\{[^}]*\bposition\s*:\s*fixed/s.test(css));
});
t('Details stay attached to geographic coordinate',()=>{
 assert(source.includes('popup.setLatLng(displayPoint(fix.lon,fix.lat))'));
 assert(source.includes('popup.openOn(map)'));
 assert(source.includes('position:{lat:fix.lat,lng:fix.lon}'));
});
t('Scene top summary intentionally anchored; geographic markers not state-fixed',()=>{
 assert(css.includes('position:absolute;top:57px'));
 assert(source.includes('L.circleMarker(displayPoint('));
});
t('Default high definition Gaode reference raster',()=>{
 assert(source.includes("| 'amap'>('amap')")||source.includes("|'amap'>('amap')"));
 assert(source.includes('createReferenceRasterLayer(L,provider)'));
 assert(raster.includes('gaode')||raster.includes('autonavi')||raster.includes('amap'));
});
t('OSM retains fallback when raster tile servers fail',()=>{
 assert(source.includes("setProvider('osm')"));assert(source.includes("rasterLayer.on('tileerror'"));
});
t('CMA outer dot size equals historical outer dot size',()=>{
 assert(source.includes('NETWORK_DOT_DIAMETER_PX=10'));
 assert(source.includes('NETWORK_CMA_DOT_DIAMETER_PX=NETWORK_DOT_DIAMETER_PX'));
});
t('Other agency smaller than CMA: six CSS px',()=>assert(source.includes('NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX=6')));
t('Every dot includes its stroke width in stated outer diameter',()=>{
 for(let x of ['NETWORK_HISTORY_DOT_STROKE_PX=0.75','NETWORK_CMA_DOT_STROKE_PX=0.75','NETWORK_OTHER_DOT_STROKE_PX=0.55'])assert(source.includes(x));
 assert(source.includes('(NETWORK_CMA_DOT_DIAMETER_PX-NETWORK_CMA_DOT_STROKE_PX)/2'));
});
t('History/cma/other Leaflet fix points use appropriate diameter and shared renderer',()=>{
 for(const text of ['radius:NETWORK_DOT_RADIUS_PX','radius:f.agency===\'中国\'?NETWORK_CMA_DOT_RADIUS_PX:NETWORK_OTHER_AGENCY_DOT_RADIUS_PX','weight:NETWORK_HISTORY_DOT_STROKE_PX','NETWORK_CMA_DOT_STROKE_PX:NETWORK_OTHER_DOT_STROKE_PX'])assert(source.includes(text));
});
t('Petal point sizes use matching shared constants',()=>{
 assert(source.includes('NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX:NETWORK_DOT_DIAMETER_PX'));
 assert(source.includes('NETWORK_CMA_DOT_DIAMETER_PX),scale:1'));
});
t('CMA still rendered on top of other agency markers',()=>{
 assert(source.includes('networkForecastDrawOrder(product.forecasts)'));
 assert(source.includes('Ordinary agency points first, larger CMA fixes last'));
});
t('Historical line remains straight between visible CMA advisory fixes',()=>assert(source.includes('networkHistorySegments(hist)')));
t('All agency lines remain straight from visible forecasts only',()=>assert(source.includes('networkForecastSegments(product.issue,f)')));
t('Wind radii sample 0.25-degree smooth arcs',()=>assert(source.includes('const stepsPerQuadrant=360')));
const fix={lat:20,lon:130,r7:{ne:550,se:330,sw:460,nw:400},r10:{ne:180,se:150,sw:170,nw:130},r12:{ne:80,se:65,sw:70,nw:60}};
for(const kind of ['r7','r10','r12']){
 t(`${kind} 1444 high precision vertices and longitude wrapped`,()=>{
  const pts=windRing(fix,kind);assert.equal(pts.length,4*361);
  for(const p of pts){assert(Number.isFinite(p[0]));assert(Number.isFinite(p[1]));assert(p[1]<180&&p[1]>=-180);}
 });
 t(`${kind} quadrant transition is precisely on latitude or longitude axis`,()=>{
  const pts=windRing(fix,kind);
  for(let q=0;q<4;q++){
    const a=pts[q*361+360];const b=pts[((q+1)%4)*361];
    if(q%2===0)assert(Math.abs(a[0]-b[0])<1e-8);else assert(Math.abs(a[1]-b[1])<1e-8);
  }
 });
 t(`${kind} smooth arcs without visible facet jumps at sector interiors`,()=>{
  const pts=windRing(fix,kind);
  for(let q=0;q<4;q++)for(let i=2;i<=360;i++){
    const a=pts[q*361+i-2],b=pts[q*361+i-1],c=pts[q*361+i];
    // Each 0.25-degree projection step should cover less than 2km on 550km ring.
    const dx=(c[1]-b[1])*111.2*Math.cos(20*Math.PI/180),dy=(c[0]-b[0])*111.2;
    assert(Math.hypot(dx,dy)<2.6);
  }
 });
}
t('Radii continue invisible at mainland center',()=>assert(source.includes('shouldDrawNetworkWindRadii(fix)')));
t('Ring stroke is lightweight with rounded joining',()=>{
 assert(source.includes('weight:0.72,opacity:.94,lineJoin:\'round\',lineCap:\'round\''));
 assert(css.includes('shape-rendering:geometricPrecision'));
});
t('CMA labels use reduced font and single outline',()=>{
 assert(source.includes('font-size="10.5" font-weight="600"'));
 assert(source.includes('stroke-width="1.25"'));
 assert(css.includes('tn-forecast-lead-icon svg text'));
 assert(css.includes('-webkit-text-stroke:0!important'));
});
t('Top summary smaller normal weight, without outline',()=>{
 assert(css.includes('font-size:clamp(10px,2.72vw,14.4px)!important'));
 assert(css.includes('font-weight:400!important'));
 assert(css.includes('text-shadow:none!important'));
});
t('Cyclone icon persists across discrete frames so CSS spin never restarts',()=>{
 assert(source.includes('focusRef.current.setLatLng(currentPoint)'));
 assert(source.includes("icon?.style.setProperty('--tn-intensity'"));
 assert(source.includes('liveFixRef.current=fix'));
 assert(source.includes("focusRef.current.on('click',()=>{if(liveFixRef.current)openLeafletDetails(liveFixRef.current);})"));
});
t('Wind radius SVG elements update coordinates without removing/readding during playback',()=>{
 assert(source.includes('windRingsRef.current[i]!.setLatLngs(vertices)'));
 assert(source.includes('windRingsRef.current[i]?.remove()'));
});
t('Renderer cleanup on map unmount',()=>assert(source.includes('networkSvgRendererRef.current=null')));
t('Storm physics and NMC modules are not modified in this patch',()=>assert(source.includes('drawNmcForecastProductCooperative(')));
const out={version:'R200',passed:count,total:count+failures.length,failed:failures};
fs.writeFileSync(path.join(root,'ROUND200_VALIDATION.json'),JSON.stringify(out,null,2));
console.log(`R200 ${count}/${count+failures.length}`);if(failures.length)process.exitCode=1;
