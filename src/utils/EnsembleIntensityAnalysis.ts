/** Round185: seven-panel member-only ensemble diagnostics. All plotted numbers are derived
 * from recorded member fixes; missing 6-hour records are unknown, never zero. */
import type { AetherGuidanceMember, AetherGuidancePoint } from '../simulation/AetherEnsembleGuidance';
import { productCoastlineGeoJson } from '../simulation/NaturalEarthLoader';
import { computeStrikeField, sampleStrikeField } from './StrikeProbabilityField';
import type { EnsembleTrackEndMode } from './EnsembleTrackTermination';
import { terminateEnsembleTrack } from './EnsembleTrackTermination';

/** Simulation issue times use Beijing WALL CLOCK fields, regardless of the
 * browser's local timezone. Convert those fields to UTC explicitly; subtracting
 * eight hours from the Date epoch itself is incorrect outside UTC+8. */
export function formatEnsembleInitializedUtc(issueDate:Date):string {
  if(!Number.isFinite(issueDate.getTime()))return '—';
  const millis=Date.UTC(issueDate.getFullYear(),issueDate.getMonth(),issueDate.getDate(),
    issueDate.getHours(),issueDate.getMinutes(),issueDate.getSeconds())-8*3600_000;
  const d=new Date(millis);
  const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2,'0')} ${month} ${d.getUTCFullYear()}  ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} UTC`;
}
const W=1988,H=1871,KT=1/0.514444;
const NAVY='#14283f',MUTED='#60738b',GRID='#e1e6ee',HEAD='#528698';
const CATEGORIES=[34,64,83,96,113,137];
const BIN_COLORS=['#a9c6d5','#4bafa3','#e4cb5f','#ef9b4c','#e0605b','#b2507f','#6e4090'];
const ATTACK_COLORS=['#9fdcff','#3ea5e6','#1b7ac4','#25a55a','#8bc43f','#f2d22f','#f0a30c','#e8302b','#a51616','#d52fd8'];
const PLOTS={track:{x:141,y:466,w:353,h:353},attack:{x:577,y:466,w:354,h:353},hist:{x:1105,y:466,w:813,h:353},
 wind:{x:130,y:985,w:812,h:248},pressure:{x:1105,y:985,w:813,h:248},bins:{x:130,y:1397,w:812,h:249},exceed:{x:1105,y:1397,w:813,h:249}};
type Rect={x:number;y:number;w:number;h:number};
export const ensQuantile=(numbers:number[],p:number):number=>{
  if(!numbers.length)return NaN;
  const sorted=[...numbers].sort((a,b)=>a-b),u=(sorted.length-1)*p,j=Math.floor(u);
  return sorted[j]+(sorted[Math.min(j+1,sorted.length-1)]-sorted[j])*(u-j);
};
export const ensWindBin=(kt:number):number=>CATEGORIES.findIndex(v=>kt<v)<0?6:CATEGORIES.findIndex(v=>kt<v);
export const ensWindColor=(kt:number):string=>BIN_COLORS[ensWindBin(kt)];
export const ensFormatMember=(n:number,grouped=false)=>grouped?n.toLocaleString('en-US'):String(n);
export const ensMaxNLocatorStep=(range:number,target=8):number=>{
  const raw=Math.max(1e-10,range/target),scale=10**Math.floor(Math.log10(raw));
  return [1,2,2.5,5,10].map(s=>s*scale).find(s=>s>=raw)??10*scale;
};
export type EnsembleAnalysisOptions={canvas:HTMLCanvasElement;width:number;members:AetherGuidanceMember[];horizonHours:number;
  issueDate:Date;title:string;agencyCode?:string;footerRight?:string;unit?:'kt'|'m/s';radiusKm?:number;
  endMode?:EnsembleTrackEndMode;signal?:AbortSignal;onProgress?:(n:number)=>void};
export interface EnsembleAnalysisSeries {hours:number[]; valid:number[]; wind:Array<number[]>;pressure:Array<number[]>;peaks:number[];minimums:number[];allMembers:number;validTracks:number;lastRecordedHour:number;}
export function buildEnsembleAnalysisSeries(members:readonly AetherGuidanceMember[],horizonHours:number,endMode:EnsembleTrackEndMode='operational'):EnsembleAnalysisSeries {
  const hours=Array.from({length:Math.floor(horizonHours/6)+1},(_,i)=>i*6);
  const wind=hours.map(()=>[] as number[]),pressure=hours.map(()=>[] as number[]),valid=hours.map(()=>0);
  const peaks:number[]=[],minimums:number[]=[];
  let validTracks=0,lastRecordedHour=0;
  for(const member of members){
    const track=terminateEnsembleTrack(member.track,horizonHours,endMode,member);
    const seen=new Set<number>(),ownWind:number[]=[],ownP:number[]=[];
    for(const p of track){
      const hour=Number.isFinite(p.leadHour)?p.leadHour:p.simHour,idx=Math.round(hour/6);
      if(!Number.isFinite(hour)||!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;
      lastRecordedHour=Math.max(lastRecordedHour,hour);
      // Peak and minimum are based on every AVAILABLE native node,
      // whereas time series use ONLY native records exactly at 6h grid points.
      if(Number.isFinite(p.vmax)&&p.vmax>=0){const v=p.vmax*KT;ownWind.push(v);}
      if(Number.isFinite(p.pmin)&&p.pmin>0)ownP.push(p.pmin);
      if(Math.abs(hour-idx*6)>1e-4||idx<0||idx>=hours.length||seen.has(idx))continue;
      seen.add(idx);
      if(Number.isFinite(p.vmax)&&p.vmax>=0)wind[idx].push(p.vmax*KT);
      if(Number.isFinite(p.pmin)&&p.pmin>0)pressure[idx].push(p.pmin);
    }
    if(track.some(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)))validTracks++;
    if(ownWind.length)peaks.push(Math.max(...ownWind));
    if(ownP.length)minimums.push(Math.min(...ownP));
  }
  for(let i=0;i<valid.length;i++) valid[i]=wind[i].length;
  return {hours,wind,pressure,valid,peaks,minimums,allMembers:members.length,validTracks,lastRecordedHour};
}
const delay=()=>new Promise<void>(r=>setTimeout(r,0));
const check=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('绘制已取消','AbortError');};
const TXT='"DejaVu Sans","Helvetica Neue",Arial,sans-serif';
async function ensureFonts(){if(typeof FontFace==='undefined'||typeof document==='undefined')return;
  try{const faces=[['400','/fonts/DejaVuSans.ttf'],['700','/fonts/DejaVuSans-Bold.ttf']] as const;
    await Promise.all(faces.map(async([weight,url])=>{const face=new FontFace('DejaVu Sans',`url(${url})`,{weight});
      document.fonts.add(await face.load());}));}catch{/* offline/font-disabled: system fallback */}}
function fill(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,size:number,color=NAVY,bold=false,align:CanvasTextAlign='left',max=1600){
  ctx.fillStyle=color;ctx.font=`${bold?700:400} ${size}px ${TXT}`;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(text,x,y,max);
}
function panelTitle(ctx:CanvasRenderingContext2D,x:number,y:number,index:string,name:string,sub:string,subRight?:string,right?:number){
  fill(ctx,`${index}  /  ${name}`,x,y,25,NAVY,true);
  fill(ctx,sub,x,y+34,16,MUTED);
  if(subRight&&right)fill(ctx,subRight,right,y+34,16,MUTED,false,'right');
}
function axes(ctx:CanvasRenderingContext2D,r:Rect,ymin:number,ymax:number,ticks:number[],fmt:(v:number)=>string){
  ctx.fillStyle='#ffffff';ctx.fillRect(r.x,r.y,r.w,r.h);
  ctx.lineWidth=1;ctx.strokeStyle=GRID;
  for(const t of ticks){const y=r.y+r.h-(t-ymin)/(ymax-ymin)*r.h;if(y<r.y-1||y>r.y+r.h+1)continue;
    ctx.beginPath();ctx.moveTo(r.x,y);ctx.lineTo(r.x+r.w,y);ctx.stroke();fill(ctx,fmt(t),r.x-11,y+5,13,MUTED,false,'right');}
}
function timeLabels(ctx:CanvasRenderingContext2D,r:Rect,horizon:number,baseY:number){
  for(let t=0;t<=horizon;t+=horizon>200?48:24)fill(ctx,String(t),r.x+t/horizon*r.w,baseY,13,MUTED,false,'center');
}
function line(ctx:CanvasRenderingContext2D,points:Array<[number,number]>,color:string,width=2,dash:number[]=[]){
  if(points.length<2)return;ctx.beginPath();ctx.setLineDash(dash);
  points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();ctx.setLineDash([]);
}
function quantiles(values:number[]):number[] {return [0.1,0.25,0.5,0.75,0.9].map(p=>ensQuantile(values,p));}
function bandPlot(ctx:CanvasRenderingContext2D,r:Rect,series:number[][],hours:number[],horizon:number,lo:number,hi:number,colors:[string,string,string],threshold=50){
  axes(ctx,r,lo,hi,Array.from({length:6},(_,i)=>lo+(hi-lo)*i/5),n=>n.toFixed(0));
  const points=series.map((s,i)=>s.length>=threshold?{t:hours[i],q:quantiles(s)}:null);
  const x=(t:number)=>r.x+t/horizon*r.w, y=(v:number)=>r.y+r.h-(v-lo)/(hi-lo)*r.h;
  for(const [a,b,c] of [[0,4,colors[0]],[1,3,colors[1]]] as const){
    ctx.fillStyle=c;let start=0;
    while(start<points.length){while(start<points.length&&!points[start])start++;let end=start;
      while(end<points.length&&points[end])end++;
      if(end-start>=2){ctx.beginPath();for(let i=start;i<end;i++){const p=points[i]!;i===start?ctx.moveTo(x(p.t),y(p.q[a])):ctx.lineTo(x(p.t),y(p.q[a]));}
        for(let i=end-1;i>=start;i--){const p=points[i]!;ctx.lineTo(x(p.t),y(p.q[b]));}ctx.closePath();ctx.fill();}
      start=end+1;}
  }
  // Break the median line at unavailable records; never interpolate unknown intervals.
  let run:Array<[number,number]>=[];
  for(const p of points){if(p){run.push([x(p.t),y(p.q[2])]);}else {line(ctx,run,colors[2],2.5);run=[];}}
  line(ctx,run,colors[2],2.5);
  // Reference markers sit at every available native six-hour fix; a gap
  // remains an actual gap and must not be visually interpolated.
  ctx.fillStyle=colors[2];
  for(const p of points)if(p){ctx.beginPath();ctx.arc(x(p.t),y(p.q[2]),2,0,2*Math.PI);ctx.fill();}
  timeLabels(ctx,r,horizon,r.y+r.h+27);
}
function coast(ctx:CanvasRenderingContext2D,r:Rect,b:{lo:number;hi:number;la:number;lb:number}){
  const px=(lon:number)=>r.x+(lon-b.lo)/(b.hi-b.lo)*r.w;
  const py=(lat:number)=>r.y+r.h-(lat-b.la)/(b.lb-b.la)*r.h;
  ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();ctx.strokeStyle='#768798';ctx.lineWidth=.9;
  let segments=0;
  for(const feature of productCoastlineGeoJson?.features||[]){
    const g=feature.geometry;if(!g)continue;
    const rings=g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat(1):[];
    for(const ring of rings){if(++segments>12000)break;
      ctx.beginPath();let previous:number[]|undefined,started=false;
      for(const v of ring){if(!Number.isFinite(v[0])||!Number.isFinite(v[1])){started=false;continue;}
        const lon=v[0]+360*Math.round(((b.lo+b.hi)/2-v[0])/360),lat=v[1];
        if(previous&&(Math.abs(lon-previous[0])>10||Math.abs(lat-previous[1])>10))started=false;
        if(!started)ctx.moveTo(px(lon),py(lat));else ctx.lineTo(px(lon),py(lat));started=true;previous=[lon,lat];
      }ctx.stroke();
    }
  }
  ctx.restore();
}
/** Geoplot graticule and sparse labels, shared by both square map panels. */
function drawGeoGraticule(ctx:CanvasRenderingContext2D,r:Rect,b:{lo:number;hi:number;la:number;lb:number}){
  const x=(lon:number)=>r.x+(lon-b.lo)/(b.hi-b.lo)*r.w;
  const y=(lat:number)=>r.y+r.h-(lat-b.la)/(b.lb-b.la)*r.h;
  ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();
  ctx.strokeStyle='rgba(191,207,220,.22)';ctx.lineWidth=1;
  for(let lon=Math.ceil(b.lo/20)*20;lon<=b.hi;lon+=20){ctx.beginPath();ctx.moveTo(x(lon),r.y);ctx.lineTo(x(lon),r.y+r.h);ctx.stroke();}
  for(let lat=Math.ceil(b.la/20)*20;lat<=b.lb;lat+=20){ctx.beginPath();ctx.moveTo(r.x,y(lat));ctx.lineTo(r.x+r.w,y(lat));ctx.stroke();}
  ctx.restore();ctx.strokeStyle='#b9c7d6';ctx.lineWidth=1.6;ctx.strokeRect(r.x,r.y,r.w,r.h);
  for(let lon=Math.ceil(b.lo/20)*20;lon<=b.hi;lon+=20){
    const label=(Math.abs(lon)%360).toFixed(0)+'°'+(lon>=0?'E':'W');
    fill(ctx,label,x(lon),r.y+r.h+18,12,MUTED,false,'center');
  }
  for(let lat=Math.ceil(b.la/20)*20;lat<=b.lb;lat+=20){
    fill(ctx,lat===0?'0°':`${Math.abs(lat)}°${lat>=0?'N':'S'}`,r.x-9,y(lat)+4,12,MUTED,false,'right');
  }
}
function drawYAxisTitle(ctx:CanvasRenderingContext2D,label:string,x:number,y:number,size:number,color:string){
  ctx.save();ctx.translate(x,y);ctx.rotate(-Math.PI/2);
  fill(ctx,label,0,0,size,color,false,'center');ctx.restore();
}
function drawQuantileLegend(ctx:CanvasRenderingContext2D,r:Rect,colors:[string,string,string]){
  const entries=[['P10–P90',colors[0]],['P25–P75',colors[1]],['Median',colors[2]]] as const;
  entries.forEach(([label,color],i)=>{
    const xx=r.x+r.w-332+i*107,yy=r.y+18;
    ctx.fillStyle=color;ctx.fillRect(xx,yy-10,24,10);
    fill(ctx,label,xx+28,yy,11,NAVY);
  });
}
function projectionBounds(members:AetherGuidanceMember[],horizon:number,mode:EnsembleTrackEndMode){
  const lats:number[]=[],lons:number[]=[],ref=members[0]?.track[0]?.lon??135;
  for(const m of members)for(const p of terminateEnsembleTrack(m.track,horizon,mode,m)){if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;
    lats.push(p.lat);lons.push(p.lon+360*Math.round((ref-p.lon)/360));}
  const q=(v:number[],p:number,f:number)=>v.length?ensQuantile(v,p):f;
  const la=q(lats,.01,0),lb=q(lats,.99,40),lo=q(lons,.01,120),hi=q(lons,.99,160);
  const span=Math.max(10,lb-la,hi-lo)*1.25,lc=(lo+hi)/2,tc=(la+lb)/2;
  return {lo:lc-span/2,hi:lc+span/2,la:tc-span/2,lb:tc+span/2};
}
export async function drawEnsembleIntensityAnalysis(o:EnsembleAnalysisOptions):Promise<void>{
  await ensureFonts();check(o.signal);const canvas=o.canvas,width=Math.max(320,Math.round(o.width));
  canvas.width=width;canvas.height=Math.round(width*H/W);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('无法创建综合集系分析画布');
  ctx.setTransform(width/W,0,0,width/W,0,0);ctx.fillStyle='#f3f6fa';ctx.fillRect(0,0,W,H);
  const mode=o.endMode||'operational',N=o.members.length,horizon=o.horizonHours||360;
  const s=buildEnsembleAnalysisSeries(o.members,horizon,mode),valid=s.validTracks;
  ctx.fillStyle=HEAD;ctx.fillRect(0,0,W,346);
  fill(ctx,`${o.agencyCode||'WMC'} ${N}-Member / ENSEMBLE INTENSITY ANALYSIS`,130,69,21,'#eaf1f5',true);
  fill(ctx,(o.title||'Ensemble').toUpperCase(),130,151,58,'#fff',true);
  const date=formatEnsembleInitializedUtc(o.issueDate);
  fill(ctx,`INITIALIZED  ${date}`,1918,115,22,'#fff',false,'right');
  fill(ctx,`Member-weighted forecast diagnostics  •  Wind in ${o.unit||'kt'}  /  Pressure in hPa`,1918,159,17,'#ebf3f7',false,'right');
  const stats:[string,string,string][]= [
    ['VALID / ALL MEMBERS',`${valid}/${N}  (${N?(100*valid/N).toFixed(1):'—'}%)`,'at least one recorded track point'],
    ['LAST TRACK RECORD',`+${s.lastRecordedHour} h`,'last available track point'],
    ['MEDIAN RECORDED PEAK / WIND',s.peaks.length?`${(ensQuantile(s.peaks,.5)*(o.unit==='m/s'?.514444:1)).toFixed(1)} ${o.unit||'kt'}`:'—',`from ${ensFormatMember(s.peaks.length,true)} members with valid wind`],
    ['MEDIAN RECORDED MINIMUM / PRESSURE',s.minimums.length?`${ensQuantile(s.minimums,.5).toFixed(1)} hPa`:'—',`from ${ensFormatMember(s.minimums.length,true)} members with valid pressure`]
  ];
  for(let i=0;i<4;i++){const x=130+i*467;fill(ctx,stats[i][0],x,221,17,'#ebf4f6',true);fill(ctx,stats[i][1],x,267,36,'#fff',true);fill(ctx,stats[i][2],x,300,15,'#e7f0f3');}
  panelTitle(ctx,141,413,'01','Ensemble tracks','Ensemble member tracks and mean track');
  panelTitle(ctx,577,413,'02','Attack probability','1° track buffer · 0.1° × 0.1° grid');
  panelTitle(ctx,1105,413,'03','Member peak-wind distribution','Maximum within each member’s available records; Bar labels: member counts');
  panelTitle(ctx,130,931,'04','Wind speed outlook',`Available-member quantiles; hidden when n < 50 (last valid: +${s.hours.filter((h,i)=>s.wind[i].length>=50).at(-1)??'—'}h)`,s.peaks.length?`Maximum: ${(Math.max(...s.peaks)*(o.unit==='m/s'?.514444:1)).toFixed(1)} ${o.unit||'kt'}`:'Maximum: —',942);
  panelTitle(ctx,1105,931,'05','Central pressure outlook',`Available-member quantiles; hidden when n < 50 (last valid: +${s.hours.filter((h,i)=>s.pressure[i].length>=50).at(-1)??'—'}h)`,s.minimums.length?`Minimum: ${Math.min(...s.minimums).toFixed(1)} hPa`:'Minimum: —',1918);
  panelTitle(ctx,130,1344,'06','Intensity-bin composition',`Share of all ${ensFormatMember(N,true)} members; bins in kt; grey = unknown`);
  panelTitle(ctx,1105,1344,'07','Wind threshold exceedance',`Recorded exceedances / ${ensFormatMember(N,true)}; unknown members are unresolved`);
  const bound=projectionBounds(o.members,horizon,mode),pr=PLOTS.track,pa=PLOTS.attack;
  ctx.fillStyle='#fff';ctx.fillRect(pr.x,pr.y,pr.w,pr.h);
  const px=(lon:number,r:Rect)=>r.x+(lon-bound.lo)/(bound.hi-bound.lo)*r.w;
  const py=(lat:number,r:Rect)=>r.y+r.h-(lat-bound.la)/(bound.lb-bound.la)*r.h;
  ctx.save();ctx.beginPath();ctx.rect(pr.x,pr.y,pr.w,pr.h);ctx.clip();
  let processed=0;
  for(const m of o.members){const t=terminateEnsembleTrack(m.track,horizon,mode,m);
    ctx.beginPath();let begun=false;
    for(const p of t){if(!Number.isFinite(p.lon)||!Number.isFinite(p.lat))continue;
      const lon=p.lon+360*Math.round(((bound.lo+bound.hi)/2-p.lon)/360);
      if(!begun){ctx.moveTo(px(lon,pr),py(p.lat,pr));begun=true;}else ctx.lineTo(px(lon,pr),py(p.lat,pr));}
    ctx.lineWidth=1;ctx.strokeStyle=N>300?'rgba(105,172,226,.11)':'rgba(105,172,226,.2)';ctx.stroke();
    if(++processed%200===0){check(o.signal);await delay();}
  }
  ctx.restore();coast(ctx,pr,bound);
  drawGeoGraticule(ctx,pr,bound);
  // Calculate pointwise mean only at 24h nodes with >=50 recorded members.
  const means:Array<[number,number,number]>=[];
  for(let t=0;t<=horizon;t+=24){const pts=o.members.map(m=>terminateEnsembleTrack(m.track,horizon,mode,m).find(p=>Math.abs(p.leadHour-t)<1e-5)).filter(Boolean) as AetherGuidancePoint[];
    if(pts.length<50)continue;const lon=pts.reduce((a,p)=>a+p.lon+360*Math.round(((bound.lo+bound.hi)/2-p.lon)/360),0)/pts.length;
    means.push([px(lon,pr),py(pts.reduce((a,p)=>a+p.lat,0)/pts.length,pr),t]);}
  line(ctx,means.map(p=>[p[0],p[1]]),'#12171c',2.2);
  for(const [x,y,t] of means){ctx.beginPath();ctx.arc(x,y,3.6,0,Math.PI*2);ctx.fillStyle='#111';ctx.fill();fill(ctx,`+${t}`,x+8,y-8,12,'#111');}
  fill(ctx,'Mean track calculated only when valid members >= 50. Labels mark',141,861,12,MUTED);
  fill(ctx,'forecast lead times at 24-hour intervals.',141,876,12,MUTED);
  o.onProgress?.(30);await delay();check(o.signal);
  const field=await computeStrikeField(o.members,{bounds:{minLon:bound.lo,maxLon:bound.hi,minLat:bound.la,maxLat:bound.lb},
    cellDeg:.1,radiusKm:o.radiusKm??111.19,horizonHours:horizon,smoothPasses:0,endMode:mode,signal:o.signal,
    onProgress:(done,total)=>o.onProgress?.(30+30*done/Math.max(total,1))});
  const raster=document.createElement('canvas');raster.width=field.nx;raster.height=field.ny;
  const rc=raster.getContext('2d');if(rc){const im=rc.createImageData(field.nx,field.ny);
    for(let y=0;y<field.ny;y++)for(let x=0;x<field.nx;x++){
      const p=field.rawProb[(field.ny-1-y)*field.nx+x],i=(y*field.nx+x)*4;
      if(p<1){im.data[i+3]=0;continue;}
      const c=ATTACK_COLORS[Math.min(9,Math.floor((p-1)/10))].replace('#','');
      im.data[i]=parseInt(c.slice(0,2),16);im.data[i+1]=parseInt(c.slice(2,4),16);
      im.data[i+2]=parseInt(c.slice(4,6),16);im.data[i+3]=255;
    }rc.putImageData(im,0,0);ctx.fillStyle='#fff';ctx.fillRect(pa.x,pa.y,pa.w,pa.h);ctx.drawImage(raster,pa.x,pa.y,pa.w,pa.h);}
  coast(ctx,pa,bound);
  drawGeoGraticule(ctx,pa,bound);
  raster.width=0;raster.height=0;
  for(let i=0;i<9;i++){ctx.fillStyle=ATTACK_COLORS[i];ctx.fillRect(594+i*321/9,857,321/9,12);}
  ctx.strokeStyle='#657480';ctx.strokeRect(594,857,321,12);
  for(const v of [1,20,40,60,80,90])fill(ctx,String(v),594+(v-1)/89*321,883,11,MUTED,false,'center');
  fill(ctx,'Attack probability (%)',754,900,15,MUTED,false,'center');
  check(o.signal);o.onProgress?.(65);await delay();
  // Panel 03: 5 kt peak bins, weights based on valid wind only. Labels
  // follow the selected unit, but bin membership stays in physical knots.
  const windUnit=o.unit||'kt',windFactor=o.unit==='m/s'?.514444:1;
  const hist=PLOTS.hist,counts=new Map<number,number>();for(const v of s.peaks){const k=Math.floor(v/5)*5;counts.set(k,(counts.get(k)||0)+1);}
  const peak=Math.max(1,...counts.values())/Math.max(1,s.peaks.length)*100;
  const histCap=peak*1.3, histStep=ensMaxNLocatorStep(histCap,8);
  axes(ctx,hist,0,histCap,Array.from({length:Math.ceil(histCap/histStep)+1},(_,i)=>i*histStep),n=>`${n.toFixed(1)}%`);
  const maxBin=Math.max(160,...counts.keys())+8, minX=-8;
  const xp=(v:number)=>hist.x+(v-minX)/(maxBin-minX)*hist.w;
  for(const [k,n] of [...counts.entries()].sort((a,b)=>a[0]-b[0])){
    const x=xp(k),ww=xp(k+5)-x-1,hh=n/Math.max(1,s.peaks.length)*100/histCap*hist.h;
    ctx.fillStyle=ensWindColor(k+2.5);ctx.fillRect(x,hist.y+hist.h-hh,Math.max(1,ww),hh);
    fill(ctx,String(n),x+ww/2,hist.y+hist.h-hh-6,12,MUTED,true,'center');
  }
  for(let q=0;q<3;q++){const percentile=[.1,.5,.9][q],v=ensQuantile(s.peaks,percentile);if(!Number.isFinite(v))continue;
    const x=xp(v);ctx.beginPath();ctx.moveTo(x,hist.y);ctx.lineTo(x,hist.y+hist.h);ctx.setLineDash(q===0?[1,3]:q===1?[6,4]:[7,3,1,3]);ctx.strokeStyle='#6b6b7b';ctx.lineWidth=1.8;ctx.stroke();ctx.setLineDash([]);
    fill(ctx,`P${[10,50,90][q]} ${(v*windFactor).toFixed(1)} ${windUnit}`,hist.x+hist.w-12,hist.y+20+q*20,14,'#333',true,'right');}
  fill(ctx,`5 kt bins`,hist.x+hist.w-12,hist.y+83,14,MUTED,false,'right');
  for(let kt=0;kt<=maxBin;kt+=25)fill(ctx,String(Number((kt*windFactor).toFixed(o.unit==='m/s'?1:0))),xp(kt),835,13,MUTED,false,'center');
  drawYAxisTitle(ctx,'Share of members with valid wind',1041,642,16,MUTED);
  fill(ctx,`Recorded member peak wind (${windUnit})`,hist.x+hist.w/2,856,17,MUTED,false,'center');
  // Panel 04/05: quantile envelopes, no interpolation of missing data.
  const isMps=o.unit==='m/s',fac=isMps?.514444:1;
  const topWind=Math.max(isMps?10:20,...s.peaks.map(v=>v*fac),0);
  bandPlot(ctx,PLOTS.wind,s.wind.map(col=>col.map(v=>v*fac)),s.hours,horizon,0,topWind,['#dde5ef','#bccce0','#2b6aa3']);
  const ps=s.pressure.flat(),loP=ps.length?Math.floor(ensQuantile(ps,.1)-10):900,hiP=ps.length?Math.ceil(ensQuantile(ps,.9)+30):1040;
  bandPlot(ctx,PLOTS.pressure,s.pressure,s.hours,horizon,loP,Math.max(loP+10,hiP),['#dfeeea','#b9ddd6','#1f8a7e']);
  drawYAxisTitle(ctx,isMps?'Maximum sustained wind (m/s)':'Maximum sustained wind (kt)',77,1111,16,MUTED);
  drawYAxisTitle(ctx,'Minimum sea-level pressure (hPa)',1046,1111,16,MUTED);
  fill(ctx,'Forecast lead time (h)',536,1271,16,MUTED,false,'center');
  fill(ctx,'Forecast lead time (h)',1511,1271,16,MUTED,false,'center');
  check(o.signal);o.onProgress?.(80);await delay();
  drawQuantileLegend(ctx,PLOTS.wind,['#dde5ef','#bccce0','#2b6aa3']);
  drawQuantileLegend(ctx,PLOTS.pressure,['#dfeeea','#b9ddd6','#1f8a7e']);
  // 06: an unknown member contributes ONLY to the uncovered grey part of each column.
  const bins=PLOTS.bins,exc=PLOTS.exceed;
  axes(ctx,bins,0,100,[0,20,40,60,80,100],v=>`${v}%`);
  // Unknown records remain uncovered neutral grey; they are not counted as calm winds.
  ctx.fillStyle='#e2e7ee';ctx.fillRect(bins.x,bins.y,bins.w,bins.h);
  axes(ctx,exc,0,108,[0,20,40,60,80,100],v=>`${v}%`);
  for(let i=0;i<s.hours.length;i++){
    const values=s.wind[i],barx=bins.x+i/(s.hours.length-1)*bins.w,bw=bins.w/(s.hours.length-1)+1;
    let y=bins.y+bins.h;
    for(let k=0;k<7;k++){const fraction=values.filter(v=>ensWindBin(v)===k).length/Math.max(1,N),height=bins.h*fraction;
      ctx.fillStyle=BIN_COLORS[k];ctx.fillRect(barx,y-height,bw,height);y-=height;}
  }
  const labels=o.unit==='m/s'?['<17.5','17.5–<32.9','32.9–<42.7','42.7–<49.4','49.4–<58.1','58.1–<70.5','≥70.5']:
    ['<34','34–<64','64–<83','83–<96','96–<113','113–<137','≥137'];
  ctx.fillStyle='rgba(255,255,255,.8)';ctx.fillRect(bins.x+450,bins.y+1,360,48);
  labels.forEach((label,i)=>{const x=bins.x+462+(i%4)*88,y=bins.y+19+Math.floor(i/4)*22;
    ctx.fillStyle=BIN_COLORS[i];ctx.fillRect(x,y-11,18,7);fill(ctx,label,x+21,y,11,'#222');});
  const limits=[34,64,96,113,137],colors=['#4bafa3','#e4cb5f','#e0605b','#b2507f','#6e4090'];
  limits.forEach((limit,k)=>{const points=s.hours.map((h,i)=>[exc.x+h/horizon*exc.w,exc.y+exc.h-(s.wind[i].filter(v=>v>=limit).length/Math.max(1,N)*100)/108*exc.h] as [number,number]);
    line(ctx,points,colors[k],2.5);});
  line(ctx,s.hours.map((h,i)=>[exc.x+h/horizon*exc.w,exc.y+exc.h-(s.wind[i].length/Math.max(1,N)*100)/108*exc.h]),'#6b7b8c',1.8,[5,4]);
  [...limits,0].forEach((v,i)=>{const x=exc.x+exc.w-355+(i%3)*117,y=exc.y+19+Math.floor(i/3)*22;
    ctx.strokeStyle=i===5?'#6b7b8c':colors[i];ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y-6);ctx.lineTo(x+25,y-6);ctx.stroke();
    fill(ctx,i===5?'Valid wind':`≥${o.unit==='m/s'?(v*.514444).toFixed(1):v} ${windUnit}`,x+28,y,12,'#253245');});
  timeLabels(ctx,bins,horizon,1665);timeLabels(ctx,exc,horizon,1665);
  fill(ctx,'Forecast lead time (h)',536,1689,15,MUTED,false,'center');fill(ctx,'Forecast lead time (h)',1511,1689,15,MUTED,false,'center');
  fill(ctx,'METHOD  /  Equal member weights • Intensity values are not interpolated • Quantiles use available members (n ≥ 50), not a confidence interval.',129,1763,16,MUTED);
  fill(ctx,'Unknown records are not assigned an intensity. Peak distributions use available portions of tracks; threshold curves are recorded ensemble fractions.',129,1797,16,MUTED);
  fill(ctx,`SOURCE  /  ${o.agencyCode||'WMC'}/AETHER simulated ensemble (${N} members)`,129,1831,16,MUTED);
  if(o.footerRight)fill(ctx,o.footerRight,1918,1831,16,MUTED,false,'right');
  o.onProgress?.(100);check(o.signal);
}
