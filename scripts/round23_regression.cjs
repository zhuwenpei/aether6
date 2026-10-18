/** Round 23: run real drawn-path branching and deterministic cloud pixels without a browser. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
function load(file, imports={}) {
  const result = ts.transpileModule(read(file), {fileName:file,reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
  assert(!(result.diagnostics||[]).some(d=>d.category===ts.DiagnosticCategory.Error), `${file} syntax`);
  const module = {exports:{}};
  new Function('exports','module','require',result.outputText)(module.exports,module,id=>{
    if (id in imports) return imports[id];
    throw Error(`Unexpected runtime dependency ${id} in ${file}`);
  });
  return module.exports;
}
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '4.3.13');
assert(read('index.html').includes('AETHER 4.3.13'));
assert.equal((read('src/simulation/Engine.ts').match(/TyphoonSim\/4\.3\.13/g)||[]).length,2);
const app=read('src/App.tsx');
assert(app.includes('if (e.code === "ArrowLeft") desktopActionsRef.current.seekHourDelta(-1)'));
assert(app.includes('else desktopActionsRef.current.seekHourDelta(1)'), 'arrow-key seek must move exactly one simulated hour');
assert(app.includes('if (!e.repeat)') && app.includes('desktopActionsRef.current.joystick(0, dy, dy !== 0)'));
assert(app.includes('!["ArrowUp","ArrowDown"].includes(event.code)') || app.includes('!["ArrowUp", "ArrowDown"].includes(event.code)'), 'draw mode may not intercept left/right');
assert(app.includes('const archivedCenter = rewound ? getDrawnBranchCenter([ty]') && app.includes('branchWithDrawnRoute(typhoonsRef.current, branchHour, route, next)'), 'draw history branching must bind archived origin');
assert(app.includes('maxHourRef.current = branchHour') && app.includes('pendingFrameLogsRef.current = []'), 'branch must invalidate future time/logs');
assert(app.includes('history: ty.history.map(h => Math.abs(h.simHour - branchHour)'), 'route cursor must persist in selected snapshot');
const move=load('src/simulation/DrawnTrack.ts');
const branch=load('src/simulation/DrawnTrackBranch.ts');
const config={controlMode:'draw',drawnTrackRoute:[{lat:10,lon:120},{lat:20,lon:130}],manualForecastRoute:[],categoryColors:{a:'#fff'}};
const history=[
  {simHour:0,lat:10,lon:120,drawnRouteProgressKm:0,dissipated:false,vmax:21},
  {simHour:20,lat:12,lon:122,drawnRouteProgressKm:312,dissipated:false,vmax:35},
  {simHour:80,lat:19,lon:129,drawnRouteProgressKm:1250,dissipated:false,vmax:45}
];
const original=[
  {id:'main',active:true,simHour:80,lat:19,lon:129,drawnRouteProgressKm:1250,history,seasonStartHour:0,seasonEndHour:90,dissipated:false,forecastPath:[{lat:30,lon:145}]},
  {id:'future',active:false,simHour:65,lat:27,lon:146,seasonStartHour:65,history:[{simHour:65,lat:27,lon:146}]}
];
const freshRoute=[{lat:12,lon:122},{lat:12.7,lon:121.8},{lat:13.3,lon:121.6}];
assert.deepEqual(branch.getDrawnBranchCenter(original.slice(0,1),20),freshRoute[0]);
const newConfig={...config,drawnTrackRoute:freshRoute};
const branched=branch.branchWithDrawnRoute(original,20,freshRoute,newConfig);
assert.equal(branched.length,1,'future-born storms must be deleted');
assert.equal(branched[0].lat,12,'branch must restore historical latitude, not current future latitude');
assert.equal(branched[0].lon,122);
assert.equal(branched[0].drawnRouteProgressKm,0,'old arc-length progress must be reset');
assert.equal(branched[0].history.length,2,'future observations must be removed');
assert.equal(branched[0].history[0],history[0],'past observations stay immutable');
assert.equal(branched[0].seasonEndHour,undefined,'future season termination must be removed');
assert.equal(branched[0].history[1].drawnRouteProgressKm,0);
assert.deepEqual(branched[0].history[1].configSnapshot.drawnTrackRoute,freshRoute);
assert.notEqual(branched[0].history[1].configSnapshot.drawnTrackRoute,freshRoute,'history must own copied route');
const firstStep=move.advanceDrawnTrack(branched[0].history[1].configSnapshot.drawnTrackRoute,branched[0].drawnRouteProgressKm,24,1/6);
assert(firstStep && branch.drawnRouteDistanceKm(branched[0],firstStep)<4.1,'first 10-minute physics step must not teleport');
assert(branch.drawnRouteDistanceKm({lat:12,lon:122},freshRoute[freshRoute.length-1])>6, 'test must exercise off-endpoint redraw');
const dynamics=load('src/simulation/ConvectiveDynamics.ts');
const cloud=load('src/simulation/HurricaneTrackerPort.ts',{'./ConvectiveDynamics':dynamics});
const base={id:'round23',lat:18,lon:132,pmin:945,rmw:40,eyewallIntegrity:.78,eyewallWrapProgress:.75,
  eyeFormationMemory:.5,coreCompactness:.65,deepConvectiveCoverage:.7,moistureReservoir:.86,
  innerCoreMoisture:.76,rainbandDominance:.8,broadMoisturePlatform:.45,shear:7,shearDir:230,
  convectiveBurstIndex:.4,coreGeometryContinuity:.96};
function cloudStats(vmax) {
  const storm={...base,vmax,dvorakTNumber:undefined,eyewallIntegrity:vmax>40?.88:vmax<33?.32:.6,
    eyewallWrapProgress:vmax>40?.87:vmax<33?.15:.52,coreCompactness:vmax>40?.82:vmax<33?.27:.5,
    deepConvectiveCoverage:vmax>40?.85:vmax<33?.33:.62,rainbandDominance:vmax>40?.6:.86};
  const core=[],bands=[];
  for (const r of [.045,.075,.10,.13,.16,.20,.25,.30,.35,.40,.45,.50,.55,.60,.65]) {
    for (let i=0;i<24;i++) {
      const angle=2*Math.PI*i/24,R=720;
      const sample=cloud.sampleHurricaneTrackerCloud(storm,18+R*r*Math.cos(angle)/111.12,
        132+R*r*Math.sin(angle)/(111.12*Math.cos(18*Math.PI/180)),48,'ir','round23-cal');
      (r<=.2?core:bands).push(sample);
    }
  }
  const mean=(a,k)=>a.reduce((sum,s)=>sum+s[k],0)/a.length;
  return {coreDensity:mean(core,'density'),bandDensity:mean(bands,'density'),
    coreTemp:mean(core,'brightnessTemperatureC'),bandTemp:mean(bands,'brightnessTemperatureC'),
    veryColdFraction:[...core,...bands].filter(s=>s.brightnessTemperatureC < -80).length/(core.length+bands.length),
    activeBands:bands.filter(s=>s.brightnessTemperatureC < -45).length};
}
const weak=cloudStats(23),strong=cloudStats(58);
assert(weak.bandDensity>weak.coreDensity,'weak storm should be rainband-dominant');
assert(weak.veryColdFraction<0.03,'weak storm must not have widespread extreme-cold cloud tops');
assert(weak.activeBands>15,'weak rainbands retain locally cold convection rather than going all gray');
assert(strong.coreDensity>strong.bandDensity,'strong CDO must be optically denser than bands');
assert(strong.coreTemp<strong.bandTemp-10,'strong CDO mean tops should be appreciably colder');
assert(strong.activeBands>15,'strong rainbands must remain active');
console.log('round23_regression PASS:',JSON.stringify({firstStepKm:+branch.drawnRouteDistanceKm(branched[0],firstStep).toFixed(2),weak,strong}));
