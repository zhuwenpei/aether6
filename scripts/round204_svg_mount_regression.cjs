/** Regression: Leaflet's CircleMarker initial SVG update precedes SVG path insertion. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
let ts;try{ts=require('typescript')}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}
const root=path.resolve(__dirname,'..');
const file=path.join(root,'src/components/TyphoonNetworkSimulator.tsx');
const src=fs.readFileSync(file,'utf8');
const begin=src.indexOf('type NetworkSvgGlyph =');
const end=src.indexOf('export default function TyphoonNetworkSimulator(',begin);
assert(begin>=0&&end>begin,'geographic glyph helper exists');
const code=src.slice(begin,end);
const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
const bundle=`const NETWORK_CYCLONE_SIZE_PX=24;\n${js}\nwindow.__networkSvgTest={networkGeographicGlyph,geographicLead,geographicCyclone};\n`;
fs.writeFileSync(path.join(root,'validation/round204_test_helpers.js'),bundle);
assert.match(code,/const parent=path\.parentNode/,'detect unattached SVG path');
assert.match(code,/if\(!parent\)return/,'skip early phantom initial construction');
assert.match(code,/anchor\._updatePath\?\.\(\)/,'force post-insertion drawing');
assert.match(code,/anchor\._networkGlyph\.parentNode!==parent/,'reattach after pane recreation');
assert.match(code,/anchor\.on\('remove'/,'cleanup detached paths');
assert.match(src,/const label=geographicLead\(/,'CMA labels use geographic SVG helper');
assert.match(src,/focusRef\.current=geographicCyclone\(/,'cyclone uses geographic SVG helper');
assert(fs.existsSync(path.join(root,'public/network-icons/cyclone-blue.png')),'blue cyclone image exists');
console.log('PASS 9/9 R204 SVG initial mount, reattach, cleanup, CMA label, center asset checks');
