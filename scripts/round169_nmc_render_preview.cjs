'use strict';
const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const {Canvas}=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/skia-canvas');
const modules={
  '../simulation/Engine':{getAgencyIntensity:v=>({value:Math.round(v)}),getWindForceCategory:v=>v>=62?17:v>=56?17:v>=51?16:v>=46?14:Math.min(16,Math.round(v/3.3))},
  '../simulation/CmaOperationalClock':{isCmaTyphoonProductTime:()=>true},
  './ProductCoastlineDrawing':{strokeProductCoastlineRing(ctx,ring,project){ctx.beginPath();let prev;for(let i=0;i<ring.length;i++){const xy=project(ring[i][1],ring[i][0]);if(prev&&Math.abs(xy.x-prev.x)>650){ctx.stroke();ctx.beginPath();ctx.moveTo(xy.x,xy.y)}else i?ctx.lineTo(xy.x,xy.y):ctx.moveTo(xy.x,xy.y);prev=xy;}ctx.stroke();}}
};
function load(p,id){const js=ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};new Function('module','exports','require',js)(m,m.exports,key=>{if(!modules[key])throw Error('Missing '+key);return modules[key]});modules[id]=m.exports;}
load('src/utils/NmcMapViewport.ts','./NmcMapViewport');load('src/utils/NmcForecastProduct.ts','./NmcForecastProduct');
global.document={createElement:t=>new Canvas(1295,1103)};
const current={simHour:0,lat:18,lon:143,vmax:48,category:'强台风'};
const history=Array.from({length:51},(_,i)=>({simHour:-50+i,lat:11+i*.14,lon:158-i*.3,vmax:16+i*.64,category:'强台风'}));
const forecast=Array.from({length:121},(_,i)=>({simHour:i,lat:18+19*i/120,lon:143+(6*i/120)-7*Math.sin(i/120*Math.PI),vmax:Math.max(18,48+15*Math.sin(i/120*Math.PI)-.3*i),category:i>=100?'温带气旋':'强台风'}));
const o={canvas:new Canvas(1295,1103),width:1295,typhoonName:'测试',typhoonNumber:'2601',ordinalNumber:1,issueDate:new Date('2026-09-13T09:00:00Z'),forecastHours:120,issueHour:0,startDate:new Date('2026-09-05T00:00:00Z'),current,history,forecast,
  landGeoJson:JSON.parse(fs.readFileSync('public/data/product_land_wide_v3.geojson','utf8')),
  countriesGeoJson:JSON.parse(fs.readFileSync('public/data/product_countries_highdetail_v3.geojson','utf8')),
  showInfoBoxes:true,showCenterBox:true,showForecastBox:true};
console.time('render');modules['./NmcForecastProduct'].drawNmcForecastProduct(o);console.timeEnd('render');o.canvas.toBuffer('png').then(b=>{fs.writeFileSync('/mnt/data/round169_nmc_layout_preview.png',b);console.log('saved '+b.length)}).catch(e=>{console.error(e);process.exitCode=1});
