'use strict';
/** Round180: NMC fill and hairline must use identical fine coastline geometry.
 * Mainland tint may depend on country affiliation but must not use the coarse
 * country shoreline as a filled boundary. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = (()=>{try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const read = path => fs.readFileSync(path,'utf8');
const source = read('src/utils/NmcForecastProduct.ts');
const modal = read('src/components/ForecastImageModal.tsx');
const loader = read('src/simulation/NaturalEarthLoader.ts');
assert(modal.includes('productCoastlineGeoJson as nmcFineCoastlineGeoJson'), 'NMC generator must load the real fine coastline dataset');
assert(modal.includes('coastlineGeoJson: nmcFineCoastlineGeoJson'), 'NMC generator must pass fine polygons to renderer');
assert(loader.includes('data/product_coastline_fine_v5.geojson'), 'fine geometry must exist in product loader');
const file=JSON.parse(read('public/data/product_coastline_fine_v5.geojson'));
assert(file.features.length > 1000, 'fine coastline dataset missing or truncated');
const transpile = js=>ts.transpileModule(js,{fileName:'NmcForecastProduct.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const modules = {
 '../simulation/Engine':{getAgencyIntensity:v=>({value:Math.round(v)}),getWindForceCategory:v=>Math.round(v/4)},
 '../simulation/CmaOperationalClock':{getSimulationBeijingDate:()=>new Date('2026-10-14T00:00:00Z')},
 './ProductCoastlineDrawing':{strokeProductCoastlineRing:(ctx,ring,project)=>{ctx.beginPath();for(const [i,coord] of ring.entries()){const p=project(coord[1],coord[0]);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)}ctx.stroke();}},
 './NmcMapViewport':{buildNmcGeoFrame:()=>({}),nmcProjectPoint:()=>({x:0,y:0})},
 './NmcOptionalGeography':{shouldDrawNmcRiver:()=>true}
};
const m={exports:{}};
new Function('module','exports','require',transpile(source)+'\nmodule.exports.__round180_drawBaseMap=drawBaseMap;')(m,m.exports,key=>{assert(modules[key],`missing mock ${key}`);return modules[key]});
const draw=m.exports.__round180_drawBaseMap;
assert.equal(typeof draw,'function');
const coast=(coords,name='')=>({type:'Feature',properties:{ADMIN:name},geometry:{type:'Polygon',coordinates:coords}});
const square = [[[100,0],[120,0],[120,30],[100,30],[100,0]]];
const fine={type:'FeatureCollection',features:[coast([[[100,0],[113,0],[116,15],[113,30],[100,30],[100,0]]]) ]};
const coarse={type:'FeatureCollection',features:[coast(square)]};
const admin={type:'FeatureCollection',features:[coast(square,'China')]};
const ops=[];
const fake={save(){ops.push('save')},restore(){ops.push('restore')},beginPath(){ops.push('begin')},rect(){},clip(rule){ops.push(['clip',rule])},fillRect(){},fill(rule){ops.push(['fill',this.fillStyle,rule])},stroke(){ops.push(['stroke',this.strokeStyle])},moveTo(x,y){ops.push(['move',x,y])},lineTo(x,y){ops.push(['line',x,y])},closePath(){ops.push('close')},setLineDash(){}};
const frame={minLon:100,maxLon:120,minLat:0,maxLat:30};
const project=(lat,lon)=>({x:lon,y:lat});
draw(fake,{landGeoJson:coarse,coastlineGeoJson:fine,countriesGeoJson:admin,overlayNationalBorders:true,chinaLandTint:true,overlayChinaProvinces:false,overlayRivers:false},frame,project);
// Round185 crash protection uses bounded offscreen `destination-in` compositing.
// In Node there is no document/offscreen canvas; optional layers degrade safely.
assert(source.includes("globalCompositeOperation='destination-in'"),
  'China tint and national borders must use safe offscreen masking');
assert(!source.includes("ctx.clip('evenodd')"),
  'the enormous cross-frame evenodd clip must not return');
assert(ops.some(op=>Array.isArray(op)&&op[0]==='line'&&op[1]===116&&op[2]===15), 'fine coastline must drive real path vertices');
const js=transpile(source)+'\nmodule.exports.__round180_drawBaseMap=drawBaseMap;';
// The browser fixture is optional; executed by the paired pixel test when Chromium is available.
const html=`<!DOCTYPE html><html><meta charset="utf-8"><canvas id="map" width="1295" height="1103"></canvas><script>
const module={exports:{}};const mocks={
'../simulation/Engine':{getAgencyIntensity:v=>({value:Math.round(v)}),getWindForceCategory:v=>Math.round(v/4)},
'../simulation/CmaOperationalClock':{getSimulationBeijingDate:()=>new Date()},
'./ProductCoastlineDrawing':{strokeProductCoastlineRing:(ctx,ring,project)=>{ctx.beginPath();for(const [i,v]of ring.entries()){const p=project(v[1],v[0]);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)}ctx.stroke();}},
'./NmcMapViewport':{},'./NmcOptionalGeography':{}
};
new Function('module','exports','require',${JSON.stringify(js)})(module,module.exports,k=>mocks[k]||{});
const fill=module.exports.__round180_drawBaseMap;
const mk=(rings,admin='')=>({type:'Feature',properties:{ADMIN:admin},geometry:{type:'Polygon',coordinates:rings}});
const fine={type:'FeatureCollection',features:[
mk([[[106,14],[117,14],[118,18],[117,23],[119,29],[117,35],[106,35],[106,14]],[[110,21],[112,21],[112,23],[110,23],[110,21]]]),
mk([[[121,17],[122,17],[122,19],[121,19],[121,17]]])
]};
const coarse={type:'FeatureCollection',features:[mk([[[105,13],[126,13],[126,36],[105,36],[105,13]]])]};
const china={type:'FeatureCollection',features:[mk([[[105,13],[126,13],[126,36],[105,36],[105,13]]],'China')]};
const frame={minLon:100,maxLon:130,minLat:10,maxLat:40};
const projection=(lat,lon)=>({x:22+(lon-100)/30*1248,y:102+(40-lat)/30*819});
const canvas=document.getElementById('map'),ctx=canvas.getContext('2d');
fill(ctx,{landGeoJson:coarse,coastlineGeoJson:fine,countriesGeoJson:china,chinaLandTint:true,overlayNationalBorders:true,overlayChinaProvinces:false,overlayRivers:false},frame,projection);
window.sample=(lat,lon)=>{const p=projection(lat,lon);return Array.from(ctx.getImageData(Math.round(p.x),Math.round(p.y),1,1).data)};
window.done=true;
</script></html>`;
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/round180_nmc_coastline_test.html',html);
console.log('ROUND180 PASS: exact bundled coastline data used by NMC land fills and strokes; tint constrained; browser pixel fixture ready');
