const fs=require('fs');const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const toJs=(p)=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const nmc=toJs('src/utils/NmcForecastProduct.ts'), viewport=toJs('src/utils/NmcMapViewport.ts');
const feature=(coords,props={CONTINENT:'Asia',ADMIN:'China'})=>({type:'Feature',properties:props,geometry:{type:'Polygon',coordinates:[coords]}});
const china=feature([[108,16],[111,18],[113,22],[117,24],[121,30],[124,34],[130,41],[90,41],[90,17],[108,16]]);
const taiwan=feature([[120.3,21.8],[121.7,22.4],[122.0,24.7],[121.7,25.3],[120.2,24],[120.3,21.8]],{CONTINENT:'Asia',ADMIN:'Taiwan'});
const luzon=feature([[119,14.3],[122.6,14],[123.1,18.6],[121,19],[119,14.3]],{CONTINENT:'Asia',ADMIN:'Philippines'});
const geom={type:'FeatureCollection',features:[china,taiwan,luzon]};
const src=`<!DOCTYPE html><html lang="zh"><meta charset="utf-8"><title>Round156 NMC render smoke</title><body style="margin:0;background:#eee">
<canvas id="chart" width="1295" height="1103"></canvas><pre id="status"></pre>
<script>
const modules={};
function evaluate(code,name){const module={exports:{}};function require(q){return modules[q]||{};}new Function('require','module','exports',code)(require,module,module.exports);modules[name]=module.exports;}
modules['../simulation/Engine']={getAgencyIntensity:(v)=>({value:Math.round(v)}),getWindForceCategory:(v)=>Math.min(17,Math.max(1,Math.round(v/3.5)))};
modules['../simulation/CmaOperationalClock']={isCmaTyphoonProductTime:()=>true};
modules['./ProductCoastlineDrawing']={strokeProductCoastlineRing:(ctx,ring,project)=>{ctx.beginPath();ring.forEach((p,i)=>{const xy=project(p[1],p[0]);i?ctx.lineTo(xy.x,xy.y):ctx.moveTo(xy.x,xy.y);});ctx.stroke();}};
evaluate(${JSON.stringify(viewport)},'./NmcMapViewport');
evaluate(${JSON.stringify(nmc)},'./NmcForecastProduct');
try {
const date=new Date('2026-07-15T06:00:00.000Z');
const current={lat:16,lon:143,vmax:60,simHour:120};
const history=Array.from({length:41},(_,i)=>({lat:11+i*.125,lon:153-i*.25,vmax:14+i*1.15,simHour:80+i}));
const forecast=Array.from({length:11},(_,i)=>({lat:16+i*.95,lon:143-i*2.1,vmax:60-i*3,simHour:120+i*12}));
modules['./NmcForecastProduct'].drawNmcForecastProduct({canvas:document.getElementById('chart'),width:1295,typhoonName:'测试',typhoonNumber:'2601',ordinalNumber:1,issueDate:date,forecastHours:120,issueHour:120,startDate:date,current,history,forecast,landGeoJson:${JSON.stringify(geom)},countriesGeoJson:${JSON.stringify(geom)},showInfoBoxes:true,showCenterBox:true,showForecastBox:true});
const c=document.getElementById('chart'),ctx=c.getContext('2d');
const p=ctx.getImageData(120,220,1,1).data;
document.getElementById('status').textContent='PASS drawing '+c.width+'x'+c.height+' sampled rgba '+Array.from(p).join(',');
}catch(error){document.getElementById('status').textContent='FAIL '+String(error)+' '+error.stack;}
</script></body></html>`;
fs.writeFileSync('/mnt/data/round156_nmc_smoke.html',src);
