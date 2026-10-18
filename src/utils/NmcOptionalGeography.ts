/** Optional detailed NMC overlays. National boundaries/China colouring work offline
 * using bundled polygons. Rivers are bundled for offline use; provinces are loaded
 * on demand from a compact public China administrative dataset. Missing data is
 * never replaced with fabricated lines. Basemap GSHHG and China Atlas provide vectors. */
export type NmcExtraVectors = { provinces: any | null; rivers: any | null; errors: string[] };
const upstream = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
let provinceCache: any | null = null;
let riverCache: any | null = null;
let pendingProvince: Promise<any> | null = null;
let pendingRiver: Promise<any> | null = null;
// Keep Round185's per-request abort safeguards; an unavailable mirror cannot
// freeze the NMC modal or become a permanent failure until page reload.
const FETCH_TIMEOUT_MS = 2000;
const REMOTE_TIMEOUT_MS = 4400;
const MAX_VECTOR_BYTES = 12_000_000;
const MAX_VECTOR_VERTICES = 300_000;
const RETRY_AFTER_MS = 45_000;
const failedGeography = new Map<'province'|'river',{message:string,at:number}>();
const PROVINCE_MIRRORS = [
  'https://cdn.jsdelivr.net/gh/BarbarossaWang/cn-atlas@main/provinces.json',
  'https://raw.githubusercontent.com/BarbarossaWang/cn-atlas/main/provinces.json'
] as const;

