import type { AetherGuidanceMember, AetherGuidancePoint } from "../simulation/AetherEnsembleGuidance";
import { productCoastlineGeoJson, productCountriesGeoJson, productLandGeoJson, isProductCoastlineSeamSegment } from "../simulation/NaturalEarthLoader";
import { getTyphoonOfficialNumber } from "./TyphoonDisplayName";
import type { EnsembleTrackEndMode } from "./EnsembleTrackTermination";
import type { Typhoon } from "../types";
import { STRIKE_SITES } from "./StrikeProbabilitySites";
import { buildStrikeSiteIndex, computeSiteProbabilityIndexed, computeSiteProbability, computeStrikeField, computeStrikeFieldStripes, sampleStrikeField, strikeTrackWithinHorizon, STRIKE_MAX_CELLS, strikeIsMobile, STRIKE_STREAM_MOBILE_CELLS, STRIKE_STREAM_DESKTOP_CELLS, unwrapStrikeLon, type StrikeBounds, type StrikeField, type StrikeSiteIndex } from "./StrikeProbabilityField";

export interface StrikeProbabilityOptions {
  horizonHours: number; radiusKm: number; cellDeg: number; smoothPasses: number;
  coastMinPct: number; coastWidth: number;
  frameMode: "auto" | "wnp" | "custom";
  customBounds?: StrikeBounds;
  showMembers: boolean; meanDotHours: number;
  pillCount: number; pillMinPct: number;
  modelLabel: string; watermark: string;
  provincesGeoJson?: any;
  endMode?: EnsembleTrackEndMode;
}
export interface StrikeRenderArgs {
  canvas: HTMLCanvasElement; width: number; height: number;
  activeState: {lat:number; lon:number}; currentHour: number; startDate: Date;
  typhoon: Typhoon; members: AetherGuidanceMember[]; centers: AetherGuidanceMember[];
  strike: StrikeProbabilityOptions; isMini?: boolean;
  signal?: AbortSignal; onProgress?: (progress:number)=>void;
  cache?: Map<string, StrikeField>;
}
/**
 * Round184: calibrated from the user-supplied 51119.png's continuous right-hand
 * 0–100% colour bar. Percentages are reference-colour stops, not hand-drawn
 * probability bands; only the member-hit field controls where colours appear.
 */
