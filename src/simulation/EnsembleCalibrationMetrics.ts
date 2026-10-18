/** Round185 calibration instrumentation. Pure statistics, NOT a physical forecast
 * calibration. A real validation requires >=30 independently integrated truths
 * for each of the eight scenarios; no synthetic fixture is used as evidence. */
export type CalibrationFix = {leadHour:number;lat:number;lon:number;vmax:number;pmin?:number};
export type CalibrationMember = {track:CalibrationFix[]};
export const CALIBRATION_LEADS = [72,120,168,240] as const;
export function calibrationQuantile(values:readonly number[], p:number):number|null {
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const rank=Math.max(0,Math.min(a.length-1,p*(a.length-1))),lo=Math.floor(rank),t=rank-lo;
  return a[lo]*(1-t)+a[Math.min(a.length-1,lo+1)]*t;
}
export function calibrationPeakIntensity(members:readonly CalibrationMember[]) {
  const peaks=members.map(m=>Math.max(...m.track.filter(f=>Number.isFinite(f.vmax)).map(f=>f.vmax),-Infinity)).filter(Number.isFinite);
  return {valid:peaks.length,total:members.length,p10:calibrationQuantile(peaks,.1),
    p50:calibrationQuantile(peaks,.5),p90:calibrationQuantile(peaks,.9),
    typhoonFraction:peaks.filter(x=>x>=32.7).length/Math.max(1,members.length),
    strongTyphoonFraction:peaks.filter(x=>x>=41.5).length/Math.max(1,members.length)};
}
export function calibrationRapidIntensification(members:readonly CalibrationMember[]):number|null {
  let count=0,valid=0;
  for(const member of members){
    const byHour=new Map(member.track.filter(f=>Number.isFinite(f.vmax)).map(f=>[Math.round(f.leadHour*1000),f.vmax]));
    let seen=false,ri=false;
    for(const fix of member.track){const next=byHour.get(Math.round((fix.leadHour+24)*1000));
      if(next===undefined||!Number.isFinite(fix.vmax))continue;
      seen=true;ri ||= (next-fix.vmax)>=15;
    }
    if(seen){valid++; if(ri)count++;}
  }
  return valid?count/valid:null;
}
/** Use a wrapped shortest longitude delta; 179°E → 179°W is ~2°, not 358°. */
const shortestLon=(a:number,b:number)=>((a-b+180)%360+360)%360-180;
const geoVector=(fix:CalibrationFix, start:CalibrationFix):[number,number]=>[
  shortestLon(fix.lon,start.lon)*111.12*Math.cos((fix.lat+start.lat)*Math.PI/360),
  (fix.lat-start.lat)*111.12];
