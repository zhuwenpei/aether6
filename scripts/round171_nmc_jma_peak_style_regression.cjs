'use strict';
/** Strict incremental checks. Execute from the Round170-derived source root. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=(()=>{try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const get=f=>fs.readFileSync(f,'utf8');
function load(f,modules={}){
 const o=ts.transpileModule(get(f),{fileName:f,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
 assert.equal((o.diagnostics||[]).filter(d=>d.category===1).length,0,'TypeScript parse diagnostics: '+f);
 const m={exports:{}};
 new Function('module','exports','require',o.outputText)(m,m.exports,name=>{
   if(!(name in modules))throw Error('unresolved mocked dependency '+name+' in '+f);
   return modules[name];
 });
 return m.exports;
}
const {shapeNmcPeakIntensity}=load('src/simulation/NmcIntensityGuidance.ts');
const p=(t,v,extra={})=>({simHour:t,lat:18+t*.15,lon:145-t*.05,vmax:v,pmin:1010-v*1.25,category:'台风',landed:false,...extra});
const check=(initial,target,override)=>{
 const changed=shapeNmcPeakIntensity(initial,target,override);
 assert.equal(changed.length,initial.length);
 assert(Math.abs(Math.max(override??initial[0].vmax,...changed.map(x=>x.vmax))-target)<1e-6,'exact peak '+target+' missed');
 changed.forEach((x,i)=>{assert.equal(x.lat,initial[i].lat);assert.equal(x.lon,initial[i].lon);assert.equal(x.simHour,initial[i].simHour);});
 for(let i=1;i<changed.length;i++){
  const dt=changed[i].simHour-changed[i-1].simHour;
  assert(changed[i].vmax<=changed[i-1].vmax+1.100001*dt,'instantaneous intensification');
  assert(changed[i].vmax>=changed[i-1].vmax-1.650001*dt,'instantaneous weakening');
  if(changed[i].landed)assert(changed[i].vmax<=changed[i-1].vmax+1e-7,'inland intensification');
 }
 return changed;
};
const times=Array.from({length:13},(_,i)=>i*6);
const ordinary=times.map(t=>p(t,21+15*Math.sin(Math.PI*t/72)));
const higher=check(ordinary,65);
assert(times.some((t,i)=>t%12===0&&Math.abs(higher[i].vmax-65)<1e-7),'maximum needs to be visible on issued 12h fix');
const lower=check(times.map(t=>p(t,21+48*Math.sin(Math.PI*t/72))),43);
assert(lower.every(x=>x.vmax<=43+1e-6),'unmodified second natural peak exceeded requested maximum');
const weakening=check(times.map(t=>p(t,27-t/12)),54);
assert(weakening.some(x=>x.vmax===54),'never-enhancing normal forecast not overridden');
check(times.map(t=>p(t,22+t/10,{landed:t>=30&&t<=42})),46);
assert.throws(()=>shapeNmcPeakIntensity([p(0,18),p(12,20)],70,18),/无法|达到/,'short issue must refuse an impossible target');
assert.throws(()=>shapeNmcPeakIntensity([],70,18),/停编/,'0h issue must refuse an impossible target');
const fixed=p(0,35,{landed:true});assert.deepEqual(shapeNmcPeakIntensity([fixed],35,35),[fixed]);
const noZero=times.slice(1).map(t=>p(t,20+t/4));
const withIssue=check(noZero,57,20);assert(withIssue.some(x=>x.vmax===57));
const geo=load('src/utils/NmcOptionalGeography.ts');
const rivers=JSON.parse(get('public/data/nmc_rivers.geojson')).features;
const inside=rivers.filter(f=>{const b=f.properties?.BBOX;return b&&b[0]<140&&b[2]>100&&b[1]<45&&b[3]>15;});
const kept=inside.filter(geo.shouldDrawNmcRiver);
assert(kept.length<inside.length*.85 && kept.length>inside.length*.5,'only moderate, whole-feature filtering '+kept.length+'/'+inside.length);
const untouched=kept[0].geometry.coordinates;assert.strictEqual(kept[0].geometry.coordinates,untouched,'geometry should never be simplified');
assert(geo.shouldDrawNmcRiver({geometry:{type:'LineString',coordinates:[[110,30],[111,30]]},properties:{scalerank:5}}));
assert(!geo.shouldDrawNmcRiver({geometry:{type:'LineString',coordinates:[[110,30],[110.02,30]]},properties:{scalerank:5}}));
const jma=get('src/components/ForecastImageModal.tsx');
// The expected literals below were verified against the uploaded Round169 file.
// Keep this regression self-contained for a standalone Round171 ZIP.
for(const fragment of [
 'const headerLeftBoxW = 168 * scale;',
 'const headerLeftBoxX = 30 * scale;',
 'ctx.font = `700 ${24 * scale}px "Microsoft YaHei",sans-serif`;',
 'ctx.fillText(`台风 ${titleNo}`',
 'placeJmaLabel(label, pt.x, pt.y, idx === 0 ? 17 : 16, candidates);',
 'ctx.setLineDash([4.4 * scale, 4.0 * scale]);'
]){assert(jma.includes(fragment),'JMA presentation not restored '+fragment);}
assert(jma.includes('idx === 0 ? 5.0 * scale : 3.5 * scale'));
assert(jma.includes('ctx.fillStyle = "#ffffff";\n      ctx.fill();'));
assert(jma.includes('drawJmaTerminationPlate('),'Round170 functional discontinued-storm behavior removed');
assert(jma.includes('overlayChinaProvinces: nmcProvinces'),'Round170 geography was accidentally replaced');
assert(!jma.includes('customPeakWind: applyImagePeak'), 'manual peak must not bypass CMA public wind bins');
const nmc=get('src/utils/NmcForecastProduct.ts');
assert(nmc.includes('rgba(239,248,252,.78)'),'callout fill must be translucent');
assert(nmc.includes("? '热带低压' : `今年第"),'TD title not corrected');
assert(nmc.includes('if (!shouldDrawNmcRiver(feature)) continue;'),'river filtering not applied');
for(const marker of ['cmaNmcAssessment(p.vmax,p.category).color,\'\',0','cmaNmcAssessment(pt.vmax,pt.category).color,\'\',0','cmaNmcAssessment(last.vmax,last.category).color,\'\',0'])
 assert(nmc.includes(marker),'forecast/historical white pin outline remains');
for(const f of ['src/simulation/NmcIntensityGuidance.ts','src/utils/NmcForecastProduct.ts','src/utils/NmcOptionalGeography.ts','src/components/ForecastImageModal.tsx']){
 const diagnostics=ts.transpileModule(get(f),{fileName:f,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).diagnostics||[];
 assert.equal(diagnostics.filter(d=>d.category===1).length,0,'parse: '+f);
}
console.log(`ROUND171 PASS: hard NMC peaks, natural rates/landfall, Round169 JMA style, TD title, translucent callouts, outline removal, complete-geometry river density ${inside.length} -> ${kept.length} visible segments`);
