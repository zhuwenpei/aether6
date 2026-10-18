const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');
const text=fs.readFileSync(path.join(root,'src/simulation/IntactEyewallRefinement.ts'),'utf8');
const transpile=ts.transpileModule(text,{fileName:'IntactEyewallRefinement.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(transpile.diagnostics.length,0,'TS syntax');
const m={exports:{}};vm.runInNewContext(transpile.outputText,{module:m,exports:m.exports,Math,Float32Array,Uint8Array});
const {enhancedEyeRefinementStrength:weight,refineEnhancedEyeVectors:enhanced,refineIntactEyewallVectors:baseline}=m.exports;
const snapshots=JSON.parse(fs.readFileSync(path.join(root,'scripts/fixtures/round152_davi_4_states.json'),'utf8')).snapshots;
const [full,gap,blocked,none]=snapshots;
assert(weight(full)>.85,'complete eye receives strong boost');
assert(weight({...full,vmax:25})>.85,'low-wind complete eye still receives full boost');
assert(weight(gap)>0,'existing damaged eye receives some smoothing');
assert(weight(blocked)>0,'heavily blocked but existing eye can receive limited smoothing');
assert(weight(gap)<weight(full)*.5,'damaged eye never gets complete ring weight');
assert.equal(weight(none),0,'no eye must not be generated');
assert.equal(weight({...full,dissipated:true}),0,'no eye enhancement for dissipated vortex');
function synthetic(state,land=false){
 const nx=141,ny=141,stepDeg=.022,latMin=state.lat-1.54,lonMin=state.lon-1.54;
 const u10=new Float32Array(nx*ny),v10=new Float32Array(nx*ny),landMask=new Uint8Array(nx*ny);
 const rmw=state.rmw||46,cl=Math.cos(state.lat*Math.PI/180);
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const dx=(lonMin+i*stepDeg-state.lon)*111.12*cl,dy=(latMin+j*stepDeg-state.lat)*111.12,r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
   const gapFactor=(a>.1&&a<.9)?0.45:1;
   const speed=(6+45*Math.exp(-Math.pow((r-rmw)/19,2))*(1+.25*Math.cos(13*a)+.13*Math.cos(8*a)))*gapFactor;
   const k=j*nx+i;u10[k]=-Math.sin(a)*speed;v10[k]=Math.cos(a)*speed;
   if(land&&r<rmw*1.3&&dx>0&&dy>0)landMask[k]=1;
 }
 return {nx,ny,stepDeg,latMin,lonMin,u10,v10,landMask};
}
const f=synthetic(full), defaultF=synthetic(full), sourceU=f.u10.slice(),sourceV=f.v10.slice();
const before=baseline(defaultF,[full]);const changes=enhanced(f,[full]);
assert(before>0&&changes>0,'baseline and enhanced both function');
let diff=0, far=0,changedDirections=0;
for(let j=0;j<f.ny;j++)for(let i=0;i<f.nx;i++){
 const k=j*f.nx+i,dx=(f.lonMin+i*f.stepDeg-full.lon)*111.12*Math.cos(full.lat*Math.PI/180),dy=(f.latMin+j*f.stepDeg-full.lat)*111.12;
 const r=Math.hypot(dx,dy),s=Math.hypot(sourceU[k],sourceV[k]),sn=Math.hypot(f.u10[k],f.v10[k]);
 if(Math.abs(sn-s)>1e-5)diff++;
 if(r>1.9*full.rmw&&(sourceU[k]!==f.u10[k]||sourceV[k]!==f.v10[k]))far++;
 if(s>1&&sn>1 && Math.abs(sourceU[k]*f.v10[k]-sourceV[k]*f.u10[k])>1e-3)changedDirections++;
 assert(sn <= s*1.241 + 1e-3,'bounded speed enhancement');
}
assert(diff>200,'enhancement actually affects intact eyewall');
assert.equal(far,0,'far-field must not change');
assert.equal(changedDirections,0,'wind directions must not rotate');
for(const state of [gap,blocked]){
 const broken=synthetic(state), a=broken.u10.slice(),b=broken.v10.slice();
 const n=enhanced(broken,[state]);assert(n>0,'existing damaged eye receives local change');
 let remainsWeak=false;
 for(let j=0;j<broken.ny;j++)for(let i=0;i<broken.nx;i++){
  const k=j*broken.nx+i,dx=(broken.lonMin+i*broken.stepDeg-state.lon)*111.12*Math.cos(state.lat*Math.PI/180),dy=(broken.latMin+j*broken.stepDeg-state.lat)*111.12;
  const r=Math.hypot(dx,dy),ang=Math.atan2(dy,dx);
  if(r>state.rmw*.85&&r<state.rmw*1.15&&ang>.2&&ang<.7){
    const original=Math.hypot(a[k],b[k]),after=Math.hypot(broken.u10[k],broken.v10[k]);
    if(original<35&&after<original*1.10)remainsWeak=true;
  }
 }
 assert(remainsWeak,'damaged eye gap must remain detectable');
}
// Round153 opt-in must visibly smooth a complete eye MORE than baseline Round152.
const baselineOnly=synthetic(full),optIn=synthetic(full);
baseline(baselineOnly,[full]);baseline(optIn,[full]);enhanced(optIn,[full]);
function ringVariance(g){
 const bins=[];const cosLat=Math.cos(full.lat*Math.PI/180);
 for(let a=0;a<72;a++){
  const angle=a*Math.PI/36;
  const y=full.lat+full.rmw*Math.sin(angle)/111.12,x=full.lon+full.rmw*Math.cos(angle)/(111.12*cosLat);
  const i=Math.round((x-g.lonMin)/g.stepDeg),j=Math.round((y-g.latMin)/g.stepDeg);
  const k=j*g.nx+i;bins.push(Math.hypot(g.u10[k],g.v10[k]));
 }
 const mean=bins.reduce((x,y)=>x+y,0)/bins.length;
 return bins.reduce((x,y)=>x+(y-mean)**2,0)/bins.length;
}
const baselineVariance=ringVariance(baselineOnly),optVariance=ringVariance(optIn);
assert(optVariance<baselineVariance*.93,'Enhanced complete eye must become appreciably smoother than Round152');
const noEye=synthetic(none),old=noEye.u10.slice();assert.equal(enhanced(noEye,[none]),0);assert.deepEqual([...noEye.u10],[...old]);
const coast=synthetic(full,true),origCoast=coast.u10.slice();assert.equal(enhanced(coast,[full]),0,'complete round-eye enforcement disabled across land');assert.deepEqual([...coast.u10],[...origCoast]);
const field=fs.readFileSync(path.join(root,'src/simulation/SynopticWindField.ts'),'utf8');
assert(field.includes('options.roundedClearEye === true ? "eye-enhanced-v153" : "eye-default-v152"'),'cache has distinct keys');
assert(field.includes('if (options.roundedClearEye === true)'), 'enhanced algorithm is opt-in');
const modal=fs.readFileSync(path.join(root,'src/components/ForecastImageModal.tsx'),'utf8');
assert(modal.includes('localStorage.getItem("forecast_synopticRoundedClearEye") === "true"'),'defaults off');
assert((modal.match(/roundedClearEye: synopticRoundedClearEye/g)||[]).length>=2,'still and video both propagate');
const records=fs.readFileSync(path.join(root,'src/components/SynopticWindPressureRecordVideoPanel.tsx'),'utf8');
assert(records.includes('roundedClearEye: false')&&records.includes('settings.roundedClearEye'),'report video opt-in default off');
for(const file of ['SynopticWindPressureMap.ts','SynopticWindPressureVideo.ts','SynopticWindPressureRecordVideo.ts']){
 assert(fs.readFileSync(path.join(root,'src/utils',file),'utf8').includes('roundedClearEye:'),'missing rendering pipeline propagation '+file);
}
console.log('Round153 opt-in enhanced eye mode, default-off, damaged-eye preservation, history/videos, cache separation: PASS');
console.log('  weights (+80h/+215h/+240h/+268h):',snapshots.map(s=>weight(s).toFixed(3)).join(' / '));
console.log('  eligible intact modified cells:',changes,'angular visual pixels affected proxies:',diff);
console.log('  RMW azimuthal variation ratio opt-in/off:',(optVariance/baselineVariance).toFixed(3));
