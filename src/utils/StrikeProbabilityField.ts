import {terminateEnsembleTrack, type EnsembleTrackEndMode} from "./EnsembleTrackTermination";
import type { AetherGuidanceMember, AetherGuidancePoint } from "../simulation/AetherEnsembleGuidance";

/** Probabilities count a member once if any part of its centre track comes within radiusKm. */
export interface StrikeBounds { minLat: number; maxLat: number; minLon: number; maxLon: number }
export interface StrikeFieldOptions {
  bounds: StrikeBounds;
  radiusKm: number;
  cellDeg: number;
  horizonHours: number;
  smoothPasses: number;
  endMode?: EnsembleTrackEndMode;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}
export interface StrikeField {
  nx: number; ny: number; cellDeg: number; minLat: number; minLon: number;
  prob: Float32Array;
  /** Unsmoothed membership probabilities for accurately placed coastline colours. */
  rawProb: Float32Array;
  memberCount: number;
  requestedCellDeg?: number;
}
export const unwrapStrikeLon = (lon: number, reference: number) => lon + 360 * Math.round((reference - lon) / 360);
const rad = Math.PI / 180;
const finite = (v: unknown) => Number.isFinite(Number(v));
export function strikeTrackWithinHorizon(track: readonly AetherGuidancePoint[], horizonHours: number,
  endMode:EnsembleTrackEndMode="operational",identity:Partial<AetherGuidanceMember>={}):AetherGuidancePoint[]{
  return terminateEnsembleTrack(track,horizonHours,endMode,identity);
}
function forEachSegment(track: readonly AetherGuidancePoint[], horizon: number, centerLon: number,
  visit: (ax: number, ay: number, bx: number, by: number) => void, endMode:EnsembleTrackEndMode="operational",identity:Partial<AetherGuidanceMember>={}) {
  const clipped = strikeTrackWithinHorizon(track, horizon,endMode,identity);
  let prevLon = centerLon;
  let prev: AetherGuidancePoint | null = null;
  for (const point of clipped) {
    const lon = unwrapStrikeLon(point.lon, prevLon);
    if (prev) visit(prevLon, prev.lat, lon, point.lat);
    else visit(lon, point.lat, lon, point.lat);
    prev = point;
    prevLon = lon;
  }
}
/** Squared km distance from geographical point to a geographical segment. */
export function strikeSegmentDistanceSq(lat: number, lon: number, ax: number, ay: number, bx: number, by: number) {
  const refLat = (lat + (ay + by) / 2) / 2;
  const cx = Math.cos(refLat * rad) * 111.32;
  const px = (lon - ax) * cx, py = (lat - ay) * 110.57;
  const vx = (bx - ax) * cx, vy = (by - ay) * 110.57;
  const d = vx * vx + vy * vy;
  const t = d > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / d)) : 0;
  const ex = px - t * vx, ey = py - t * vy;
  return ex * ex + ey * ey;
}
export function computeSiteProbability(members: readonly AetherGuidanceMember[], site: { lat: number; lon: number }, radiusKm: number, horizonHours: number,endMode:EnsembleTrackEndMode="operational"): number {
  if (!members.length) return 0;
  let hits = 0;
  const maxDistSq = radiusKm * radiusKm;
  for (const m of members) {
    let hit = false;
    forEachSegment(m.track, horizonHours, site.lon, (ax, ay, bx, by) => {
      if (hit) return;
      if (strikeSegmentDistanceSq(site.lat, site.lon, ax, ay, bx, by) <= maxDistSq) hit = true;
    }, endMode,m);
    if (hit) hits++;
  }
  return hits * 100 / members.length;
}
/** Pre-index member centre-track segments by conservative latitude/longitude boxes.
 * Used only where an oversized requested grid was relaxed by the memory budget:
 * coastal highlight/site probabilities remain exact UNSMOOTHED hit fractions.
 * The final membership test is the same as computeSiteProbability.
 */
