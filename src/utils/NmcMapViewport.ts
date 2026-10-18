/** NMC cartography viewport, kept independent from the simulation physics.
 * Spherical Mercator EPSG:3857 (Web Mercator), with one identical pixel scale
 * for longitude and projected latitude. All coordinates here are angular degrees.
 */
export type NmcMapLocation = { lat: number; lon: number; simHour?: number };
export type NmcGeoFrame = { minLon: number; maxLon: number; minLat: number; maxLat: number; minMercY: number; maxMercY: number; includesHistory: boolean; significantLandfall: boolean };
export type NmcGeoRectangle = { x: number; y: number; w: number; h: number };

const RAD = Math.PI / 180;
const MERCATOR_LIMIT = 85.05112878;
/** Per-polygon threshold excludes isolated small islets, not an entire country. */
export const NMC_SIGNIFICANT_LAND_KM2 = 5000;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export function nmcMercatorY(lat: number): number {
  const phi = clamp(lat, -MERCATOR_LIMIT, MERCATOR_LIMIT) * RAD;
  return Math.log(Math.tan(Math.PI / 4 + phi / 2)) / RAD;
}
export function nmcInverseMercatorY(y: number): number {
  return (2 * Math.atan(Math.exp(y * RAD)) - Math.PI / 2) / RAD;
}
export function nmcUnwrapLongitude(lon:number,anchor:number):number {
  if(!Number.isFinite(lon)||!Number.isFinite(anchor))return NaN;
  return ((lon-anchor+180)%360+360)%360-180+anchor;
}

type LandPolygon = { bounds: [number, number, number, number]; rings: number[][][] };
const significantPolygonCache = new WeakMap<object, LandPolygon[]>();
function approximateRingAreaKm2(ring: number[][]): number {
  if (ring.length < 4) return 0;
  let shoelace = 0, sumLat = 0;
  const refLon = ring[0][0];
  for (let i = 0; i < ring.length - 1; i++) {
    const p = ring[i], q = ring[i+1];
    const px = nmcUnwrapLongitude(p[0], refLon), qx = nmcUnwrapLongitude(q[0], refLon);
    shoelace += px * q[1] - qx * p[1];
    sumLat += p[1];
  }
  const meanLat = sumLat / (ring.length - 1);
  return Math.abs(shoelace / 2) * 111.195 * 111.195 * Math.max(0.01, Math.cos(meanLat * RAD));
}
function polygonBounds(ring: number[][]): [number,number,number,number] {
  let left=Infinity, right=-Infinity, bottom=Infinity, top=-Infinity;
  for(const [lon,lat] of ring){ left=Math.min(left,lon);right=Math.max(right,lon);bottom=Math.min(bottom,lat);top=Math.max(top,lat); }
  return [left,bottom,right,top];
}
function collectSignificantPolygons(geo: any): LandPolygon[] {
  if (!geo || typeof geo !== 'object') return [];
  const cached = significantPolygonCache.get(geo);
  if (cached) return cached;
  const accepted: LandPolygon[]=[];
  const accept = (rings: number[][][]) => {
    if (!Array.isArray(rings) || !rings[0] || rings[0].length < 4) return;
    // Interior holes do not make a small island significant.
    const area = approximateRingAreaKm2(rings[0]) - rings.slice(1).reduce((s,r)=>s+approximateRingAreaKm2(r),0);
    if (area >= NMC_SIGNIFICANT_LAND_KM2) accepted.push({ rings, bounds: polygonBounds(rings[0]) });
  };
  for (const feature of geo.features || []) {
    const g = feature?.geometry;
    if (g?.type === 'Polygon') accept(g.coordinates);
    else if (g?.type === 'MultiPolygon') for(const p of g.coordinates) accept(p);
  }
  significantPolygonCache.set(geo, accepted);
  return accepted;
}
function ringContains(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false;
  const ref = ring[0][0];
  const x = nmcUnwrapLongitude(lon, ref);
  for (let i=0,j=ring.length-1; i<ring.length; j=i++) {
    const ax=nmcUnwrapLongitude(ring[i][0],ref), ay=ring[i][1];
    const bx=nmcUnwrapLongitude(ring[j][0],ref), by=ring[j][1];
    if ((ay>lat)!==(by>lat) && x < ax+(bx-ax)*(lat-ay)/(by-ay)) inside=!inside;
  }
  return inside;
}
function significantLandContains(lat: number, lon: number, polygons: LandPolygon[]): boolean {
  for (const { bounds, rings } of polygons) {
    if(lat < bounds[1] || lat > bounds[3]) continue;
    const x=nmcUnwrapLongitude(lon,(bounds[0]+bounds[2])/2);
    if(x<bounds[0] || x>bounds[2]) continue;
    if(!ringContains(lat,x,rings[0])) continue;
    if(!rings.slice(1).some(r=>ringContains(lat,x,r))) return true;
  }
  return false;
}
/** Forecast CENTERLINE touches substantial land; probability cone alone is not landfall. */
export function nmcForecastTouchesSignificantLand(current: NmcMapLocation, forecast: NmcMapLocation[], landGeoJson: any, fallbackCountries?: any): boolean {
  const polys=collectSignificantPolygons(landGeoJson?.features?.length ? landGeoJson : fallbackCountries);
  if (!polys.length) return false;
  const points = [current, ...forecast].filter(p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lon));
  for(let i=0;i<points.length;i++) {
    const a=points[i], b=points[Math.min(i+1,points.length-1)];
    const endLon=nmcUnwrapLongitude(b.lon,a.lon);
    const pieces=Math.max(1,Math.ceil(Math.hypot((endLon-a.lon)*Math.cos(a.lat*RAD),b.lat-a.lat)/.2));
    for(let k=0;k<(i===points.length-1?1:pieces);k++) {
      const t=i===points.length-1?0:k/pieces;
      if(significantLandContains(a.lat+(b.lat-a.lat)*t,a.lon+(endLon-a.lon)*t,polys))return true;
    }
  }
  return false;
}

