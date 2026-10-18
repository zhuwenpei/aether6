'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function mod(f){const m={exports:{}};vm.runInNewContext(ts.transpileModule(read(f),{fileName:f,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,Math});return m.exports;}
const src=read('src/utils/NmcForecastProduct.ts');
assert(src.includes('NMC_HISTORY_HOURS = [2, 8, 11, 14, 17, 20, 23]'));
assert(src.includes('if (!isNmcHistoryFix(o.startDate,p.simHour)) continue;'));
const modal=read('src/components/ForecastImageModal.tsx');
assert(modal.includes('drawJmaTerminationPlate('));
assert(modal.includes('drawNmcForecastProductCooperative(') || modal.includes('drawNmcForecastProduct(')); // Round182: cancellable vector stages
assert(modal.includes('overlayChinaProvinces: nmcProvinces'));
assert(modal.includes('overlayRivers: nmcRivers'));
assert(modal.includes('const headerLeftBoxW = 168 * scale')); // Round171 restores Round169 style
assert(!modal.includes('ctx.strokeStyle = JMA_PRODUCT_COLORS.stormWind;\n    ctx.lineWidth = 2.5 * scale;\n    drawEnvelopePath'));
const river=JSON.parse(read('public/data/nmc_rivers.geojson'));
assert(river.features.length>3000,'blue water layer should have genuine region-wide vectors');
const land=JSON.parse(read('public/data/product_countries_highdetail_v3.geojson'));
assert(land.features.some(f=>f.properties.ADMIN==='China'));
assert(land.features.some(f=>f.properties.ADMIN==='Taiwan'));
const control=read('src/components/ControlDrawer.tsx');
assert(control.includes('westerliesLat: 37, westerliesStrength: 0.9'));
const defaults=read('src/config/DefaultSettings.ts');
assert(defaults.includes('circulationSizeReferenceKm: 320'));
const engine=read('src/simulation/Engine.ts');
assert(engine.includes('const etGrowthTauBase = Math.max(4.6, Math.min(10.0'));
assert(engine.includes('vmaxDeltaPerHour * stepFraction - belowThreshold) * (2 / 3)'));
assert(engine.includes('vmaxDeltaPerHour * stepSizeHours - belowThreshold) * (2 / 3)'));
const synoptic=read('src/simulation/SynopticWindField.ts');
assert(synoptic.includes('1 - 0.475 * clamp(landInterior'));
const rain=mod('src/simulation/PrecipitationModel.ts').computeTyphoonPrecipitation;
const st={lat:25,lon:123,vmax:52,pmin:930,rmw:30,simHour:0,direction:325,speed:14,landed:false,shear:18,shearDir:210,eyewallIntegrity:.74,moistureReservoir:.9,outflowEfficiency:.85,rainbandDominance:.67,r7:{ne:280,se:260,sw:260,nw:260},r10:{ne:115,se:115,sw:115,nw:115}};
const totals=[];const lonKm=(x)=>x/(111.12*Math.cos(25*Math.PI/180));
for(let iy=-13;iy<=13;iy++)for(let ix=-13;ix<=13;ix++){
 let total=0;
 for(let hour=0;hour<24;hour+=3){const move={...st,simHour:hour,lat:25+hour*.025,lon:123-hour*.016};const lat=25+iy*16/111.12,lon=123+lonKm(ix*16);total+=rain(move,lat,lon,{isLand:false,config:{monsoonTroughEnabled:true,westerliesEnabled:true,westerliesLat:36,westerliesStrength:.7,subtropicalHighEnabled:true,subtropicalHighStrength:1.1,humidityScale:1.05}}).rate*3;}
 totals.push(total);
}
const s=[...totals].sort((a,b)=>a-b),mean=totals.reduce((a,b)=>a+b,0)/s.length,p50=s[Math.floor(.5*s.length)],p99=s[Math.floor(.99*s.length)];
const above250=totals.filter(v=>v>=250).length/totals.length;
assert(mean<175,`broad mean still too high ${mean}`);
assert(above250<.15,`too much uniform heavy rainfall ${above250}`);
assert(p99>p50*3.0,`embedded peaks lost ${p99} / ${p50}`);
assert(s.at(-1)>300,'strong local bursts removed entirely');
console.log('ROUND170 PASS geography overlays, strict NMC cadence, JMA stop (Round169 appearance restored), 68m/s/ET/37N/320km');
console.log(`Rain 24h synthetic strong-typhoon: mean=${mean.toFixed(1)}mm p50=${p50.toFixed(1)}mm p99=${p99.toFixed(1)}mm max=${s.at(-1).toFixed(1)}mm area>=250mm=${(above250*100).toFixed(1)}%`);
console.log('NOAA Harvey 2017 maximum event TOTAL (multi-day) 60.58in = 1538.7mm. This magnitude comparison is not a case-specific hindcast.');
