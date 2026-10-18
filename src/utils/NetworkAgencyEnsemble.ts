/** R216 — Agency forecasts sampled from *actual* independently integrated ensemble members.
 * Reproducible per cyclone (a different issue never redraws agency/model identity),
 * while each issued forecast runs its own thermodynamics and terrain integration.
 * Synthetic agencies are illustrative, not statements of operational forecasts.
 */
import type {SimulationConfig, Typhoon} from '../types';
import {materializeForecastPath, getLandMetrics} from '../simulation/Engine';
import {buildAetherEnsembleMembers, AETHER_MODEL_SPECS, type AetherGuidancePoint, type AetherGuidanceMember} from '../simulation/AetherEnsembleGuidance';
import {loadProductNaturalEarthData, checkPointOnProductLandGeoJson, productLandGeoJson} from '../simulation/NaturalEarthLoader';
import {buildNetworkForecasts, NETWORK_FORECAST_STYLE, type NetworkFix, type NetworkForecast} from './TyphoonNetworkData';

const FOREIGN_AGENCIES = ['日本','美国','韩国'] as const;
function hash32(s:string):number {let h=2166136261>>>0;for(let i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),16777619)>>>0;}return h>>>0;}
/** Stable pseudo-random sample WITHOUT replacement from the eight model families. */
export function selectNetworkAgencyModels(storm:Typhoon, config:SimulationConfig):Array<{agency:typeof FOREIGN_AGENCIES[number];modelId:(typeof AETHER_MODEL_SPECS)[number]['id'];memberIndex:number}> {
  const identity=`${config.seed||'AETHER'}|${storm.id||storm.name||storm.lat+','+storm.lon}|NETWORK-AGENCY-R216`;
  const shuffled=AETHER_MODEL_SPECS.map(spec=>({modelId:spec.id,sort:hash32(identity+'|'+spec.id)}))
    .sort((a,b)=>a.sort-b.sort||a.modelId.localeCompare(b.modelId));
  return FOREIGN_AGENCIES.map((agency,i)=>({agency,modelId:shuffled[i].modelId,memberIndex:1+(hash32(identity+'|member|'+agency)%2)}));
}
const normalizeLon=(lon:number)=>((lon+180)%360+360)%360-180;
const unit=(n:number,step=1)=>Math.round(n/step)*step;
/** Preserve the ensemble's native 3h intensity states. No positional jiggle, no timewise
 * smooth curve, and NO rescaling from the China advisory. Land checks are performed at
 * EACH MEMBER'S OWN center, not at the deterministic control track's center. */
export function physicalAgencyFixes(points:readonly AetherGuidancePoint[],issue:NetworkFix,config:SimulationConfig,landCheck?:(lat:number,lon:number)=>boolean):NetworkFix[] {
  const result:NetworkFix[]=[];
  const sorted=[...points].filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Number.isFinite(p.vmax)&&Number.isFinite(p.leadHour)&&p.leadHour>0&&p.leadHour<=120+1e-6)
    .sort((a,b)=>a.leadHour-b.leadHour);
  let previous:NetworkFix=issue;
  let priorLead=0;
  for(const p of sorted){
    // Native ensemble integration is on 3h nodes. Retain ONLY those physical nodes.
    if(Math.abs(p.leadHour/3-Math.round(p.leadHour/3))>1e-5||p.leadHour<=priorLead+1e-6)continue;
    const onLand=!!p.landed || (landCheck ? landCheck(p.lat,p.lon) : getLandMetrics(p.lat,p.lon,config.coastlineSource,true).isLand);
    let vmax=unit(Math.max(0,p.vmax));
    let pmin=unit(Math.max(850,Math.min(1050,p.pmin)));
    if(onLand){
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
export async function buildNetworkForecastsWithEnsemble(issue:NetworkFix,storm:Typhoon,config:SimulationConfig,signal?:AbortSignal,onProgress?:(done:number,total:number,stage:string)=>void):Promise<NetworkForecast[]> {
  // CMA alone keeps the existing public wind ladder and operational-reference guidance.
  const china=buildNetworkForecasts(issue,storm,config,true)[0];
  if(!china||issue.dissipated)return china?[china]:[];
  if(signal?.aborted)throw new DOMException('台风网预报已取消','AbortError');
  const choices=selectNetworkAgencyModels(storm,config);
  const seed={...storm,...issue,history:(storm.history||[]).filter(p=>p.simHour<=issue.simHour),simHour:issue.simHour,forecastPath:[]} as Typhoon;
  const horizon=120;
  // The same source and full thermodynamics as the normal ensemble meteorological products.
  // A product coastline lets small-island landfalls influence each model independently.
  const geodataReady=await loadProductNaturalEarthData().catch(()=>false);
  if(signal?.aborted)throw new DOMException('台风网预报已取消','AbortError');
  const path=materializeForecastPath(seed,config,horizon,undefined,false);
  const members=await buildAetherEnsembleMembers({storm:seed,currentHour:issue.simHour,scene:[seed],seed:config.seed||'AETHER',referencePath:path,
    selectedModelIds:choices.map(item=>item.modelId),membersPerModel:3,horizon,config,useProductCoastline:geodataReady,signal,onProgress});
  if(signal?.aborted)throw new DOMException('台风网预报已取消','AbortError');
  const styles=NETWORK_FORECAST_STYLE;
  const hasLandPlate=!!geodataReady&&!!productLandGeoJson;
  const landCheck=(lat:number,lon:number)=>hasLandPlate?checkPointOnProductLandGeoJson(lat,lon):getLandMetrics(lat,lon,config.coastlineSource,true).isLand;
  const foreign=choices.map(({agency,modelId,memberIndex})=>{
    const member:AetherGuidanceMember|undefined=members.find(m=>m.modelId===modelId&&!m.control&&m.memberNumber===memberIndex);
    if(!member||!member.track.length)throw new Error(`集合成员计算缺失：${modelId} / ${agency}`);
    const fixes=physicalAgencyFixes(member.track,issue,config,landCheck);
    const style=styles.find(f=>f.agency===agency);
    return {agency,color:style?.color||'#aaa',fixes};
  });
  return [china,...foreign];
}
