const fs=require('fs'),assert=require('assert'),ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const file=fs.readFileSync('src/components/TyphoonNetworkSimulator.tsx','utf8');
const css=fs.readFileSync('src/components/TyphoonNetworkSimulator.css','utf8');
const old=fs.readFileSync('../aether_r200_work/src/components/TyphoonNetworkSimulator.tsx','utf8');
const oldCss=fs.readFileSync('../aether_r200_work/src/components/TyphoonNetworkSimulator.css','utf8');
const all=[];
function test(label,fn){try{fn();all.push({name:label,pass:true});console.log('PASS',label)}catch(e){all.push({name:label,pass:false,error:String(e)});console.error('FAIL',label,e.message)}}
test('Full TSX parser diagnostics clean',()=>{let source=ts.createSourceFile('a.tsx',file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);assert.equal(source.parseDiagnostics.length,0)});
test('Exactly one back button with dedicated ID',()=>assert.equal((file.match(/id="tn-network-back"/g)||[]).length,1));
test('Exactly one map switch button with dedicated ID',()=>assert.equal((file.match(/id="tn-network-switch"/g)||[]).length,1));
test('Provider switch menu and original event retained',()=>assert(file.includes('onClick={switchProvider}')&&file.includes('tn-provider-menu')));
test('Map switch displays two distinct labels, no BR',()=>assert(file.includes('<span className="tn-switch-first">切换</span><span className="tn-switch-second">地图商</span>')));
test('Reference icon and interaction remain unchanged',()=>assert(file.includes('id="tn-network-reference-icon"')&&file.includes('{hurricaneSvg(40)}')));
test('Back navigation retained',()=>assert(file.includes("if(stage==='reference'){setStage('map');}else onClose();")));
test('White outline for left two buttons',()=>assert((css.match(/border:1\.5px solid #fff!important/g)||[]).length>=2));
test('Borderless reference',()=>assert(css.includes('#tn-network-reference-icon:not(#aether-default-dialog-button)')&&css.includes('border:0!important')));
test('Fixed square button (mobile + desktop)',()=>assert(css.includes('width:46px!important;height:46px!important')&&css.includes('width:41px!important;height:41px!important')));
test('No glass behind controls',()=>assert(css.includes('backdrop-filter:none!important;-webkit-backdrop-filter:none!important')));
test('Labels independently styleable',()=>assert(css.includes('.tn-switch-first')&&css.includes('.tn-switch-second')));
test('Other TSX unchanged after removal of two scoped markup edits',()=>{
  const rest=file.replace('id="tn-network-back" ','').replace('id="tn-network-switch" ','').replace('<span className="tn-switch-first">切换</span><span className="tn-switch-second">地图商</span>','切换<br/>地图商');
  assert.equal(rest,old);
});
test('CSS only appended',()=>assert(css.startsWith(oldCss)));
const out={pass:all.filter(x=>x.pass).length,total:all.length,tests:all};
fs.writeFileSync('ROUND201_HEADER_SOURCE_VALIDATION.json',JSON.stringify(out,null,2));
console.log(`R201 ${out.pass}/${out.total}`);process.exitCode=out.pass===out.total?0:1;
