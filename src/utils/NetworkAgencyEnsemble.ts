/** R218 — Foreign agency views map one-to-one to preselected ensemble main/control paths.
 * Each centre inherits its own model intensity/landfall evolution; final displayed
 * intensity retains the R217 high-weight NMC reference and landfall gate.
 * These synthetic country labels are illustrative, NOT operational guidance.
 */
import type {SimulationConfig, Typhoon} from '../types';
import {materializeForecastPath, getLandMetrics} from '../simulation/Engine';
import {buildAetherCenterGuidance, AETHER_MODEL_SPECS, type AetherGuidancePoint} from '../simulation/AetherEnsembleGuidance';
import {loadProductNaturalEarthData, checkPointOnProductLandGeoJson, productLandGeoJson} from '../simulation/NaturalEarthLoader';
import {NETWORK_FORECAST_STYLE, type NetworkFix, type NetworkForecast} from './TyphoonNetworkData';

const FOREIGN_AGENCIES = ['日本','美国','韩国'] as const;
function hash32(s:string):number {let h=2166136261>>>0;for(let i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),16777619)>>>0;}return h>>>0;}
/** Assign each foreign display agency to ONE stable ensemble model MAIN/control
 * path. WNV3 and FNV3 are excluded. GEM remains available.
 * The assignment is stable for the storm and configuration seed across issues.
 */
export const NETWORK_ALLOWED_MAIN_MODELS=AETHER_MODEL_SPECS.filter(spec=>spec.id!=='WNV3'&&spec.id!=='FNV3');
export function selectNetworkAgencyModels(storm:Typhoon,config:SimulationConfig):Array<{agency:typeof FOREIGN_AGENCIES[number];modelId:(typeof AETHER_MODEL_SPECS)[number]['id']}> {
  const identity=`${config.seed||'AETHER'}|${storm.id||storm.name||storm.lat+','+storm.lon}|NETWORK-MAIN-R218`;
  const shuffled=NETWORK_ALLOWED_MAIN_MODELS.map(spec=>({modelId:spec.id,sort:hash32(identity+'|'+spec.id)}))
    .sort((a,b)=>a.sort-b.sort||a.modelId.localeCompare(b.modelId));
  return FOREIGN_AGENCIES.map((agency,i)=>({agency,modelId:shuffled[i].modelId}));
}
const normalizeLon=(lon:number)=>((lon+180)%360+360)%360-180;
const unit=(n:number,step=1)=>Math.round(n/step)*step;
/** Preserve the ensemble's native 3h intensity states. No positional jiggle, no timewise
 * smooth curve, and NO rescaling from the China advisory. Land checks are performed at
 * EACH MEMBER'S OWN center, not at the deterministic control track's center. */
