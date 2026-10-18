'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const get=p=>fs.readFileSync(p,'utf8');
function load(p,modules){const out=ts.transpileModule(get(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};vm.runInNewContext(out,{require:(id)=>modules[id]||{},module:m,exports:m.exports,Date,Math,Array,Number,Set,Map,Error});return m.exports;}
const dateMath=(startDate,simHour)=>new Date(startDate.getTime()+simHour*3600e3+8*3600e3);
const {NMC_HISTORY_HOURS,isNmcHistoryFix}=load('src/utils/NmcForecastProduct.ts',{'../simulation/CmaOperationalClock':{getSimulationBeijingDate:dateMath}});
assert.equal([...NMC_HISTORY_HOURS].join(','),'2,8,11,14,17,20,23');
const start=new Date('2026-10-12T00:00:00Z');
for(let h=0;h<48;h++){const local=(h+8)%24;assert.equal(isNmcHistoryFix(start,h),[2,8,11,14,17,20,23].includes(local),`hour ${h}`);}
assert.equal(isNmcHistoryFix(start,11.5),false);
const app=get('src/config/DefaultSettings.ts');assert.match(app,/circulationSizeReferenceKm:\s*320/);
assert.match(get('src/components/ControlDrawer.tsx'),/name:\s*"9月"[^\n]*westerliesLat:\s*37/);
const engine=get('src/simulation/Engine.ts');assert.ok((engine.match(/vmaxDeltaPerHour[\s\S]{0,260}68/g)||[]).length>=2);
assert.match(get('src/simulation/SynopticWindField.ts'),/landReduction = estimateTenMeterReduction\([^\n]+\* 0\.987;/);
const nmc=get('src/utils/NmcForecastProduct.ts');for(const s of ['overlayNationalBorders','overlayChinaProvinces','overlayRivers','chinaLandTint'])assert.ok(nmc.includes(s));
const modal=get('src/components/ForecastImageModal.tsx');for(const s of ['drawJmaTerminationPlate','setNmcChinaTint','setNmcBorders','setNmcProvinces','setNmcRivers'])assert.ok(modal.includes(s));
const svgText=[];
const fakeCtx=new Proxy({},{get:(target,name)=>name==='measureText'?(()=>({width:120})): name==='fillText'||name==='strokeText'?((t)=>svgText.push(t)):()=>{},set:()=>true});
const {drawJmaTerminationPlate}=load('src/utils/JmaTerminationPlate.ts',{'./MapProjection':{projectNorthPolarStereographicKm:(lat,lon)=>({x:lon*100,y:lat*100})},'./LocalVectorBasemaps':{JMA_PRODUCT_COLORS:{grid:'white',logoGreen:'green'},LOCAL_VECTOR_BASEMAPS:{jma:{ocean:'blue',land:'green'}}}});
const canvas={width:1200,height:900,getContext:()=>fakeCtx};
drawJmaTerminationPlate(canvas,{features:[]},29,'熱帯低気圧');assert.ok(svgText.includes('台風29号は熱帯低気圧に変わりました'));
svgText.length=0;drawJmaTerminationPlate(canvas,{features:[]},28,'温帯低気圧');assert.ok(svgText.includes('台風28号は温帯低気圧に変わりました'));
console.log('ROUND170 PASS: 7-point NMC historical clock, JMA termination styles, September, 320 km, 68 m/s throttle, NMC overlays, mild land decay');