async function fetchValidatedGeoJson(url:string, timeoutMs=FETCH_TIMEOUT_MS):Promise<any> {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetch(url,{signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const type=response.headers.get('content-type')||'';
    if(!/json|geo\+json|octet-stream/i.test(type))throw new Error('接口未返回地理数据（可能是 index.html）');
    const text=await response.text();
    if(text.length>MAX_VECTOR_BYTES || !/^\s*\{/.test(text))throw new Error('地理数据大小或格式无效');
    const data=JSON.parse(text);
    if(!Array.isArray(data?.features)||data.features.length>12000)throw new Error('地理要素数量无效');
    let vertices=0;
    const visit=(v:any,depth:number):boolean=>{
      if(depth>9)return false;
      if(Array.isArray(v)&&typeof v[0]==='number'){
        vertices++;return vertices<=MAX_VECTOR_VERTICES && v.length>=2 &&
          Number.isFinite(v[0])&&Number.isFinite(v[1])&&v[0]>=-180&&v[0]<=540&&Math.abs(v[1])<=90;
      }
      return Array.isArray(v)&&v.every(p=>visit(p,depth+1));
    };
    if(!data.features.every((f:any)=>f&&f.geometry&&visit(f.geometry.coordinates,0)))throw new Error('地理坐标或体量无效');
    return data;
  } finally {clearTimeout(timer);}
}
function localGeoUrl(which:'province'|'river'):string {
  const file=which==='province'?'nmc_china_provinces.geojson':'nmc_rivers.geojson';
  return typeof document==='undefined' ? `/data/${file}` : new URL(`data/${file}`,document.baseURI).toString();
}
async function load(which:'province'|'river'):Promise<any> {
  let data:any;
  const local=localGeoUrl(which);
  try { data=await fetchValidatedGeoJson(local); }
  catch(localError) {
    if(which==='river')throw new Error(`本地水系读取失败: ${String(localError)}`);
    // R205: R204 accidentally omitted the province asset. CDN fallback works
    // for older deployments; the build prepare script bundles it when online.
    let lastError:unknown=localError;
    for(const mirror of PROVINCE_MIRRORS){
      try {data=await fetchValidatedGeoJson(mirror,REMOTE_TIMEOUT_MS);break;}
      catch(e){lastError=e;}
    }
    if(!data)throw new Error(`省界本地及在线备用源均不可用: ${String(lastError)}`);
  }
  const chinaAtlas=which==='province' && data.features.length<=50 &&
    data.features.some((f:any)=>f.properties?.name||f.properties?.地名||f.properties?.区划码);
  return {type:'FeatureCollection',features:data.features.filter((feature:any)=>{
    if(which==='province'){
      if(chinaAtlas)return true;
      const pr=feature.properties||{};
      return [pr.admin,pr.geonunit,pr.sovereignt,pr.name_en,pr.name].some(v=>/^(China|Taiwan)$/i.test(String(v||''))) || ['CHN','TWN'].includes(String(pr.adm0_a3||pr.sov_a3||''));
    }
    const b=feature.properties?.BBOX||feature.bbox;
    return !b||b.length!==4||b[0]<155&&b[2]>70&&b[1]<60&&b[3]>0;
  })};
}
function cacheFailure(which:'province'|'river',e:unknown) {
  failedGeography.set(which,{message:`${which==='province'?'省界':'水系'}已跳过: ${String(e)}`,at:Date.now()});
}
export async function loadNmcOptionalGeography(provinces:boolean,rivers:boolean):Promise<NmcExtraVectors> {
  const jobs:Promise<unknown>[]=[];
  const stale=(key:'province'|'river')=>{
    const failure=failedGeography.get(key);
    if(failure && Date.now()-failure.at>=RETRY_AFTER_MS)failedGeography.delete(key);
    return failedGeography.has(key);
  };
  // Loading the two sources simultaneously means a missing optional province
  // URL cannot delay the already bundled river layer.
  if(provinces && !provinceCache && !stale('province')){
    pendingProvince ||= load('province').then(v=>{provinceCache=v;failedGeography.delete('province');})
      .catch(e=>cacheFailure('province',e)).finally(()=>{pendingProvince=null;});
    jobs.push(pendingProvince);
  }
  if(rivers && !riverCache && !stale('river')){
    pendingRiver ||= load('river').then(v=>{riverCache=v;failedGeography.delete('river');})
      .catch(e=>cacheFailure('river',e)).finally(()=>{pendingRiver=null;});
    jobs.push(pendingRiver);
  }
  if(jobs.length)await Promise.all(jobs);
  const errors:string[]=[];
  if(provinces && failedGeography.has('province'))errors.push(failedGeography.get('province')!.message);
  if(rivers && failedGeography.has('river'))errors.push(failedGeography.get('river')!.message);
  return {provinces:provinceCache,rivers:riverCache,errors};
}

/** NMC only: feature-level river density selection at the full original vector
 * resolution. Natural Earth/GSHHG's rank is nearly always 5 in this dataset,
 * so filtering solely on rank incorrectly erases almost the entire network.
 * Retain all main stems and tributaries >= 40 km, draw ALL original vertices.
 * This never mutates or reduces resolution of the bundled GeoJSON. */
const riverChoice = new WeakMap<object, boolean>();
export function shouldDrawNmcRiver(feature: any): boolean {
  if (!feature?.geometry) return false;
  const obj = feature as object;
  const known = riverChoice.get(obj);
  if (known !== undefined) return known;
  const g = feature.geometry;
  const lines: number[][][] = g.type === 'LineString' ? [g.coordinates] :
    g.type === 'MultiLineString' ? g.coordinates : [];
  const rank = Number(feature.properties?.scalerank);
  let lengthKm = 0;
  for (const line of lines) {
    for (let j = 1; j < line.length; j++) {
      const [lon1, lat1] = line[j - 1], [lon2, lat2] = line[j];
      if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) continue;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      let dLon = ((lon2 - lon1 + 540) % 360) - 180;
      dLon *= Math.PI / 180;
      const midLat = (lat1 + lat2) * Math.PI / 360;
      lengthKm += 6371 * Math.hypot(dLat, dLon * Math.cos(midLat));
      if (lengthKm >= 40) break;
    }
    if (lengthKm >= 40) break;
  }
  const keep = rank <= 3 || lengthKm >= 40;
  riverChoice.set(obj, keep);
  return keep;
}
