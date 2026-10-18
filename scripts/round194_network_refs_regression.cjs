/* Round194: prevent entry crash from unbound Leaflet/offline map refs. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');
const component=path.join(root,'src/components/TyphoonNetworkSimulator.tsx');
const source=fs.readFileSync(component,'utf8');
const tests=[];
const check=(label,callback)=>{
  try{callback();tests.push({name:label,status:'PASS'});console.log('PASS',label)}
  catch(error){tests.push({name:label,status:'FAIL',error:String(error)});console.error('FAIL',label,error.message)}
};
const parsed=ts.createSourceFile(component,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
check('TSX parses cleanly',()=>assert.equal(parsed.parseDiagnostics.length,0));
const names=['lastLeafletProviderRef','offlineLayerRef'];
const isUseRef=(expr)=>ts.isCallExpression(expr)&&ts.isIdentifier(expr.expression)&&expr.expression.text==='useRef';
for(const name of names){
  check(name+' is created by a useRef hook at component scope',()=>{
    let declarations=[];
    function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name)declarations.push(node);ts.forEachChild(node,visit)}
    visit(parsed);
    assert.equal(declarations.length,1);
    assert(declarations[0].initializer&&isUseRef(declarations[0].initializer));
    const start=declarations[0].getStart(parsed);
    const fn=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='TyphoonNetworkSimulator');
    assert(fn && start>fn.getStart(parsed)&&start<fn.getEnd());
  });
}
check('Leaflet remembers OSM/offline provider switch',()=>{
  assert(source.includes('lastLeafletProviderRef.current!==provider'));
  assert(source.includes('lastLeafletProviderRef.current=provider'));
  assert(source.includes('map.panTo([current.lat,current.lon],{animate:false})'));
});
check('Offline layer ref holds and releases async-loaded vector layer',()=>{
  assert(source.includes('offlineLayerRef.current=localLayer'));
  assert(source.includes('offlineLayerRef.current=null'));
  assert(source.includes('map.removeLayer(offlineLayerRef.current)'));
  assert(source.includes('if(cancelled||leafletRef.current!==map)return'));
});
check('OSM/Offline selection, legacy providers and first-entry playback unchanged',()=>{
  assert(source.includes("provider!=='osm'&&provider!=='offline'"));
  for(const x of ['osm','baidu','petal','offline'])assert(source.includes(`selectProvider('${x}')`));
  assert(source.includes('cmaBoundedNetworkHistory(storm,startDate,currentHour)'));
  assert(source.includes('187.5'));
});
const configPath=path.join(root,'tsconfig.json');
const cfg=ts.readConfigFile(configPath,ts.sys.readFile);
check('tsconfig read',()=>assert(!cfg.error));
const parsedConfig=ts.parseJsonConfigFileContent(cfg.config,ts.sys,root);
const program=ts.createProgram({rootNames:parsedConfig.fileNames,options:parsedConfig.options});
const allDiagnostics=ts.getPreEmitDiagnostics(program);
const current=allDiagnostics.filter(d=>d.file?.fileName===component);
check('NO undefined identifiers (TS2304/TS2552) in network simulator',()=>{
  const unresolved=current.filter(d=>d.code===2304||d.code===2552);
  assert.equal(unresolved.length,0,unresolved.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; '));
});
check('No introduced non-dependency TS diagnostics in simulator',()=>{
  const nonDependency=current.filter(d=>![2307,2688,2875].includes(d.code));
  assert.equal(nonDependency.length,0,nonDependency.map(d=>String(d.code)+':'+ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; '));
});
const failed=tests.filter(t=>t.status==='FAIL');
const result={round:194,passed:tests.length-failed.length,total:tests.length,failed:failed.length,fullBuildVerified:false,note:'Dependency packages (React/Leaflet/Vite) are missing in the test environment. Undefined-variable semantic checks were run using the global TypeScript compiler.',results:tests};
fs.writeFileSync(path.join(root,'ROUND194_VALIDATION.json'),JSON.stringify(result,null,2));
console.log(`Round194: ${result.passed}/${result.total} passed`);
if(failed.length)process.exitCode=1;