export interface StrikeSiteIndex {
  readonly memberCount:number;
  readonly radiusKm:number;
  readonly centerLon:number;
  readonly bucketDeg:number;
  readonly buckets:Map<string, Array<{member:number;ax:number;ay:number;bx:number;by:number}>>;
}
export function buildStrikeSiteIndex(members:readonly AetherGuidanceMember[], radiusKm:number,
  horizonHours:number,centerLon:number,endMode:EnsembleTrackEndMode='operational',bucketDeg=3):StrikeSiteIndex {
  const buckets=new Map<string,Array<{member:number;ax:number;ay:number;bx:number;by:number}>>();
  const bucket=Math.max(1,Math.min(10,Number.isFinite(bucketDeg)?bucketDeg:3));
  const radius=Math.max(1,radiusKm),latPad=radius/110.57;
  members.forEach((member,mi)=>forEachSegment(member.track,horizonHours,centerLon,(ax,ay,bx,by)=>{
    if(![ax,ay,bx,by].every(Number.isFinite))return;
    const maxAbsLat=Math.min(89.5,Math.max(Math.abs(ay),Math.abs(by))+latPad);
    const lonPad=radius/(111.32*Math.max(.0087265,Math.cos(maxAbsLat*rad)));
    const lowX=Math.floor((Math.min(ax,bx)-lonPad)/bucket),highX=Math.floor((Math.max(ax,bx)+lonPad)/bucket);
    const lowY=Math.floor((Math.min(ay,by)-latPad)/bucket),highY=Math.floor((Math.max(ay,by)+latPad)/bucket);
    // Reject malformed world-spanning segments instead of allocating millions of buckets.
    if((highX-lowX+1)*(highY-lowY+1)>50000)return;
    for(let y=lowY;y<=highY;y++)for(let x=lowX;x<=highX;x++){
      const key=`${x}:${y}`,entry={member:mi,ax,ay,bx,by};
      const list=buckets.get(key);if(list)list.push(entry);else buckets.set(key,[entry]);
    }
  },endMode,member));
  return {memberCount:members.length,radiusKm:radius,centerLon,bucketDeg:bucket,buckets};
}
export function computeSiteProbabilityIndexed(index:StrikeSiteIndex,site:{lat:number;lon:number}):number {
  if(!index.memberCount||![site.lat,site.lon].every(Number.isFinite))return 0;
  const lon=unwrapStrikeLon(site.lon,index.centerLon),cell=index.bucketDeg;
  const entries=index.buckets.get(`${Math.floor(lon/cell)}:${Math.floor(site.lat/cell)}`);
  if(!entries?.length)return 0;
  const seen=new Set<number>(),radiusSq=index.radiusKm*index.radiusKm;
  for(const seg of entries){
    if(seen.has(seg.member))continue;
    if(strikeSegmentDistanceSq(site.lat,lon,seg.ax,seg.ay,seg.bx,seg.by)<=radiusSq)seen.add(seg.member);
  }
  return seen.size*100/index.memberCount;
}
function smoothGrid(src: Float32Array, nx: number, ny: number): Float32Array {
  const dst = new Float32Array(src.length);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let sum = 0, weight = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= nx || yy < 0 || yy >= ny) continue;
      const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
      sum += src[yy * nx + xx] * w; weight += w;
    }
    dst[y * nx + x] = sum / weight;
  }
  return dst;
}
/** Constant-time per pixel separable box filters approximate a Gaussian with a
 * FIXED geographic width. A 0.0025° mesh therefore does not lose smoothing by
 * using the same 3×3 pixels as a 0.1° mesh. Kept separate from the legacy
 * 0.1° path to preserve Round184 pixel and test compatibility. */
