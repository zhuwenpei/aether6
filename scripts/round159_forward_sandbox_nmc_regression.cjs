'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const evalModule=(file)=>{
  const src=fs.readFileSync(file,'utf8');
  const js=ts.transpileModule(src,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};vm.runInNewContext(js,{exports:module.exports,module,Math,Number,Array,Object,Set,Map,Date,Error});
  return module.exports;
};
const {issuePreSimulationReference,rebasePreSimulationReference,preSimulationFixAt,blendPreSimulationForecast}=evalModule('src/simulation/PreSimulationReference.ts');
const radii=(x)=>({ne:x,se:x,sw:x,nw:x});
const fix=(h)=>({leadHour:h,lat:16+h*.2,lon:140-h*.15,vmax:52-h*.3,pmin:930+h,speed:25-h*.1,direction:290,rmw:22,
  r7:radii(260-h),r10:radii(120-h),r12:radii(60-h),category:'TY',landed:false,dissipated:false});
const refA={version:1,stormId:'s1',issueHour:50,authority:.995,completedLeadHour:120,fixes:[...Array(121)].map((_,i)=>fix(i))};
const refB={...refA,issueHour:80,completedLeadHour:12,fixes:[...Array(13)].map((_,i)=>({...fix(i),lat:40+i*.03}))};
const timeline=[{simHour:50,preSimulationReference:refA},{simHour:80,preSimulationReference:refB}];
const storm={id:'s1',lat:20,lon:132,history:timeline};
assert.strictEqual(issuePreSimulationReference(storm,49),undefined,'future reference leaked into historical playback');
assert.strictEqual(issuePreSimulationReference(storm,60).issueHour,50,'previous reference not inherited');
assert.strictEqual(issuePreSimulationReference(storm,81).issueHour,80,'new reference did not supersede old');
assert.strictEqual(issuePreSimulationReference(storm,95),undefined,'obsolete branch resurrected after superseding branch expired');
// The real centre is on the pre-simulation route, already at lead 12.
const forward=rebasePreSimulationReference(refA,62,{lat:18.4,lon:138.2});
assert(forward && Math.abs(forward.fixes[0].lat-18.4)<1e-8 && Math.abs(forward.fixes[0].lon-138.2)<1e-8,'spatial rebase origin mismatch');
assert(Math.abs(forward.fixes[1].lat-18.6)<1e-8,'geographic next fix was not retained');
assert(Math.abs(forward.completedLeadHour-107)<1e-8 || Math.abs(forward.completedLeadHour-108)<1e-8,'forward recorded lifetime incorrectly reset');
const base=[0,1,2,3].map(h=>({simHour:h,lat:18.4+h*.2,lon:138.2-h*.15,vmax:h?50:48,pmin:940,speed:25,category:'台风'}));
const merged=blendPreSimulationForecast(base,forward,3);
assert.strictEqual(merged[0].lat,18.4,'authoritative current centre changed');
assert(Math.abs(merged[1].lat-18.6)<0.05,'next branch location is not spatially guided');
assert(merged[1].vmax<50 && merged[1].vmax>47,'moderate physically limited wind blending failed');
assert(merged[1].r7.ne>0,'spatial wind radii not incorporated');
// Full ordinary forecast geometry must be computed regardless of recorded branch length.
const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
assert(engine.includes('const preferredGeometry = geometryPath;'),'short sandbox branch incorrectly truncates later forecast');
assert(engine.includes('rebasePreSimulationReference(stored,issueHour'),'saved reference is not rebased at later issue times');
// Isolate the real NMC public timing/straight-line section without mocking business methods.
const nmc=fs.readFileSync('src/utils/NmcForecastProduct.ts','utf8');
const a=nmc.indexOf('export function nmcOperationalLeadHours('),b=nmc.indexOf('function getNmcConeSections(',a);
assert(a>=0&&b>a);
const code=ts.transpileModule(nmc.slice(a,b).replace('export function','function'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const ctx={Math};vm.createContext(ctx);vm.runInContext(code+'\nthis.leads=nmcOperationalLeadHours;',ctx);
assert.deepStrictEqual([...ctx.leads(120)],[0,12,24,36,48,60,72,96,120]);
assert.deepStrictEqual([...ctx.leads(72)],[0,12,24,36,48,60,72]);
assert(nmc.includes('const pts=nmcStraightFixes(original,o.issueHour);'),'forecast renderer ignores fixed straight vertices');
assert(nmc.includes('renderEnvelope(ctx,pts,project,wrap,o.issueHour);'),'uncertainty cone does not use matching polyline');
assert(nmc.includes('const straight=nmcStraightFixes(pts,o.issueHour);'),'leader obstacle layout does not use matching polyline');
const ui=fs.readFileSync('src/components/ForecastPreSimulation.tsx','utf8');
assert(ui.includes('const [playing,setPlaying]=useState(false)'),'branch must enter paused');
assert(ui.includes('speed:8')&&ui.includes('setSpeed(Number(e.target.value))'),'8x must remain adjustable');
assert(ui.includes('<ControlDrawer')&&ui.includes('onConfigChange={onConfigChange}')&&ui.includes('onLayersChange=')&&ui.includes('onUpdateTyphoonIdentity='),'branch must reuse the main simulation settings pages');
assert(ui.includes('onForecastRoutePoint={handlePlacement}')&&ui.includes('onConfirm(ref)'),'branch route tools/confirmation disconnected');
assert(ui.includes('sandboxMode'),'branch must isolate parent archive/product actions');
assert(ui.includes('createSimulationArchiveBlob(branchArchiveData(),mode)')&&ui.includes('readSimulationArchiveFile(file)')&&ui.includes('data.startDate!==startDate.toISOString()'),'branch-only archive import/export is not sandbox-scoped');
console.log('ROUND159 PASS: initial pause, 8x, independent settings/tools, continuous/superseding forecast references, fixed storm-centre rebase, 120h forecast continuity, 12/24h NMC cadence and straight cone vertices.');
