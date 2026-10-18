const fs=require('fs'),path=require('path'),assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
let pass=0;function test(name,fn){fn();pass++;console.log('PASS',name)}
const v=read('src/components/VirtualJoystick.tsx'),n=read('src/components/TyphoonNetworkSimulator.tsx'),nc=read('src/components/TyphoonNetworkSimulator.css'),s=read('src/utils/TyphoonNetworkStandaloneExport.ts'),css=read('src/index.css');
test('joystick uses displayed scale to normalize pointer coordinates',()=>{assert.match(v,/rect\.width\s*\/\s*diameter/);assert.match(v,/deltaX\s*=\s*\(clientX\s*-\s*centerX\)\s*\/\s*visualScaleX/);assert.match(v,/deltaY\s*=\s*\(clientY\s*-\s*centerY\)\s*\/\s*visualScaleY/)});
test('network gallery switch buttons are keyboard accessible and state-driven',()=>{assert.match(n,/setGalleryView.*strike/);assert.match(n,/aria-pressed=\{galleryView==='strike'\}/);assert.match(n,/aria-pressed=\{galleryView==='centers'\}/);assert.match(n,/tn-gallery-figure\$\{galleryView/)});
test('gallery CSS shows each image at full available width without stretching',()=>{assert.match(nc,/max-width:960px/);assert.match(nc,/tn-gallery-figure\.is-selected\s*\{display:flex/);assert.match(nc,/tn-probability-page\s*>\s*figure\.tn-gallery-figure/)});
test('narrow screen network side rail has independent ticker scroll',()=>{assert.match(nc,/max-height:390px/);assert.match(nc,/max-height:calc\(100% - 180px\)/)});
test('safe area is reserved for rail controls',()=>{assert.match(css,/--aether-landscape-rail-w:max\(clamp/);assert.match(css,/safe-area-inset-left/)});
test('status, product parameters and advanced tools can scroll independently',()=>{assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);assert.match(css,/\.aether-mobile-tools-overflow/);assert.match(css,/\.aether-mobile-product-settings/)});
test('short-height screen gets compact layout without squeezing map',()=>{assert.match(css,/max-height:340px/);assert.match(css,/--aether-landscape-head-h:68px/);assert.doesNotMatch(css,/transform:scale\(\.\d+\)[^;]*#typhoon-gis-viewport/)});
test('offline switch mirrors live gallery buttons',()=>{assert.match(s,/id="gallerytabs"/);assert.match(s,/id="showstrike"/);assert.match(s,/id="showcenters"/);assert.match(s,/setGalleryTab\('strike'\)/);assert.match(s,/syncProbabilityDisplay/)});
test('offline orientation change reflows open gallery',()=>{assert.match(s,/window\.addEventListener\('resize',syncProbabilityDisplay\)/);assert.match(s,/#prob figure\.galleryfigure\.is-selected/)});
test('portrait and wide landscape keep both images',()=>{assert.match(nc,/#root \.tn-gallery-switch \{display:none\}/);assert.match(s,/#gallerytabs\{display:none\}/)});
for(let f of ['src/components/VirtualJoystick.tsx','src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkStandaloneExport.ts'])test('TS parses '+f,()=>{let x=ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,f.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.equal(x.parseDiagnostics.length,0,x.parseDiagnostics.map(a=>a.messageText).join('\n'))});
console.log(`R221 deep landscape checks: ${pass}/${pass} PASS`);