export const STRIKE_COLOR_STOPS: ReadonlyArray<readonly [number,string]> = [
  [0,"#fafaff"], [4,"#eaf1ff"], [10,"#deecff"], [20,"#86c2ff"],
  [25,"#62aeff"], [30,"#4e90ff"], [35,"#4479ff"], [40,"#91a9b5"],
  [42,"#b8c687"], [45,"#f4f04b"], [50,"#ffde3e"],
  [60,"#ffa23a"], [70,"#dc6238"], [80,"#c13e57"],
  [90,"#e367df"], [95,"#f17df0"], [100,"#ff98fc"]
];
const COAST_COLORS = ["#19c3ff","#f3ee1d","#ff3b0f","#c800ff"] as const;
const clamp = (n:number,a:number,b:number) => Math.max(a,Math.min(b,n));
const abortIfNeeded = (signal?:AbortSignal) => { if(signal?.aborted) throw new DOMException("cancelled","AbortError"); };
const rgb = (hex:string) => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
export function strikeColor(p:number): [number,number,number,number] {
  if(p < 1) return [255,255,255,0];
  for(let i=1;i<STRIKE_COLOR_STOPS.length;i++) {
    const [hi,hc]=STRIKE_COLOR_STOPS[i], [lo,lc]=STRIKE_COLOR_STOPS[i-1];
    if(p>hi) continue;
    const t=clamp((p-lo)/(hi-lo),0,1), a=rgb(lc), b=rgb(hc);
    return [Math.round(a[0]+(b[0]-a[0])*t),Math.round(a[1]+(b[1]-a[1])*t),Math.round(a[2]+(b[2]-a[2])*t),Math.round(255 * clamp(p/4,0,1))];
  }
  return [...rgb("#ff7df0"),255] as [number,number,number,number];
}
const mapRect=(w:number,h:number) => ({x:w*97/2030,y:w*101/2030,w:w*(2008-97)/2030,h:w*(1763-101)/2030});
function fitAspect(b:StrikeBounds, ratio:number):StrikeBounds {
  let {minLat,maxLat,minLon,maxLon}=b;
  const lonSpan=maxLon-minLon, latSpan=maxLat-minLat;
  if (lonSpan/latSpan<ratio) {const d=(latSpan*ratio-lonSpan)/2;minLon-=d;maxLon+=d;}
  else {const d=(lonSpan/ratio-latSpan)/2;minLat-=d;maxLat+=d;}
  return {minLat,maxLat,minLon,maxLon};
}
export function strikeMapBounds(members:AetherGuidanceMember[], args:StrikeRenderArgs):StrikeBounds {
  const {strike}=args, box=mapRect(args.width,args.height);
  // The exact WNP reference footprint measured in 51119.png. Its longitude / latitude
  // span already matches the map's plate-carree aspect (not cosine-corrected).
  if(strike.frameMode==="wnp") return fitAspect({minLon:107.6,maxLon:177.3,minLat:-2.65,maxLat:57.9},box.w/box.h);
  if(strike.frameMode==="custom" && strike.customBounds && strike.customBounds.maxLon>strike.customBounds.minLon && strike.customBounds.maxLat>strike.customBounds.minLat)
    return fitAspect(strike.customBounds,box.w/box.h);
  const initialLon=args.activeState.lon;
  const lons:number[]=[initialLon], lats:number[]=[args.activeState.lat];
  for (const member of members) for (const p of strikeTrackWithinHorizon(member.track,strike.horizonHours,strike.endMode||"operational",member)) {
    if (Number.isFinite(p.lat)&&Number.isFinite(p.lon)) {lons.push(unwrapStrikeLon(p.lon,initialLon));lats.push(p.lat);}
  }
  // A percentile view is not thrown far away by a few outlying ensemble members.
  const limits=(arr:number[]) => {arr.sort((a,b)=>a-b);return [arr[Math.floor((arr.length-1)*.01)],arr[Math.ceil((arr.length-1)*.99)]];};
  const [lo0,lo1]=limits(lons), [la0,la1]=limits(lats);
  const minLon=Math.floor((Math.min(initialLon,lo0)-5)/5)*5, maxLon=Math.ceil((Math.max(initialLon,lo1)+5)/5)*5;
  const minLat=Math.floor((Math.min(args.activeState.lat,la0)-5)/5)*5, maxLat=Math.ceil((Math.max(args.activeState.lat,la1)+5)/5)*5;
  const centerLon=(minLon+maxLon)/2, centerLat=(minLat+maxLat)/2;
  return fitAspect({minLon:centerLon-Math.max(40,maxLon-minLon)/2,maxLon:centerLon+Math.max(40,maxLon-minLon)/2,
    minLat: centerLat-Math.max(35,maxLat-minLat)/2,maxLat:centerLat+Math.max(35,maxLat-minLat)/2},box.w/box.h);
}
function forGeoRings(data:any, visit:(ring:number[][])=>void) {
  for(const feature of data?.features||[]) {
    const g=feature.geometry;
    const polygon=g?.type==="Polygon"?[g.coordinates]:g?.type==="MultiPolygon"?g.coordinates:[];
    for(const poly of polygon) for(const ring of poly) if(ring?.length>1)visit(ring);
    const lines=g?.type==="LineString"?[g.coordinates]:g?.type==="MultiLineString"?g.coordinates:[];
    for(const ring of lines) if(ring?.length>1)visit(ring);
  }
}
function geoTrace(ctx:CanvasRenderingContext2D, geo:any, project:(lat:number,lon:number)=>{x:number;y:number}, center:number, bounds:StrikeBounds, signal?:AbortSignal) {
  let n=0;
  forGeoRings(geo,(ring) => {
    if((++n & 511)===0) abortIfNeeded(signal);
    let latMin=90,latMax=-90;
    for(const xy of ring) if(Number.isFinite(xy?.[1])) {latMin=Math.min(latMin,xy[1]);latMax=Math.max(latMax,xy[1]);}
    if(latMax<bounds.minLat-1 || latMin>bounds.maxLat+1) return;
    ctx.beginPath();let lastLon=center,prev:number[]|undefined, pen=false;
    for(const c of ring) {
      if(!Number.isFinite(c?.[0])||!Number.isFinite(c?.[1])) continue;
      const lon=unwrapStrikeLon(c[0],lastLon);
      const pt=[lon,c[1]];lastLon=lon;
      if(prev && isProductCoastlineSeamSegment(prev as [number,number],pt as [number,number]))pen=false;
      const q=project(pt[1],pt[0]);
      if(!pen)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);
      pen=true;prev=pt;
    }
    ctx.stroke();
  });
}
async function colorCoasts(ctx:CanvasRenderingContext2D,geo:any,project:(lat:number,lon:number)=>{x:number;y:number},bounds:StrikeBounds,field:StrikeField|undefined,options:StrikeProbabilityOptions,scale:number,isMini:boolean,signal?:AbortSignal,siteIndex?:StrikeSiteIndex):Promise<void> {
  const paths=COAST_COLORS.map(()=>new Path2D());
  const centerLon=(bounds.minLon+bounds.maxLon)/2;
  const threshold=options.coastMinPct;
  const tier=(p:number)=>p<threshold?-1:p<25?0:p<50?1:p<75?2:3;
  const rings:number[][][]=[];
  forGeoRings(geo,ring=>rings.push(ring));
  for(let n=0;n<rings.length;n++) {
    if((n & 63)===0) {
      abortIfNeeded(signal);
      // Round184: allow mobile browsers to paint progress and dispatch AbortSignal
      // instead of spending a long uninterrupted main-thread task on fine islands.
      if(n>0) await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    const ring=rings[n];
    if(ring.length<2)continue;
    let lastLon=centerLon,prev:number[]|null=null;
    for(const point of ring) {
      if(!Number.isFinite(point?.[0])||!Number.isFinite(point?.[1]))continue;
      const lon=unwrapStrikeLon(point[0],lastLon);lastLon=lon;
      const curr=[lon,point[1]];
      if(prev&&!isProductCoastlineSeamSegment(prev as [number,number],curr as [number,number])) {
        const dx=curr[0]-prev[0],dy=curr[1]-prev[1];
        const length=Math.hypot(dx,dy);
        if(Math.max(prev[1],curr[1])>=bounds.minLat-1 && Math.min(prev[1],curr[1])<=bounds.maxLat+1 &&
           Math.max(prev[0],curr[0])>=bounds.minLon-1 && Math.min(prev[0],curr[0])<=bounds.maxLon+1 && length<10) {
          const steps=Math.max(1,Math.ceil(length/(isMini?.15:.05)));
          for(let s=0;s<steps;s++) {
            const t0=s/steps,t1=(s+1)/steps,lat=prev[1]+dy*(t0+t1)/2,plon=prev[0]+dx*(t0+t1)/2;
            const cat=tier(siteIndex?computeSiteProbabilityIndexed(siteIndex,{lat,lon:plon}):sampleStrikeField(field!,lat,plon,true));
            if(cat<0)continue;
            const a=project(prev[1]+dy*t0,prev[0]+dx*t0),b=project(prev[1]+dy*t1,prev[0]+dx*t1);
            paths[cat].moveTo(a.x,a.y);paths[cat].lineTo(b.x,b.y);
          }
        }
      }
      prev=curr;
    }
  }
  abortIfNeeded(signal);
  ctx.save();ctx.lineCap="round";ctx.lineJoin="round";
  ctx.strokeStyle="rgba(22,32,44,.95)";ctx.lineWidth=(options.coastWidth+4)*scale;
  for(const path of paths)ctx.stroke(path);
  ctx.lineWidth=options.coastWidth*scale;
  for(let i=0;i<paths.length;i++){ctx.strokeStyle=COAST_COLORS[i];ctx.stroke(paths[i]);}
  ctx.restore();
}
function meanWithSurvivorThreshold(members:AetherGuidanceMember[], horizon:number,endMode:EnsembleTrackEndMode="operational"):AetherGuidancePoint[] {
  const groups=new Map<number,{lat:number;lon:number;vmax:number;pmin:number;n:number}>();
  const threshold=Math.max(3,Math.ceil(members.length*.05));
  const baseLon=members[0]?.track?.[0]?.lon??140;
  for(const member of members) for(const p of strikeTrackWithinHorizon(member.track,horizon,endMode,member)) {
    const lead=Math.round(p.leadHour??p.simHour);
    const g=groups.get(lead)||{lat:0,lon:0,vmax:0,pmin:0,n:0};
    g.lat+=p.lat;g.lon+=unwrapStrikeLon(p.lon,baseLon);g.vmax+=p.vmax;g.pmin+=p.pmin;g.n++;
    groups.set(lead,g);
  }
  return [...groups.entries()].sort((a,b)=>a[0]-b[0]).filter(([,g])=>g.n>=threshold).map(([lead,g])=>({
    lat:g.lat/g.n,lon:g.lon/g.n,vmax:g.vmax/g.n,pmin:g.pmin/g.n,leadHour:lead,simHour:lead
  }));
}
const coordLon=(lon:number)=> `${Math.abs(lon>180?lon-360:lon).toFixed(0)}°${((lon%360)+360)%360<=180?"E":"W"}`;
const coordLat=(lat:number)=> lat===0?"0°":`${Math.abs(lat)}°${lat>0?"N":"S"}`;
function stageColorBar(ctx:CanvasRenderingContext2D,s:number) {
  // The reference colour strip itself starts slightly lower than its 100% label:
  // top about y1547, bottom y1690 in the 2030-wide design coordinate system.
  const top=1547, bottom=1690;
  for(let j=0;j<=bottom-top;j++) {
    const p=100*(1-j/(bottom-top)), color=strikeColor(p);
    ctx.fillStyle=`rgb(${color[0]},${color[1]},${color[2]})`;
    ctx.fillRect(1891*s,(top+j)*s,31*s,1.06*s);
  }
  ctx.font=`${26*s}px Arial,sans-serif`;ctx.fillStyle="#111";ctx.textAlign="left";
  for(const [p,y] of [[100,1534],[50,1608],[0,1682]])ctx.fillText(`${p}%`,1932*s,y*s);
}
export async function drawStrikeProbabilityProduct(args:StrikeRenderArgs):Promise<StrikeField|undefined> {
  const {canvas,width:w,height:h, strike,signal}=args;
  const ctx=canvas.getContext("2d"); if(!ctx)throw new Error("无法创建概率图画布");
  if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
  ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);
  if(!productLandGeoJson?.features && !productCoastlineGeoJson?.features) {
    ctx.font="18px sans-serif";ctx.fillStyle="#a00";ctx.fillText("精细海岸线数据不可用，请联网后重试",20,45);
    throw new Error("缺少精细海岸线数据");
  }
  const members=(args.members.length?args.members:args.centers);
  const box=mapRect(w,h),s=w/2030;
  const bounds=strikeMapBounds(members,args),centerLon=(bounds.minLon+bounds.maxLon)/2;
  const project=(lat:number,lon:number)=>({x:box.x+(unwrapStrikeLon(lon,centerLon)-bounds.minLon)/(bounds.maxLon-bounds.minLon)*box.w,
    y:box.y+box.h-(lat-bounds.minLat)/(bounds.maxLat-bounds.minLat)*box.h});
  const cell=args.isMini?Math.max(.2,strike.cellDeg):strike.cellDeg;
  const key=[members.length,members.map(m=>`${m.id}:${m.track?.length}:${m.track?.at(-1)?.lat?.toFixed(3)}:${m.track?.at(-1)?.lon?.toFixed(3)}`).join("|"),
    bounds.minLon,bounds.maxLon,bounds.minLat,bounds.maxLat,strike.radiusKm,cell,strike.horizonHours,strike.smoothPasses,strike.endMode||"operational"].join(";");
  const requestedCols=Math.floor((bounds.maxLon-bounds.minLon)/cell)+1;
  const requestedRows=Math.floor((bounds.maxLat-bounds.minLat)/cell)+1;
  const stream=requestedCols*requestedRows>STRIKE_MAX_CELLS && !args.isMini;
  let field:StrikeField|undefined=stream?undefined:args.cache?.get(key);
  let streamedRaster:HTMLCanvasElement|undefined;
  let actualCell=cell;
  if(stream){
    // Rasterize directly to export-image pixel dimensions. Never create an
    // Nx×Ny Canvas/Float32 field for the potentially 80-million-cell grid.
    const raster=document.createElement('canvas');
    raster.width=Math.max(1,Math.min(3072,Math.ceil(box.w)));
    raster.height=Math.max(1,Math.min(3072,Math.ceil(box.h)));
    const rctx=raster.getContext('2d');if(!rctx)throw new Error('概率条带画布创建失败');
    const target=rctx.createImageData(raster.width,raster.height);
    const tileWidth=raster.width,tileHeight=raster.height;
    const cap=strikeIsMobile()?STRIKE_STREAM_MOBILE_CELLS:STRIKE_STREAM_DESKTOP_CELLS;
    let meta;
    try{meta=await computeStrikeFieldStripes(members,{bounds,radiusKm:strike.radiusKm,cellDeg:cell,
      horizonHours:strike.horizonHours,smoothPasses:strike.smoothPasses,endMode:strike.endMode,signal,
      onProgress:(done,total)=>args.onProgress?.(70+12*done/Math.max(1,total))},stripe=>{
        // Each target output row belongs to one core stripe. The extra row on
        // either side is retained only for cross-stripe bilinear interpolation.
        for(let py=0;py<tileHeight;py++){
          const sy=(stripe.ny-1)*(1-(py+.5)/tileHeight),y0=Math.floor(sy);
          if(y0<stripe.coreStart||y0>=stripe.coreEnd)continue;
          const y1=Math.min(stripe.ny-1,y0+1),ty=sy-y0;
          for(let px=0;px<tileWidth;px++){
            const sx=(stripe.nx-1)*(px+.5)/tileWidth,x0=Math.floor(sx),x1=Math.min(stripe.nx-1,x0+1),tx=sx-x0;
            const i0=(y0-stripe.firstRow)*stripe.nx+x0,i1=(y1-stripe.firstRow)*stripe.nx+x0;
            const p0=stripe.prob[i0]*(1-tx)+stripe.prob[i0+x1-x0]*tx;
            const p1=stripe.prob[i1]*(1-tx)+stripe.prob[i1+x1-x0]*tx;
            const color=strikeColor(p0*(1-ty)+p1*ty),i=(py*tileWidth+px)*4;
            for(let c=0;c<4;c++)target.data[i+c]=color[c];
          }
        }
      },cap);
    }catch(error){raster.width=raster.height=0;throw error;}
    actualCell=meta.cellDeg;
    rctx.putImageData(target,0,0);
    streamedRaster=raster;
  }else if(!field){
    field=await computeStrikeField(members,{bounds,radiusKm:strike.radiusKm,cellDeg:cell,horizonHours:strike.horizonHours,
      smoothPasses:members.length<10?0:strike.smoothPasses,endMode:strike.endMode,signal,onProgress:(done,total)=>args.onProgress?.(70+12*done/Math.max(1,total))});
    if(args.cache) {if(args.cache.size>2)args.cache.clear();args.cache.set(key,field);}
  }
  if(field) actualCell=field.cellDeg;
  args.onProgress?.(83);abortIfNeeded(signal);
  ctx.save();ctx.fillStyle="#fdfdff";ctx.fillRect(box.x,box.y,box.w,box.h);
  ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();
  // Reference graticule is a very light dotted gray, distinct from coastlines.
  ctx.strokeStyle="rgba(138,138,138,.45)";ctx.lineWidth=1.2*s;ctx.setLineDash([2*s,3*s]);
  for(let lon=Math.ceil(bounds.minLon/5)*5;lon<=bounds.maxLon;lon+=5) {const x=project(bounds.minLat,lon).x;ctx.beginPath();ctx.moveTo(x,box.y);ctx.lineTo(x,box.y+box.h);ctx.stroke();}
  for(let lat=Math.ceil(bounds.minLat/5)*5;lat<=bounds.maxLat;lat+=5){const y=project(lat,bounds.minLon).y;ctx.beginPath();ctx.moveTo(box.x,y);ctx.lineTo(box.x+box.w,y);ctx.stroke();}
  ctx.setLineDash([]);
  if(streamedRaster){
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(streamedRaster,box.x,box.y,box.w,box.h);
    streamedRaster.width=streamedRaster.height=0;
  }else if(field){
    // Round184 small-frame buffer path is unchanged for pixel compatibility.
    const raster=document.createElement("canvas");raster.width=field.nx;raster.height=field.ny;
    const rctx=raster.getContext("2d");if(!rctx)throw new Error("概率场离屏画布创建失败");
    const data=rctx.createImageData(field.nx,field.ny);
    for(let y=0;y<field.ny;y++)for(let x=0;x<field.nx;x++) {
      const p=field.prob[(field.ny-1-y)*field.nx+x];
      const color=strikeColor(p),i=(y*field.nx+x)*4;
      for(let c=0;c<4;c++)data.data[i+c]=color[c];
    }
    rctx.putImageData(data,0,0);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
    ctx.drawImage(raster,box.x,box.y,box.w,box.h);raster.width=raster.height=0;
  }
  abortIfNeeded(signal);
  // Grey geography boundaries only: the land and sea share the same white background.
  const coastline=productCoastlineGeoJson||productLandGeoJson;
  ctx.lineWidth=2*s;ctx.strokeStyle="#666";geoTrace(ctx,coastline,project,centerLon,bounds,signal);
  ctx.lineWidth=1.3*s;ctx.strokeStyle="#777";geoTrace(ctx,productCountriesGeoJson,project,centerLon,bounds,signal);
  if(strike.provincesGeoJson)geoTrace(ctx,strike.provincesGeoJson,project,centerLon,bounds,signal);
  // If the requested grid was relaxed for memory, coastlines must not use
  // interpolated/coarsened field values: use an exact indexed per-member hit test.
  const siteIndex=stream || (field?.requestedCellDeg && field.cellDeg>field.requestedCellDeg*1.0001)
    ?buildStrikeSiteIndex(members,strike.radiusKm,strike.horizonHours,centerLon,strike.endMode||'operational'):undefined;
  if(field||siteIndex)await colorCoasts(ctx,coastline,project,bounds,field,strike,s,!!args.isMini,signal,siteIndex);
  args.onProgress?.(91);abortIfNeeded(signal);
  if(strike.showMembers) {
    ctx.save();ctx.strokeStyle="rgba(150,150,160,.35)";ctx.lineWidth=1.2*s;ctx.lineJoin="round";
    const stride=Math.max(1,Math.ceil(members.length/600));
    for(let i=0;i<members.length;i+=stride) {
      if((i&63)===0)abortIfNeeded(signal);
      const track=strikeTrackWithinHorizon(members[i].track,strike.horizonHours,strike.endMode||"operational",members[i]);
      if(track.length<2)continue;
      ctx.beginPath();track.forEach((p,j)=>{const q=project(p.lat,p.lon);j?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();
    }
    ctx.restore();
  }
  const mean=meanWithSurvivorThreshold(members,strike.horizonHours,strike.endMode||"operational");
  if(mean.length>1){ctx.strokeStyle="#000";ctx.lineWidth=2.6*s;ctx.beginPath();mean.forEach((p,i)=>{const q=project(p.lat,p.lon);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();}
  ctx.fillStyle="#000";
  for(const p of mean)if(Math.round(p.leadHour)%strike.meanDotHours===0){const q=project(p.lat,p.lon);ctx.beginPath();ctx.arc(q.x,q.y,5*s,0,2*Math.PI);ctx.fill();}
  const origin=project(args.activeState.lat,args.activeState.lon);
  if(origin.x>=box.x && origin.x<=box.x+box.w && origin.y>=box.y && origin.y<=box.y+box.h) {
    ctx.lineWidth=5*s;ctx.lineCap="butt";ctx.strokeStyle="#000";ctx.beginPath();
    ctx.moveTo(origin.x-17*s,origin.y-17*s);ctx.lineTo(origin.x+17*s,origin.y+17*s);
    ctx.moveTo(origin.x+17*s,origin.y-17*s);ctx.lineTo(origin.x-17*s,origin.y+17*s);ctx.stroke();
  }
  ctx.restore();
  // Map outline and ticks live outside the clipping region.
  ctx.lineWidth=3*s;ctx.strokeStyle="#000";ctx.strokeRect(box.x,box.y,box.w,box.h);
  ctx.font=`${30*s}px "DejaVu Sans",Verdana,Arial,sans-serif`;ctx.fillStyle="#111";
  ctx.textAlign="right";ctx.textBaseline="middle";
  for(let lat=Math.ceil(bounds.minLat/5)*5;lat<=bounds.maxLat;lat+=5){const y=project(lat,bounds.minLon).y;ctx.fillText(coordLat(lat),84*s,y);}
  ctx.textAlign="center";ctx.textBaseline="alphabetic";
  for(let lon=Math.ceil(bounds.minLon/5)*5;lon<=bounds.maxLon;lon+=5){const x=project(bounds.minLat,lon).x;ctx.fillText(coordLon(lon),x,1795*s);}
  // Coastline key.
  ctx.textAlign="left";ctx.font=`${26*s}px Arial,sans-serif`;
  for(let i=0;i<4;i++){
    const yy=(148+33*i)*s;
    ctx.strokeStyle=COAST_COLORS[i];ctx.lineWidth=8*s;ctx.beginPath();ctx.moveTo(142*s,yy);ctx.lineTo(207*s,yy);ctx.stroke();
    const t=i===0?strike.coastMinPct:i===1?25:i===2?50:75;
    ctx.fillStyle="#111";ctx.fillText(`${t}% - ${[25,50,75,100][i]}%`,222*s,yy+8*s);
  }
  ctx.fillStyle="rgba(255,255,255,.85)";ctx.fillRect(1678*s,116*s,317*s,82*s);
  ctx.strokeStyle="#d0d0d0";ctx.lineWidth=1.5*s;ctx.strokeRect(1678*s,116*s,317*s,82*s);
  ctx.font=`${28*s}px Arial,sans-serif`;ctx.fillStyle="#111";
  ctx.strokeStyle="#b0b0b8";ctx.lineWidth=2*s;ctx.beginPath();ctx.moveTo(1688*s,135*s);ctx.lineTo(1741*s,135*s);ctx.stroke();
  ctx.fillText("Ensemble Cluster",1760*s,143*s);
  ctx.strokeStyle="#000";ctx.beginPath();ctx.moveTo(1688*s,173*s);ctx.lineTo(1741*s,173*s);ctx.stroke();
  ctx.fillStyle="#000";ctx.beginPath();ctx.arc(1715*s,173*s,4*s,0,Math.PI*2);ctx.fill();ctx.fillText("Ensemble Mean",1760*s,181*s);
  stageColorBar(ctx,s);
  if(actualCell>cell*1.0001){
    ctx.font=`${22*s}px Arial,sans-serif`;ctx.textAlign='left';ctx.fillStyle='#555';
    ctx.fillText(`实际栅格 ${Number(actualCell.toFixed(5))}°（取景过大，已按内存上限放宽）`,97*s,1841*s,1450*s);
  }
  if(strike.watermark.trim()) {ctx.textAlign="right";ctx.fillStyle="#222";ctx.font=`${32*s}px Arial,sans-serif`;ctx.fillText(strike.watermark.trim(),1925*s,1730*s);}
  // Station probabilities are exact member hit fractions, independent of raster smoothing.
  const siteValues=STRIKE_SITES.filter(site=>site.lat>=bounds.minLat&&site.lat<=bounds.maxLat&&
    unwrapStrikeLon(site.lon,centerLon)>=bounds.minLon&&unwrapStrikeLon(site.lon,centerLon)<=bounds.maxLon)
    .map(site=>({site,p:siteIndex?computeSiteProbabilityIndexed(siteIndex,site):computeSiteProbability(members,site,strike.radiusKm,strike.horizonHours,strike.endMode||"operational")}))
    .filter(v=>v.p>=strike.pillMinPct).sort((a,b)=>b.p-a.p);
  const chosen:typeof siteValues=[];
  for(const item of siteValues) {
    if(chosen.length>=strike.pillCount)break;
    if(chosen.some(other=>other.site.label===item.site.label||Math.hypot(other.site.lat-item.site.lat,other.site.lon-item.site.lon)<.25))continue;
    chosen.push(item);
  }
  const pillW=Math.min(209,(box.w/s-56-Math.max(0,chosen.length-1)*11)/Math.max(1,chosen.length)),pillH=74;
  ctx.textAlign="center";ctx.textBaseline="middle";
  for(let i=0;i<chosen.length;i++){
    const x=(125+i*(pillW+10.8))*s,y=1665*s,r=37*s;
    const hueT=chosen.length<=1?0:i/(chosen.length-1);
    const grad=ctx.createLinearGradient(x,y,x+pillW*s,y);
    grad.addColorStop(0,hueT<.5?"#ff4b0a":"#ff600a");grad.addColorStop(1,"#ff6a0a");
    ctx.fillStyle=grad;ctx.beginPath();ctx.roundRect(x,y,pillW*s,pillH*s,r);ctx.fill();
    ctx.font=`${28*s*Math.min(1,pillW/209)}px "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif`;
    ctx.fillStyle="#fff";ctx.fillText(`${chosen[i].site.label} ${Math.round(chosen[i].p)}%`,x+pillW*s/2,y+pillH*s/2,pillW*s-10*s);
  }
  ctx.textAlign="left";ctx.textBaseline="alphabetic";ctx.fillStyle="#111";
  ctx.font=`${36*s}px "DejaVu Sans",Arial,sans-serif`;
  const num=getTyphoonOfficialNumber(args.typhoon,args.startDate);
  const code=`WP${num.slice(-2)}20${num.slice(0,2)}`;
  ctx.fillText(`${strike.modelLabel.trim()||"WMC"} Ensemble Forecast Probability that [${code}] will pass within ${strike.radiusKm} km radius`,97*s,47*s,1850*s);
  const issue=new Date(args.startDate.getTime()+args.currentHour*3600000);
  const digits=(n:number)=>String(n).padStart(2,"0");
  ctx.fillText(`Initial time:${issue.getUTCFullYear()}-${digits(issue.getUTCMonth()+1)}-${digits(issue.getUTCDate())}-${digits(issue.getUTCHours())}Z`,97*s,88*s);
  ctx.textAlign="right";ctx.font=`${32*s}px Arial,sans-serif`;
  ctx.fillText(`[lon,lat]=[${args.activeState.lon.toFixed(1)},${args.activeState.lat.toFixed(1)}]`,1976*s,88*s);
  args.onProgress?.(96);abortIfNeeded(signal);
  return field;
}