const distance=(a:readonly number[],b:readonly number[])=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function cluster2d(points:readonly [number,number][], count:number) {
  const center=(indices:number[]):[number,number]=>[
    indices.reduce((a,i)=>a+points[i][0],0)/indices.length,
    indices.reduce((a,i)=>a+points[i][1],0)/indices.length];
  let seeds:[number,number][]=[points.reduce((a,p)=>a[0]+a[1]>p[0]+p[1]?a:p,points[0])];
  for(let k=1;k<count;k++) seeds.push(points.reduce((a,p)=>
    Math.min(...seeds.map(s=>distance(p,s)))>Math.min(...seeds.map(s=>distance(a,s)))?p:a,points[0]));
  let groups:number[][]=[];
  for(let step=0;step<28;step++){
    groups=seeds.map(()=>[]);
    points.forEach((p,i)=>{let nearest=0,best=Infinity;
      seeds.forEach((s,k)=>{const d=distance(p,s);if(d<best){best=d;nearest=k;}});
      groups[nearest].push(i);
    });
    if(groups.some(g=>!g.length))return {silhouette:0,centers:seeds,counts:groups.map(g=>g.length)};
    const next=groups.map(center);
    if(next.every((s,i)=>distance(s,seeds[i])<.000001)){seeds=next;break;}
    seeds=next;
  }
  if(count===1)return {silhouette:0,centers:seeds,counts:[points.length]};
  const labels=Array<number>(points.length).fill(0);
  groups.forEach((g,j)=>g.forEach(i=>labels[i]=j));
  // Average silhouette, ignoring singleton groups as zero, all distances in km.
  let sum=0;
  for(let i=0;i<points.length;i++){
    const own=groups[labels[i]];
    if(own.length<2)continue;
    const a=own.reduce((s,j)=>s+(i===j?0:distance(points[i],points[j])),0)/(own.length-1);
    const b=Math.min(...groups.filter((g,j)=>j!==labels[i]&&g.length).map(g=>
      g.reduce((s,j)=>s+distance(points[i],points[j]),0)/g.length));
    sum+=(b-a)/Math.max(.00001,a,b);
  }
  return {silhouette:sum/points.length,centers:seeds,counts:groups.map(g=>g.length)};
}
export function calibrationTrackSpread(members:readonly CalibrationMember[],hour:number) {
  const vectors:[number,number][]=[];
  for(const m of members){
    const start=m.track.find(f=>f.leadHour===0),end=m.track.find(f=>Math.abs(f.leadHour-hour)<1e-5);
    if(start&&end&&[start.lat,start.lon,end.lat,end.lon].every(Number.isFinite))vectors.push(geoVector(end,start));
  }
  if(vectors.length<5)return {valid:vectors.length,hour,crossP10P90:null,headingStdDeg:null,clusterCount:0,silhouette:0,centroidAngleGap:null};
  const mx=vectors.reduce((a,p)=>a+p[0],0)/vectors.length,my=vectors.reduce((a,p)=>a+p[1],0)/vectors.length;
  const axis=Math.atan2(my,mx),cross=vectors.map(p=>-Math.sin(axis)*p[0]+Math.cos(axis)*p[1]);
  const span=calibrationQuantile(cross,.9)!-calibrationQuantile(cross,.1)!;
  const hs=vectors.map(p=>Math.atan2(p[1],p[0]));
  const cx=hs.reduce((a,h)=>a+Math.cos(h),0)/hs.length,cy=hs.reduce((a,h)=>a+Math.sin(h),0)/hs.length;
  const r=Math.max(1e-9,Math.min(1,Math.hypot(cx,cy)));
  const two=cluster2d(vectors,2),three=cluster2d(vectors,3);
  const strongest=three.silhouette>two.silhouette+.065?three:two;
  const distinct=strongest.silhouette>=.34 && Math.min(...strongest.counts)>=Math.max(3,Math.round(vectors.length*.08));
  const angles=distinct?strongest.centers.map(p=>Math.atan2(p[1],p[0])):[];
  let maxGap=0;
  for(let i=0;i<angles.length;i++)for(let j=i+1;j<angles.length;j++){
    const delta=Math.atan2(Math.sin(angles[j]-angles[i]),Math.cos(angles[j]-angles[i]));
    maxGap=Math.max(maxGap,Math.abs(delta*180/Math.PI));
  }
  return {valid:vectors.length,hour,crossP10P90:span,headingStdDeg:Math.sqrt(-2*Math.log(r))*180/Math.PI,
    clusterCount:distinct?strongest.centers.length:1,silhouette:strongest.silhouette,centroidAngleGap:distinct?maxGap:0};
}
export function evaluateCalibrationEnsemble(members:readonly CalibrationMember[]) {
  return {peak:calibrationPeakIntensity(members),ri24h:calibrationRapidIntensification(members),
    tracks:CALIBRATION_LEADS.map(h=>calibrationTrackSpread(members,h))};
}
export function compareCalibrationEnsembles(forecast:readonly CalibrationMember[],truth:readonly CalibrationMember[]) {
  if(!truth.length)throw new Error('集系标定需要真实物理引擎积分样本，不得使用空真值。');
  const f=evaluateCalibrationEnsemble(forecast),t=evaluateCalibrationEnsemble(truth);
  return {forecast:f,truth:t,
    medianPeakRatio:f.peak.p50!=null&&t.peak.p50!=null&&t.peak.p50>0?f.peak.p50/t.peak.p50:null,
    strongTyphoonProbabilityGap:f.peak.strongTyphoonFraction-t.peak.strongTyphoonFraction};
}

/** True-model coverage is computed ONLY when an externally supplied independent
 * physical truth ensemble exists. Never substitute the forecast for its truth. */
export function calibrationPeakCoverage(forecast:readonly CalibrationMember[],truth:readonly CalibrationMember[]) {
 if(truth.length<30)throw new Error('必须提供至少30条独立物理引擎积分真值。');
 const fp=calibrationPeakIntensity(forecast);
 const lows=fp.p10,highs=fp.p90;
 if(lows==null||highs==null)throw new Error('预报集系没有有效风速记录。');
 const truthPeaks=truth.map(m=>m.track.reduce((v,p)=>Number.isFinite(p.vmax)?Math.max(v,p.vmax):v,-Infinity))
   .filter(Number.isFinite);
 if(truthPeaks.length<30)throw new Error('有效物理真值不足30条。');
 const within=truthPeaks.filter(p=>p>=lows&&p<=highs).length;
 return {coverage:within/truthPeaks.length,validTruth:truthPeaks.length,p10:lows,p90:highs,
   truthP10:calibrationQuantile(truthPeaks,.1),truthP50:calibrationQuantile(truthPeaks,.5),
   truthP90:calibrationQuantile(truthPeaks,.9)};
}
/** Talagrand peak rank histogram: truth and forecast must be independent. A
 * single pooled truth ensemble is not a substitute for paired verification cases.
 * Call once per matched independent scenario/case and aggregate returned ranks. */
export function calibrationPeakRank(forecast:readonly CalibrationMember[],truthPeak:number):number|null {
 if(!Number.isFinite(truthPeak))return null;
 const peaks=forecast.map(m=>m.track.reduce((v,p)=>Number.isFinite(p.vmax)?Math.max(v,p.vmax):v,-Infinity))
   .filter(Number.isFinite).sort((a,b)=>a-b);
 if(!peaks.length)return null;
 // Use midrank on a tie to avoid systematic low-rank bias.
 const below=peaks.filter(v=>v<truthPeak).length;
 const equal=peaks.filter(v=>v===truthPeak).length;
 return below+equal/2;
}
