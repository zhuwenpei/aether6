const fs=require('fs'),ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const assert=require('assert');
const compile=(p)=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const modules={
  '../simulation/Engine':{getAgencyIntensity:v=>({value:Math.round(v)}),getWindForceCategory:v=>Math.min(17,Math.round(v/3.7))},
  '../simulation/CmaOperationalClock':{isCmaTyphoonProductTime:()=>true},
  './ProductCoastlineDrawing':{strokeProductCoastlineRing(ctx,ring,project){ctx.beginPath();for(let i=0;i<ring.length;i++){const xy=project(ring[i][1],ring[i][0]);i?ctx.lineTo(xy.x,xy.y):ctx.moveTo(xy.x,xy.y)}ctx.stroke();}}
};
function use(p,id){const m={exports:{}};new Function('module','exports','require',compile(p))(m,m.exports,(key)=>{if(!modules[key])throw Error('Missing '+key);return modules[key]});modules[id]=m.exports;}
use('src/utils/NmcMapViewport.ts','./NmcMapViewport');use('src/utils/NmcForecastProduct.ts','./NmcForecastProduct');
const tally={paths:0,lines:0,fills:0,texts:0};
function ctx(){return {beginPath(){tally.paths++},moveTo(){},lineTo(){tally.lines++},arc(){},ellipse(){},rect(){},closePath(){},clip(){},fill(){tally.fills++},stroke(){},fillRect(){tally.fills++},strokeRect(){},setTransform(){},save(){},restore(){},translate(){},rotate(){},roundRect(){},setLineDash(){},drawImage(){},measureText(v){return {width:String(v).length*9}},fillText(){tally.texts++}};}
class FakeCanvas{width=0;height=0;context=ctx();getContext(type){return type==='2d'?this.context:null}}
global.document={createElement(type){assert.equal(type,'canvas');return new FakeCanvas()}};
const poly=(coords,admin)=>({type:'Feature',properties:{CONTINENT:'Asia',ADMIN:admin},geometry:{type:'Polygon',coordinates:[coords]}});
const land={type:'FeatureCollection',features:[
 poly([[105,15],[110,15],[115,20],[121,28],[128,40],[85,40],[85,15],[105,15]],'China'),
 poly([[120.1,21.8],[121.8,22.4],[121.7,25.1],[120.1,21.8]],'Taiwan'),
 poly([[119,13],[122.4,14],[121.4,18.8],[119,13]],'Philippines')
]};
const history=Array.from({length:42},(_,i)=>({lat:11+i*.1,lon:151-i*.2,vmax:12+i*.7,simHour:80+i}));
const forecast=Array.from({length:11},(_,i)=>({lat:15.2+i*.55,lon:142.8-i*1.9,vmax:56-i*1.5,simHour:121+i*12}));
const canvas=new FakeCanvas();
modules['./NmcForecastProduct'].drawNmcForecastProduct({canvas,width:1295,issueDate:new Date('2026-07-15T06:00:00Z'),startDate:new Date('2026-07-10T00:00:00Z'),typhoonName:'测试',typhoonNumber:'2601',ordinalNumber:1,issueHour:121,forecastHours:120,current:{lat:15.2,lon:142.8,vmax:56,simHour:121},history,forecast,landGeoJson:land,countriesGeoJson:land,showInfoBoxes:true,showCenterBox:true,showForecastBox:true});
assert.equal(canvas.width,1295);assert.equal(canvas.height,1103);assert(tally.paths>100&&tally.lines>100&&tally.texts>10&&tally.fills>10,JSON.stringify(tally));
console.log(JSON.stringify({result:'PASS',canvas:[canvas.width,canvas.height],operations:tally}));
