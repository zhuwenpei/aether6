/**
 * R205: prepare a genuine admin-1 boundary GeoJSON at build time.
 * Source: cn-atlas (ISC) / ruiduobao 2023 China province boundaries.
 * This is deliberately best-effort: an unavailable public mirror may NOT
 * prevent the application from building. Runtime loader has the same fallback.
 * Run: node scripts/prepare_nmc_provinces.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'public','data','nmc_china_provinces.geojson');
const mirrors=[
 'https://cdn.jsdelivr.net/gh/BarbarossaWang/cn-atlas@main/provinces.json',
 'https://raw.githubusercontent.com/BarbarossaWang/cn-atlas/main/provinces.json'
];
function isProvinceData(v){
 return v?.type==='FeatureCollection' && Array.isArray(v.features) &&
  v.features.length>=25 && v.features.length<=60 &&
  v.features.every(f=>f?.geometry && ['Polygon','MultiPolygon'].includes(f.geometry.type));
}
try {
 const cached=JSON.parse(await fs.readFile(output,'utf8'));
 if(isProvinceData(cached)){console.log('[NMC] Province GeoJSON already bundled');process.exit(0);}
} catch {/* missing in R204; download the source */}
let installed=false;
for(const url of mirrors){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),6500);
 try {
  const res=await fetch(url,{signal:controller.signal,headers:{accept:'application/json'}});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  const bytes=await res.text();
  if(bytes.length>12_000_000)throw new Error('province asset too large');
  const data=JSON.parse(bytes);
  if(!isProvinceData(data))throw new Error('invalid province boundary feature collection');
  await fs.mkdir(path.dirname(output),{recursive:true});
  // Only publish verified real data, never substitute an invented mesh.
  await fs.writeFile(output,JSON.stringify(data));
  console.log(`[NMC] Bundled ${data.features.length} province boundary features (${Math.round(bytes.length/1024)} KiB)`);
  installed=true;break;
 } catch(error){console.warn(`[NMC] Optional boundary mirror unavailable: ${String(error)}`);}
 finally{clearTimeout(timer);}
}
if(!installed)console.warn('[NMC] Province boundaries could not be bundled in this build environment. The app will retry the public sources at runtime; existing rivers still work offline.');
