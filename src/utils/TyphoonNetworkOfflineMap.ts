/** R193: independent, key-free reference-colored offline vector basemap.
 * Land boundaries are real packaged GeoJSON, NOT stretched reference screenshots.
 * On first use, static resources are fetched from THIS application's origin;
 * no third-party map service, online tiles or SDK is accessed. Once cached in
 * memory the layer can be switched without additional fetches. */
import L from 'leaflet';

// Representative flat-area RGB pixels sampled from user-uploaded 51425/51424:
// sea (161,210,253), land (255,255,255).
export const NETWORK_OFFLINE_COLORS = Object.freeze({
  sea:'#a1d2fd', land:'#ffffff', coastline:'#a1c1d1', border:'#bc999d'
});
type FeatureCollection = {type:'FeatureCollection';features:any[]};
export type NetworkOfflineGeography = {land:FeatureCollection; borders:FeatureCollection};
let cached:NetworkOfflineGeography|null=null;
let pending:Promise<NetworkOfflineGeography>|null=null;

function assetPath(file:string){
  const base=((import.meta as any).env?.BASE_URL||'/').replace(/\/?$/,'/');
  return `${base}data/${file}`;
}
async function readLocalGeoJson(name:string):Promise<FeatureCollection>{
  const response=await fetch(assetPath(name),{cache:'force-cache'});
  if(!response.ok)throw new Error(`离线地图内置文件读取失败：${name} (${response.status})`);
  const value=await response.json();
  if(value?.type!=='FeatureCollection'||!Array.isArray(value.features)||!value.features.length)
    throw new Error(`离线地图内置几何数据损坏：${name}`);
  return value as FeatureCollection;
}
export function loadNetworkOfflineGeography():Promise<NetworkOfflineGeography>{
  if(cached)return Promise.resolve(cached);
  if(pending)return pending;
  pending=Promise.all([
    readLocalGeoJson('product_land_wide_v3.geojson'),
    readLocalGeoJson('product_countries_highdetail_v3.geojson')
  ]).then(([land,borders])=>{cached={land,borders};return cached;})
    .finally(()=>{pending=null;});
  return pending;
}
/** A dedicated canvas renderer helps low-memory mobile browsers with large coastlines. */
export function createNetworkOfflineLayer(geography:NetworkOfflineGeography):L.LayerGroup{
  const canvas=L.canvas({padding:0.35,pane:'tn-offline-ground'});
  const layer=L.layerGroup();
  L.geoJSON(geography.land as any,{
    interactive:false,
    style:()=>({renderer:canvas,pane:'tn-offline-ground',smoothFactor:0.7,color:NETWORK_OFFLINE_COLORS.coastline,weight:0.65,
      fillColor:NETWORK_OFFLINE_COLORS.land,fillOpacity:1,opacity:0.95})
  }).addTo(layer);
  L.geoJSON(geography.borders as any,{
    interactive:false,
    style:()=>({renderer:canvas,pane:'tn-offline-ground',smoothFactor:0.7,color:NETWORK_OFFLINE_COLORS.border,
      weight:0.48,opacity:0.75,fillOpacity:0})
  }).addTo(layer);
  (layer as any)._aetherOffline=true;
  return layer;
}
