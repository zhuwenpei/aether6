const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/components/TyphoonNetworkSimulator.tsx'),'utf8');
const old=fs.readFileSync(path.join(root,'ROUND202_NETWORK_MAP_GLYPH_ALIGNMENT_FIX.md'),'utf8');
const ast=ts.createSourceFile('network.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let count=0, fails=[];
const test=(label,fn)=>{try{fn();count++;console.log('PASS',label);}catch(e){fails.push({label,error:String(e.message)});console.error('FAIL',label,e.message);}};
function pure(name,L={}){
 const decl=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
 assert(decl,`Missing ${name}`);
 const js=ts.transpileModule(decl.getText(ast).replace(/^export\s+/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return vm.runInNewContext(`${js}\n${name};`,{L,Math});
}
test('R203 TypeScript/TSX parses cleanly',()=>assert.equal(ast.parseDiagnostics.length,0));
test('Clicked Leaflet popup explicitly disables camera autoPan',()=>{
 assert.match(source,/L\.popup\(\{[^}]*autoPan:false/s);
 assert.match(source,/popup\.setLatLng\(displayPoint\(fix\.lon,fix\.lat\)\)/);
});
test('Completing 32x replay on user interruption never calls panTo/setCenter',()=>{
 const body=source.slice(source.indexOf('const finishReplay=()=>{'),source.indexOf('const finishReplayRef='));
 assert(!body.includes('.panTo(')&&!body.includes('.setCenter(')&&!body.includes('.flyTo('));
 assert(body.includes('setFrame(product.history.length-1)'));assert(body.includes('setPlaying(false)'));
});
test('Tap listeners and all marker details use camera-preserving interruption',()=>{
 assert(source.includes('const skip=()=>finishReplayRef.current()'));
 assert(source.includes('finishReplay();\n    map.closePopup()'));
 assert(source.includes("mark.on('click',()=>openLeafletDetails(point,f.agency))"));
 assert(source.includes("marker.on('click',()=>openLeafletDetails(p))"));
});
test('Petal popup disables automatic map pan when supported by SDK',()=>assert(source.includes('disableAutoPan:true')));
test('Three CSS-pixel dot diameters unchanged from R200',()=>{
 for(const str of ['NETWORK_DOT_DIAMETER_PX=10','NETWORK_CMA_DOT_DIAMETER_PX=NETWORK_DOT_DIAMETER_PX','NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX=6'])assert(source.includes(str));
});
test('Fine outlines are visually subordinate to fill and semi-transparent',()=>{
 for(const str of ['NETWORK_HISTORY_DOT_STROKE_PX=0.36','NETWORK_CMA_DOT_STROKE_PX=0.36','NETWORK_OTHER_DOT_STROKE_PX=0.30'])assert(source.includes(str));
 assert(source.includes('NETWORK_DOT_OUTLINE_OPACITY=0.28')); assert(source.includes('opacity:NETWORK_DOT_OUTLINE_OPACITY'));
 assert(source.includes('stroke-opacity="${NETWORK_DOT_OUTLINE_OPACITY}"'));
});
test('History, CMA and other agencies all enable stroke at corresponding widths',()=>{
 for(const str of ['weight:NETWORK_HISTORY_DOT_STROKE_PX','weight:f.agency===\'中国\'?NETWORK_CMA_DOT_STROKE_PX:NETWORK_OTHER_DOT_STROKE_PX','stroke:true,color:NETWORK_DOT_OUTLINE_COLOR'])assert(source.includes(str));
});
test('Wind rings avoid Leaflet one-CSS-pixel rounding',()=>{
 assert(source.includes('map.project(ll,map.getZoom()).subtract(map.getPixelOrigin())'));
 assert(!source.includes('map.latLngToLayerPoint(ll)'));
 assert(source.includes('smoothWindPolygon(map,vertices'));
});
test('Wind ring SVG remains static and reprojects on zoom without rebuilding',()=>{
 assert(source.includes('windRingsRef.current[i]!.setLatLngs(vertices)'));
 assert(source.includes('smoothFactor:0'));
 assert(source.includes("lineJoin:'round'"));
});
const fakeL={LatLng:class LatLng {constructor(lat,lng){this.lat=lat;this.lng=lng;}},polygon:(vertices,options)=>({vertices,options})};
const fakeMap={getZoom:()=>9,getPixelOrigin:()=>({x:7654,y:1687}),project:(point)=>({x:10000+point.lng*2.341,y:2000-point.lat*2.317,subtract(o){return {x:this.x-o.x,y:this.y-o.y}}})};
const smoothWindPolygon=pure('smoothWindPolygon',fakeL);
test('Polygon projector retains subpixel precision in real generated coordinates',()=>{
 const verts=[new fakeL.LatLng(21.551,130.342),new fakeL.LatLng(21.558,130.348)];
 const poly=smoothWindPolygon(fakeMap,verts,{color:'#0b0'});const rings=[],bounds={extend(){}};
 poly._projectLatlngs(verts,rings,bounds);
 assert.equal(rings.length,1);assert.equal(rings[0].length,2);
 const p=rings[0][0];assert(Math.abs(p.x-Math.round(p.x))>.01);assert(Math.abs(p.y-Math.round(p.y))>.01);
});
test('Subpixel projector recursively handles nested polygon rings',()=>{
 const poly=smoothWindPolygon(fakeMap,[],{});const rings=[],bounds={extend(){}};
 const a=new fakeL.LatLng(21.25,131.1),b=new fakeL.LatLng(21.36,131.2);
 poly._projectLatlngs([[a,b],[b,a]],rings,bounds);
 assert.equal(rings.length,2);assert.equal(rings[0].length,2);
});
const windRing=pure('windRing');
const fix={lat:23.4,lon:130.2,r7:{ne:500,se:340,sw:280,nw:460},r10:{ne:150,se:100,sw:95,nw:120},r12:{ne:70,se:55,sw:52,nw:62}};
for(const f of ['r7','r10','r12'])test(`${f} raw quadrant values remain unchanged and full ring continuous`,()=>{
 const points=windRing(fix,f);assert.equal(points.length,1444);
 for(const p of points){assert(Number.isFinite(p[0])&&Number.isFinite(p[1]));}
 for(let i=0;i<4;i++){
  const a=points[i*361+360], b=points[((i+1)%4)*361];
  if(i%2===0)assert(Math.abs(a[0]-b[0])<1e-8);else assert(Math.abs(a[1]-b[1])<1e-8);
 }
});
test('Physics and non-network forecast modules are not changed',()=>{
 const original=fs.readFileSync('/mnt/data/aether_r202_work/src/simulation/Engine.ts');
 const current=fs.readFileSync(path.join(root,'src/simulation/Engine.ts'));
 assert(original.equals(current));
 assert(old.includes('R202'));
});
const out={version:'R203',passed:count,total:count+fails.length,failed:fails};
fs.writeFileSync(path.join(root,'ROUND203_VALIDATION.json'),JSON.stringify(out,null,2));
console.log(`R203: ${count}/${count+fails.length}`);
if(fails.length)process.exitCode=1;
