const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const assert = require('node:assert/strict');

function loadTsModule(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports,module,require){${js}\n})(module.exports,module,require)`,
    { module, exports: module.exports, require, console, Math, Float32Array, Uint8Array, DOMException, setTimeout, clearTimeout },
    { filename: file });
  return module.exports;
}

const { DEFAULT_CONFIG } = loadTsModule('src/config/DefaultSettings.ts');
const { getSynopticEnvironmentState } = loadTsModule('src/simulation/SynopticEnvironment.ts');
const { getConfiguredSystemSurfaceState } = loadTsModule('src/simulation/SynopticConfiguredSystems.ts');
const { diagnoseSynopticEnvironmentalWindTarget } = loadTsModule('src/simulation/SynopticEnvironmentalWindModel.ts');
const { sampleTropicalCycloneVortex } = loadTsModule('src/simulation/TropicalCycloneVortex.ts');
const { resolveCirculationSizeTransition } = loadTsModule('src/simulation/CirculationSizeTransition.ts');

const fieldSrc = fs.readFileSync('src/simulation/SynopticWindField.ts', 'utf8');
const vortexSrc = fs.readFileSync('src/simulation/TropicalCycloneVortex.ts', 'utf8');
const engineSrc = fs.readFileSync('src/simulation/Engine.ts', 'utf8');
const environmentSrc = fs.readFileSync('src/simulation/SynopticEnvironment.ts', 'utf8');
const appSrc = fs.readFileSync('src/App.tsx', 'utf8');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth01 = (v) => { const x = clamp(v, 0, 1); return x*x*(3-2*x); };
function stringHash(seed) { let h=2166136261>>>0; for(let i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619);} return h>>>0; }
function hash01(x,y,t,seed){let h=seed^Math.imul((x|0)+0x9e3779b9,0x85ebca6b)^Math.imul((y|0)+0x7f4a7c15,0xc2b2ae35)^Math.imul((t|0)+0x165667b1,0x27d4eb2d);h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return(h>>>0)/4294967295;}
function valueNoise(lat,lon,hour,seed,cellDeg,timeStepHours){const x=(lon+360)/cellDeg,y=(lat+90)/cellDeg,x0=Math.floor(x),y0=Math.floor(y),tx=smooth01(x-x0),ty=smooth01(y-y0),scale=Math.max(.25,timeStepHours),tf=hour/scale,t0=Math.floor(tf),tt=smooth01(tf-t0);const at=(t)=>{const a=hash01(x0,y0,t,seed),b=hash01(x0+1,y0,t,seed),c=hash01(x0,y0+1,t,seed),d=hash01(x0+1,y0+1,t,seed);return (a*(1-tx)+b*tx)*(1-ty)+(c*(1-tx)+d*tx)*ty-.5;};return at(t0)*(1-tt)+at(t0+1)*tt;}
function correlatedNoise(lat,lon,hour,seed){return(valueNoise(lat,lon,hour,seed,.45,1.5)+.65*valueNoise(lat,lon,hour,seed^0x9e3779b9,1,3)+.42*valueNoise(lat,lon,hour,seed^0x243f6a88,2.2,6))/1.04;}

const month = 7;
const cfg = { ...DEFAULT_CONFIG, shearPreset:'july' };
const seedHash = stringHash(`${cfg.seed}|0|0|2026-07-15T00:00:00.000Z`) ^ 0x51ed270b;
function targetAt(lat,lon) {
  const env = getSynopticEnvironmentState(lat,lon,cfg,0);
  const sys = getConfiguredSystemSurfaceState(lat,lon,cfg,month,0);
  const monsoon = Math.max(env.scores.monsoonFlow||0,sys.monsoon);
  const westerly = Math.max(env.scores.westerlyJet||0,env.scores.midLatWesterlies||0,sys.westerly);
  const high = Math.max(env.scores.subtropicalHigh||0,sys.subtropicalHigh);
  const gain = clamp(.995+.10*westerly+.06*monsoon+.025*(env.scores.meanFlow||0),.98,1.18);
  const target = diagnoseSynopticEnvironmentalWindTarget({
    lat,lon,isLand:false,month,
    backgroundTexture:correlatedNoise(lat,lon,17.25,seedHash),
    synopticActivity:smooth01((gain-1.03)/.28),
    monsoonFlow:monsoon,
    crossEquatorialFlow:env.scores.crossEquatorialFlow||0,
    monsoonTrough:Math.max(env.scores.monsoonTrough||0,sys.monsoon*.88),
    subtropicalHigh:high,
    westerlyJet:westerly,midLatWesterlies:westerly,
    westerlyTrough:Math.max(env.scores.westerlyTrough||0,sys.westerlyTrough),
    meanFlow:env.scores.meanFlow||0
  });
  return target.target10mKt;
}
function box(name,lat0,lat1,lon0,lon1) {
  const vals=[];
  for(let lat=lat0;lat<=lat1+1e-9;lat+=1) for(let lon=lon0;lon<=lon1+1e-9;lon+=1) vals.push(targetAt(lat,lon));
  vals.sort((a,b)=>a-b);
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  const q=(p)=>vals[Math.floor((vals.length-1)*p)];
  return {name,avg,min:vals[0],p10:q(.1),p50:q(.5),p90:q(.9),max:vals.at(-1),low:vals.filter(v=>v<10).length/vals.length,normal:vals.filter(v=>v>=10&&v<=16).length/vals.length,high:vals.filter(v=>v>16).length/vals.length};
}
const basins=[
  box('Western North Pacific',10,30,130,160),
  box('Philippine Sea',7,23,125,145),
  box('East China Sea',23,34,118,132),
  box('South China Sea',4,22,105,122),
  box('Subtropical NW Pacific',20,35,145,175),
  box('Westerly belt',36,50,120,170)
];
for(const b of basins){assert.ok(b.min>=4-1e-9,`${b.name} below 4 kt floor`);assert.ok(b.max<=36+1e-9,`${b.name} above 36 kt ceiling`);}
const tropicalSample=box('Tropical/subtropical ocean total',0,35,105,180);
assert.ok(tropicalSample.normal>0.64,`10-16 kt is not the majority: ${(tropicalSample.normal*100).toFixed(1)}%`);
assert.ok(tropicalSample.low<0.12,'4-10 kt tail is too common');
assert.ok(tropicalSample.high<0.34,'16-36 kt tail is too common');
const deepTrough=diagnoseSynopticEnvironmentalWindTarget({lat:15,lon:135,isLand:false,backgroundTexture:-1,synopticActivity:.2,meanFlow:.1});
const monsoonFast=diagnoseSynopticEnvironmentalWindTarget({lat:15,lon:119,isLand:false,month:7,backgroundTexture:0,synopticActivity:.4,meanFlow:.2,monsoonFlow:1});
const westerlyFast=diagnoseSynopticEnvironmentalWindTarget({lat:42,lon:145,isLand:false,backgroundTexture:0,synopticActivity:.4,meanFlow:.4,westerlyJet:1});
assert.ok(deepTrough.target10mKt>=4&&deepTrough.target10mKt<10,'low-wind trough tail missing');
assert.ok(monsoonFast.target10mKt>16&&monsoonFast.target10mKt<=36,'monsoon fast tail missing');
assert.ok(westerlyFast.target10mKt>16&&westerlyFast.target10mKt<=36,'westerly fast tail missing');

// Configured subtropical high must be NH-clockwise: north flank eastward, east flank southward.
const highCfg={...cfg,subtropicalHighEnabled:true,subtropicalHighStrength:1.3,subtropicalHighLat:30,subtropicalHighLon:140,subtropicalHighWestExtent:120,westerliesEnabled:false,monsoonTroughEnabled:false};
const highNorth=getConfiguredSystemSurfaceState(35,135,highCfg,7,0);
const highEast=getConfiguredSystemSurfaceState(30,150,highCfg,7,0);
assert.ok(highNorth.u10>0,'subtropical-high north flank is not eastward');
assert.ok(highEast.v10<0,'subtropical-high east flank is not southward');

// Seasonal monsoon axis must migrate materially poleward in Jul-Aug versus January.
const monCfg={...cfg,subtropicalHighEnabled:false,westerliesEnabled:false,monsoonTroughEnabled:true};
function peakMonsoonLat(m){let best={lat:0,score:-1};for(let lat=0;lat<=25;lat+=.25){const s=getConfiguredSystemSurfaceState(lat,130,monCfg,m,0).monsoon;if(s>best.score)best={lat,score:s};}return best.lat;}
const janAxis=peakMonsoonLat(1), julAxis=peakMonsoonLat(7);
assert.ok(julAxis-janAxis>5,`seasonal monsoon migration too small: Jan=${janAxis}, Jul=${julAxis}`);

// Weak cyclones should deform more strongly in the westerlies than intense warm-core systems.
function pointAt(st,bearing,r){const a=bearing*Math.PI/180;return{lat:st.lat+Math.cos(a)*r/111.12,lon:st.lon+Math.sin(a)*r/(111.12*Math.max(.2,Math.cos(st.lat*Math.PI/180)))}};
function anisotropy(st){const vals=[0,45,90,135,180,225,270,315].map(b=>{const p=pointAt(st,b,130);const x=sampleTropicalCycloneVortex(p.lat,p.lon,st,{slp:1010,shearU:8,shearV:2,westerlyStrength:1});return Math.hypot(x.u,x.v)});return Math.max(...vals)/Math.min(...vals);}
const common={id:'ET',name:'ET',lat:34,lon:140,direction:45,speed:25,rmw:35,r7:{ne:250,se:250,sw:250,nw:250},r10:{ne:130,se:130,sw:130,nw:130},r12:{ne:75,se:75,sw:75,nw:75},landed:false,dissipated:false,extrTransition:0,ewrcState:'none',ewrcProgress:0,active:true,history:[],simHour:0};
const weakAniso=anisotropy({...common,vmax:28,pmin:980});
const strongAniso=anisotropy({...common,vmax:60,pmin:930});
assert.ok(weakAniso>strongAniso+0.12,`weak TC does not deform more in westerlies: weak=${weakAniso}, strong=${strongAniso}`);

// Same storm state must not get a larger vortex merely because landfall=true.
const landBase={...common,lat:20,lon:120,vmax:45,pmin:950,rmw:32,r7:{ne:240,se:250,sw:230,nw:235},r10:{ne:130,se:140,sw:120,nw:125},r12:{ne:70,se:78,sw:65,nw:68},isStructureDamaged:true,structuralDamageHours:18,terrainHollowCoreMemory:.7};
for(const r of [50,100,180,250]){const p=pointAt(landBase,90,r);const sea=sampleTropicalCycloneVortex(p.lat,p.lon,{...landBase,landed:false},{slp:1010,shearU:5,shearV:1,westerlyStrength:0});const land=sampleTropicalCycloneVortex(p.lat,p.lon,{...landBase,landed:true},{slp:1010,shearU:5,shearV:1,westerlyStrength:0});assert.ok(Math.hypot(land.u,land.v)<=Math.hypot(sea.u,sea.v)*1.03,`landfall inflated vortex at ${r} km`);}

// Long circulation transitions are continuous on the physics clock, including the common UI order
// "change size first -> select 72 h" guarded statically below.
const transitionCfg={circulationSizeReferenceKm:500,circulationSizeTransitionHours:72,circulationSizeTransitionStartHour:10,circulationSizeTransitionFromKm:380,circulationSizeTransitionTargetKm:500};
const t10=resolveCirculationSizeTransition(transitionCfg,10), t1016=resolveCirculationSizeTransition(transitionCfg,10+1/6), t13=resolveCirculationSizeTransition(transitionCfg,13), t46=resolveCirculationSizeTransition(transitionCfg,46), t82=resolveCirculationSizeTransition(transitionCfg,82);
assert.equal(t10.referenceKm,380);assert.ok(t1016.referenceKm>380&&t1016.referenceKm<381,'first 10-min step jumps');assert.ok(t13.referenceKm<390,'first 3 h jumps');assert.ok(Math.abs(t46.referenceKm-440)<1e-9);assert.equal(t82.referenceKm,500);

assert.ok(!fs.existsSync('src/simulation/SynopticEnvironmentWindPreset.ts'),'old geographic wind-preset module still exists');
assert.ok(fieldSrc.includes('diagnoseSynopticEnvironmentalWindTarget')&&fieldSrc.includes('oceanEnvironmentalFloorMs'),'global environmental-wind model/floor not wired');
assert.ok(fieldSrc.includes('dragInterior = 0.26')&&fieldSrc.includes('solverSlopeEast')&&fieldSrc.includes('coastalTurbulenceGate = Math.pow')&&fieldSrc.includes('Interpolate in time as well as space'),'coastline jet/pulsing guards missing');
assert.ok(vortexSrc.includes('baroclinicShape')&&vortexSrc.includes('Math.max(baseRmw * 1.03, 28)'),'westerly deformation / landfall compactness missing');
assert.ok(environmentSrc.includes('seasonalMonsoonLatitudeShift')&&engineSrc.includes('configuredSeasonMonth'), 'seasonal monsoon migration is not wired into both synoptic and legacy environment paths');
assert.ok(engineSrc.includes('etWesterlyIngress')&&engineSrc.includes('etGrowthTau'), 'gradual westerly-driven extratropical transition logic missing');
assert.ok(engineSrc.includes('manualCirculationTransitionActive || isExactlyOnThreeHour'),'timed wind-radii transition still stair-steps at 3 h');
assert.ok(engineSrc.includes('expansionTarget = Math.min(expansionTarget, previousExpansion * 0.94)'),'landfall circulation-expansion clamp missing');
assert.ok(appSrc.includes('pendingCirculationSizeOriginRef')&&appSrc.includes('applyCirculationTransitionDuration'),'size-first then duration UI transition repair missing');
assert.ok(engineSrc.includes('newPmin = Math.max(850, Math.min(1045, newPmin))'),'pressure sanity clamp missing');

console.log('ROUND87 ENVIRONMENT TARGET AVERAGES (kt; no TC contribution)');
for(const b of basins) console.log(`${b.name}: avg=${b.avg.toFixed(2)} p10=${b.p10.toFixed(2)} p50=${b.p50.toFixed(2)} p90=${b.p90.toFixed(2)} min=${b.min.toFixed(2)} max=${b.max.toFixed(2)}`);
console.log(`Tropical/subtropical distribution: 4-10=${(tropicalSample.low*100).toFixed(1)}% 10-16=${(tropicalSample.normal*100).toFixed(1)}% 16-35=${(tropicalSample.high*100).toFixed(1)}%`);
console.log(`Seasonal monsoon axis @130E: Jan=${janAxis.toFixed(2)}N Jul=${julAxis.toFixed(2)}N`);
console.log(`Westerly deformation anisotropy: weak=${weakAniso.toFixed(3)} strong=${strongAniso.toFixed(3)}`);
console.log('round87_global_environment_coast_landfall_transition_regression: PASS');