export function smoothGridPhysical(src:Float32Array,nx:number,ny:number,cellDeg:number,passes:number):Float32Array {
  if(!nx||!ny||src.length!==nx*ny||passes<=0)return src;
  const physicalWidthDeg=.065*Math.sqrt(Math.max(1,passes));
  const radius=Math.max(1,Math.min(64,Math.round(physicalWidthDeg/Math.max(.0025,cellDeg))));
  // Two horizontal + two vertical passes: rotationally symmetric smoothing.
  // Only two scratch buffers are allocated; rawProb is never mutated. This also
  // eliminates the former horizontal-horizontal/vertical asymmetry.
  const a=new Float32Array(src.length),b=new Float32Array(src.length);
  let current:Float32Array=src;
  for(let iteration=0;iteration<4;iteration++){
    const target=iteration%2===0?a:b;
    if(iteration%2===0){
      for(let y=0;y<ny;y++){
        let sum=0,count=0;const offset=y*nx;
        for(let x=0;x<nx;x++){
          if(x===0){for(let j=0;j<=Math.min(radius,nx-1);j++){sum+=current[offset+j];count++;}}
          else {if(x-radius-1>=0){sum-=current[offset+x-radius-1];count--;}
            if(x+radius<nx){sum+=current[offset+x+radius];count++;}}
          target[offset+x]=sum/count;
        }
      }
    }else{
      for(let x=0;x<nx;x++){
        let sum=0,count=0;
        for(let y=0;y<ny;y++){
          if(y===0){for(let j=0;j<=Math.min(radius,ny-1);j++){sum+=current[j*nx+x];count++;}}
          else {if(y-radius-1>=0){sum-=current[(y-radius-1)*nx+x];count--;}
            if(y+radius<ny){sum+=current[(y+radius)*nx+x];count++;}}
          target[y*nx+x]=sum/count;
        }
      }
    }
    current=target;
  }
  return current;
}
const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
};
/** Conservative budget for the full in-memory field + browser raster; choose finer cells on small frames. */
/** Full-buffer path is still used for 2019/Round184 exact image compatibility. */
export const STRIKE_MAX_CELLS = 5_000_000;
/** Streamed path limits; stripes, not the whole requested probability field, are retained. */
export const STRIKE_STREAM_DESKTOP_CELLS = 80_000_000;
export const STRIKE_STREAM_MOBILE_CELLS = 16_000_000;
export const strikeIsMobile = () => typeof navigator!=='undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent||'');
export const strikeStreamingCell = (bounds:StrikeBounds,requested:number,mobile=strikeIsMobile()) =>
  strikeEffectiveCell(bounds,requested,mobile?STRIKE_STREAM_MOBILE_CELLS:STRIKE_STREAM_DESKTOP_CELLS);
export function strikeEffectiveCell(bounds:StrikeBounds,requested:number,budget=STRIKE_MAX_CELLS):number {
  let cell=Math.max(.0025,Math.min(1,Number.isFinite(requested)?requested:.1));
  const dims=(v:number)=>[Math.floor((bounds.maxLon-bounds.minLon)/v)+1,Math.floor((bounds.maxLat-bounds.minLat)/v)+1];
  let [nx,ny]=dims(cell);
  if(nx*ny>budget){
    cell=Math.max(cell,Math.sqrt((bounds.maxLon-bounds.minLon)*(bounds.maxLat-bounds.minLat)/Math.max(1,budget-10000)));
    [nx,ny]=dims(cell);
    while(nx*ny>budget){cell*=1.001;[nx,ny]=dims(cell);}
  }
  return cell;
}
/**
 * Exact capsule horizontal intervals, in the SAME local metric used by
 * strikeSegmentDistanceSq (refLat depends on the query row).
 */
