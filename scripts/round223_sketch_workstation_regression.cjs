// R223: sketch-based landscape workstation and provenance-isolated quiet mode.
const fs=require('fs'),path=require('path'),assert=require('assert');
const ts=(()=>{try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('src/App.tsx'),css=read('src/index.css'),map=read('src/components/MapView.tsx'),
 chrome=read('src/components/AetherMobileChrome.tsx'),transport=read('src/components/AetherMobileTransport.tsx'),
 network=read('src/components/TyphoonNetworkSimulator.tsx'),exporter=read('src/utils/TyphoonNetworkStandaloneExport.ts'),
 entry=read('src/components/NetworkEntrySettings.tsx');
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name)};
check('three React-driven layout states',()=>{assert.match(app,/landscapeShellStage.*useState<0 \| 1 \| 2>/);assert.match(app,/aether-landscape-ui-hidden/);assert.match(app,/aether-landscape-rail-collapsed/)});
check('sidebar and immersive controls are semantic independent buttons',()=>{assert.match(app,/aria-label=\{landscapeShellStage >= 1/);assert.match(app,/aria-label=\{landscapeShellStage === 2/);assert.match(app,/setLandscapeShellStage\(v => v === 0 \? 1 : 0\)/);assert.match(app,/setLandscapeShellStage\(v => v === 2 \? 1 : 2\)/)});
check('sketch left information, lower joystick, right action strip and bottom time rail',()=>{
 for (const c of ['.aether-mobile-statusrail','.aether-landscape-joystick-bay','.aether-mobile-header-actions','.aether-mobile-transport','.aether-landscape-time-main'])assert(css.includes(c),c);
 assert.match(css,/--aether-shell-rail-w:clamp\(226px,32vw,465px\)/);assert.match(transport,/aria-label="横屏历史时间位置"/);
});
check('buttons retain actual handlers and semantic roles',()=>{
 for(const c of ['aether-landscape-tool-products','aether-landscape-tool-shortcuts','aether-landscape-tool-menu','aether-landscape-tool-more'])assert(chrome.includes(c));
 for(const c of ['onProducts','onInfluence','onSettings','onMoreOpen'])assert(chrome.includes(c));
});
check('actual map viewport transitions to safe-area width',()=>{
 assert.match(css,/#typhoon-gis-viewport\s*\{/);assert.match(css,/transition:left \.34s/);
 assert.match(css,/\.aether-landscape-rail-collapsed:not\(\.aether-keyboard-open\) #typhoon-gis-viewport/);
 assert.match(css,/\.aether-landscape-ui-hidden:not\(\.aether-keyboard-open\)/);
});
check('follow camera targets centre of resized Leaflet map, not physical screen',()=>{
 assert.match(map,/landscapeLayoutEpoch/);assert.match(map,/map\.invalidateSize\(\{ pan: false, animate: false \}\)/);
 assert.match(map,/map\.panTo\(\[active\.lat, active\.lon\]/);assert.match(map,/orientationchange/);
});
check('safe insets use user supplied #292929 in both orientations',()=>{
 assert.match(css,/--aether-hole-gray:#292929/);assert.match(css,/body\.aether-mobile-ui::before/);
 assert.match(css,/body\.aether-mobile-ui:not\(\.aether-mobile-landscape\)::before/);
 assert.match(css,/body\.aether-mobile-ui\.aether-mobile-landscape::before/);
});
check('password gated in-app hints hidden, offline provenance non-suppressible',()=>{
 assert.match(entry,/quietPassword!==['"]110908['"]/);
 assert.match(network,/!chartSettings\.quietSimulationHints&&<div className="tn-map-simulation-mark"/);
 assert.match(network,/quietSimulationHints:false\}\)/);assert.match(exporter,/safeEmbeddedJson\(\{ \.\.\.payload, quietSimulationHints:false/);
 assert.match(exporter,/虚拟模拟 · 非官方预报/);assert.match(exporter,/模拟资料/);
});
check('real original portrait interface preserved',()=>{
 assert.match(css,/body\.aether-mobile-ui:not\(\.aether-mobile-landscape\) #typhoon-app-container/);
 assert.match(css,/@media \(orientation:landscape\) and \(max-height:850px\)/);
 assert(!app.includes('location.reload('));
});
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):x.isFile()&&/\.(tsx?|jsx?)$/.test(x.name)?[path.join(d,x.name)]:[]);
const files=walk(path.join(root,'src'));
const invalid=files.flatMap(f=>{const src=ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true,/\.tsx$/.test(f)?ts.ScriptKind.TSX:ts.ScriptKind.TS);return src.parseDiagnostics.map(d=>[f,d.messageText])});
check(`all ${files.length} TS/TSX/JS source files parse`,()=>{assert.deepStrictEqual(invalid,[])});
console.log(`R223: ${checks}/${checks} checks passed`);
