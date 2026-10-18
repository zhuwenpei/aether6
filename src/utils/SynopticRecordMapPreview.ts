/** Round154: non-mutating archive replay preview for fixed-position synoptic video.
 * Uses the EXACT manually chosen EPSG:3857 crop; no storm-follow camera, no
 * forecasting and no calls into the simulation integrator.
 */
import type { Typhoon, TyphoonState } from '../types';
import { productLandGeoJson, productCoastlineGeoJson } from '../simulation/NaturalEarthLoader';
import { synopticCropProject, type SynopticCropBounds } from './SynopticProductLayout';

const geographicPreviewCache = new Map<string, HTMLCanvasElement>();
const wrapAround = (x: number, center: number) => x + 360 * Math.round((center - x) / 360);
const validBounds = (b: SynopticCropBounds) =>
  [b.lonMin,b.lonMax,b.latMin,b.latMax].every(Number.isFinite) && b.lonMax > b.lonMin && b.latMax > b.latMin;

/** The end points remain archived snapshots; only moving center/radii are interpolated. */
export function historicalStormAt(typhoon: Typhoon, simHour: number): TyphoonState | null {
  const h = typhoon.history || [];
  if (!h.length) return null;
  let lo = 0, hi = h.length - 1;
  if (simHour <= h[0].simHour) return h[0];
  if (simHour >= h[hi].simHour) return h[hi];
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (h[mid].simHour <= simHour) lo = mid; else hi = mid;
  }
  const a = h[lo], b = h[hi], t = (simHour - a.simHour) / (b.simHour - a.simHour);
  const mix = (x: number, y: number) => x + (y - x) * t;
  const radii = (key: 'r7'|'r10'|'r12') => {
    const left = a[key], right = b[key];
    if (!left || !right) return left || right;
    return { ne: mix(left.ne,right.ne), se: mix(left.se,right.se),sw:mix(left.sw,right.sw),nw:mix(left.nw,right.nw) };
  };
  return { ...a, lat: mix(a.lat,b.lat), lon: mix(a.lon,b.lon), vmax: mix(a.vmax,b.vmax),
    pmin: mix(a.pmin,b.pmin), r7:radii('r7'), r10:radii('r10'), r12:radii('r12') };
}