export function capsuleRowInterval(lat:number, ax:number, ay:number,bx:number,by:number,radiusKm:number):[number,number]|null {
  const metric=Math.max(0.000001,Math.cos(((lat+(ay+by)/2)/2)*rad)*111.32);
  const vx=(bx-ax)*metric, vy=(by-ay)*110.57, dy=(lat-ay)*110.57;
  const r=Math.max(0,radiusKm), rSq=r*r,d=vx*vx+vy*vy;
  let lo=Infinity,hi=-Infinity;
  const add=(a:number,b:number)=>{lo=Math.min(lo,a);hi=Math.max(hi,b);};
  const disc=(cx:number,cy:number)=>{const dist=(lat-cy)*110.57;if(Math.abs(dist)<=r){const half=Math.sqrt(Math.max(0,rSq-dist*dist))/metric;add(cx-half,cx+half);}};
  disc(ax,ay);disc(bx,by);
  if(d>1e-12){
    let l=-Infinity,h=Infinity;
    // Projection onto the segment t in [0,1].
    if(Math.abs(vx)>1e-12){
      const a=( -dy*vy)/vx+ax*metric,b=(d-dy*vy)/vx+ax*metric;
      l=Math.max(l,Math.min(a,b));h=Math.min(h,Math.max(a,b));
    } else if(dy*vy<0||dy*vy>d) h=-Infinity;
    // Signed normal distance to the supporting line.
    if(Math.abs(vy)>1e-12){
      const aa=(vx*dy-r*Math.sqrt(d))/vy+ax*metric;
      const bb=(vx*dy+r*Math.sqrt(d))/vy+ax*metric;
      l=Math.max(l,Math.min(aa,bb));h=Math.min(h,Math.max(aa,bb));
    }else if(Math.abs(vx*dy)>r*Math.sqrt(d)) h=-Infinity;
    if(l<=h)add(l/metric,h/metric);
  }
  return lo<=hi?[lo,hi]:null;
}
export async function computeStrikeField(members:readonly AetherGuidanceMember[],opt:StrikeFieldOptions):Promise<StrikeField> {
  const {bounds}=opt;
  if(![bounds.minLon,bounds.maxLon,bounds.minLat,bounds.maxLat].every(Number.isFinite)||bounds.maxLon<=bounds.minLon||bounds.maxLat<=bounds.minLat)
    throw new Error("概率取景范围无效");
  const cell=strikeEffectiveCell(bounds,opt.cellDeg);
  const nx=Math.floor((bounds.maxLon-bounds.minLon)/cell)+1,ny=Math.floor((bounds.maxLat-bounds.minLat)/cell)+1;
  const diff=new Int32Array((nx+1)*ny),centerLon=(bounds.minLon+bounds.maxLon)/2;
  const radius=Math.max(1,opt.radiusKm),padLat=radius/110.57,endMode=opt.endMode||"operational";
  aborted(opt.signal);
  for(let mi=0;mi<members.length;mi++){
    const rowIntervals=new Map<number,Array<[number,number]>>();
    forEachSegment(members[mi].track,opt.horizonHours,centerLon,(ax,ay,bx,by)=>{
      const y0=Math.max(0,Math.ceil((Math.min(ay,by)-padLat-bounds.minLat)/cell-1e-8));
      const y1=Math.min(ny-1,Math.floor((Math.max(ay,by)+padLat-bounds.minLat)/cell+1e-8));
      for(let y=y0;y<=y1;y++){
        const lat=bounds.minLat+y*cell;
        const interval=capsuleRowInterval(lat,ax,ay,bx,by,radius);
        if(!interval)continue;
        const x0=Math.max(0,Math.ceil((interval[0]-bounds.minLon)/cell-1e-8));
        const x1=Math.min(nx-1,Math.floor((interval[1]-bounds.minLon)/cell+1e-8));
        if(x0>x1)continue;
        const row=rowIntervals.get(y);
        if(row)row.push([x0,x1]);else rowIntervals.set(y,[[x0,x1]]);
      }
    },endMode,members[mi]);
    for(const [y,intervals] of rowIntervals){
      intervals.sort((a,b)=>a[0]-b[0]);
      let [left,right]=intervals[0];
      const add=(a:number,b:number)=>{diff[y*(nx+1)+a]++;diff[y*(nx+1)+b+1]--;};
      for(let j=1;j<intervals.length;j++){
        const [a,b]=intervals[j];
        if(a<=right+1)right=Math.max(right,b);
        else {add(left,right);left=a;right=b;}
      }
      add(left,right);
    }
    if(mi%8===7||mi===members.length-1){opt.onProgress?.(mi+1,members.length);aborted(opt.signal);await new Promise<void>(resolve=>setTimeout(resolve,0));}
  }
  const rawProb=new Float32Array(nx*ny),n=members.length;
  for(let y=0;y<ny;y++){
    let count=0;
    for(let x=0;x<nx;x++){
      count+=diff[y*(nx+1)+x];
      if(n)rawProb[y*nx+x]=100*count/n;
    }
    if((y&255)===0){aborted(opt.signal);await new Promise<void>(resolve=>setTimeout(resolve,0));}
  }
  let prob=rawProb;
  const smoothing=Math.min(2,Math.max(0,Math.round(opt.smoothPasses)));
  if(n>=10 && smoothing && cell<.075){
    prob=smoothGridPhysical(rawProb,nx,ny,cell,smoothing);
    aborted(opt.signal);await new Promise<void>(resolve=>setTimeout(resolve,0));
  }else for(let pass=0;pass<smoothing;pass++)if(n>=10)prob=smoothGrid(prob,nx,ny);
  aborted(opt.signal);
  return {nx,ny,cellDeg:cell,requestedCellDeg:opt.cellDeg,minLat:bounds.minLat,minLon:bounds.minLon,prob,rawProb,memberCount:n};
}
/** Exact row-block hit field for frames too large to keep as a single dense buffer.
 * Caller receives each processed stripe and can resample it to output pixels.
 * Vertical halos protect the physical Gaussian kernel and bilinear sampling at
 * stripe boundaries; the callback retains only the cropped, short-lived rows.
 */
