/** Round149: single cartographic geometry for stills, video and the live Leaflet crop tool.
 * Coordinates are in a 1536-wide design space; the legend is NOT part of the crop.
 */
export type SynopticProductStyle = 'default' | 'hmon' | 'hwrf';
export type SynopticProductAspect = 'default' | '3:4' | '4:3' | '9:16' | '16:9';
export const SYNOPTIC_DESIGN_WIDTH = 1536;
const DEFAULT_HEIGHT: Record<SynopticProductStyle, number> = { default: 1024, hmon: 1462, hwrf: 1230 };
const ASPECT_VALUES: Record<Exclude<SynopticProductAspect, 'default'>, number> = {
  '3:4': 3 / 4, '4:3': 4 / 3, '9:16': 9 / 16, '16:9': 16 / 9
};
export function synopticOutputAspect(style: SynopticProductStyle = 'default', choice: SynopticProductAspect = 'default') {
  return choice === 'default' ? SYNOPTIC_DESIGN_WIDTH / DEFAULT_HEIGHT[style] : ASPECT_VALUES[choice];
}
export function synopticProductLayout(style: SynopticProductStyle = 'default', choice: SynopticProductAspect = 'default') {
  const outputAspect = synopticOutputAspect(style, choice);
  const height = Math.round(SYNOPTIC_DESIGN_WIDTH / outputAspect);
  const portrait = outputAspect < 1;
  // The 65px header and the wind-field rectangle are the same for every renderer.
  // Landscape keeps the right-hand legend; portrait moves the legend below the field.
  const map = { x: 62, y: 65, w: portrait ? 1410 : 1348, h: height - (portrait ? 232 : 84) };
  const colorbar = portrait
    ? { x: 95, y: height - 112, w: 1352, h: 32, cap: 0 }
    : { x: 1424, y: style === 'default' ? 100 : map.y, w: 31,
        h: style === 'default' ? Math.max(40, map.h - 57) : map.h,
        cap: style === 'default' ? 35 : 0 };
  return { map, height, colorbar, portrait, outputAspect, mapAspect: map.w / map.h };
}

/** Exact Leaflet / EPSG:3857 latitude mapping for a user-picked crop.
 * A crop's north/south edges must remain fixed even when a different aspect
 * ratio is chosen; the renderer and crop tool share this coordinate system.
 */
export type SynopticCropBounds = {lonMin:number;lonMax:number;latMin:number;latMax:number};
const mercatorY=(lat:number)=>Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*Math.PI/360));
export function synopticCropLatitudeAtRow(bounds:SynopticCropBounds, fraction:number){
  const north=mercatorY(bounds.latMax),south=mercatorY(bounds.latMin);
  return (2*Math.atan(Math.exp(north+(south-north)*fraction))-Math.PI/2)*180/Math.PI;
}
export function synopticCropProject(bounds:SynopticCropBounds, frame:{w:number;h:number},lat:number,lon:number){
  const north=mercatorY(bounds.latMax),south=mercatorY(bounds.latMin);
  return {x:(lon-bounds.lonMin)/(bounds.lonMax-bounds.lonMin)*frame.w,
    y:(north-mercatorY(lat))/(north-south)*frame.h};
}
