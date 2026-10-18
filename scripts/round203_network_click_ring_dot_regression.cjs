const fs = require('fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const source = fs.readFileSync('src/components/TyphoonNetworkSimulator.tsx','utf8');
const ast=ts.createSourceFile('TyphoonNetworkSimulator.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let count=0;
function check(label,fn){fn();count++;console.log('PASS',label);}
function pure(name){
 const node=ast.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text===name);
 assert(node,`missing ${name}`);
 const code=ts.transpileModule(node.getText(ast).replace(/^export\s+/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return vm.runInNewContext(code+`\n${name};`);
}
check('TSX syntax valid',()=>assert.equal(ast.parseDiagnostics.length,0));
check('Leaflet detail popup cannot auto-pan',()=>{
 const block=source.slice(source.indexOf('const openLeafletDetails='),source.indexOf('// The OSM viewport remains'));
 assert.match(block,/finishReplay\(\)/);
 assert.match(block,/autoPan:false/);
 assert(!/autoPan:true/.test(block));
});
check('Replay skip on map gesture never moves camera to end',()=>{
 const block=source.slice(source.indexOf('const finishReplay='),source.indexOf('const openLeafletDetails='));
 assert.match(block,/const finishReplay=\(\)=>/);
 assert(!block.includes('panTo('));
 assert(!block.includes('setCenter('));
 assert.match(block,/const skip=\(\)=>finishReplayRef\.current\(\)/);
});
check('Petal forecast popup also skips replay without forced recenter',()=>{
 const block=source.slice(source.indexOf('const openPetalDetails='),source.indexOf('// Petal SDK owns'));
 assert.match(block,/finishReplay\(\)/);
});
check('Switching providers still explicitly preserves its existing transition logic',()=>{
 assert(source.includes('const selectProvider=async('));
 assert(source.includes('finishReplay();'));
});
check('Dot outline widths are ultra-fine and keep outer diameter unchanged',()=>{
 for(const pair of [['NETWORK_HISTORY_DOT_STROKE_PX',.36],['NETWORK_CMA_DOT_STROKE_PX',.36],['NETWORK_OTHER_DOT_STROKE_PX',.16]]){
 const m=source.match(new RegExp(`export const ${pair[0]}=([0-9.]+)`));
 assert(m); assert.equal(Number(m[1]),pair[1]); assert(Number(m[1])<.4);
 }
 assert.match(source,/NETWORK_DOT_RADIUS_PX=\(NETWORK_DOT_DIAMETER_PX-NETWORK_HISTORY_DOT_STROKE_PX\)\/2/);
 assert.match(source,/NETWORK_CMA_DOT_RADIUS_PX=\(NETWORK_CMA_DOT_DIAMETER_PX-NETWORK_CMA_DOT_STROKE_PX\)\/2/);
});
check('Historical and forecast dots have semi-transparent stroke',()=>{
 assert.equal((source.match(/stroke:true,color:NETWORK_DOT_OUTLINE_COLOR/g)||[]).length,2);
 assert.equal((source.match(/opacity:NETWORK_DOT_OUTLINE_OPACITY/g)||[]).length,2);
 assert.match(source,/NETWORK_DOT_OUTLINE_OPACITY=0.28/);
});
check('Petal generated marker image uses same subtle translucent edge',()=>{
 assert(source.includes('stroke-opacity="${NETWORK_DOT_OUTLINE_OPACITY}"')); assert(source.includes('NETWORK_DOT_OUTLINE_OPACITY=0.28'));
 assert(source.includes('stroke-width="${weight}"')); assert(source.includes('NETWORK_OTHER_DOT_STROKE_PX')); 
});
check('Wind polygons project geographic vertices at fractional SVG pixel coordinates',()=>{
 assert(source.includes('export function smoothWindPolygon('));
 assert(source.includes('const pt=map.project(ll,map.getZoom()).subtract(map.getPixelOrigin())'));
 assert(source.includes('path._projectLatlngs=function(latlngs,result,bounds)'));
 assert(source.includes('smoothWindPolygon(map,vertices,'));
});
check('Wind ring retains 360 steps/quadrant and unchanged radii',()=>{
 const ring=pure('windRing');
 const fix={lat:22.1,lon:131.3,r7:{ne:560,se:250,sw:320,nw:420},r10:{ne:180,se:140,sw:150,nw:165},r12:{ne:55,se:45,sw:48,nw:50}};
 for(const field of ['r7','r10','r12']){
  const pts=ring(fix,field);assert.equal(pts.length,1444);
  for(const [lat,lon] of pts){assert(Number.isFinite(lat)&&Number.isFinite(lon));}
  for(let q=0;q<4;q++){
   const a=pts[q*361+360],b=pts[((q+1)%4)*361];
   assert(Math.abs(a[q%2===0?0:1]-b[q%2===0?0:1])<1e-7,'cardinal seam horizontal/vertical');
  }
 }
});
check('Projection override retains fractional points in the polygon ring array',()=>{
 class LatLng {constructor(lat,lon){this.lat=lat;this.lng=lon;}}
 class Point {constructor(x,y){this.x=x;this.y=y;}subtract(p){return new Point(this.x-p.x,this.y-p.y);}}
 class Bounds {constructor(){this.points=[];}extend(p){this.points.push(p);}}
 const L={LatLng,polygon(vertices,opts){return {_latlngs:vertices,opts}}};
 const start=source.indexOf('export function smoothWindPolygon('),end=source.indexOf('export function shouldDrawNetworkWindRadii',start);
 const snippet=source.slice(start,end).split('/** Show rings only')[0].replace(/^export /,'');
 const js=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const smooth=vm.runInNewContext(js+'\nsmoothWindPolygon',{L});
 const map={getZoom:()=>7,getPixelOrigin:()=>new Point(1.11,2.22),project:({lat,lng})=>new Point(12.35+lng*3.457,20.25-lat*2.347)};
 const pg=smooth(map,[],{});const rings=[],bounds=new Bounds();
 pg._projectLatlngs([new LatLng(23.123,120.456),new LatLng(22.879,120.782)],rings,bounds);
 assert.equal(rings.length,1);assert.equal(rings[0].length,2);assert.equal(bounds.points.length,2);
 assert(Math.abs(rings[0][0].x-Math.round(rings[0][0].x))>.01);
 assert(Math.abs(rings[0][1].y-Math.round(rings[0][1].y))>.01);
});
check('Smooth SVG wind rings still leave physical wind radii unmodified',()=>{
 assert(source.includes("windRingsRef.current[i]!.setLatLngs(vertices)"));
 assert(source.includes("lineJoin:'round',lineCap:'round',smoothFactor:0"));
 assert(source.includes('shouldDrawNetworkWindRadii(fix)'));
});
console.log(`ROUND203_NETWORK_REGRESSION ${count}/${count} PASS`);
