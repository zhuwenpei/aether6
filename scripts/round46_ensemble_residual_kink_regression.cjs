const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');

const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
if(!engine.includes('continueResidualToDissipation: boolean = false')) throw new Error('forecast residual-continuation switch missing');
if(!engine.includes('normalForecastTermination && !continueResidualToDissipation')) throw new Error('normal stop criteria are not bypassed only for residual diagnostics');

const modal=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
if((modal.match(/pressure_spaghetti_basin/g)||[]).length<3 || (modal.match(/paired_cycle_pressure/g)||[]).length<3) throw new Error('residual product dispatch missing');
if((modal.match(/calculateForecastPath\(primaryStorm, config, ensembleHorizon, false, true\)/g)||[]).length<2) throw new Error('member generation is not using horizon-capped residual reference path');
if(!modal.includes('framingReferencePath,')) throw new Error('normal-stop framing path not passed to product renderer');

const product=fs.readFileSync('src/utils/EnsembleReferenceProducts.ts','utf8');
if(!product.includes('framingReferencePath?: any[]')) throw new Error('framing reference path contract missing');
const pressureStart=product.indexOf('function drawPressureSpaghetti');
const pairedStart=product.indexOf('function drawPairedCycle');
const nextAfterPaired=product.indexOf('function drawCategoryWindBands',pairedStart);
const pressure=product.slice(pressureStart,pairedStart);
const paired=product.slice(pairedStart,nextAfterPaired);
if(!pressure.includes('boundsForOperationalForecast(args,mapRect,true)')) throw new Error('pressure spaghetti still frames from residual members');
if(!paired.includes('boundsForOperationalForecast(args,mapRect,true)')) throw new Error('dual-cycle still frames from residual members');

const guidanceSrc=fs.readFileSync('src/simulation/AetherEnsembleGuidance.ts','utf8');
if(!guidanceSrc.includes('constrainCenterPolylineKink')) throw new Error('centre polyline kink limiter missing');
if(!guidanceSrc.includes('previousTurn*rawTurn<0')) throw new Error('opposite-sign triangle reversal guard missing');

// Parse every directly changed TS/TSX file without resolving runtime dependencies.
for(const file of ['src/simulation/Engine.ts','src/simulation/AetherEnsembleGuidance.ts','src/utils/EnsembleReferenceProducts.ts','src/components/ForecastImageModal.tsx']){
  const source=fs.readFileSync(file,'utf8');
  const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true,fileName:file});
  const syntax=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  if(syntax.length) throw new Error(`${file} transpile errors: ${syntax.map(d=>d.messageText).join('; ')}`);
}

// Numeric geometry regression: centres remain native node polylines, but no model may create a
// large one-node hook or an acute opposite-sign zig-zag on a smooth reference forecast.
const js=ts.transpileModule(guidanceSrc,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){
  const n=Math.round(horizon/6);
  return names.map((name,k)=>({spec:{name},track:Array.from({length:n+1},(_,i)=>({lat:storm.lat+i*.12+(k-3)*.02*Math.sin(i*.4),lon:storm.lon+i*.23+(k-3)*.01}))}));
}
const mod={exports:{}};
function req(id){
  if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
  if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>({rh700:72,shear:10,sst:29,ohc:85,scores:{dryAir:.08}})};
  if(id.includes('NaturalEarthLoader'))return{checkPointOnProductLandGeoJson:()=>false};
  if(id.endsWith('/Engine')||id.includes('./Engine'))return{getLandMetrics:()=>({isLand:false,elevation:0,landName:'海洋'}),getProceduralElevation:()=>0};
  return{};
}
new Function('require','module','exports',js)(req,mod,mod.exports);
const storm={id:'T',lat:15,lon:130,vmax:40,pmin:960,rmw:30};
const reference=[];let lat=15,lon=130;
for(let h=0;h<=168;h+=3){if(h){lat+=.18+0.03*Math.sin(h/18);lon+=.28;}reference.push({simHour:h,lat,lon,vmax:40,pmin:960});}
const centers=mod.exports.buildAetherCenterGuidance(storm,0,[storm],'round46-kink',reference,168);
function bearing(a,b){const p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dl=(b.lon-a.lon)*Math.PI/180;const y=Math.sin(dl)*Math.cos(p2);const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(Math.atan2(y,x)*180/Math.PI+360)%360;}
function delta(a,b){let d=((b-a+540)%360)-180;return d===-180?180:d;}
let worstTurn=0,worstReversal=0;
for(const center of centers){
  const turns=[];
  for(let i=2;i<center.track.length;i++){
    const t=delta(bearing(center.track[i-2],center.track[i-1]),bearing(center.track[i-1],center.track[i]));
    turns.push(t);worstTurn=Math.max(worstTurn,Math.abs(t));
    if(turns.length>1){const prev=turns[turns.length-2];if(prev*t<0)worstReversal=Math.max(worstReversal,Math.min(Math.abs(prev),Math.abs(t)));}
  }
}
if(worstTurn>36) throw new Error(`centre path still has a node-scale hook: ${worstTurn.toFixed(1)} deg`);
if(worstReversal>18) throw new Error(`centre path still has a triangular reversal: ${worstReversal.toFixed(1)} deg`);
console.log('Round 46 ensemble residual/kink regression: PASS',`maxTurn=${worstTurn.toFixed(1)}deg`,`maxReversePair=${worstReversal.toFixed(1)}deg`);
