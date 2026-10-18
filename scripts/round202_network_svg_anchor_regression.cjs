const fs=require('fs'), assert=require('assert'), ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const page=fs.readFileSync('src/components/TyphoonNetworkSimulator.tsx','utf8');
const css=fs.readFileSync('src/components/TyphoonNetworkSimulator.css','utf8');
const checks=[];
function test(label,fn){fn();checks.push(label);console.log('PASS',label);}
const patch=page.slice(page.indexOf('type NetworkSvgGlyph ='),page.indexOf('async function loadPetalMapsApi('));
test('SVG geographic helper exists and references same map renderer',()=>assert(patch.includes('const anchor=L.circleMarker(at,{renderer')));
test('Leaflet center icon is no longer an independent divIcon DOM marker',()=>{
  assert(page.includes('focusRef.current=geographicCyclone(map,currentPoint,networkSvgRendererRef.current!,fix)'));
  assert(!page.includes("className:'tn-cyclone-icon',html:cycloneHtml"));
});
test('Lead labels use SVG geographic anchors, no DOM marker icon',()=>{
  assert(page.includes('geographicLead(map,displayPoint(point.lon,point.lat),networkSvgRendererRef.current!,lead,force)'));
  assert(!page.includes("className:'tn-label-pin tn-forecast-lead-icon',html:networkLeadLabelSvg"));
});
test('SVG glyphs get repositioned by renderer updates on zoom and pan',()=>{
  assert(patch.includes('anchor._updatePath=()=>{'));
  assert(patch.includes('make(pos,anchor._networkGlyph)'));
  assert(patch.includes("anchor.on('remove',()=>{anchor._networkGlyph?.remove()"));
});
test('Animation survives map reposition and uses same SVG coordinate space',()=>{
  assert(css.includes('.tn-geo-cyclone-spin'));
  assert(css.includes('animation:tn-cyclone-counterclockwise 2s linear infinite'));
  assert(patch.includes('image.setAttribute(\'x\',String(point.x-NETWORK_CYCLONE_SIZE_PX/2))'));
  assert(patch.includes("eye.setAttribute('cx',String(point.x))"));
});
test('History/CMA/other forecast points do not have outlines',()=>{
  assert(page.includes('export const NETWORK_HISTORY_DOT_STROKE_PX=0;'));
  assert(page.includes('export const NETWORK_CMA_DOT_STROKE_PX=0;'));
  assert(page.includes('export const NETWORK_OTHER_DOT_STROKE_PX=0;'));
  assert((page.match(/stroke:false,weight:0/g)||[]).length>=2);
});
test('Petal marker image has no white stroke',()=>assert(page.includes('fill="${safe}" stroke="none" stroke-width="0"')));
test('Transparent SVG glyph overlay does not use HTML glass backgrounds',()=>{
  assert(css.includes('.tn-geo-glyph'));
  assert(css.includes('background:none!important'));
});
test('TSX syntax compiles without parser errors',()=>{
 const diagnostics=ts.transpileModule(page,{fileName:'TyphoonNetworkSimulator.tsx',reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).diagnostics||[];
 assert.equal(diagnostics.length,0,diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join(';'));
});
console.log(`R202 SVG anchor suite: ${checks.length}/${checks.length} PASS`);
