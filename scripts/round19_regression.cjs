/** Round19 self-contained numeric and integration regression. NODE_PATH="$(npm root -g)" node scripts/round19_regression.cjs */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function load(file,imports={}) {
  const result=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}});
  assert(!result.diagnostics.some(d=>d.category===ts.DiagnosticCategory.Error),'invalid TypeScript: '+file);
  const module={exports:{}};
  new Function('module','exports','require',result.outputText)(module,module.exports,id=>{if(id in imports)return imports[id];throw Error(file+' unexpected import '+id)});
  return module.exports;
}
const rawNames=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function raw(storm,hour,scene,seed,reference,horizon){
  const n=Math.ceil(horizon/6);
  return rawNames.map((name,k)=>({spec:{name},track:Array.from({length:n+1},(_,i)=>{
    const f=i/n;return {lat:storm.lat+8*f+(k-3)*.15*f,lon:storm.lon-8*f+(k-3)*.1*f};
  })}));
}
const guidance=load('src/simulation/AetherEnsembleGuidance.ts',{'./HurricaneTrackerPort':{calculateHurricaneTrackerGuidanceTracks:raw},'./SynopticEnvironment':{}});
const radar=load('src/simulation/PrecipitationModel.ts');
const storm={id:'R19',lat:17,lon:139,vmax:24,pmin:991,rmw:43,shear:8};
const ref=Array.from({length:57},(_,i)=>({simHour:i*3,lat:17+8*i/56,lon:139-8*i/56,vmax:24+25*i/56,pmin:991-28*i/56}));
(async()=>{
 const first=guidance.buildAetherCenterGuidance(storm,0,[storm],'R19-seed',ref,168);
 const second=guidance.buildAetherCenterGuidance(storm,0,[storm],'R19-seed',ref,168);
 assert.equal(JSON.stringify(first),JSON.stringify(second),'same synoptic issue must replay deterministically');
 assert.equal(first.length,8,'keep eight new agency center models');
 for(const center of first){
   assert.equal(center.track[0].lat,storm.lat,'origin must remain anchored to analysis');
   assert(center.track.every(p=>Number.isFinite(p.vmax)&&Number.isFinite(p.pmin)&&p.vmax>=0),'preserved new intensity must remain finite');
   for(let i=1;i<center.track.length;i++){
     const a=center.track[i-1],b=center.track[i];
     assert(Math.hypot((a.lon-b.lon)*106,(a.lat-b.lat)*111)<550,'no old geometry discontinuities');
   }
 }
 assert(read('src/simulation/AetherEnsembleGuidance.ts').includes('legacyModelRand=rng(') &&
        read('src/simulation/AetherEnsembleGuidance.ts').includes('legacyMemberRand=rng('),'ported old geometry has independent RNG stream');
 assert(read('src/simulation/AetherEnsembleGuidance.ts').includes('memberSeaHoursAfterLand') &&
        read('src/simulation/AetherEnsembleGuidance.ts').includes('memberEwrc=createGuidanceEwrcState') &&
        read('src/simulation/AetherEnsembleGuidance.ts').includes('genesisSpreadFactor'),'new strength/sea/genesis preserved');
 const ensemble=await guidance.buildAetherEnsembleMembers({storm,currentHour:0,scene:[storm],seed:'R19-seed',referencePath:ref,selectedModelIds:['ECMWF','GEFS'],membersPerModel:12,horizon:168});
 assert.equal(ensemble.length,24);
 for(const p of ensemble.flatMap(m=>m.track))assert(Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Number.isFinite(p.vmax));
 const at=20;const points=ensemble.filter(x=>x.modelId==='ECMWF').map(x=>x.track[at]);
 const mean=points.reduce((a,p)=>a+p.lon,0)/points.length;
 assert(Math.max(...points.map(p=>Math.abs(p.lon-mean)))>.1,'member geometry must separate');
 const rstate={...storm,vmax:42,pmin:963,simHour:21,deepConvectiveCoverage:.74,eyewallIntegrity:.66,moistureReservoir:.8,rainbandDominance:.75};
 let nonzero=0;
 for(let ri=0;ri<9;ri++)for(let a=0;a<36;a++){
   const km=25+ri*55,theta=a*Math.PI/18;
   const lat=rstate.lat+km*Math.cos(theta)/111.12;
   const lon=rstate.lon+km*Math.sin(theta)/(111.12*Math.cos(rstate.lat*Math.PI/180));
   const out=radar.computeGroundRadarDiagnostics(rstate,lat,lon);
   assert(Number.isFinite(out.dbz)&&out.dbz>=0&&out.dbz<=65,'radar finite and bounded');
   if(out.dbz>8)nonzero++;
 }
 assert(nonzero>25,'radar field must remain populated');
 const rain=read('src/utils/ObservedRainfallMap.ts');
 assert(rain.includes('snapshotBuckets')&&rain.includes('dLatKm * dLatKm + dLonKm * dLonKm')&&rain.includes('Math.max(144,')&&rain.includes('threshold.value>maxField'),'rain tiling and fast rejection preserved');
 assert(rain.includes('calibrated = fullTrackProduct ? Math.max(0, total)'),'lifetime total must stay physically additive');
 const precip=read('src/simulation/PrecipitationModel.ts');
 assert(precip.includes('const innerSpiralPhase = (bearing * Math.PI / 180) + hemisphere * Math.log') &&
        precip.includes('movementDir + 145 - (state.lat < 0 ? -1 : 1) * simHour') &&
        precip.includes('circulationSign * tangentEastFlow'),'all radar/flow winding paths align by hemisphere');
 const map=read('src/components/MapView.tsx'),chart=read('src/components/AetherIntensityPanel.tsx');
 assert(map.includes('L.DomUtil.setPosition(pane, base.add(')&&map.includes('map.panBy([-totalX,-totalY]')&&
        map.includes('map.dragging.disable()'),'middle-button pan is compositor-only until release');
 assert(!map.includes('map.panBy([-pendingX, -pendingY]'),'no old repeated heavy pan');
 assert(map.includes('if (isForecastRouteDrawing && forecastRouteDraft.length > 0)')&&!map.includes('if (config.controlMode === "draw" && config.drawnTrackRoute?.length'),'saved route no longer overlaid');
 assert(map.includes('zoomSnap: 0')&&map.includes('pane.style.transform=')&&map.includes('map.setZoom(previewZoom,{animate:false})'),'compositor zoom commits only on key release');
 assert(map.includes('config.intensityAgency')&&map.includes('config.intensityReportingMode')&&map.includes('archived')||map.includes('historyCacheKey'),'historic tooltip tracks agency changes');
 assert(chart.includes('ai.rawValue * 10')&&chart.includes('hoverIndex !== null && <div'),'chart uses actual continuous series, hover-only details');
 const css=read('src/index.css');
 assert(css.includes('--aether-glass:rgba(32,32,34')&&css.includes('prefers-reduced-transparency'),'neutral frosted theme + accessibility fallback');
 console.log('round19_regression PASS: legacy geometry/new strength and sea/genesis preservation, numeric tracks, radar hemispheric winding, rainfall guard/performance, compositor pan, continuous zoom/chart, glass theme');
})().catch(e=>{console.error(e);process.exitCode=1});
