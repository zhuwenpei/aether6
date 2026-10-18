/** R198: Mirror the raster basemap used by the user-uploaded webtoapp app.
 * webtoapp `assets/index-v5fix4.js` labels this style `baidu`, but the
 * actual four raster URLs are all `*.is.autonavi.com` (Gaode).
 * Consequently, this source is NOT a genuine Baidu raster basemap.
 * Availability and permitted usage are determined by the tile provider.
 */
import type L from 'leaflet';
export type ReferenceRasterProvider='baidu'|'amap';
export const REFERENCE_RASTER_CREDIT='© 高德地图';
export const REFERENCE_RASTER_TILE_URL='https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
export function isReferenceRasterProvider(p:string):p is ReferenceRasterProvider{
  return p==='baidu'||p==='amap';
}
/** Coordinates displayed over raster tiles are GCJ-02 on the mainland.
 * The existing conversion function supplies the position; never mutate simulation WGS84.
 */
export function referenceBasemapLocation(
  provider:string,lon:number,lat:number,toGcj:(lon:number,lat:number)=>[number,number]
):[number,number] {
  const [outLon,outLat]=isReferenceRasterProvider(provider)?toGcj(lon,lat):[lon,lat];
  return [outLat,outLon];
}
export function createReferenceRasterLayer(leaflet:typeof L,provider:ReferenceRasterProvider):L.TileLayer {
  if(!isReferenceRasterProvider(provider))throw new Error('Unknown raster provider');
  return leaflet.tileLayer(REFERENCE_RASTER_TILE_URL,{
    subdomains:['1','2','3','4'],tileSize:256,maxZoom:18,minZoom:1,
    attribution:REFERENCE_RASTER_CREDIT,
    updateWhenIdle:false,keepBuffer:3
  });
}