export function buildNmcGeoFrame(current: NmcMapLocation, history: NmcMapLocation[], forecast: NmcMapLocation[], landGeoJson: any, map: NmcGeoRectangle, countriesGeoJson?: any): NmcGeoFrame {
  // Round148: always use the old near-landfall viewport geometry; the
  // significant-land contact flag remains diagnostic-only, never determines crop.
  const significantLandfall = nmcForecastTouchesSignificantLand(current, forecast, landGeoJson, countriesGeoJson);
  // After a significant-land forecast keep recent history context (36 h),
  // rather than leaving only a lone current-centre point. Do not zoom out to
  // distant genesis positions after landfall.
  const recentHistory=Number.isFinite(current.simHour)
    ? history.filter(p=>Number.isFinite(p.simHour) && p.simHour! >= current.simHour! - 36 && p.simHour! <= current.simHour!)
    : [];
  const selected = [...recentHistory, current, ...forecast];
  const points=selected.filter(p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lon));
  if (!points.length) points.push(current);
  const xVals=points.map(p=>nmcUnwrapLongitude(p.lon,current.lon));
  const yVals=points.map(p=>nmcMercatorY(p.lat));
  // Fit the *entire probability cone*, not just its narrow centreline. The
  // previous 15% centreline padding clipped wide end caps near China/Taiwan.
  for (let i=0;i<forecast.length;i++) {
    const point=forecast[i];
    if (!Number.isFinite(point?.lat)||!Number.isFinite(point?.lon))continue;
    const lead=Number.isFinite(current.simHour) && Number.isFinite(point.simHour)
      ? Math.max(0,point.simHour!-current.simHour!) : (i+1)*3;
    const capped=Math.min(120,lead);
    const radiusKm=capped>0?30+360*Math.pow(capped/120,1.27):0;
    const angularRadius=radiusKm/(111.12*Math.max(.3,Math.cos(point.lat*RAD)));
    const x=nmcUnwrapLongitude(point.lon,current.lon),y=nmcMercatorY(point.lat);
    xVals.push(x-angularRadius,x+angularRadius);
    yVals.push(y-angularRadius,y+angularRadius);
  }
  const minX=Math.min(...xVals),maxX=Math.max(...xVals);
  const minY=Math.min(...yVals),maxY=Math.max(...yVals);
  const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  // Apply a smaller final margin on top of the already-fitted cone, and
  // maintain identical metres-per-pixel in Mercator X and Y.
  const margin=1.08;
  let spanX=Math.max(9,(maxX-minX)*margin);
  let spanY=Math.max(7,(maxY-minY)*margin);
  const unitPerPixel=Math.max(spanX/map.w,spanY/map.h);
  spanX=unitPerPixel*map.w;
  spanY=unitPerPixel*map.h;
  const left=centerX-spanX/2,right=centerX+spanX/2;
  const bottom=centerY-spanY/2,top=centerY+spanY/2;
  return {minLon:left,maxLon:right,minLat:nmcInverseMercatorY(bottom),maxLat:nmcInverseMercatorY(top),minMercY:bottom,maxMercY:top,includesHistory:recentHistory.length>0,significantLandfall};
}

export function nmcProjectPoint(lat: number, lon: number, frame: NmcGeoFrame, map: NmcGeoRectangle): {x:number;y:number} {
  return {
    x:map.x+(lon-frame.minLon)/(frame.maxLon-frame.minLon)*map.w,
    y:map.y+(frame.maxMercY-nmcMercatorY(lat))/(frame.maxMercY-frame.minMercY)*map.h
  };
}
