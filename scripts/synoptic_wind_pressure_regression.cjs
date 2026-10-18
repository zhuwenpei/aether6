const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const read = p => fs.readFileSync(p, 'utf8');

const modal = read('src/components/ForecastImageModal.tsx');
const renderer = read('src/utils/SynopticWindPressureMap.ts');
const video = read('src/utils/SynopticWindPressureVideo.ts');
const field = read('src/simulation/SynopticWindField.ts');
const vortex = read('src/simulation/TropicalCycloneVortex.ts');
const solver = read('src/simulation/WindBoundaryLayerSolver.ts');
const surface = read('src/simulation/SurfaceRoughness.ts');
const surfaceDrag = read('src/simulation/SurfaceDragPhysics.ts');
const terrain = read('src/simulation/HighResolutionTerrain.ts');
const engine = read('src/simulation/Engine.ts');
const pkg = JSON.parse(read('package.json'));

// 5.2.31 风场/地形/视频预报精算 + Windy 图例精确取色补丁。
assert(['5.2.31', '5.3.0', '6.0.0', '6.0.6', '6.0.7', '6.0.8', '6.0.9', '6.0.10', '6.0.11', '6.0.12','6.0.13'].includes(pkg.version), 'package version must retain the 5.2.31 synoptic feature baseline');
assert(pkg.scripts?.['test:synoptic'] === 'node scripts/synoptic_wind_pressure_regression.cjs', 'test:synoptic missing');
assert(modal.includes('"synoptic_wind_pressure"') && modal.includes('风场气压形势图'), 'synoptic product entry missing');
assert(modal.includes('0.10°（超高精度）') && modal.includes('0.125°（高精度）'), 'higher-precision grid choices missing');
assert(modal.includes('等压线：{synopticShowContours ? "开" : "关"}') && renderer.includes('options.showContours !== false'), 'contour on/off missing');
assert(modal.includes('forecast_synopticMapZoom') && renderer.includes('mapZoom?: number') && renderer.includes('lonSpan /= zoom'), 'map zoom missing');
assert(modal.includes('synopticIssueHour') && modal.includes('const synopticMaxLead = 168'), 'stable issue/lead state missing');
assert(modal.includes('initHour: synopticIssueHour') && !modal.includes('initHour: currentHour,\n        endLeadHours: endLead'), 'video/image generation must use frozen issue hour');
assert(renderer.includes('resolveSynopticStormAtHour') && renderer.includes('forecastAnchor'), 'follow-storm bounds must use resolved forecast state');

// 视频：完整逐帧物理重建 + 可选帧数/时长/清晰度。
assert(modal.includes('生成预报风场视频') && modal.includes('synopticVideoFrames') && modal.includes('synopticVideoDuration') && modal.includes('synopticVideoResolution'), 'video controls missing');
assert(video.includes('drawSynopticWindPressureMap({') && video.includes('const validHour = options.initHour + endLead * frac'), 'video must recompute full forecast field per frame');
assert(video.includes('VideoEncoder') && video.includes('MediaRecorder'), 'video encoder and fallback missing');
assert(video.includes('1080, height: 720') && video.includes('1620, height: 1080') && video.includes('2160, height: 1440'), '3:2 even video dimensions missing');
assert(video.includes('Math.min(240') && modal.includes('120, 144, 180, 240'), 'higher video frame-count modes missing');
assert(field.includes('simHour: initHour + Number(p.simHour || 0)') && field.includes('materializeForecastPath(seed, config, lead, seed.forecastPath, true)'), 'forecast video absolute-time/materialized-path fix missing');
assert(engine.includes('terrainHollowCoreMemory: forecastTerrainHollowCoreMemory') && engine.includes('penaltyRecoveryActive: forecastPenaltyRecoveryActive') && engine.includes('extrTransition: forecastExtrTransition'), 'forecast materialization must carry damage/recovery/ET state');

