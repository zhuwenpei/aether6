/** Round24: history branch, no-teleport routing, favorable weak-storm guidance, clear-eye and station performance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function load(name, injected = {}) {
  const result = ts.transpileModule(read(name), { fileName: name, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.equal((result.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0, `${name} syntax`);
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputText)(module, module.exports, id => {
    if (Object.hasOwn(injected, id)) return injected[id];
    throw Error(`unexpected runtime import ${id} from ${name}`);
  });
  return module.exports;
}
assert.equal(JSON.parse(read('package.json')).version, '4.3.13');
assert(read('index.html').includes('AETHER 4.3.13'));
const branch = load('src/simulation/DrawnTrackBranch.ts');
const track = load('src/simulation/DrawnTrack.ts');
const route = [{lat:10, lon:120},{lat:10,lon:123},{lat:12,lon:125}];
const mid = track.advanceDrawnTrack(route, 0, 36, 8);
const config = {controlMode:'draw',drawnTrackRoute:route,manualForecastRoute:[],intensificationRate:1};
const past = [
  {simHour:0,lat:10,lon:120,vmax:18,pmin:998,drawnRouteProgressKm:0,dissipated:false},
  {simHour:8,lat:mid.lat,lon:mid.lon,vmax:25,pmin:984,drawnRouteProgressKm:mid.progressKm,dissipated:false},
  {simHour:28,lat:12,lon:125,vmax:42,pmin:954,drawnRouteProgressKm:1000,dissipated:false}
];
const storm = {id:'storm',history:past,active:true,lat:12,lon:125,vmax:42,drawnRouteProgressKm:1000,forecastPath:[{lat:14,lon:127}],seasonEndHour:35};
const future = {id:'new',history:[{simHour:20,lat:15,lon:128,dissipated:false}],active:false};
const preserved = branch.branchWithExistingDrawnRoute([storm,future],8,config);
assert.deepEqual(preserved.config.drawnTrackRoute,route,'ordinary branch keeps original waypoints');
assert.equal(preserved.storms.length,1,'future storms removed');
assert.equal(preserved.storms[0].history.length,2,'old future snapshots removed');
assert.equal(preserved.storms[0].drawnRouteProgressKm,mid.progressKm,'preserve archived cursor');
assert(Math.abs(preserved.storms[0].lat-mid.lat)<1e-9,'restore archived center');
const step=track.advanceDrawnTrack(preserved.config.drawnTrackRoute,preserved.storms[0].drawnRouteProgressKm,36,1/6);
assert(branch.drawnRouteDistanceKm(step,preserved.storms[0])<=6.01,'first step must move by at most six km');
// An older corrupt save may carry a cursor from the *future*. Reset safely at the archived centre.
const corrupted = [{...storm,history:[past[0],{...past[1],drawnRouteProgressKm:1000},past[2]]}];
const fixed = branch.branchWithExistingDrawnRoute(corrupted,8,config);
assert.equal(fixed.storms[0].drawnRouteProgressKm,0);
assert.equal(fixed.config.drawnTrackRoute[0].lat,mid.lat);
assert.equal(fixed.config.drawnTrackRoute[0].lon,mid.lon);
const safeStep=track.advanceDrawnTrack(fixed.config.drawnTrackRoute,0,36,1/6);
assert(branch.drawnRouteDistanceKm(safeStep,fixed.storms[0])<=6.01,'corrupt cursor must not teleport');
const explicit = branch.branchWithDrawnRoute([storm],8,[{lat:mid.lat,lon:mid.lon},{lat:11,lon:126}],config);
assert.equal(explicit[0].drawnRouteProgressKm,0,'explicit clear and redraw must reset cursor');
assert.equal(explicit[0].lat,mid.lat);
const app=read('src/App.tsx');
assert(app.includes('branchWithExistingDrawnRoute(typhoonsRef.current, currentHour, configRef.current)'), 'Play from history preserves route');
assert(app.includes('const continueAtEndpoint = route.length >= 2 &&') && app.includes('(rewound ||'), 'continuing history route does not automatically clear it');
assert(app.includes('branchWithDrawnRoute(typhoonsRef.current, branchHour, route, next)'), 'explicit cleared route is separately branched');

const rawGuidance=(storm,hour,scene,seed,reference,horizon)=>['ICON','GFS','EURO'].map((name,k)=>({spec:{name},track:reference.map(p=>({lat:p.lat+k*.05,lon:p.lon-k*.04}))}));
const guidance=load('src/simulation/AetherEnsembleGuidance.ts',{
  './HurricaneTrackerPort':{calculateHurricaneTrackerGuidanceTracks:rawGuidance},
  './SynopticEnvironment':{getSynopticEnvironmentState:()=>({rh700:85,scores:{dryAir:0},shear:5,sst:29,ohc:90})}
});
const developing={id:'developing',lat:15,lon:130,vmax:18,pmin:999,rmw:40,shear:5,
  configSnapshot:config,landed:false,dryAirCoreExposure:0,dryAirIntrusion:0};
const reference=Array.from({length:25},(_,i)=>({lat:15+i*.06,lon:130+i*.09,simHour:i*3,vmax:18+Math.max(0,i-1)*.28,pmin:999-i*.32,landed:false}));
const centers=guidance.buildAetherCenterGuidance(developing,0,[developing],'round24-genesis',reference,72,{
  ...config,newEnvironmentPhysicsEnabled:false,dryAirStrength:0,intensificationRate:1});
assert.equal(centers.length,8);
const firstCenters=centers.map(m=>m.track[1].vmax);
assert(firstCenters.filter(v=>v>=17.2).length>=6,'favorable TS cannot make every model instantly become TD');
const poor=guidance.buildAetherCenterGuidance({...developing,shear:40},0,[developing],'round24-genesis',reference,72,{
  ...config,newEnvironmentPhysicsEnabled:false,dryAirStrength:1.4,intensificationRate:0});
assert.equal(poor.length,8,'adverse environment remains supported');
(async()=>{
  const members=await guidance.buildAetherEnsembleMembers({storm:developing,currentHour:0,scene:[developing],seed:'round24-genesis',
    referencePath:reference,selectedModelIds:['GEFS','ECMWF'],membersPerModel:10,horizon:72,
    config:{...config,newEnvironmentPhysicsEnabled:false,dryAirStrength:0,intensificationRate:1}});
  const at3=members.filter(m=>!m.control).map(m=>m.track[1].vmax);
  assert(at3.filter(v=>v>=17.2).length>=Math.floor(at3.length*.6),'most viable ensemble members should retain TS status at 3h');
  assert(read('src/simulation/Engine.ts').includes('recentSuccessfulEye'), 'successful eyewall replacement needs eye-size memory');
  assert(read('src/simulation/HurricaneTrackerPort.ts').includes('successfulTakeover'), 'satellite must remove false double rings on successful takeover');
  const dynamics=load('src/simulation/ConvectiveDynamics.ts');
  const cloud=load('src/simulation/HurricaneTrackerPort.ts',{'./ConvectiveDynamics':dynamics});
  const healthy={id:'eye',lat:15,lon:130,vmax:60,pmin:925,rmw:60,eyeRadiusKm:38,
    eyeClearance:.93,eyeObstruction:.04,eyeFormationMemory:.94,eyewallIntegrity:.93,eyewallWrapProgress:.95,
    secondaryEyewallStrength:.7,ewrcState:'recovering_success',ewrcIsFailure:false,ewrcProgress:.4,
    dryAirCoreExposure:0,terrainCoreLandFraction:0,shear:5,deepConvectiveCoverage:.85,moistureReservoir:.95};
  const eye=cloud.sampleHurricaneTrackerCloud(healthy,15,130,48,'ir','round24-eye');
  assert(Number.isFinite(eye.density)&&Number.isFinite(eye.brightnessTemperatureC),'completed eye should render finite diagnostics');
  const sampling=load('src/components/StationChartSampling.ts');
  const rows=Array.from({length:3600},(_,i)=>({time:i/6,wind:10,pressure:1000,precipitation:2,stormSurge:0}));
  rows[1000].wind=86;rows[2000].pressure=890;rows[2500].precipitation=146;rows[3000].stormSurge=5;
  const reduced=sampling.downsampleStationChartData(rows);
  assert(reduced.length<=420&&reduced.length>0,'station chart must stay bounded');
  for(const idx of [0,1000,2000,2500,3000,3599])assert(reduced.includes(rows[idx]),`extreme/end ${idx} must survive`);
  const station=read('src/components/StationHistory.tsx');
  assert(station.includes('setTimeout(work, 0)')&&station.includes('downsampleStationChartData(historyData)'),'station work must be deferred');
  assert.equal((station.match(/<LineChart data=\{chartData\}>/g)||[]).length,4,'all four charts must be lightweight');
  assert(station.includes('historyData={historyData}'),'full-resolution data must remain available for report');
  console.log('round24_regression PASS:',JSON.stringify({firstStepKm:+branch.drawnRouteDistanceKm(step,preserved.storms[0]).toFixed(2),
    reanchorStepKm:+branch.drawnRouteDistanceKm(safeStep,fixed.storms[0]).toFixed(2),
    centersRemainingTS:firstCenters.filter(v=>v>=17.2).length,membersRemainingTS:at3.filter(v=>v>=17.2).length,
    chartOriginal:rows.length,chartReduced:reduced.length,eyeTemperatureC:+eye.brightnessTemperatureC.toFixed(1)}));
})().catch(error=>{console.error(error);process.exitCode=1;});
