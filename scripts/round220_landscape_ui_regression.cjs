const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root = path.join(__dirname,'..');
let passed = 0;
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}
function check(name,fn){fn();console.log('PASS',name);passed++;}
const css=read('src/index.css'), net=read('src/components/TyphoonNetworkSimulator.css'), entry=read('src/components/NetworkEntrySettings.css');
const app=read('src/App.tsx'), map=read('src/components/MapView.tsx'), simulator=read('src/components/TyphoonNetworkSimulator.tsx'), standalone=read('src/utils/TyphoonNetworkStandaloneExport.ts');
check('landscape detection uses physical layout orientation and restores portrait',()=>{assert.match(app,/matchMedia\("\(orientation: landscape\)"\)/);assert.match(app,/classList\.toggle\("aether-mobile-landscape"/);assert.match(app,/classList\.remove\([^)]*"aether-mobile-landscape"/);});
check('mobile landscape uses separate side rail, no full UI scale',()=>{assert.match(app,/aether-landscape-rail/);assert.match(css,/--aether-landscape-rail-w:clamp\(158px,20vw,280px\)/);assert.match(css,/#typhoon-gis-viewport\s*\{\s*position:absolute\s*!important;/);});
check('right map is genuine resized geographic viewport',()=>{assert.match(css,/width:calc\(100% - var\(--aether-landscape-rail-w\)\)/);assert.match(map,/new ResizeObserver\(resize\)/);assert.match(map,/invalidateSize\(\{ pan: false, animate: false \}\)/);});
check('landscape rail owns status/actions/transport/boxed joystick',()=>{assert.match(css,/\.aether-landscape-joystick-bay/);assert.match(css,/\.aether-mobile-statusrail\s*\{/);assert.match(css,/\.aether-mobile-transport\s*\{/);assert.match(css,/#root #joystick-wrapper \{z-index:2440!important;/);});
check('expanded playback remains accessible without hiding joystick',()=>{assert.match(css,/aether-mobile-landscape:has\(\.aether-mobile-timeline\) #joystick-wrapper/);assert.match(css,/\.aether-mobile-timeline\s*\{/);});
check('settings drawer has independent vertical navigation and scrollable editor',()=>{assert.match(css,/grid-template-areas:"drawerhead content" "drawertabs content"/);assert.match(css,/#control-drawer-tabs\.aether-mobile-drawer-tabs/);assert.match(css,/#control-drawer-content\.aether-mobile-drawer-content/);});
check('original product editor becomes left catalog and right full content',()=>{assert.match(css,/grid-template-areas:"producthead settings" "productnav settings"/);assert.match(css,/\.aether-mobile-product-nav .icwc-product-tab/);assert.match(css,/\.aether-mobile-product-settings\s*\{\s*box-sizing:border-box/);});
check('video preview and export options use separate columns',()=>{assert.match(css,/\.video-export-workstation \.video-export-main/);assert.match(css,/grid-template-columns:minmax\(0,56%\) minmax\(0,44%\)/);});
check('report builder settings and figure preview use separate columns',()=>{assert.match(css,/\.aether-report-builder-body\s*\{\s*display:grid/);assert.match(css,/grid-template-columns:minmax\(225px,32%\) minmax\(0,1fr\)/);});
check('network canvas and controls use separate landscape panes',()=>{assert.match(simulator,/tn-viewport tn-stage-\$\{stage\}/);assert.match(net,/--tn-landscape-rail:clamp/);assert.match(net,/\.tn-map,[\s\S]{1,500}left:var\(--tn-landscape-rail\)!important/);assert.match(simulator,/new ResizeObserver\(refresh\)/);});
check('NMC and probability originals preserved and positioned at native ratio',()=>{assert.match(net,/\.tn-reference-page/);assert.match(net,/\.tn-probability-page > figure/);assert.match(net,/aspect-ratio:auto!important/);assert.match(net,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);});
check('entry parameters arranged side-by-side in landscape only',()=>{assert.match(entry,/@media \(orientation:landscape\)/);assert.match(entry,/grid-template-columns:minmax\(170px,26%\) minmax\(0,1fr\)/);});
check('offline read-only viewer also supports landscape, map resize and back navigation',()=>{assert.match(standalone,/R220 offline snapshot/);assert.match(standalone,/#prob figure img\{width:100%/);assert.match(standalone,/window\.addEventListener\('resize',resize\)/);assert.match(standalone,/\['block','grid'\]\.includes/);});
check('portrait UI retained by strictly scoped mobile landscape CSS',()=>{assert.match(css,/@media \(orientation: landscape\)/);assert.match(css,/body\.aether-mobile-ui\.aether-mobile-landscape/);assert.doesNotMatch(app,/window\.location\.reload/);});
for(const file of ['src/App.tsx','src/components/MapView.tsx','src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkStandaloneExport.ts']){
 check('TypeScript syntax '+file,()=>{const f=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.deepEqual(f.parseDiagnostics,[]);});
}
console.log('R220 landscape UI regression:',passed+'/'+passed,'PASS');