export function physicalAgencyFixes(points:readonly AetherGuidancePoint[],issue:NetworkFix,config:SimulationConfig,
  landCheck?:(lat:number,lon:number)=>boolean,nmcReference:readonly NetworkFix[]=[]):NetworkFix[] {
  const result:NetworkFix[]=[];
  const sorted=[...points].filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Number.isFinite(p.vmax)&&Number.isFinite(p.leadHour)&&p.leadHour>0&&p.leadHour<=120+1e-6)
    .sort((a,b)=>a.leadHour-b.leadHour);
  let previous:NetworkFix=issue;
  let priorLead=0;
  let everLanded=!!issue.landed;
  // Same issue and lead as the shared NMC plate; beyond its official termination
  // a model retains its native physical intensity instead of being artificially
  // held at a stale NMC wind value.
  const reference=new Map(nmcReference.map(p=>[Math.round(p.simHour*1e5),p]));
  const referenceAt=(absoluteHour:number):NetworkFix|undefined=>{
    const direct=reference.get(Math.round(absoluteHour*1e5));if(direct)return direct;
    const first=nmcReference[0],last=nmcReference[nmcReference.length-1];
    if(!first||!last||absoluteHour<first.simHour||absoluteHour>last.simHour)return undefined;
    const right=nmcReference.find(p=>p.simHour>=absoluteHour);if(!right)return undefined;
    const left=[...nmcReference].reverse().find(p=>p.simHour<=absoluteHour)||right;
    if(right===left)return right;
    const t=(absoluteHour-left.simHour)/(right.simHour-left.simHour);
    return {...left,vmax:left.vmax+(right.vmax-left.vmax)*t,pmin:left.pmin+(right.pmin-left.pmin)*t};
  };
  for(const p of sorted){
    // Native ensemble integration is on 3h nodes. Retain ONLY those physical nodes.
    if(Math.abs(p.leadHour/3-Math.round(p.leadHour/3))>1e-5||p.leadHour<=priorLead+1e-6)continue;
    const onLand=!!p.landed || (landCheck ? landCheck(p.lat,p.lon) : getLandMetrics(p.lat,p.lon,config.coastlineSource,true).isLand);
    const aligned=referenceAt(issue.simHour+p.leadHour);
    // 82% NMC control / 18% independent ensemble thermodynamics. The ensemble
    // still owns every agency's geometry, landfall and native intensity tendency.
    const guidedWind=aligned?0.82*aligned.vmax+0.18*p.vmax:p.vmax;
    let vmax=unit(Math.max(0,guidedWind));
    let pmin=unit(Math.max(850,Math.min(1050,p.pmin+(p.vmax-vmax)*1.15)));
    everLanded=everLanded||onLand;
    if(everLanded){
      // The model already integrates friction, inner-core damage and land decay.
      // The final discretisation must not re-strengthen a landfall fix via rounding,
      // synoptic target relaxation or post-processing. Enforce an individual
      // agency-specific one-way land gate, not a shared China intensity series.
      vmax=Math.max(0,Math.min(vmax,previous.vmax-0.5));
      pmin=Math.max(pmin,previous.pmin);
    }
    const f:NetworkFix={...issue,lat:p.lat,lon:normalizeLon(p.lon),vmax,pmin,category:vmax<5?'残留低压':undefined,
      simHour:issue.simHour+p.leadHour,landed:onLand,dissipated:vmax<5,
      speed:Number.isFinite(p.speed)?p.speed:previous.speed,
      direction:Number.isFinite(p.direction)?p.direction:previous.direction};
    result.push(f);previous=f;priorLead=p.leadHour;
    // Once a member loses its tropical low-level vortex, do not resurrect
    // it at a later forecast lead merely because the guidance continues its
    // remnant geometry into open water.
    if(f.dissipated)break;
  }
  return result;
}
export async function buildNetworkForecastsWithEnsemble(issue:NetworkFix,storm:Typhoon,config:SimulationConfig,
  china:NetworkForecast,signal?:AbortSignal,onProgress?:(done:number,total:number,stage:string)=>void):Promise<NetworkForecast[]> {
  // China is the EXACT already-computed NMC intensity series, not re-materialized
  // here. The three other agencies each retain independently integrated paths.
  if(issue.dissipated)return [china];
  if(signal?.aborted)throw new DOMException('台风网预报已取消','AbortError');
  const choices=selectNetworkAgencyModels(storm,config);
  const seed={...storm,...issue,history:(storm.history||[]).filter(p=>p.simHour<=issue.simHour),simHour:issue.simHour,forecastPath:[]} as Typhoon;
  // The classic ensemble's main/control tracks use a 168h integration. Render
  // only the first 120h on the network, without recomputing a 120h scenario.
  const horizon=168;
  // The same source and full thermodynamics as the normal ensemble meteorological products.
  // A product coastline lets small-island landfalls influence each model independently.
  const geodataReady=await loadProductNaturalEarthData().catch(()=>false);
  if(signal?.aborted)throw new DOMException('台风网预报已取消','AbortError');
  const path=materializeForecastPath(seed,config,horizon,undefined,false);
  // Exactly the same deterministic family control tracks as the classic eight-
  // model ensemble centre product, not randomized individual plume members.
  onProgress?.(0,choices.length,'计算各机构主路径');
  const mainTracks=buildAetherCenterGuidance(seed,issue.simHour,[seed],config.seed||'AETHER',path,horizon,config,geodataReady);
  if(signal?.aborted)throw new DOMException('台风网预报已取消','AbortError');
  const styles=NETWORK_FORECAST_STYLE;
  const hasLandPlate=!!geodataReady&&!!productLandGeoJson;
  const landCheck=(lat:number,lon:number)=>hasLandPlate?checkPointOnProductLandGeoJson(lat,lon):getLandMetrics(lat,lon,config.coastlineSource,true).isLand;
  const foreign=choices.map(({agency,modelId},index)=>{
    const model=mainTracks.find(m=>m.modelId===modelId&&m.control);
    if(!model||!model.track.length)throw new Error(`集合机构主路径缺失：${modelId} / ${agency}`);
    const fixes=physicalAgencyFixes(model.track,issue,config,landCheck,china.fixes);
    onProgress?.(index+1,choices.length,`${agency} ← ${modelId} 主路径`);
    const style=styles.find(f=>f.agency===agency);
    return {agency,color:style?.color||'#aaa',fixes,sourceModelId:modelId};
  });
  return [china,...foreign];
}
