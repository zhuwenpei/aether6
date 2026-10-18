const fs = require('fs');
const assert = require('assert');
const Module = require('module');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read = (p) => fs.readFileSync(p, 'utf8');

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '6.0.38', 'ROUND108 package version mismatch');

// Execute the standalone environmental-wind module to verify the terrain-aware land ceilings.
const envSource = read('src/simulation/SynopticEnvironmentalWindModel.ts');
const js = ts.transpileModule(envSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = new Module('round108-env');
m.filename = 'round108-env.js';
m.paths = module.paths;
m._compile(js, m.filename);
const { diagnoseLandEnvironmentalWindCeilingKt, diagnoseSynopticEnvironmentalWindTarget } = m.exports;

const plain = diagnoseLandEnvironmentalWindCeilingKt({ elevationM: 20, localReliefM: 20 });
const hill = diagnoseLandEnvironmentalWindCeilingKt({ elevationM: 1100, localReliefM: 550 });
const mountain = diagnoseLandEnvironmentalWindCeilingKt({ elevationM: 3000, localReliefM: 1600 });
assert(plain < 12 && plain > 11, `ordinary lowland ceiling must be <12 kt, got ${plain}`);
assert(hill < plain, 'hill wind ceiling must be lower than lowland');
assert(mountain < hill, 'high-mountain wind ceiling must be lower than hill');

const coldPlain = diagnoseLandEnvironmentalWindCeilingKt({ elevationM: 20, localReliefM: 20, coldAirStrength: 1 });
const coldMountain = diagnoseLandEnvironmentalWindCeilingKt({ elevationM: 3000, localReliefM: 1600, coldAirStrength: 1 });
const westPlain = diagnoseLandEnvironmentalWindCeilingKt({ elevationM: 20, localReliefM: 20, westerlyStrength: 1 });
assert(coldPlain <= 22.000001 && coldPlain > plain, `cold-air lowland ceiling invalid: ${coldPlain}`);
assert(westPlain <= 22.000001 && westPlain > plain, `westerly lowland ceiling invalid: ${westPlain}`);
assert(coldMountain < coldPlain, 'cold-air mountain ceiling must retain terrain reduction');

const landTargetPlain = diagnoseSynopticEnvironmentalWindTarget({ lat:30, lon:115, isLand:true, elevationM:30, localReliefM:30, backgroundTexture:1, synopticActivity:1 });
const landTargetHigh = diagnoseSynopticEnvironmentalWindTarget({ lat:30, lon:115, isLand:true, elevationM:3000, localReliefM:1600, backgroundTexture:1, synopticActivity:1 });
assert(landTargetPlain.target10mKt <= 9.2 + 1e-9, 'ordinary land target not lowered');
assert(landTargetHigh.target10mKt < landTargetPlain.target10mKt, 'land target does not decrease with terrain');

const field = read('src/simulation/SynopticWindField.ts');
const map = read('src/utils/SynopticWindPressureMap.ts');
const record = read('src/utils/SynopticWindPressureRecordVideo.ts');
assert(field.includes('diagnoseLandEnvironmentalWindCeilingKt'), 'terrain-aware final land cap not connected');
assert(field.includes('gate > 0.92'), 'land environmental cap is not restricted to far-field background flow');
assert(field.includes('Math.floor(rawLonMin / stepDeg'), 'solver grid is not globally lattice-anchored');
assert(field.includes('Math.ceil(rawLatMax / stepDeg'), 'solver latitude grid is not globally lattice-anchored');
assert(map.includes('sampleWindVectorAndSpeedAtLonLat'), 'single vector/speed sample optimization missing');
assert(!/const row = new Array<number>\(4\)/.test(map), 'bicubic sampler still allocates row arrays');
assert(map.includes('if (canvas.width !== targetCanvasWidth)'), 'video canvas still reallocates every frame');
assert(record.includes('encodeRenderedSequenceWebCodecs'), 'direct full-lifecycle WebCodecs path missing');
assert(record.includes('already-rendered') || record.includes('already-rendered'), 'direct encode rationale missing');

// Exact arithmetic regression for the allocation-free bicubic rewrite.
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function cubic(p0,p1,p2,p3,t){const a0=-.5*p0+1.5*p1-1.5*p2+.5*p3;const a1=p0-2.5*p1+2*p2-.5*p3;const a2=-.5*p0+.5*p2;return ((a0*t+a1)*t+a2)*t+p1;}
function oldSample(f,nx,ny,x,y){const fx=clamp(x,0,nx-1.001),fy=clamp(y,0,ny-1.001);const ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy;const row=new Array(4);for(let mm=-1;mm<=2;mm++){const yy=clamp(iy+mm,0,ny-1);const p=new Array(4);for(let nn=-1;nn<=2;nn++)p[nn+1]=f[yy*nx+clamp(ix+nn,0,nx-1)];row[mm+1]=cubic(p[0],p[1],p[2],p[3],tx)}const raw=cubic(row[0],row[1],row[2],row[3],ty);const x1=Math.min(nx-1,ix+1),y1=Math.min(ny-1,iy+1);const a=f[iy*nx+ix],b=f[iy*nx+x1],c=f[y1*nx+ix],d=f[y1*nx+x1];return clamp(raw,Math.min(a,b,c,d),Math.max(a,b,c,d));}
function newSample(f,nx,ny,x,y){const fx=clamp(x,0,nx-1.001),fy=clamp(y,0,ny-1.001);const ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy;const x0=clamp(ix-1,0,nx-1),x1=clamp(ix,0,nx-1),x2=clamp(ix+1,0,nx-1),x3=clamp(ix+2,0,nx-1);const y0=clamp(iy-1,0,ny-1),y1=clamp(iy,0,ny-1),y2=clamp(iy+1,0,ny-1),y3=clamp(iy+2,0,ny-1);const r0=cubic(f[y0*nx+x0],f[y0*nx+x1],f[y0*nx+x2],f[y0*nx+x3],tx),r1=cubic(f[y1*nx+x0],f[y1*nx+x1],f[y1*nx+x2],f[y1*nx+x3],tx),r2=cubic(f[y2*nx+x0],f[y2*nx+x1],f[y2*nx+x2],f[y2*nx+x3],tx),r3=cubic(f[y3*nx+x0],f[y3*nx+x1],f[y3*nx+x2],f[y3*nx+x3],tx);const raw=cubic(r0,r1,r2,r3,ty);const cx1=Math.min(nx-1,ix+1),cy1=Math.min(ny-1,iy+1);const a=f[iy*nx+ix],b=f[iy*nx+cx1],c=f[cy1*nx+ix],d=f[cy1*nx+cx1];return clamp(raw,Math.min(a,b,c,d),Math.max(a,b,c,d));}
const nx=37,ny=29,f=new Float32Array(nx*ny);for(let i=0;i<f.length;i++)f[i]=Math.sin(i*.173)*17+Math.cos(i*.031)*5;
for(let q=0;q<1000;q++){const x=((q*17)%3700)/100,y=((q*31)%2900)/100;const a=oldSample(f,nx,ny,x,y),b=newSample(f,nx,ny,x,y);assert(Math.abs(a-b)<1e-12,`bicubic mismatch ${a} ${b}`);}

console.log('ROUND108 land-wind/performance regression: PASS');
console.log(JSON.stringify({ ordinaryKt:{plain,hill,mountain}, organizedKt:{coldPlain,coldMountain,westPlain}, targetsKt:{plain:landTargetPlain.target10mKt,high:landTargetHigh.target10mKt} }));
