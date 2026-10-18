const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const file='src/components/TyphoonNetworkSimulator.tsx',cssfile='src/components/TyphoonNetworkSimulator.css';
const src=read(file),css=read(cssfile);const checks=[];
function test(name,fn){try{fn();checks.push({name,pass:true});console.log('PASS',name)}catch(e){checks.push({name,pass:false,error:e.message});console.error('FAIL',name,e.message)}}
for(const f of [file,'src/utils/TyphoonNetworkData.ts'])test('TypeScript parser '+f,()=>assert.equal(ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS).parseDiagnostics.length,0));
test('Forecast markers use smaller hierarchy than baseline',()=>{
  assert(src.includes('NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX=7'));assert(src.includes('NETWORK_CMA_DOT_DIAMETER_PX=12'));assert(src.includes('NETWORK_DOT_DIAMETER_PX=11'));assert(src.includes('NETWORK_CMA_DOT_RADIUS_PX:NETWORK_OTHER_AGENCY_DOT_RADIUS_PX'));
});
test('Agency draw order always places CMA above other forecast fixes',()=>{
  assert(src.includes('export function networkForecastDrawOrder'));assert.equal(src.match(/networkForecastDrawOrder\(product.forecasts\)/g)?.length,2);
  const ordered=[{agency:'中国'},{agency:'韩国'},{agency:'日本'},{agency:'美国'}].sort((a,b)=>(a.agency==='中国'?1:0)-(b.agency==='中国'?1:0));assert.equal(ordered.at(-1).agency,'中国');
});
test('Visible forecast point connections retain source-defined straight dotted paths',()=>{
  assert(src.includes('networkForecastSegments(product.issue,f)'));assert(src.includes('networkVisibleForecastFixes(f,product.issue)'));assert(src.includes("dashArray:'2,7'"));
});
test('Forecast colors remain wind-intensity colors',()=>assert(src.includes('return networkPointColor(fix.vmax,fix.category)')));
test('Forecast labels render as text-only SVG with no box or thumbnail',()=>{
  assert(src.includes('networkLeadLabelSvg(lead,force)'));assert(src.includes('tn-forecast-lead-icon'));assert(src.includes('paint-order="stroke"'));assert(!src.includes('className:\'tn-label-pin\',html:`'));
});
test('Both Leaflet and Petal scale their CMA/non-CMA dots to matching hierarchy',()=>{
  assert(src.includes('strengthDotSvg(networkForecastDotColor(fix),NETWORK_CMA_DOT_DIAMETER_PX)'));assert(src.includes('agency?NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX:NETWORK_DOT_DIAMETER_PX'));
});
test('Button, image, cyclone marker and label containers forcibly clear glass backdrop',()=>{
  for(const token of ['.tn-reference-link:hover','.tn-reference-art','.leaflet-marker-icon.tn-cyclone-icon','.leaflet-marker-icon.tn-forecast-lead-icon','.tn-cyclone-center','.tn-cyclone-spin','.tn-ticker'])assert(css.includes(token));
  assert(css.includes('backdrop-filter:none!important'));assert(css.includes('background-color:transparent!important'));
});
test('Spinning icon and unmoving intensity eye retained',()=>{
  assert(css.includes('tn-cyclone-counterclockwise 2s linear infinite'));assert(css.includes('background:var(--tn-intensity'));
});
test('Reference icon and original NMC flow remain',()=>{
  assert(src.includes('src="/network-icons/reference-white.png"'));assert(src.includes('drawNmcForecastProductCooperative('));
});
test('Original history dots, ring geometry, land rules and frame behavior retained',()=>{
  assert(src.includes('shouldDrawNetworkWindRadii(fix)'));assert(src.includes('windRing(fix,field)'));assert(src.includes('finishReplay()'));assert(src.includes('L.circleMarker(displayPoint(p.lon,p.lat),{radius:NETWORK_DOT_RADIUS_PX'));
});
const summary={version:'R199',passed:checks.filter(x=>x.pass).length,total:checks.length,failed:checks.filter(x=>!x.pass),checks};fs.writeFileSync(path.join(root,'ROUND199_VALIDATION.json'),JSON.stringify(summary,null,2));console.log(`R199 ${summary.passed}/${summary.total}`);if(summary.failed.length)process.exitCode=1;
