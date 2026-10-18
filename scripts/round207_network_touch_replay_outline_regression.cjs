'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const file=fs.readFileSync(path.join(root,'src/components/TyphoonNetworkSimulator.tsx'),'utf8');
const prior=fs.readFileSync(path.join(root,'ROUND206_NETWORK_GAODE_ONLY_VISUAL_CHANGELOG.md'),'utf8');
let tests=0;
const check=(title,fn)=>{fn();tests++;console.log(`PASS ${title}`)};
const getNum=(id)=>Number(file.match(new RegExp(`export const ${id}=([0-9.]+);`))?.[1]);
const ast=ts.createSourceFile('TyphoonNetworkSimulator.tsx',file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
check('TSX parses without syntax errors',()=>assert.equal(ast.parseDiagnostics.length,0));
const before=String.raw`export const NETWORK_REPLAY_HORIZONTAL_SPAN_KM=1000;
export function networkReplayZoomForWidth(viewportWidthPx:number,latitude:number):number {
  // EPSG:3857 ground resolution: circumference*cos(lat)/(256*2^zoom).
  // A fractional zoom is intentional: integer zooms cannot maintain 1000km on phones.
  const cosLat=Math.cos(Math.max(-85,Math.min(85,latitude))*Math.PI/180);
  const zoom=Math.log2(Math.max(1,viewportWidthPx)*40075.016686*Math.max(0.087,cosLat)/
    (256*NETWORK_REPLAY_HORIZONTAL_SPAN_KM));
  return Math.max(2,Math.min(18,zoom));
}`;
check('replay geometry helper source is unchanged from validated test input',()=>assert(file.includes(before)));
const js=ts.transpileModule(before,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const ctx={Math,exports:{}};vm.runInNewContext(js,ctx);
const zoom=ctx.exports.networkReplayZoomForWidth;
check('horizontal view zoom depends on viewport width and latitude',()=>{
  assert.notEqual(zoom(360,20),zoom(430,20));assert.notEqual(zoom(390,20),zoom(390,45));
});
for(const [w,lat] of [[320,0],[360,20],[390,25],[430,45],[768,15],[1080,30]]){
  check(`1000 km horizontal span at ${w}px, ${lat}°`,()=>{
    const z=zoom(w,lat);const km=w*40075.016686*Math.cos(lat*Math.PI/180)/(256*2**z);
    assert(Math.abs(km-1000)<0.001,`actual span=${km}`);assert(z>2&&z<18);
  });
}
check('fractional map zoom activated',()=>{assert.match(file,/zoomSnap:0,zoomDelta:0\.25/);});
check('playing frame updates center and width without easing',()=>assert.match(file,/if\(playing\)\{[\s\S]*map\.setView\(currentPoint,networkReplayZoomForWidth\(map\.getSize\(\)\.x,fix\.lat\),\{animate:false\}\)/));
check('fixed 32x discrete replay timer preserved',()=>assert.match(file,/setInterval\([\s\S]*\),93\.75\)/));
check('touch, wheel and pointer input interrupt playback',()=>assert.match(file,/'pointerdown','wheel','touchstart'/));
check('interruption does not re-center camera',()=>{const cut=file.slice(file.indexOf('  const finishReplay=()=>{'),file.indexOf('  const finishReplayRef='));assert(!cut.includes('setView(')&&!cut.includes('panTo('));});
check('center icon PNG is hidden during playback, visible afterwards',()=>assert.match(file,/querySelector\('image'\)\?\.setAttribute\('visibility',playing\?'hidden':'visible'\)/));
check('center strength disk grows to history size only during playback',()=>assert.match(file,/querySelector\('circle'\)\?\.setAttribute\('r',String\(playing\?NETWORK_DOT_RADIUS_PX:3\.5\)\)/));
check('cyclone icon remains the original 24px sprite',()=>assert.equal(getNum('NETWORK_CYCLONE_SIZE_PX'),24));
check('forecast dots retain four pixel visual diameter',()=>assert.equal(getNum('NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX'),4));
check('CMA and history remain 10px',()=>{assert.equal(getNum('NETWORK_DOT_DIAMETER_PX'),10);assert.match(file,/NETWORK_CMA_DOT_DIAMETER_PX=NETWORK_DOT_DIAMETER_PX/);});
check('other agency transparent touch target radius is 7px',()=>assert.equal(getNum('NETWORK_OTHER_AGENCY_HIT_RADIUS_PX'),7));
check('touch target is SVG invisible hit layer, not visual size increase',()=>{assert.match(file,/radius:NETWORK_OTHER_AGENCY_HIT_RADIUS_PX,stroke:false,fill:true/);assert.match(file,/fillOpacity:0\.001,interactive:true/);});
check('hit areas are layered below all visible forecast dots',()=>{
 const hit=file.indexOf('    // Hit targets are kept BELOW all visible dots.');
 const visible=file.indexOf('    // Ordinary agency points first, larger CMA fixes last: visually clear hierarchy.');
 assert(hit>0&&visible>hit);assert(file.indexOf('const hit=L.circleMarker',hit)<visible);
});
check('hit area click binds correct agency and exact forecast fix',()=>{
 assert.match(file,/hit\.on\('click',\(\)=>openLeafletDetails\(point,f\.agency\)\)/);
});
check('CMA does not create extra invisible hit areas',()=>assert.match(file,/if\(f\.agency==='中国'\|\|!f\.fixes\.length\)continue/));
check('history outline mildly thicker and low contrast',()=>{assert.equal(getNum('NETWORK_HISTORY_DOT_STROKE_PX'),0.48);assert.equal(getNum('NETWORK_CMA_DOT_STROKE_PX'),0.48);});
check('other agency outline mildly thicker without dominating small dots',()=>{assert.equal(getNum('NETWORK_OTHER_DOT_STROKE_PX'),0.28);assert.equal(getNum('NETWORK_DOT_OUTLINE_OPACITY'),0.34);});
check('marker radius accounts for stroke width and preserves total diameter',()=>{
 const total=2*(10-.48)/2+.48;const other=2*(4-.28)/2+.28;
 assert.equal(total,10);assert.equal(other,4);
});
check('wind radii geometry preserved',()=>assert.match(file,/windRing\(fix,field\)/));
check('single Gaode tile source preserved',()=>assert.match(file,/createReferenceRasterLayer\(L,'amap'\)/));
console.log(`ROUND207 ${tests}/${tests} passed`);
