/* Round190: source / geometric regression; no dependency installation required. */
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const assert=require('node:assert/strict');
let ts;try{ts=require('typescript');}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}
const root=path.resolve(__dirname,'..');
const get=p=>fs.readFileSync(path.join(root,p),'utf8');
let passed=0;const test=(name,check)=>{check();passed++;console.log('PASS',name);};
for(const filename of ['src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkData.ts','src/components/ForecastImageModal.tsx','src/App.tsx']){
  test('typescript syntax '+filename,()=>{const text=get(filename),src=ts.createSourceFile(filename,text,ts.ScriptTarget.Latest,true,filename.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS); assert.equal(src.parseDiagnostics.length,0);});
}
const source=get('src/utils/TyphoonNetworkData.ts');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mockModule={exports:{}};const mockForecast=(seed,_config)=>Array.from({length:40},(_,i)=>({simHour:(i+1)*3,lat:seed.lat+i*.08,lon:seed.lon+i*.08,vmax:30+i/10,pmin:970-i/2,speed:20,direction:300}));
vm.runInNewContext(js,{exports:mockModule.exports,module:mockModule,require:id=>id.includes('Engine')?{getWindForceCategory:x=>Math.floor(x/3),materializeForecastPath:mockForecast}:{}}, {filename:'TyphoonNetworkData.js'});
const {sampleNetworkFix,threeHourlyNetworkHistory,buildNetworkForecasts,networkPointColor}=mockModule.exports;
const radii={ne:310,se:260,sw:220,nw:190};
const storm={name:'合成',simHour:24,lat:12,lon:144,vmax:35,pmin:955,speed:18,direction:320,r7:radii,r10:{ne:150,se:140,sw:120,nw:100},r12:{ne:60,se:50,sw:40,nw:30},rmw:20,history:Array.from({length:25},(_,i)=>({simHour:i,lat:10+i/12,lon:140+i/6,vmax:20+i/2,pmin:980-i,speed:18+i/10,direction:310,r7:radii,r10:{ne:150,se:140,sw:120,nw:100},r12:{ne:60,se:50,sw:40,nw:30},rmw:20}))};
const orig=JSON.stringify(storm);
let history=threeHourlyNetworkHistory(storm);
test('3-hour fixes sample the original physical trajectory',()=>assert.equal(history.map(x=>x.simHour).join(','),'0,3,6,9,12,15,18,21,24'));
test('3-hour node original wind radii are not mutated',()=>assert.equal(history[4].r7.ne,310));
test('track terminal and first remain exact',()=>{assert.equal(history[0].lon,140);assert.equal(history.at(-1).lon,144);});
test('nonintegral historical start and end retained',()=>{const partial={...storm,history:storm.history.slice(2,8)};assert.equal(threeHourlyNetworkHistory(partial).map(p=>p.simHour).join(','),'2,3,6,7');});
test('sample interpolation and circular direction',()=>{const sampled=sampleNetworkFix([ {...storm.history[0],direction:350},{...storm.history[3],direction:10}],1.5);assert.ok(Math.abs(sampled.direction-0)<1e-6);});
const forecasts=buildNetworkForecasts(storm.history[24],storm,{});
test('4 simulated guidance styles',()=>assert.equal(forecasts.map(x=>x.agency).join(','),'中国,日本,美国,韩国'));
test('guidance fixes at 3-hour timestamps',()=>assert.ok(forecasts.every(f=>f.fixes.every(x=>x.simHour>24&&((x.simHour-24)%3)===0))));
test('guidance types are spatially independent',()=>assert.ok(forecasts[1].fixes[8].lon!==forecasts[2].fixes[8].lon));
test('forecast does not change simulation storm object',()=>assert.equal(JSON.stringify(storm),orig));
test('NMC reference not embedded image or screenshot',()=>{const page=get('src/components/TyphoonNetworkSimulator.tsx');assert.ok(page.includes('drawNmcForecastProductCooperative('));assert.ok(page.includes('loadNaturalEarthData('));assert.ok(!page.includes('51395.jpg'));});
test('user button and standalone router integrated',()=>{assert.ok(get('src/components/ForecastImageModal.tsx').includes('onOpenTyphoonNetwork?.()'));assert.ok(get('src/App.tsx').includes('<TyphoonNetworkSimulator'));});
test('player jumps at 3h cadence, 16 simulated hours/sec',()=>{const page=get('src/components/TyphoonNetworkSimulator.tsx');assert.ok(page.includes('187.5'));assert.ok(!page.includes('animate:true'));assert.ok(page.includes('animate:false'));});
test('OSM is default, Baidu and Petal require authorization',()=>{const page=get('src/components/TyphoonNetworkSimulator.tsx');assert.ok(page.includes("useState<'osm'|'baidu'|'petal'|'offline'>('osm')"));assert.ok(page.includes('VITE_BAIDU_MAP_AK'));});
test('target information fields present, no unrelated toolbar icons',()=>{const page=get('src/components/TyphoonNetworkSimulator.tsx');for(const item of ['中心位置','最大风力','中心气压','预报时效','移向移速','风圈方位','七级风圈半径','十级风圈半径','12级风圈半径','台风参考'])assert.ok(page.includes(item),item);assert.ok(!page.includes('tn-share'));assert.ok(!page.includes('tn-refresh'));});
test('no actual center forecast overwrite or save operation',()=>{const page=get('src/components/TyphoonNetworkSimulator.tsx');assert.ok(!/\bsetTyphoons\b|\bsetConfig\b|\bwriteSimulationArchive\b/.test(page));});
test('source category palettes cover tropical depression to super typhoon',()=>{assert.notEqual(networkPointColor(10),networkPointColor(60));});
console.log(`${passed}/${passed} PASS`);
