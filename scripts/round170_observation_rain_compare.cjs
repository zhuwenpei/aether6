'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
function load(f){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module:m,exports:m.exports,Math,Number,Date,Map,Set,Error});return m.exports.computeTyphoonPrecipitation;}
const old=load('scripts/fixtures/round169_precipitation.ts');
const fresh=load('src/simulation/PrecipitationModel.ts');
const s={lat:24,lon:130,vmax:42,pmin:950,rmw:36,simHour:12,direction:315,speed:25,landed:false,shear:13,shearDir:230,structuralState:.85,eyewallIntegrity:.82,moistureReservoir:.90,rainbandDominance:.70,outflowEfficiency:.8,r7:{ne:260,se:260,sw:260,nw:260},r10:{ne:110,se:110,sw:110,nw:110}};
function profile(fn,r){const rates=[];for(let i=0;i<36;i++){const a=i*Math.PI/18;const lat=s.lat+Math.sin(a)*r/111.12;const lon=s.lon+Math.cos(a)*r/(111.12*Math.cos(s.lat*Math.PI/180));rates.push(fn(s,lat,lon,{isLand:false,config:{humidityScale:1,monsoonTroughEnabled:false}}).rate);}return {mean:rates.reduce((a,b)=>a+b,0)/rates.length,min:Math.min(...rates),max:Math.max(...rates),spread:Math.max(...rates)-Math.min(...rates)};}
const result={};for(const r of [60,200,330])result[r]={old:profile(old,r),new:profile(fresh,r)};
// TRMM observational composite: 60km 6.7 mm/h, 200km 3.9 mm/h (not case-specific truth).
for(const r of [60,200,330]){const a=result[r];assert(a.new.mean<=a.old.mean*1.04,'over-broad mean was increased at '+r);assert(a.new.max>0);}
assert(result[60].new.mean>result[200].new.mean,'core average must exceed 200km band');
console.log(JSON.stringify({referenceTRMM:{inner60:6.7,outer200:3.9},simulated:result},null,2));