export interface StrikeFieldStripe {
  nx:number;ny:number;cellDeg:number;requestedCellDeg:number;
  /** Processed probability rows in south-to-north order [firstRow,lastRow). */
  firstRow:number;lastRow:number;coreStart:number;coreEnd:number;
  prob:Float32Array;
}
export async function computeStrikeFieldStripes(members:readonly AetherGuidanceMember[], opt:StrikeFieldOptions,
  onStripe:(stripe:StrikeFieldStripe)=>void|Promise<void>,maxCells=STRIKE_STREAM_DESKTOP_CELLS,stripeCells=1_600_000):Promise<{nx:number;ny:number;cellDeg:number;requestedCellDeg:number}> {
  const {bounds}=opt;
  if(![bounds.minLon,bounds.maxLon,bounds.minLat,bounds.maxLat].every(Number.isFinite)||bounds.maxLon<=bounds.minLon||bounds.maxLat<=bounds.minLat)
    throw new Error('概率取景范围无效');
  const cell=strikeEffectiveCell(bounds,opt.cellDeg,maxCells);
  const nx=Math.floor((bounds.maxLon-bounds.minLon)/cell)+1,ny=Math.floor((bounds.maxLat-bounds.minLat)/cell)+1;
  const smoothing=members.length>=10?Math.min(2,Math.max(0,Math.round(opt.smoothPasses))):0;
  const widthDeg=.065*Math.sqrt(Math.max(1,smoothing));
  const r=smoothing?Math.max(1,Math.min(64,Math.round(widthDeg/Math.max(.0025,cell)))):0;
  const halo=2*r+1; // two vertical box passes + bilinear neighbour
  const maxBandRows=Math.max(1,Math.floor(Math.max(1000,stripeCells)/Math.max(1,nx))-2*halo);
  const totalBands=Math.ceil(ny/maxBandRows);
  const centerLon=(bounds.minLon+bounds.maxLon)/2;
  const radius=Math.max(1,opt.radiusKm),padLat=radius/110.57,endMode=opt.endMode||'operational';
  for(let band=0;band<totalBands;band++){
    aborted(opt.signal);
    const coreStart=band*maxBandRows,coreEnd=Math.min(ny,coreStart+maxBandRows);
    const firstCalc=Math.max(0,coreStart-halo),lastCalc=Math.min(ny,coreEnd+halo);
    const rows=lastCalc-firstCalc;
    const diff=new Int32Array((nx+1)*rows);
    for(let mi=0;mi<members.length;mi++){
      const rowIntervals=new Map<number,Array<[number,number]>>();
      forEachSegment(members[mi].track,opt.horizonHours,centerLon,(ax,ay,bx,by)=>{
        const y0=Math.max(firstCalc,Math.ceil((Math.min(ay,by)-padLat-bounds.minLat)/cell-1e-8));
        const y1=Math.min(lastCalc-1,Math.floor((Math.max(ay,by)+padLat-bounds.minLat)/cell+1e-8));
        for(let y=y0;y<=y1;y++){
          const lat=bounds.minLat+y*cell,interval=capsuleRowInterval(lat,ax,ay,bx,by,radius);
          if(!interval)continue;
          const x0=Math.max(0,Math.ceil((interval[0]-bounds.minLon)/cell-1e-8));
          const x1=Math.min(nx-1,Math.floor((interval[1]-bounds.minLon)/cell+1e-8));
          if(x0>x1)continue;
          const row=rowIntervals.get(y);if(row)row.push([x0,x1]);else rowIntervals.set(y,[[x0,x1]]);
        }
      },endMode,members[mi]);
      for(const [y,intervals] of rowIntervals){
        intervals.sort((a,b)=>a[0]-b[0]);
        let [left,right]=intervals[0],offset=(y-firstCalc)*(nx+1);
        for(let j=1;j<intervals.length;j++){
          const [a,b]=intervals[j];
          if(a<=right+1)right=Math.max(right,b);
          else {diff[offset+left]++;diff[offset+right+1]--;left=a;right=b;}
        }
        diff[offset+left]++;diff[offset+right+1]--;
      }
      if((mi&15)===15 || mi===members.length-1){
        opt.onProgress?.(band*members.length+mi+1,totalBands*members.length);
        aborted(opt.signal);
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
    }
    const rawProb=new Float32Array(nx*rows),n=members.length;
    for(let y=0;y<rows;y++){
      let count=0,offset=y*(nx+1),outputOffset=y*nx;
      for(let x=0;x<nx;x++){count+=diff[offset+x];if(n)rawProb[outputOffset+x]=100*count/n;}
      if((y&127)===0){aborted(opt.signal);await new Promise<void>(resolve=>setTimeout(resolve,0));}
    }
    let prob=rawProb;
    if(smoothing)prob=smoothGridPhysical(rawProb,nx,rows,cell,smoothing);
    const firstRow=Math.max(firstCalc,coreStart-1),lastRow=Math.min(lastCalc,coreEnd+1);
    const result=prob.slice((firstRow-firstCalc)*nx,(lastRow-firstCalc)*nx);
    aborted(opt.signal);
    await onStripe({nx,ny,cellDeg:cell,requestedCellDeg:opt.cellDeg,firstRow,lastRow,coreStart,coreEnd,prob:result});
    // Drop the band including raw/working arrays on the next iteration.
    await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  aborted(opt.signal);
  return {nx,ny,cellDeg:cell,requestedCellDeg:opt.cellDeg};
}
export function sampleStrikeField(f: StrikeField, lat: number, lon: number, raw = false): number {
  const referenceLon = f.minLon + (f.nx - 1) * f.cellDeg / 2;
  const x = (unwrapStrikeLon(lon, referenceLon) - f.minLon) / f.cellDeg;
  const y = (lat - f.minLat) / f.cellDeg;
  if (x < 0 || x > f.nx - 1 || y < 0 || y > f.ny - 1) return 0;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(f.nx - 1, x0 + 1), y1 = Math.min(f.ny - 1, y0 + 1);
  const tx = x - x0, ty = y - y0, p = raw ? f.rawProb : f.prob;
  const a = p[y0 * f.nx + x0] * (1 - tx) + p[y0 * f.nx + x1] * tx;
  const b = p[y1 * f.nx + x0] * (1 - tx) + p[y1 * f.nx + x1] * tx;
  return a * (1 - ty) + b * ty;
}
