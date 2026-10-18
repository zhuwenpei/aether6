const fs=require('fs'), path=require('path'), vm=require('vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');
const raw=fs.readFileSync(root+'/src/simulation/IntactEyewallRefinement.ts','utf8');
const js=ts.transpileModule(raw,{fileName:'IntactEyewallRefinement.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},reportDiagnostics:true});
if(js.diagnostics.length) throw Error('TS syntax failure');
const m={exports:{}};vm.runInNewContext(js.outputText,{exports:m.exports,module:m,Float32Array,Uint8Array,Math,Number,console});
const {intactEyewallRefinementStrength:strength,refineIntactEyewallVectors:refine}=m.exports;
const fixture=JSON.parse(fs.readFileSync(root+'/scripts/fixtures/round152_davi_4_states.json','utf8'));
const cases=[80,215,240,268].map(h=>fixture.snapshots.find(x=>Math.abs(x.simHour-h)<0.1));
if(cases.some(x=>!x))throw Error('Missing four historical states');
const [s80,s215,s240,s268]=cases;
if(strength(s80)<.15)throw Error('Complete +80h eye not eligible');
for(const s of [s215,s240,s268])if(strength(s)!==0)throw Error('Broken/absent eye incorrectly regularized at '+s.simHour);
const strong=strength({...s80,vmax:75}),weak=strength({...s80,vmax:50});
if(!(strong>weak && weak>=0))throw Error('Refinement strength not increasing with wind speed');
function synthetic(s,land=false){
 const nx=181,ny=181,stepDeg=.02,latMin=s.lat-1.8,lonMin=s.lon-1.8;
 const u10=new Float32Array(nx*ny),v10=new Float32Array(nx*ny),landMask=new Uint8Array(nx*ny);
 const rmw=s.rmw||46,cl=Math.cos(s.lat*Math.PI/180);
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const dy=(latMin+j*stepDeg-s.lat)*111.12,dx=(lonMin+i*stepDeg-s.lon)*111.12*cl;
  const r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);const sp=10+50*Math.exp(-(((r-rmw)/26)**2))*(1+.24*Math.cos(9*a)+.13*Math.sin(13*a));
  const k=j*nx+i;u10[k]=-Math.sin(a)*sp;v10[k]=Math.cos(a)*sp;
  if(land&&r>rmw*.65&&r<rmw*1.2&&dx>0&&dy>0)landMask[k]=1;
 }
 return {nx,ny,stepDeg,latMin,lonMin,u10,v10,landMask};
}
const grid=synthetic(s80),origU=new Float32Array(grid.u10),origV=new Float32Array(grid.v10);
const changed=refine(grid,[s80]);if(changed<=0)throw Error('Complete strong eye was not adjusted');
let origVar=0,afterVar=0,num=0,offCoreChange=0;
for(let j=0;j<grid.ny;j++)for(let i=0;i<grid.nx;i++){
 const k=j*grid.nx+i,dy=(grid.latMin+j*grid.stepDeg-s80.lat)*111.12,dx=(grid.lonMin+i*grid.stepDeg-s80.lon)*111.12*Math.cos(s80.lat*Math.PI/180);
 const r=Math.hypot(dx,dy),before=Math.hypot(origU[k],origV[k]),after=Math.hypot(grid.u10[k],grid.v10[k]);
 if(Math.abs(r-s80.rmw)<7){origVar+=(before-60)**2;afterVar+=(after-60)**2;num++}
 if(r>2*s80.rmw||r<.35*s80.rmw){if(origU[k]!==grid.u10[k]||origV[k]!==grid.v10[k])offCoreChange++}
}
if(offCoreChange)throw Error('Changed wind outside intact eyewall');
if(afterVar>=origVar)throw Error('Angular variation not smoothed');
for(const s of [s215,s240,s268]){const q=synthetic(s);const original=q.u10.slice();const n=refine(q,[s]);if(n||q.u10.some((v,i)=>v!==original[i]))throw Error('Damaged eye changed '+s.simHour)}
const coast=synthetic(s80,true),coastU=coast.u10.slice();if(refine(coast,[s80])!==0||coast.u10.some((v,i)=>v!==coastU[i]))throw Error('Changed a coastal storm');
console.log('ROUND152 intact eyewall gate, monotonic vmax strength, offshore-only change, lost-eye invariance: PASS');
console.log('  +80 gate=',strength(s80).toFixed(3),'updatedCells=',changed,'ring deviation change=',(afterVar/origVar).toFixed(3));
console.log('  +215/+240/+268 gate=',cases.slice(1).map(strength).join(','),'coast gate=0');
