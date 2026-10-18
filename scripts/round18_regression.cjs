/** Standalone regression: NODE_PATH="$(npm root -g)" node scripts/round18_regression.cjs */
const fs=require('node:fs'), assert=require('node:assert/strict');
const ts=require('typescript');
const root=require('node:path').resolve(__dirname,'..');
const read=(f)=>fs.readFileSync(root+'/'+f,'utf8');
const compile=(file,imports={})=>{
 const {outputText,diagnostics}=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}});
 assert(!diagnostics.some(d=>d.category===ts.DiagnosticCategory.Error),'transpile '+file);
 const mod={exports:{}};
 new Function('module','exports','require',outputText)(mod,mod.exports,id=>{if(id in imports)return imports[id];throw Error(file+': unexpected import '+id)});
 return mod.exports;
};
(async()=>{
const {advanceDrawnTrack}=compile('src/simulation/DrawnTrack.ts');
const route=[{lat:19,lon:130},{lat:20,lon:130}], ext=[...route,{lat:21,lon:131}];
const reached=advanceDrawnTrack(route,0,120,1);
assert(reached.finished,'short route must reach end');
const appended=advanceDrawnTrack(ext,reached.progressKm,30,1);
assert(!appended.finished&&appended.lat>20&&appended.lon>130,'continuation must advance beyond the old terminus');
const paused=advanceDrawnTrack(ext,reached.progressKm,0,1);
assert(Math.abs(paused.lat-20)<1e-8,'continuing draft must retain existing arc length progress');
const reset=advanceDrawnTrack([{lat:20,lon:130},{lat:20,lon:129}],0,30,1);
assert(reset.lon<130&&Math.abs(reset.lat-20)<1e-8,'cleared route must start at current center');

const app=read('src/App.tsx'), map=read('src/components/MapView.tsx');
assert(app.includes('continuingDrawnTrackRef.current ? (ty.drawnRouteProgressKm ?? 0) : 0'));
assert(app.includes('const clearDrawnTrack = () =>')&&app.includes('继续画点')&&app.includes('aria-label="删除全部画点"'));
assert(map.includes('event.button !== 1')&&map.includes('L.DomUtil.setPosition(pane')&&map.includes('map.panBy([-totalX,-totalY],{animate:false})'));
assert(map.includes('onSelectTrackPointRef.current?.(state.simHour);')&&map.includes('L.DomEvent.stop(e.originalEvent);'));
assert(map.includes('const oceanFingerprint = oceanTextureFingerprint('));
assert(map.includes('!uiOnly.has(key)')&&map.includes('lastRadarMoveAt >= 125'));
const report=read('src/components/TyphoonReportModal.tsx');
assert(report.includes('const baseW = 1280;')&&report.includes('fullResolutionExport'));

const rainSrc=read('src/utils/ObservedRainfallMap.ts');
assert(rainSrc.includes('calibrated = fullTrackProduct ? Math.max(0, total)'));
assert(rainSrc.includes('if (fullTrackProduct || landMask[idx] !== 1 || preExtremeLocalization[idx] <= 0) continue;'));
const rain=compile('src/utils/RainfallTimeWindow.ts');
const base={lat:22,lon:130,simHour:4,vmax:30,pmin:990,rmw:35,direction:280,speed:20,r7:{ne:100,se:90,sw:70,nw:80},r10:{ne:80,se:75,sw:65,nw:70},r12:{ne:30,se:20,sw:20,nw:30}};
const storm={...base,history:Array.from({length:5},(_,h)=>({...base,simHour:h,lon:130-h*.1}))};
const lifetime=rain.buildWeightedRainSnapshots(storm,4,4),day=rain.buildWeightedRainSnapshots(storm,4,1);
const integrated=(w)=>w.snapshots.reduce((sum,s)=>sum+s.dtHours*(3+0.3*s.state.simHour),0);
assert(Math.abs(lifetime.snapshots.reduce((s,p)=>s+p.dtHours,0)-4)<1e-6);
assert(integrated(lifetime)>=integrated(day),'physically summed lifetime cannot be below one of its windows at a fixed location');

const dynamics=compile('src/simulation/ConvectiveDynamics.ts');
const clouds=compile('src/simulation/HurricaneTrackerPort.ts',{'./ConvectiveDynamics':dynamics});
const cyclone={id:'round18',lat:19,lon:130,vmax:24,pmin:986,rmw:35,dvorakTNumber:3.3,
 deepConvectiveCoverage:.46,convectiveBurstIndex:.85,coreCompactness:.30,broadMoisturePlatform:.75,
 moistureReservoir:.74,innerCoreMoisture:.72,rainbandDominance:.78,shear:11,eyeClearance:0};
const low=[], time=20, radiusKm=520;
for(let i=0;i<32;i++)for(let j=0;j<18;j++){
 const theta=2*Math.PI*i/32,r=.22+.7*j/18;
 const lat=cyclone.lat+radiusKm*r*Math.sin(theta)/111.12;
 const lon=cyclone.lon+radiusKm*r*Math.cos(theta)/(111.12*Math.cos(cyclone.lat*Math.PI/180));
 const s=clouds.sampleHurricaneTrackerCloud(cyclone,lat,lon,time,'ir','round18-check');
 assert(Number.isFinite(s.brightnessTemperatureC),'cloud temperature must remain finite');
 low.push(s);
}
assert(low.filter(s=>s.brightnessTemperatureC < -55).length > 45,'growing tropical-storm convective clusters still too weak');
assert(low.filter(s=>s.brightnessTemperatureC < -65).length > 15,'intensification needs isolated very cold towers');
let image;
global.document={createElement(name){assert.equal(name,'canvas');return {width:0,height:0,getContext(){return {
 createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)}},putImageData(data){image=data;}
}}}}};
const small={...cyclone,id:'round18-tile',vmax:44,dvorakTNumber:5.1,eyewallIntegrity:.69};
const sync=clouds.renderHurricaneTrackerCloudTile(small,40,'ir','round18-sync',32,'ott');
assert(sync&&image.data.some((v,i)=>i%4===3&&v>0),'tile must render opaque clouds');
const syncData=new Uint8ClampedArray(image.data);
// Precomputed rainband random coefficients must not alter the public standalone sampler.
const bounds=clouds.getHurricaneTrackerCloudBounds(small);
let validated=0;
for(let y=4;y<28;y+=5)for(let x=3;x<30;x+=6){
 const lat=bounds.north+(bounds.south-bounds.north)*y/31;
 const lon=bounds.west+(bounds.east-bounds.west)*x/31;
 const sample=clouds.sampleHurricaneTrackerCloud(small,lat,lon,40,'ir','round18-sync');
 if(sample.density<=.035)continue;
 const rgba=clouds.getHurricaneTrackerSatelliteColorForTemperature(sample.brightnessTemperatureC,'ott',1)
   .match(/rgba\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^\)]+)\)/);
 assert(rgba,'expected valid OTT colour');
 const offset=(y*32+x)*4;
 for(let channel=0;channel<3;channel++)assert(Math.abs(syncData[offset+channel]-Number(rgba[channel+1]))<=1,
   'tile fast path must match standalone storm sampler');
 validated++;
}
assert(validated>=8,'comparison must cover multiple nontransparent IR pixels');
// Force an uncached asynchronous render of precisely the SAME storm, seed and pixel footprint.
for(let n=0;n<13;n++)clouds.renderHurricaneTrackerCloudTile(small,40,'ir',`round18-evict-${n}`,1,'ott');
let maxProgress=0;
const asyncTile=await clouds.renderHurricaneTrackerCloudTileAsync(small,40,'ir','round18-sync',32,'ott',{
 chunkRows:16,onProgress:p=>{assert(p>=maxProgress&&p<=100);maxProgress=p;}
});
assert(asyncTile&&maxProgress===100,'async cloud tile must finish and signal progress');
assert.equal(Buffer.compare(Buffer.from(syncData),Buffer.from(image.data)),0,'sync and asynchronous IR pixels must match');
const controller=new AbortController();controller.abort();
await assert.rejects(()=>clouds.renderHurricaneTrackerCloudTileAsync(small,41,'ir','round18-abort',32,'ott',{signal:controller.signal}),{name:'AbortError'});
assert(read('src/simulation/HurricaneTrackerPort.ts').includes('createCloudRenderFrame(storm, seed, halfLat)'));
console.log('round18_regression PASS: continuation, clear/redraw, pan/no relocation, direct time jump, cloud strength, IR tile sync/async/abort, report preview, rainfall integral');
})().catch(e=>{console.error(e);process.exitCode=1});