// 参考版式与渲染管线。
assert(renderer.includes('Forecast Time Init:') && renderer.includes('[+${lead}h] Valid:') && renderer.includes('Mean Sea Level Pressure(hpa) & 10m wind speed(kt)'), 'title template mismatch');
assert(renderer.includes('Min_MSLP: ${field.minMslp.toFixed(1)} hPa'), 'Min_MSLP title missing');
assert(renderer.includes('SYNOPTIC_TITLE_MODEL_LABEL = "AETHER SIM"'), 'default model label must not impersonate ECMWF');
assert(renderer.includes('createPlateCarreeProjector'), 'Plate Carree projector missing');
assert(renderer.includes('sampleBicubic') && renderer.includes('contourSegments') && renderer.includes('chaikin(chaikin'), 'bicubic/marching-squares/Chaikin path missing');
assert(renderer.includes('MAP = { x: 62, y: 65, w: 1348, h: 940 }'), 'logical map geometry drifted');
assert(!renderer.includes('landMask'), 'renderer must never recolor by land mask');
assert(renderer.includes('asymptotic decider') && renderer.includes('mask === 5 || mask === 10'), 'natural isobar saddle topology fix missing');
assert(renderer.includes('The source legend uses 2 kt color slabs') && renderer.includes('Math.min(79.999999, speed) / 2'), 'Windy 2-kt legend quantization missing');
for (const swatch of ['#fefefe','#828180','#265bee','#a2f0fb','#63cf47','#fdfc91','#e83f25','#5d3a20','#f6d2cb','#e24036','#6f130b','#6f140c']) {
  assert(renderer.includes(swatch), `Windy reference swatch missing: ${swatch}`);
}
assert(renderer.includes('for(let i=0;i<40;i++)') && renderer.includes('KT_COLORS[40]'), '40-band Windy colorbar + overflow cap missing');

// 物理场：高阶边界层、ETOPO 地形、强风陆面修复、强台风轴对称保护。
assert(field.includes('getSynopticEnvironmentState') && field.includes('sampleTropicalCycloneVortex') && field.includes('solveWindBoundaryLayer'), 'physical pipeline incomplete');
assert(field.includes('blendEnvironmentIntoCyclone') && field.includes('envFlowGain') && !field.includes('environmentShield'), 'progressive environment-to-TC blending missing');
assert(field.includes('diagnoseSynopticEnvironmentalWindTarget') && field.includes('nudgeVectorToMinimumBackground') && field.includes('backgroundTarget10mMs'), 'global system-aware background wind regularization missing');
assert(field.includes('landInteriorWeight') && field.includes('cross-shore averaging was a source'), 'one-sided coast transition missing');
assert(renderer.includes('sampleWindSpeedAtLonLat') && renderer.includes('return clamp(rawKt'), 'bounded vector wind interpolation missing');
assert(field.includes('buildTerrainWakeField') && field.includes('terrainWake'), 'downstream terrain-wake blocking missing');
assert(surface.includes('const isLand = checkPointOnProductLandGeoJson(lat, lon);'), 'high-detail coastline must own the land mask');
assert(!surface.includes('checkPointOnProductLandGeoJson(lat, lon) || rawElevation >'), 'ETOPO must not expand land mask into nearshore water');
assert(surface.includes('getSynopticTerrainDiagnostics') && surface.includes('slopeEastMPerKm') && surface.includes('localReliefM'), 'high-resolution terrain elevation/relief/slope diagnostics missing');
assert(terrain.includes('ETOPO_2022_v1_60s') && terrain.includes('TARGET_STRIDE = 6') && terrain.includes('TARGET_STEP'), 'ETOPO 2022 ~0.10deg terrain provider missing');
assert(terrain.includes('fetchTerrainWithTimeout') && terrain.includes('const batchSize = 8'), 'terrain preload timeout/concurrency optimization missing');
assert(surface.includes('terrainHighResolution') && !surface.includes('getSynopticTerrainElevation'), 'surface roughness must reuse terrain diagnostics without duplicate elevation fetch');
assert(field.includes('prepareHighResolutionTerrain({ lonMin, lonMax, latMin, latMax }'), 'high-resolution terrain preload missing');
assert(surfaceDrag.includes('strongWindMixing') && surfaceDrag.includes('0.62, 0.86'), 'reduced land-friction 10m coupling missing');
assert(solver.includes('RK2') && solver.includes('Catmull-Rom') && solver.includes('四阶中心差分'), 'high-order fluid solver missing');
assert(solver.includes('couplingTau') && solver.includes('initialU[k] - uu'), 'free-atmosphere momentum coupling missing');
assert(solver.includes('Poisson') && solver.includes('Brinkman') && solver.includes('stormCenters'), 'projection/terrain/core protection missing');
assert(solver.includes('clamp(options.maxIterations ?? defaultIterations, 60, 180)'), 'high precision solver iteration range missing');
assert(vortex.includes('vortexSymmetryWeight') && vortex.includes('regularizedAngularRadius'), 'mature-TC symmetry regularization missing');
assert(vortex.includes('Math.max(baseRmw * 1.03, 28)') && vortex.includes('damageWindBroadening') && vortex.includes('baroclinicShape'), 'landfall pressure-core contraction / westerly deformation guard missing');
assert(vortex.includes('wave-3 / wave-4') && vortex.includes('counter-clockwise'), 'irregular TC structure / NH circulation protection missing');
assert(field.includes('physicalCoreKm') && field.includes('landBroadening = s.landed ? 1.06 : 1'), 'landed contour anti-pileup calibration missing');
assert(field.includes('slp[cj * nx + ci] = s.pmin') && field.includes('deepestPmin'), 'pmin consistency pin/floor missing');
assert(field.includes('fieldCache') && field.includes('environmentSampleCache'), 'field/environment LRU cache missing');