export function drawSynopticRecordMapPreview(
  canvas: HTMLCanvasElement, typhoon: Typhoon, bounds: SynopticCropBounds, hour: number,
  width: number, height: number
) {
  if (!validBounds(bounds)) return;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.clearRect(0,0,width,height);
  const midLon = (bounds.lonMin+bounds.lonMax)/2;
  const pos = (lat:number, lon:number) => synopticCropProject(bounds,{w:width,h:height},lat,wrapAround(lon,midLon));
  // Both the cached and uncached branches clip dynamic overlays to the same fixed frame.
  ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
  const cacheKey = [width,height,bounds.lonMin,bounds.lonMax,bounds.latMin,bounds.latMax].join(':');
  const cachedBase = geographicPreviewCache.get(cacheKey);
  if (cachedBase) ctx.drawImage(cachedBase,0,0);
  if (!cachedBase) {
  ctx.fillStyle = '#0d2930'; ctx.fillRect(0,0,width,height);
  // Cached coastline and land use precisely the same clip and projection.
  const features = (productLandGeoJson as any)?.features || [];
  const renderRing = (ring: number[][]) => {
    let last: {x:number;y:number}|null=null, has=false;
    for (const c of ring) {
      if(!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      const p=pos(c[1],c[0]);
      if(last && Math.abs(p.x-last.x)>width*.7){last=p;continue;}
      if (!has) {ctx.moveTo(p.x,p.y);has=true;} else ctx.lineTo(p.x,p.y);
      last=p;
    }
    if(has)ctx.closePath();
  };
  const renderPolygon = (rings: number[][][]) => {
    if (!rings.length)return;
    const outer=rings[0];
    if (outer.length===0) return;
    let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
    for (const point of outer){
      const lon=wrapAround(point[0],midLon);
      west=Math.min(west,lon);east=Math.max(east,lon);
      south=Math.min(south,point[1]);north=Math.max(north,point[1]);
    }
    if(east-west>180 || east<bounds.lonMin || west>bounds.lonMax ||
       north<bounds.latMin || south>bounds.latMax) return;
    ctx.beginPath();rings.forEach(renderRing);
    ctx.fillStyle='#153d36'; ctx.fill('evenodd');
  };
  // The product land GeoJSON is loaded once by the enclosing panel. Never fetch on a slider event.
  for (const feat of features) {
    const geo=feat?.geometry;
    if(geo?.type==='Polygon')renderPolygon(geo.coordinates);
    else if(geo?.type==='MultiPolygon')geo.coordinates.forEach(renderPolygon);
  }
  // Gridlines use the same Mercator mapping as the selected wind product.
  const lonStep=[0.25,0.5,1,2,5,10,20,30].find(s=>(bounds.lonMax-bounds.lonMin)/s<8)||30;
  const latStep=[0.25,0.5,1,2,5,10,20,30].find(s=>(bounds.latMax-bounds.latMin)/s<7)||30;
  ctx.strokeStyle='rgba(140,177,196,.17)';ctx.lineWidth=0.7;
  for(let lon=Math.ceil(bounds.lonMin/lonStep)*lonStep;lon<bounds.lonMax;lon+=lonStep){
    const a=pos(bounds.latMin,lon),b=pos(bounds.latMax,lon);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  }
  for(let lat=Math.ceil(bounds.latMin/latStep)*latStep;lat<bounds.latMax;lat+=latStep){
    const a=pos(lat,bounds.lonMin),b=pos(lat,bounds.lonMax);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  }
  const coastFeatures=(productCoastlineGeoJson as any)?.features || [];
  ctx.strokeStyle='rgba(176,219,209,.54)';ctx.lineWidth=.7;
  const coastRing=(ring:number[][])=>{
    let prev:{x:number;y:number}|null=null;
    ctx.beginPath();
    for(const pt of ring){const p=pos(pt[1],pt[0]);if(prev&&Math.abs(p.x-prev.x)>width*.7){ctx.stroke();ctx.beginPath();prev=null;}
      if(!prev)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);prev=p;}
    ctx.stroke();
  };
  for(const feat of coastFeatures){const g=feat.geometry;
    if(g?.type==='LineString')coastRing(g.coordinates);
    if(g?.type==='MultiLineString')g.coordinates.forEach(coastRing);
  }
  // Geographical names are part of the archived map preview only, not encoded into wind products.
  const cities:[string,number,number][]=[
    ['上海',31.23,121.47],['杭州',30.27,120.15],['福州',26.08,119.30],
    ['广州',23.13,113.27],['香港',22.3,114.17],['台北',25.03,121.57],
    ['高雄',22.63,120.30],['马尼拉',14.6,120.98],['东京',35.68,139.69],
    ['大阪',34.7,135.5],['那霸',26.21,127.68],['首尔',37.57,126.98],
    ['青岛',36.07,120.38],['海口',20.05,110.33],['厦门',24.48,118.08]
  ];
  ctx.font='9px sans-serif';ctx.textBaseline='middle';
  for(const [name,lat,lon] of cities){const p=pos(lat,lon);
    if(p.x<7 || p.x>width-35 || p.y<9 || p.y>height-10)continue;
    ctx.fillStyle='#ef4444';ctx.beginPath();ctx.arc(p.x,p.y,2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='rgba(229,231,235,.88)';ctx.fillText(name,p.x+5,p.y);
  }
  const base=document.createElement('canvas');base.width=width;base.height=height;
  base.getContext('2d')?.drawImage(canvas,0,0);
  geographicPreviewCache.set(cacheKey,base);
  // Only retain a couple of user-selected crops; memory must remain bounded.
  if (geographicPreviewCache.size>3) geographicPreviewCache.delete(geographicPreviewCache.keys().next().value!);
  }
  const current=historicalStormAt(typhoon,hour);
  const h=(typhoon.history||[]).filter(s=>s.simHour<=hour);
  if(h.length){
    ctx.strokeStyle='rgba(254,255,255,.88)';ctx.lineWidth=2.2;
    ctx.beginPath();h.forEach((s,i)=>{const p=pos(s.lat,s.lon);if(!i)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
    if(current){const p=pos(current.lat,current.lon);ctx.lineTo(p.x,p.y);}
    ctx.stroke();
    for(const s of h.filter((_,i)=>i%3===0)){
      const p=pos(s.lat,s.lon);ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);
      ctx.fillStyle=s.vmax>=51?'#ef4444':s.vmax>=42?'#d946ef':s.vmax>=33?'#fb923c':s.vmax>=24?'#22c55e':s.vmax>=17?'#3b82f6':'#facc15';
      ctx.fill();ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=.65;ctx.stroke();
    }
  }
  if(current){
    for(const [key,color] of [['r7','rgba(86,194,245,.65)'],['r10','rgba(247,190,65,.78)'],['r12','rgba(238,74,84,.83)']] as const){
      const r=current[key];if(!r || Math.max(r.ne,r.se,r.sw,r.nw)<=0)continue;
      ctx.beginPath();for(let d=0;d<=360;d+=5){
        const q=d%360, km=q<90?r.ne:q<180?r.se:q<270?r.sw:r.nw;
        const angle=d*Math.PI/180;
        const lat=current.lat+Math.cos(angle)*km/111.32;
        const lon=current.lon+Math.sin(angle)*km/(111.32*Math.max(.3,Math.cos(current.lat*Math.PI/180)));
        const p=pos(lat,lon);if(d===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
      }ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.stroke();
    }
    const p=pos(current.lat,current.lon);
    ctx.beginPath();ctx.arc(p.x,p.y,5.1,0,2*Math.PI);ctx.fillStyle='#ffcd37';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
  }
  ctx.restore();
  ctx.font='11px sans-serif';ctx.fillStyle='#e0f2fe';ctx.textBaseline='top';
  ctx.fillText(`历史回放  T+${hour.toFixed(1)}h  ·  固定地理选区`,10,10);
  if(current){ctx.font='10px monospace';ctx.fillStyle='#bef264';ctx.fillText(`${current.vmax.toFixed(1)}m/s  ${Math.round(current.pmin)}hPa`,10,25);}
}
