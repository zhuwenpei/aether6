/* Round195 targeted checks: remove the bottom Leaflet attribution panel/mask while
 * keeping OSM copyright visible and map-anchored dot detail popups intact. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');
const comp=fs.readFileSync(path.join(root,'src/components/TyphoonNetworkSimulator.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'src/components/TyphoonNetworkSimulator.css'),'utf8');
const source=ts.createSourceFile('TyphoonNetworkSimulator.tsx',comp,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let passed=0,failed=0;const results=[];
const check=(name,fn)=>{try{fn();console.log('PASS',name);results.push({name,status:'PASS'});passed++}catch(e){console.error('FAIL',name,e.message);results.push({name,status:'FAIL',reason:e.message});failed++}};
check('valid TSX syntax',()=>assert.equal(source.parseDiagnostics.length,0));
check('Leaflet default footer attribution control is disabled for this map',()=>assert.match(comp,/L\.map\(rootMapRef\.current,\{zoomControl:false,attributionControl:false/));
check('OSM tile source is still the official attribution source',()=>assert.match(comp,/attribution:'© OpenStreetMap contributors'/));
check('a visible OSM copyright link is rendered on the OSM map',()=>{
  assert.match(comp,/provider==='osm'&&<a className=/);
  assert.match(comp,/https:\/\/www\.openstreetmap\.org\/copyright/);
  assert.match(comp,/© OpenStreetMap contributors<\/a>/);
});
check('attribution link is independent of Leaflet control pane and limited to map stage',()=>{
  const ticker=comp.indexOf('{stage===\'map\'&&product&&latest&&<>');
  const link=comp.indexOf('tn-osm-credit${latest.dissipated');
  const closing=comp.indexOf("{stage==='reference'&&<main",ticker);
  assert(ticker>=0 && link>ticker && closing>link);
});
check('credit has no translucent bar/blur/shadow or mask',()=>{
  assert.match(css,/#root \.tn-viewport \.tn-osm-credit\{/);
  const block=css.match(/#root \.tn-viewport \.tn-osm-credit\{([\s\S]*?)\}/)?.[1]||'';
  for(const rule of [/background:transparent!important/,/box-shadow:none!important/,/backdrop-filter:none!important/,/padding:0!important/,/border:0!important/])assert.match(block,rule);
  assert.match(block,/position:absolute!important/);
  assert.match(block,/top:143px/);
  assert(!/bottom\s*:/.test(block));
});
check('obsolete bottom-right Leaflet footer CSS overrides removed',()=>assert(!css.includes('#root .tn-map .leaflet-control-attribution')));
check('OSM credit is moved below the blue header on mobile, never at map bottom',()=>{
  assert.match(css,/tn-osm-credit\{top:117px/);
  assert.match(css,/tn-osm-credit-after-status\{top:144px/);
});
check('clickable historical and agency dot details retained',()=>{
  assert.match(comp,/marker\.on\('click',\(\)=>openLeafletDetails\(p\)\)/);
  assert.match(comp,/mark\.on\('click',\(\)=>openLeafletDetails\(point,f\.agency\)\)/);
  assert.match(comp,/popup\.openOn\(map\)/);
});
check('all four map providers and native standalone reference retained',()=>{
  for (const provider of ['osm','offline','baidu','petal'])assert(comp.includes(`selectProvider('${provider}')`));
  assert.match(comp,/stage==='reference'&&<main className="tn-reference-page"/);
});
check('three-hour jump playback still active',()=>{
  assert(comp.includes('187.5'));
  assert(comp.includes("setPlaying(false);return last"));
});
const result={round:195,passed,failed,total:passed+failed,items:results,kind:'static/AST targeted regression',fullBuildVerified:false};
fs.writeFileSync(path.join(root,'ROUND195_VALIDATION.json'),JSON.stringify(result,null,2));
console.log(`Round195: ${passed}/${passed+failed} passed`);
if(failed)process.exitCode=1;
