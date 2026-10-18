/**
 * ROUND152 — structure-gated wind-map eyewall coherence.
 *
 * This does NOT create an eye, erase the centre wind, restore a missing eyewall,
 * impose a circular pressure anomaly or alter storm history/physics.  It only
 * damps short-wavelength AZIMUTHAL speed noise where a well-defined eyewall
 * already exists in the solved ten-metre wind vectors.  Strength increases
 * progressively with Vmax, but requires independent positive evidence of a
 * complete, relatively clear, non-landfalling eye from the simulation state.
 */

export interface IntactEyewallState {
  lat: number;
  lon: number;
  vmax: number;
  rmw?: number;
  landed?: boolean;
  dissipated?: boolean;
  eyeType?: string;
  eyePhase?: string;
  eyeClearance?: number;
  eyeObstruction?: number;
  eyeAsymmetry?: number;
  eyeRadiusKm?: number;
  eyewallIntegrity?: number;
  eyewallWrapProgress?: number;
  eyewallOpenSectorFraction?: number;
  extrTransition?: number;
}

interface EyeGrid {
  nx: number;
  ny: number;
  lonMin: number;
  latMin: number;
  stepDeg: number;
  landMask: Uint8Array;
  u10: Float32Array;
  v10: Float32Array;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
function smooth(x: number) { const t = clamp(x, 0, 1); return t*t*(3-2*t); }

/** Zero means do not modify ANY grid cell: damaged or missing eyes are left intact. */
export function intactEyewallRefinementStrength(s: IntactEyewallState): number {
  if (s.landed || s.dissipated || !['small_round','large_round'].includes(s.eyeType || '')
    || !['clear','replacement_new'].includes(s.eyePhase || '')
    || (s.extrTransition || 0) > 0.08) return 0;
  if (!(s.vmax > 42) || (s.eyewallIntegrity || 0) < 0.76
    || (s.eyeClearance || 0) < 0.42 || (s.eyeObstruction ?? 1) > 0.55
    || (s.eyeAsymmetry ?? 1) > 0.48
    || (s.eyewallWrapProgress || 0) < 0.70
    || (s.eyewallOpenSectorFraction ?? 1) > 0.19) return 0;
  const wind = smooth((s.vmax - 44) / 30);
  const intact = smooth(((s.eyewallIntegrity || 0) - 0.76) / 0.18);
  const clarity = smooth(((s.eyeClearance || 0) - 0.42) / 0.16);
  const obstruction = 1 - smooth(((s.eyeObstruction || 0) - 0.32) / 0.23);
  const symmetry = 1 - smooth(((s.eyeAsymmetry || 0) - 0.24) / 0.24);
  const wrapped = smooth(((s.eyewallWrapProgress || 0) - 0.70) / 0.19);
  return 0.56 * wind * intact * clarity * obstruction * symmetry * wrapped;
}

function sampleSpeed(grid: EyeGrid, srcU: Float32Array, srcV: Float32Array, lat: number, lon: number): number | null {
  let x = (lon - grid.lonMin) / grid.stepDeg;
  const y = (lat - grid.latMin) / grid.stepDeg;
  if (x < 0 || y < 0 || x >= grid.nx - 1 || y >= grid.ny - 1) return null;
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j;
  const a = j * grid.nx + i, b = a + 1, c = a + grid.nx, d = c + 1;
  if (grid.landMask[a] || grid.landMask[b] || grid.landMask[c] || grid.landMask[d]) return null;
  const mag = (k: number) => Math.hypot(srcU[k], srcV[k]);
  return ((mag(a)*(1-tx)+mag(b)*tx)*(1-ty)
    + (mag(c)*(1-tx)+mag(d)*tx)*ty);
}

/** Mutates vectors only at an already intact, all-ocean eyewall; no global smoothing. */
export function refineIntactEyewallVectors(grid: EyeGrid, states: readonly IntactEyewallState[]): number {
  const { nx,ny,stepDeg,lonMin,latMin,u10,v10,landMask } = grid;
  if (nx < 4 || ny < 4 || stepDeg <= 0) return 0;
  let changed = 0;
  for (const storm of states) {
    const weight = intactEyewallRefinementStrength(storm);
    if (weight < 0.0001) continue;
    const rmw = clamp(storm.rmw || 35, 9, 115);
    // No circular eye artificiality across a coast: a single land pixel within
    // 1.9 RMW disables the entire operation for this storm.
    const cosLat = Math.max(0.25, Math.cos(storm.lat * Math.PI/180));
    const i0 = Math.max(0, Math.floor((storm.lon - 1.95*rmw/(111.12*cosLat) - lonMin)/stepDeg));
    const i1 = Math.min(nx-1, Math.ceil((storm.lon + 1.95*rmw/(111.12*cosLat) - lonMin)/stepDeg));
    const j0 = Math.max(0, Math.floor((storm.lat - 1.95*rmw/111.12 - latMin)/stepDeg));
    const j1 = Math.min(ny-1, Math.ceil((storm.lat + 1.95*rmw/111.12 - latMin)/stepDeg));
    if (i0 === 0 || i1 === nx-1 || j0 === 0 || j1 === ny-1) continue;
    let touchesLand = false;
    for (let j=j0;j<=j1&&!touchesLand;j++) for (let i=i0;i<=i1;i++) {
      const dy=(latMin+j*stepDeg-storm.lat)*111.12;
      const dx=(lonMin+i*stepDeg-storm.lon)*111.12*cosLat;
      if (dx*dx+dy*dy < (1.9*rmw)**2 && landMask[j*nx+i]) { touchesLand=true; break; }
    }
    if (touchesLand) continue;
    // Always sample the original solver result rather than feeding smoothed
    // values back into following samples. The original wind direction is kept.
    const srcU = new Float32Array(u10),srcV = new Float32Array(v10);
    for (let j=j0;j<=j1;j++) for (let i=i0;i<=i1;i++) {
      const k = j*nx+i;
      if (landMask[k]) continue;
      const dy=(latMin+j*stepDeg-storm.lat)*111.12;
      const dx=(lonMin+i*stepDeg-storm.lon)*111.12*cosLat;
      const r=Math.hypot(dx,dy);
      if (r<0.42*rmw || r>1.78*rmw) continue;
      const ring = smooth((r/rmw-0.42)/0.40) * (1-smooth((r/rmw-1.35)/0.43));
      if (ring < 0.002) continue;
      const speed=Math.hypot(srcU[k],srcV[k]);
      if (speed < 0.5) continue;
      const angle=Math.atan2(dy,dx);
      let avg=0,total=0;
      for(const [delta,w] of [[0,0.38],[-0.21,0.22],[0.21,0.22],[-0.42,0.09],[0.42,0.09]] as const){
        const lat=storm.lat + (r*Math.sin(angle+delta))/111.12;
        const lon=storm.lon + (r*Math.cos(angle+delta))/(111.12*cosLat);
        const s=sampleSpeed(grid,srcU,srcV,lat,lon);
        if(s!==null){avg+=s*w;total+=w;}
      }
      if(total<0.75)continue;
      const target=avg/total;
      // Preserve local magnitude, maximum winds and asymmetric large-scale
      // flow; damp only small jagged sectors. The operation cannot open a calm
      // eye or restore missing walls because eligibility already forbids them.
      const mix=weight*ring;
      const next=speed+clamp((target-speed)*mix,-speed*0.13,speed*0.13);
      if (Math.abs(next-speed) < 1e-4) continue;
      const factor=next/speed;
      u10[k]=srcU[k]*factor;
      v10[k]=srcV[k]*factor;
      changed++;
    }
  }
  return changed;
}


/**
 * ROUND153 opt-in presentation enhancement, separate from the default Round152
 * calculation. This requires an actual archived eye; it never creates an eye,
 * depresses central winds to zero, or bridges an absent wall.
 *
 * A complete eye receives strong angular denoising independent of Vmax.
 * A damaged but still existing eye receives weaker, guarded local smoothing;
 * a missing eye receives absolutely no adjustment.
 */
export function enhancedEyeRefinementStrength(s: IntactEyewallState): number {
  if (s.dissipated || !s.eyeType || s.eyeType === 'none' || s.eyePhase === 'none'
    || (s.extrTransition || 0) > 0.45) return 0;
  const integrity = clamp(s.eyewallIntegrity || 0, 0, 1);
  const clearance = clamp(s.eyeClearance || 0, 0, 1);
  const obstruction = clamp(s.eyeObstruction ?? 1, 0, 1);
  const asymmetry = clamp(s.eyeAsymmetry ?? 1, 0, 1);
  const wrapped = clamp(s.eyewallWrapProgress || 0, 0, 1);
  const opening = clamp(s.eyewallOpenSectorFraction ?? 1, 0, 1);
  // An eye classified as intact receives the same strong enhancement even at
  // tropical-storm winds. No artificial Vmax threshold or pressure shortcut.
  const complete = integrity >= .54 && clearance >= .16 && obstruction <= .84
    && wrapped >= .48 && opening <= .43 && asymmetry <= .80
    && ['clear', 'replacement_new'].includes(s.eyePhase || '');
  if (complete) return .88 + .08 * smooth((s.vmax - 25) / 45);
  // A gap / partial eye is NOT a round eye. Its existing sectors can be cleaned
  // a little, without closing gaps or imposing a global circular template.
  if (integrity < .17 || wrapped < .23 || clearance < .10 || obstruction >= .985 || opening > .86) return 0;
  const remaining = smooth((integrity - .17) / .50);
  const partial = .85 * Math.pow(remaining, .58) * (1 - .24 * obstruction)
    * (1 - .20 * asymmetry) * (0.85 + .15 * clearance) * (1 - .25 * opening);
  return clamp(partial, 0, .60);
}

export function refineEnhancedEyeVectors(grid: EyeGrid, states: readonly IntactEyewallState[]): number {
  const { nx, ny, stepDeg, lonMin, latMin, u10, v10, landMask } = grid;
  if (nx < 4 || ny < 4 || stepDeg <= 0) return 0;
  let changed = 0;
  for (const storm of states) {
    const strength = enhancedEyeRefinementStrength(storm);
    if (strength <= .0001) continue;
    const fullEye = strength >= .8;
    // Avoid rebuilding a symmetric ring across terrain or an incomplete eye.
    // On land the existing vortex, friction and topography remain untouched.
    if (storm.landed && fullEye) continue;
    const rmw = clamp(storm.rmw || 35, 9, 115);
    const cosLat = Math.max(.25, Math.cos(storm.lat * Math.PI / 180));
    const radius = 1.90 * rmw;
    const i0 = Math.max(0, Math.floor((storm.lon - radius / (111.12*cosLat) - lonMin) / stepDeg));
    const i1 = Math.min(nx-1, Math.ceil((storm.lon + radius / (111.12*cosLat) - lonMin) / stepDeg));
    const j0 = Math.max(0, Math.floor((storm.lat - radius / 111.12 - latMin) / stepDeg));
    const j1 = Math.min(ny-1, Math.ceil((storm.lat + radius / 111.12 - latMin) / stepDeg));
    if (i0 === 0 || j0 === 0 || i1 === nx-1 || j1 === ny-1) continue;
    let coast = false;
    for (let j=j0; j<=j1 && !coast; j++) for (let i=i0; i<=i1; i++) {
      const dy=(latMin+j*stepDeg-storm.lat)*111.12;
      const dx=(lonMin+i*stepDeg-storm.lon)*111.12*cosLat;
      if (dx*dx+dy*dy < radius*radius && landMask[j*nx+i]) { coast=true; break; }
    }
    // An existing damaged eye may still be cleaned locally over water; never
    // impose a full circular wall where terrain physically interrupts it.
    if (coast && fullEye) continue;
    const sourceU=new Float32Array(u10),sourceV=new Float32Array(v10);
    // Opt-in clarity must not invent a stronger peak than the resolved solver.
    let originalPeak = 0;
    for (let j=j0;j<=j1;j++) for (let i=i0;i<=i1;i++) {
      const k=j*nx+i;
      if (!landMask[k]) originalPeak=Math.max(originalPeak,Math.hypot(sourceU[k],sourceV[k]));
    }
    const coreRadius = clamp(storm.eyeRadiusKm || .42*rmw, 6, .85*rmw);
    for (let j=j0;j<=j1;j++) for (let i=i0;i<=i1;i++) {
      const k=j*nx+i;
      if (landMask[k]) continue;
      const dy=(latMin+j*stepDeg-storm.lat)*111.12;
      const dx=(lonMin+i*stepDeg-storm.lon)*111.12*cosLat;
      const r=Math.hypot(dx,dy);
      // Opt-in: excavate the EXISTING calm eye inside its archived radius.
      // Eligibility still requires eye diagnostics and an entirely oceanic
      // complete eye. Never change pressure, physical intensity or no-eye cases.
      if(fullEye && r<coreRadius*.90 && !coast && (storm.eyeClearance||0)>=.16){
        const sourceSpeed=Math.hypot(sourceU[k],sourceV[k]);
        const eyeMask=1-smooth((r/coreRadius-.12)/.78);
        const floor=1-(.60*strength*eyeMask);
        if(sourceSpeed>.2 && floor<.999){
          u10[k]=sourceU[k]*floor;v10[k]=sourceV[k]*floor;changed++;
        }
        continue;
      }
      if (r<Math.max(.32*rmw,.57*coreRadius) || r>1.83*rmw) continue;
      const radialMask=smooth((r/rmw-.32)/.32)*(1-smooth((r/rmw-1.42)/.40));
      if (radialMask < .002) continue;
      const speed=Math.hypot(sourceU[k],sourceV[k]);
      if (speed < 1) continue;
      const angle=Math.atan2(dy,dx);
      const deltaSamples: readonly [number,number][] = fullEye
        ? [[0,.19],[-.15,.16],[.15,.16],[-.30,.12],[.30,.12],[-.48,.085],[.48,.085],[-.65,.035],[.65,.035]]
        : [[0,.5],[-.12,.18],[.12,.18],[-.24,.07],[.24,.07]];
      let weightedSpeed=0,weightSum=0;
      for(const [delta,w] of deltaSamples){
        const lat=storm.lat+r*Math.sin(angle+delta)/111.12;
        const lon=storm.lon+r*Math.cos(angle+delta)/(111.12*cosLat);
        const sampled=sampleSpeed(grid,sourceU,sourceV,lat,lon);
        if(sampled!==null){weightedSpeed+=sampled*w;weightSum+=w;}
      }
      if(weightSum<.72)continue;
      const mean=weightedSpeed/weightSum;
      // A missing wall is a genuine strong speed deficit: do NOT fill it by
      // importing wind from the opposite side of the eye.
      if (!fullEye && Math.abs(mean-speed)>speed*.28) continue;
      let next=speed+(mean-speed)*strength*radialMask;
      if (r>coreRadius*.85 && r<rmw*1.30) {
        // Weak radial contrast enhancement at the existing eye-wall boundary.
        // Only accentuate a physically resolved outward speed gradient; never
        // force central calm, and never overwrite the original flow direction.
        const dr=Math.max(3,.18*rmw);
        const inner=sampleSpeed(grid,sourceU,sourceV,
          storm.lat+(r-dr)*Math.sin(angle)/111.12,
          storm.lon+(r-dr)*Math.cos(angle)/(111.12*cosLat));
        const outer=sampleSpeed(grid,sourceU,sourceV,
          storm.lat+(r+dr)*Math.sin(angle)/111.12,
          storm.lon+(r+dr)*Math.cos(angle)/(111.12*cosLat));
        if(inner!==null && outer!==null && outer>inner) {
          const contrast=(outer-inner)*(fullEye ? .24 : .11)*strength*radialMask;
          next += clamp(contrast,-.09*speed,.09*speed);
        }
      }
      // No uncontrolled amplification: protect the vortex solution and rings.
      const limit=fullEye?.30:.14;
      next=Math.min(originalPeak,clamp(next,speed*(1-limit),speed*(1+limit)));
      if (Math.abs(next-speed)<.0001) continue;
      const factor=next/speed;
      u10[k]=sourceU[k]*factor;
      v10[k]=sourceV[k]*factor;
      changed++;
    }
  }
  return changed;
}
