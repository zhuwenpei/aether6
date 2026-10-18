/** R215 network gallery: reuse unmodified normal product renderers and aspect ratios. */
import type {Typhoon,SimulationConfig} from '../types';
import {materializeForecastPath} from '../simulation/Engine';
import {buildAetherCenterGuidance,buildAetherEnsembleMembers,AETHER_MODEL_SPECS,type AetherGuidanceMember} from '../simulation/AetherEnsembleGuidance';
import {loadProductNaturalEarthData} from '../simulation/NaturalEarthLoader';
import {loadNmcOptionalGeography} from './NmcOptionalGeography';
import {drawClassicEnsembleProduct} from './ClassicEnsembleProduct';
import {drawEnsembleReferenceProductAsync,getEnsembleReferenceAspect} from './EnsembleReferenceProducts';
import type {NetworkFix} from './TyphoonNetworkData';
import type {NetworkChartSettings} from '../components/NetworkEntrySettings';

export type NetworkReferenceImages={strike:string;centers:string};
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('生成已取消','AbortError');};
/** Exactly the standard WMC classic center-path product renderer, no custom styles. */
export function drawNetworkEightCenterChart(canvas:HTMLCanvasElement,centers:AetherGuidanceMember[],issue:NetworkFix,stormName:string,startDate:Date,
  referencePath:any[]=[],config?:SimulationConfig,width=2560,height=1920):void{
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法创建经典集系图');
  drawClassicEnsembleProduct({ctx,W:width,H:height,scale:width/1920,isMini:false,
    activeState:issue,referencePath,allTracks:centers,visibleCenters:centers,
    ensembleMode:'centers',ensembleBlackLines:true,selectedEnsembleModels:AETHER_MODEL_SPECS.map(m=>m.id),config,
    currentHour:issue.simHour,startDate});
}

export async function generateNetworkReferenceCharts(args:{storm:Typhoon;issue:NetworkFix;startDate:Date;config:SimulationConfig;settings:NetworkChartSettings;name:string;signal:AbortSignal;onProgress?:(text:string)=>void;}):Promise<NetworkReferenceImages>{
  const {storm,issue,startDate,config,settings,name,signal,onProgress}=args;
  check(signal);onProgress?.('准备集合底图与模拟预报');
  const ready=await loadProductNaturalEarthData();check(signal);
  if(!ready)throw new Error('集合预报地理底图未就绪');
  const seed={...storm,...issue,history:(storm.history||[]).filter(h=>h.simHour<=issue.simHour),forecastPath:[],simHour:issue.simHour} as Typhoon;
  // Normal classic centre product has a fixed 168h horizon. The normal strike
  // product has its own independent selectable 72–360h horizon.
  const centerHorizon=168;
  const classicForecast=materializeForecastPath(seed,config,centerHorizon,undefined,false)
    .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  check(signal);onProgress?.('生成 8 机构差异化中心路径');
  const classicCenters=buildAetherCenterGuidance(seed,issue.simHour,[seed],config.seed||'AETHER',classicForecast,centerHorizon,config,true);
  if(!classicCenters.length)throw new Error('8 机构中心路径计算结果为空');
  const centerCanvas=document.createElement('canvas');
  drawNetworkEightCenterChart(centerCanvas,classicCenters,issue,name,startDate,classicForecast,config,settings.nmcWidth,Math.round(settings.nmcWidth*3/4));
  const centerImage=centerCanvas.toDataURL('image/png');
  centerCanvas.width=1;centerCanvas.height=1;check(signal);
  const horizon=settings.strikeHorizon;
  const operationalForecast=horizon===centerHorizon?classicForecast:materializeForecastPath(seed,config,horizon,undefined,false)
    .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  const forecast=settings.strike.endMode==='residual'?
    materializeForecastPath(seed,config,horizon,undefined,true).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)):
    operationalForecast;
  const centers=horizon===centerHorizon&&settings.strike.endMode!=='residual'?classicCenters:
    buildAetherCenterGuidance(seed,issue.simHour,[seed],config.seed||'AETHER',forecast,horizon,config,true);
  onProgress?.(`生成 ${centers.length} 机构集合成员与袭击概率`);
  const members=await buildAetherEnsembleMembers({storm:seed,currentHour:issue.simHour,scene:[seed],seed:config.seed||'AETHER',referencePath:forecast,
    selectedModelIds:AETHER_MODEL_SPECS.map(m=>m.id),membersPerModel:settings.membersPerModel,horizon,config,useProductCoastline:true,signal,
    onProgress:(done,total)=>{if(done===total)onProgress?.('绘制袭击概率栅格');}});
  check(signal);
  if(!members.length)throw new Error('集合成员计算结果为空');
  const strikeCanvas=document.createElement('canvas');
  const overlay=await loadNmcOptionalGeography(true,false);check(signal);
  await drawEnsembleReferenceProductAsync({canvas:strikeCanvas,style:'strike_probability_120km',typhoon:seed,activeState:seed,
    currentHour:issue.simHour,startDate,config,centers,members,referencePath:forecast,framingReferencePath:operationalForecast,forecastHorizonHours:horizon,
    width:settings.nmcWidth,height:Math.round(settings.nmcWidth/getEnsembleReferenceAspect('strike_probability_120km')),stormName:name,historicalTrack:(storm.history||[]).filter(p=>p.simHour<=issue.simHour),
    strike:{...settings.strike,horizonHours:horizon,provincesGeoJson:overlay.provinces},
    signal,onProgress:p=>onProgress?.(`绘制袭击概率图 ${Math.round(p)}%`)});
  check(signal);
  const strikeImage=strikeCanvas.toDataURL('image/png');
  strikeCanvas.width=1;strikeCanvas.height=1;
  return {strike:strikeImage,centers:centerImage};
}
