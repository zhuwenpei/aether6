'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const output=ts.transpileModule(fs.readFileSync('src/simulation/PreSimulationReference.ts','utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  reportDiagnostics:true
});
assert.equal(output.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const m={exports:{}};
vm.runInNewContext(output.outputText,{module:m,exports:m.exports,Math,Number,Error});
const {blendPreSimulationForecast,preSimulationFixNearPosition,rebasePreSimulationReference,
  buildPreSimulationReference}=m.exports;
const rad=n=>({ne:n,se:n,sw:n,nw:n});
const snapshot=(h,lon,vmax,landed,base={})=>({
  simHour:h,lat:23,lon,vmax,pmin:1012-vmax*1.35,speed:22,rmw:32,
  r7:rad(210),r10:rad(90),r12:rad(40),direction:270,category:'台风',
  dissipated:false,landed,...base
});
const normalLon={0:118,1:119,2:120.5,3:121,4:122,5:122.6,6:123.2,9:125};
const raw=[0,1,2,3,4,5,6,9].map(h=>({
  ...snapshot(h,normalLon[h], h===0?45:58+h,false),simHour:h
}));
const ref=buildPreSimulationReference({id:'landfall',history:[
  snapshot(80,118,45,false),snapshot(81,119,46,false),
  snapshot(82,120.5,45,true),snapshot(83,121,42,true),
  snapshot(84,122,38,true)
]},80);
assert.equal(ref.fixes.length,5);
const fix=preSimulationFixNearPosition(ref,{lat:23,lon:121},0);
assert.equal(fix.vmax,42,'spatial fixation should find land fix at 121E, not time-zero 45m/s');
const shifted=blendPreSimulationForecast(raw,ref,9,{isLandAt:(_,lon)=>lon>=120.5});
// Round165: the native forward distance, not a matching clock hour,
// determines where the guided cyclone sits. A physically capped fast segment
// arrives later than the old time-indexed 120.5E fix; it must NOT be rewound.
assert(shifted[2].lon>120&&shifted[2].lon<120.5,'path did not honor forward distance');
for(let i=1;i<shifted.length;i++)
  assert(shifted[i].lon>=shifted[i-1].lon-1e-6,'track rewound to old time-indexed fix');
const firstLand=shifted.findIndex(p=>p.landed);
assert(firstLand>=2&&firstLand<=4,'spatial landfall was not diagnosed at correct geography');
assert(shifted[firstLand].vmax<=shifted[firstLand-1].vmax,'landfall manufactured strengthening');
for(let i=firstLand+1;i<shifted.length;i++){
  assert(shifted[i].vmax<=shifted[i-1].vmax+1e-6,'unapproved inland intensity gain');
  assert(shifted[i].pmin>=shifted[i-1].pmin-1e-6,'inland pressure deepened despite weakening');
}
assert.equal(shifted.length,raw.length,'seam fabricated extra forecast hours');
for(let i=1;i<shifted.length;i++){
  const a=shifted[i-1],b=shifted[i],dt=b.simHour-a.simHour;
  const km=Math.hypot((b.lat-a.lat)*111.12,(b.lon-a.lon)*111.12*Math.cos(b.lat*Math.PI/180));
  assert(km<=120*dt+0.1,'reconnection made an implausible translation jump');
}
// Geo-fix land/sea mismatch: no 48 m/s on actual land after an offshore 45 m/s.
const seaRef={...ref,fixes:ref.fixes.map(f=>({...f,landed:false,vmax:f.leadHour>=2?48:45}))};
const geoMismatch=blendPreSimulationForecast(raw,seaRef,9,{isLandAt:(_,lon)=>lon>=120.5});
assert(geoMismatch[firstLand].vmax<=geoMismatch[firstLand-1].vmax+1e-6,
  'offshore 48 m/s was incorrectly imported into real land after a weaker fix');
assert(geoMismatch[firstLand+1].vmax<=geoMismatch[firstLand].vmax+1e-6,
  'coastline land flag did not override displaced branch offshore state');
// The exception is explicit on-land strengthening in the user-run sandbox.
const exceptional={...ref,fixes:ref.fixes.map(f=>({...f,vmax:f.leadHour===3?48:f.vmax}))};
const allowed=blendPreSimulationForecast(raw,exceptional,9,{isLandAt:(_,lon)=>lon>=120.5});
assert(allowed[firstLand].vmax>shifted[firstLand].vmax+.6,
  'authentic sandbox on-land strengthening must still influence the forecast');
assert(allowed[firstLand].vmax<53,'ordinary model inflated the sandbox exception');
// Reissuing after track divergence should not physically move a mainland landfall.
const rebased=rebasePreSimulationReference(ref,81,{lat:23,lon:120.5});
assert(rebased&&rebased.fixes[0].lon===120.5,'current forecast origin did not follow the observed centre');
assert(Math.abs(rebased.fixes.at(-1).lon-122)<.15,
  'rigid route translation misplaced a future landfall/strength analysis');
assert.equal(rebased.fixes[0].leadHour,0);
assert(rebased.completedLeadHour>0&&rebased.completedLeadHour<=3,'spatial reissue should inherit only remaining route');
assert.equal(rebasePreSimulationReference(ref,81,{lat:23,lon:122}),undefined,'a centre at route end must not rewind to earlier nodes');
console.log('ROUND164 SPATIAL PASS: geometry/intensity same geographic fix, inland 45->42->38, displaced sea/land guard, sandbox exception, geographic reattachment, reference horizon.');
