/** R218 — Reference WGS84 coordinates for the typhoon 24 h/48 h warning lines.
 * Sourced from publicly reproduced GIS linework, NOT authenticated CMA GIS data.
 * Coordinates are [longitude,latitude]. Rendering and crossing checks share them.
 */
export const NETWORK_WARNING_24H: readonly (readonly [number,number])[] = [
  [105,0],[113,4.5],[119,11],[119,18],[127,22],[127,34]
] as const;
export const NETWORK_WARNING_48H: readonly (readonly [number,number])[] = [
  [105,0],[120,0],[132,15],[132,34]
] as const;

/** Mainland/landward side (west of the warning polyline) at a given latitude.
 * The open 24-hour boundary is not an official closed polygon. This predicate
 * is a deterministic geographic-side test, not an official alert decision.
 * The eastern edge has a northward extension for storms above 34° N.
 */
export function insideNetwork24hWarning(lat:number,lon:number):boolean {
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<0)return false;
  const unwrapped=((lon+180)%360+360)%360-180;
  const points=NETWORK_WARNING_24H;
  let edge=points[points.length-1][0];
  for(let i=1;i<points.length;i++){
    const [x1,y1]=points[i-1],[x2,y2]=points[i];
    if(lat<=y2){edge=x1+(x2-x1)*Math.max(0,Math.min(1,(lat-y1)/(y2-y1)));break;}
  }
  return unwrapped<=edge;
}
