/** Product-local agency caption preferences. The official identities of third-party agencies
 * are never shipped as defaults: all weather products are labelled simulated WMC products. */
export interface AgencyBranding {
  agencyName:string;
  agencyCode:string;
  footerNote:string;
  makerSuffix:string;
}
export const DEFAULT_AGENCY_BRANDING:AgencyBranding={agencyName:'晚风气象台',agencyCode:'WMC',footerNote:'模拟产品，仅供娱乐',makerSuffix:'制作'};
export function sanitizeBrandText(s:string,maxLen:number):string {
  return String(s??'').replace(/[\u0000-\u001f\u007f-\u009f]/g,'').replace(/\s+/g,' ').trim().slice(0,maxLen);
}
const limits:Record<keyof AgencyBranding,number>={agencyName:16,agencyCode:12,footerNote:60,makerSuffix:10};
const key=(productId:string)=>productId==='global'?'forecast_agency_global':`forecast_agency_${productId}`;
const read=(id:string):Partial<AgencyBranding>=>{
  try {const raw=localStorage.getItem(key(id));const data=JSON.parse(raw||'null');
    if(!data||typeof data!=='object')return{};
    const result:Partial<AgencyBranding>={};
    for(const k of Object.keys(limits) as (keyof AgencyBranding)[])
      if(typeof data[k]==='string')result[k]=sanitizeBrandText(data[k],limits[k]);
    return result;
  }catch{return{};}
};
export function loadAgencyBranding(productId:string):AgencyBranding {
  const raw={...DEFAULT_AGENCY_BRANDING,...read('global'),...read(productId)};
  return {...raw,agencyName:raw.agencyName||DEFAULT_AGENCY_BRANDING.agencyName,
    agencyCode:raw.agencyCode||DEFAULT_AGENCY_BRANDING.agencyCode};
}
export function saveAgencyBranding(productId:string,patch:Partial<AgencyBranding>):void {
  try {const result={...read(productId)};
    for(const k of Object.keys(limits) as (keyof AgencyBranding)[])
      if(typeof patch[k]==='string')result[k]=sanitizeBrandText(patch[k]!,limits[k]);
    localStorage.setItem(key(productId),JSON.stringify(result));
  }catch{/* private browser mode */}
}

/** Commit a new global default atomically with clearing all product overrides.
 * A product-specific value left behind would otherwise silently defeat "apply to all". */
export function applyAgencyBrandingGlobally(patch:Partial<AgencyBranding>):void {
  try {
    const storage=localStorage;
    const productKeys:string[]=[];
    for(let i=0;i<storage.length;i++){
      const item=storage.key(i);
      if(item?.startsWith('forecast_agency_')&&item!=='forecast_agency_global')productKeys.push(item);
    }
    // Write before clearing; a failed global write must not erase per-product data.
    const next={...read('global')};
    for(const field of Object.keys(limits) as (keyof AgencyBranding)[])
      if(typeof patch[field]==='string')next[field]=sanitizeBrandText(patch[field]!,limits[field]);
    storage.setItem(key('global'),JSON.stringify(next));
    for(const item of productKeys)storage.removeItem(item);
  }catch{/* storage may be unavailable, previews keep fallback identities */}
}
/** Removing the preference restores global defaults rather than writing a stale override. */
export function clearAgencyBranding(productId:string):void {
  try {localStorage.removeItem(key(productId));}catch{/* private mode */}
}