for (const [name, src] of [
  ['field', field], ['vortex', vortex], ['solver', solver], ['surface', surface],
  ['surfaceDrag', surfaceDrag], ['renderer', renderer], ['video', video]
]) assert(!src.includes('Math.random('), `${name} contains Math.random`);

// 用户已明确要求正式包去掉参考 PNG；回归防止它再次导致包体膨胀。
assert(!fs.existsSync('docs/reference/synoptic_reference.png'), 'reference PNG must not be shipped in 5.2.31 package');

// 数值回归只编译纯物理模块，避免 DOM / Turf / React 依赖。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-synoptic-531-'));
const entry = path.join(tmpDir, 'numeric.ts');
const outfile = path.join(tmpDir, 'numeric.cjs');
fs.writeFileSync(entry, `
import assert from 'node:assert/strict';
import { sampleTropicalCycloneVortex, targetWindFromQuadrantRadii } from ${JSON.stringify(path.resolve('src/simulation/TropicalCycloneVortex.ts'))};
import { solveWindBoundaryLayer } from ${JSON.stringify(path.resolve('src/simulation/WindBoundaryLayerSolver.ts'))};
import { estimateTenMeterReduction, seaSurfaceDragCoefficient } from ${JSON.stringify(path.resolve('src/simulation/SurfaceDragPhysics.ts'))};

function bytes(a: Float32Array){ return Buffer.from(a.buffer, a.byteOffset, a.byteLength); }
function pointAt(storm:any,bearing:number,rKm:number){
  const a=bearing*Math.PI/180;
  return {lat:storm.lat+Math.cos(a)*rKm/111.12,lon:storm.lon+Math.sin(a)*rKm/(111.12*Math.max(.2,Math.cos(storm.lat*Math.PI/180)))};
}

async function main(){
const storm:any={id:'SYN',name:'SYN',lat:19,lon:116,vmax:75,pmin:913.7,direction:0,speed:25,rmw:28,
  r7:{ne:300,se:360,sw:250,nw:270},r10:{ne:155,se:180,sw:135,nw:145},r12:{ne:82,se:96,sw:72,nw:76},
  category:'SuperTY',landed:false,dissipated:false,extrTransition:0,ewrcState:'none',ewrcProgress:0,active:true,history:[],simHour:0};
const env={slp:1010,shearU:5,shearV:1};
const c=sampleTropicalCycloneVortex(19,116,storm,env as any);
assert.ok(Math.abs(c.pressureHpa-storm.pmin)<0.1,'centre pmin mismatch');
const east=sampleTropicalCycloneVortex(19,116.6,storm,env as any);
const west=sampleTropicalCycloneVortex(19,115.4,storm,env as any);
assert.ok(east.v>0 && west.v<0,'NH circulation must be counter-clockwise');
assert.ok(east.radialInflowMs<0 && west.radialInflowMs<0,'boundary-layer seed must contain inward radial flow');
assert.ok(Math.hypot(east.u,east.v)>Math.hypot(west.u,west.v),'moving NH storm right side should remain stronger');
const south={...storm,lat:-19};
assert.ok(sampleTropicalCycloneVortex(-19,116.6,south,env as any).v<0,'SH circulation must mirror NH');

// 正常四象限差异仍应保留风圈约束。
for (const [r,v] of [[storm.r12.ne,32.4],[storm.r10.ne,24.2],[storm.r7.ne,13.9]] as const) {
  const got=targetWindFromQuadrantRadii(storm,45,r);
  assert.ok(Math.abs(got-v)/v<=0.10, 'quadrant radius anchor outside 10%');
}

// 极端不均匀风圈不能再把强台风内核压扁成单侧直墙。
const lopsided:any={...storm,lat:25,lon:122,vmax:60,pmin:930,direction:315,speed:22,
 r7:{ne:380,se:340,sw:120,nw:150},r10:{ne:230,se:210,sw:80,nw:100},r12:{ne:130,se:120,sw:55,nw:70}};
const coreSpeeds=[45,135,225,315].map(b=>{const p=pointAt(lopsided,b,60);const x=sampleTropicalCycloneVortex(p.lat,p.lon,lopsided,{slp:1010,shearU:10,shearV:3} as any);return Math.hypot(x.u,x.v);});
assert.ok(Math.max(...coreSpeeds)/Math.min(...coreSpeeds)<1.40,'strong TC core remains excessively squashed');

// 登陆/地形损伤不能仅因 damage 标志把风速最大风圈突然膨胀；压力场可独立展宽。
const damagedSea:any={...storm,lat:22,lon:121,vmax:48,pmin:955,rmw:32,landed:false,isStructureDamaged:true,structuralDamageHours:20,terrainHollowCoreMemory:0.8};
const damagedLand:any={...damagedSea,landed:true};
const ringR=44;
const pSea=pointAt(damagedSea,90,ringR), pLand=pointAt(damagedLand,90,ringR);
const vSea=sampleTropicalCycloneVortex(pSea.lat,pSea.lon,damagedSea,{slp:1008,shearU:4,shearV:1} as any);
const vLand=sampleTropicalCycloneVortex(pLand.lat,pLand.lon,damagedLand,{slp:1008,shearU:4,shearV:1} as any);
assert.ok(Math.hypot(vLand.u,vLand.v) <= Math.hypot(vSea.u,vSea.v)*1.12,'landfall damage still inflates the wind core abruptly');

// 强风陆面 10 m 耦合不再被固定压到 40%-50%。
const sea=estimateTenMeterReduction(false,0.001,760,35,14,0);
const land=estimateTenMeterReduction(true,0.20,900,35,14,80);
assert.ok(land/sea>=0.70 && land/sea<=0.94,'strong-wind land/sea 10m ratio out of repaired range');
assert.ok(seaSurfaceDragCoefficient(55)<=seaSurfaceDragCoefficient(33),'high-wind sea drag must saturate/decline');

// 直接回归 slab：35 m/s 的平原来流经过完整高精度伪时间迭代后不能被摩擦耗散到接近 0。
const nx=31, ny=31, n=nx*ny;
const slp=new Float32Array(n).fill(1000), u=new Float32Array(n).fill(35), v=new Float32Array(n);
const cd=new Float32Array(n).fill(0.004), h=new Float32Array(n).fill(900), pen=new Float32Array(n), tx=new Float32Array(n), ty=new Float32Array(n);
const isLand=new Uint8Array(n).fill(1), relief=new Float32Array(n).fill(40), elevation=new Float32Array(n).fill(20), sx=new Float32Array(n), sy=new Float32Array(n);
const opts:any={geometry:{nx,ny,lon0:120,lat0:28,stepDeg:0.125},slpHpa:slp,initialU:u,initialV:v,
 surface:{dragCoefficient:cd,boundaryLayerDepthM:h,terrainPenalty:pen,terrainDeflectX:tx,terrainDeflectY:ty,isLand,localReliefM:relief,elevationM:elevation,slopeEastMPerKm:sx,slopeNorthMPerKm:sy},maxIterations:132};
const sol=await solveWindBoundaryLayer(opts); const k=15*nx+15; const retained=Math.hypot(sol.u[k],sol.v[k]);
assert.ok(retained/35>0.72,'flat-land slab still destroys strong wind');
const tenM=retained*estimateTenMeterReduction(true,0.12,900,retained,14,40)*1.943844;
assert.ok(tenM>32,'synthetic strong-TC inland wind fell below 32 kt');

// 地形尾流进入动量方程后，山后风速应显著小于无尾流基线，但仍保持有限恢复能力。
const wake=new Float32Array(n);
for(let y=12;y<=18;y++) for(let x=14;x<=20;x++) wake[y*nx+x]=Math.max(0.15,0.82-Math.abs(x-16)*0.12);
const wakeOpts:any={...opts,surface:{...opts.surface,terrainWake:wake}};
const wakeSol=await solveWindBoundaryLayer(wakeOpts);
const lee=15*nx+17;
assert.ok(Math.hypot(wakeSol.u[lee],wakeSol.v[lee]) < Math.hypot(sol.u[lee],sol.v[lee])*0.97,'terrain wake does not create a lee-side wind reduction');
assert.ok(Math.hypot(wakeSol.u[15*nx+20],wakeSol.v[15*nx+20]) > Math.hypot(wakeSol.u[lee],wakeSol.v[lee])*0.90,'terrain wake recovery is unrealistically absent');

// 同输入逐字节确定、无 NaN/Infinity。
const sol2=await solveWindBoundaryLayer(opts);
for(const arr of [sol.u,sol.v,sol.diagnostics.divergence,sol.diagnostics.verticalVelocity]) for(const x of arr) assert.ok(Number.isFinite(x),'NaN/Infinity in solver');
assert.ok(sol.diagnostics.iterations>=60 && sol.diagnostics.iterations<=180 && Number.isFinite(sol.diagnostics.residualMs),'solver diagnostics invalid');
assert.ok(bytes(sol.u).equals(bytes(sol2.u)) && bytes(sol.v).equals(bytes(sol2.v)),'solver output must be bytewise deterministic');

// 日界线连续。
const dateline={...storm,lon:179.8};
const across=sampleTropicalCycloneVortex(19,-179.8,dateline,env as any);
assert.ok(Number.isFinite(across.pressureHpa)&&across.pressureHpa<1008,'dateline vortex discontinuity');
console.log('synoptic numeric 5.2.31 palette-fix: PASS');
}
main().catch(err=>{ console.error(err); process.exit(1); });
`);
try {
  const esbuild = require('esbuild');
  esbuild.buildSync({ entryPoints:[entry], bundle:true, platform:'node', format:'cjs', target:'node20', outfile, logLevel:'silent' });
  execFileSync(process.execPath, [outfile], {stdio:'inherit'});
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message || '').includes('esbuild')) {
    execFileSync(process.execPath, ['--experimental-strip-types', entry], {stdio:'inherit'});
  } else throw err;
}
fs.rmSync(tmpDir, {recursive:true, force:true});
console.log('synoptic_wind_pressure_regression 5.2.31 palette-fix: PASS');
