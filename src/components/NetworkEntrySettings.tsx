import {useState} from 'react';
import type {SimulationConfig,Typhoon} from '../types';
import ForecastImageModal from './ForecastImageModal';
import type {StrikeProbabilityOptions} from '../utils/StrikeProbabilityProduct';
import {AETHER_ENSEMBLE_MEMBER_COUNTS} from '../simulation/AetherEnsembleGuidance';
import {loadAgencyBranding} from '../utils/AgencyBranding';
import './NetworkEntrySettings.css';

/** Network reference products consume the same persistent settings as ForecastImageModal.
 * The drawer mounts that ORIGINAL editor; no second, reduced options list exists.
 */
export type NetworkChartSettings={
  precalculate:boolean;
  resolutionId:'1080p'|'2k'|'4k'|'8k';
  nmcWidth:number;
  forecastHours:number;
  nmcCoarseIntensity:boolean;
  nmcCustomPeakEnabled:boolean;
  nmcCustomPeak:number;
  nmcBorders:boolean;nmcChinaTint:boolean;nmcProvinces:boolean;nmcRivers:boolean;
  showInfoBoxes:boolean;showCenterBox:boolean;showForecastBox:boolean;
  strikeHorizon:number;strikeRadiusKm:number;strikeCellDeg:number;strikeSmoothPasses:number;
  membersPerModel:number;meanDotHours:number;
  strike:StrikeProbabilityOptions;
};
const NORMAL_SIZES={
  '1080p':{width:1920,height:1440},'2k':{width:2560,height:1920},
  '4k':{width:3840,height:2880},'8k':{width:7680,height:5760}
} as const;
const getStored=(key:string)=>{try{return localStorage.getItem(`forecast_${key}`)}catch{return null}};
const readSelect=<T extends string|number>(key:string,fallback:T,values:readonly T[]):T=>{
  const raw=getStored(key);if(raw===null)return fallback;
  const val=(typeof fallback==='number'?Number(raw):raw) as T;
  return values.includes(val)?val:fallback;
};
const readText=(key:string,fallback:string,max:number)=>String(getStored(key)??fallback).slice(0,max);
const readCheck=(key:string,defaultValue:boolean)=>{const val=getStored(key);return val===null?defaultValue:val==='true'};
/** Exactly the normal product editor's defaults (including 2K, 50 members and 0.1° grid). */
export function readNetworkChartSettingsFromProducts(precalculate=false):NetworkChartSettings {
  const resolutionId=readSelect('resolutionId','2k' as const,Object.keys(NORMAL_SIZES) as (keyof typeof NORMAL_SIZES)[]);
  const boundsDefault={minLon:105,maxLon:180,minLat:-3,maxLat:58};
  let customBounds=boundsDefault;
  try{const b=JSON.parse(getStored('strikeCustomBounds')||'null');
    if(b&&[b.minLon,b.maxLon,b.minLat,b.maxLat].every(Number.isFinite)&&b.maxLon>b.minLon&&b.maxLat>b.minLat)customBounds=b;
  }catch{}
  const strikeHorizon=readSelect('ensembleStrikeHorizonHours',168,[72,96,120,168,240,360]);
  const strikeRadiusKm=readSelect('strikeRadiusKm',120,[50,80,100,120,150,200,300]);
  const strikeCellDeg=readSelect('strikeCellDeg',0.1,[0.0025,0.005,0.01,0.02,0.025,0.05,0.1,0.2,0.25]);
  const strikeSmoothPasses=readSelect('strikeSmoothPasses',1,[0,1,2]);
  const meanDotHours=readSelect('strikeMeanDotHours',6,[3,6,12,24]);
  const membersPerModel=readSelect('ensembleMembersPerModel',50,AETHER_ENSEMBLE_MEMBER_COUNTS);
  const strike:StrikeProbabilityOptions={
    horizonHours:strikeHorizon,radiusKm:strikeRadiusKm,cellDeg:strikeCellDeg,smoothPasses:strikeSmoothPasses,
    endMode:readSelect('strikeTrackEndMode','operational' as const,['operational','residual'] as const),
    coastMinPct:readSelect('strikeCoastMinPct',5,[1,5,10,25]),
    coastWidth:readSelect('strikeCoastWidth',7,[4,5,6,7,8,9,10,11,12]),
    frameMode:readSelect('strikeFrameMode','auto' as const,['auto','wnp','custom'] as const),
    customBounds,showMembers:readCheck('strikeShowMembers',true),meanDotHours,
    pillCount:readSelect('strikePillCount',7,[0,1,2,3,4,5,6,7,8,9,10]),
    pillMinPct:readSelect('strikePillMinPct',5,Array.from({length:30},(_,i)=>i+1)),
    modelLabel:(()=>{const text=readText('strikeModelLabel','WMC',12);return text==='WMC'?loadAgencyBranding('ensemble_tracks').agencyCode:text;})(),
    watermark:readText('strikeWatermark','WMC',30)
  };
  return {
    precalculate,resolutionId,nmcWidth:NORMAL_SIZES[resolutionId].width,
    forecastHours:readSelect('forecastHours',120,[24,48,72,96,120]),
    nmcCoarseIntensity:readCheck('nmcCoarseIntensity',true),
    nmcCustomPeakEnabled:readCheck('nmcCustomPeakEnabled',false),
    nmcCustomPeak:readSelect('nmcCustomPeak',55,Array.from({length:76},(_,i)=>15+i)),
    nmcBorders:readCheck('nmcBorders',true),nmcChinaTint:readCheck('nmcChinaTint',true),
    nmcProvinces:readCheck('nmcProvinces',true),nmcRivers:readCheck('nmcRivers',true),
    showInfoBoxes:readCheck('showInfoBoxes',true),showCenterBox:readCheck('showCenterBox',true),
    showForecastBox:readCheck('showForecastBox',true),
    strikeHorizon,strikeRadiusKm,strikeCellDeg,strikeSmoothPasses,membersPerModel,meanDotHours,strike
  };
}
export const DEFAULT_NETWORK_CHART_SETTINGS:NetworkChartSettings=readNetworkChartSettingsFromProducts();

export default function NetworkEntrySettings({config,storm,currentHour,startDate,mobileMode,onStartSynopticMapSelection,onCancel,onConfirm}:{
  config:SimulationConfig;storm:Typhoon;currentHour:number;startDate:Date;mobileMode?:boolean;
  onStartSynopticMapSelection?:()=>void;onCancel:()=>void;onConfirm:(config:SimulationConfig,settings:NetworkChartSettings)=>void;
}){
  const [precalculate,setPrecalculate]=useState(false);
  const [drawer,setDrawer]=useState(false);
  const [openEditor,setOpenEditor]=useState(false);
  return <div className="tn-entry-overlay" role="dialog" aria-modal="true" aria-label="台风网模拟入场调整">
    <section className="tn-entry-card">
      <div className="tn-entry-head"><button type="button" onClick={onCancel} aria-label="取消进入">←</button><strong>模拟台风网 · 预报调整</strong></div>
      <div className="tn-entry-body">
        <p className="tn-entry-muted">本次入场生成专用预报，不改变主模拟物理历史与原始参数。</p>
        <p className="tn-entry-muted">中国预报与 NMC 参考图完全共用正常 NMC 产品的强度计算结果；各国预报在独立集合成员基础上高权重参考这一结果。巅峰参数请在完整气象图设置的 NMC 产品中调整。</p>
        <button type="button" className="tn-entry-drawer-toggle" onClick={()=>setDrawer(v=>!v)} aria-expanded={drawer} aria-controls="tn-entry-drawer">☰　气象图生成参数 <span>{drawer?'收起 ▲':'展开 ▼'}</span></button>
        {drawer&&<div id="tn-entry-drawer" className="tn-entry-drawer">
          <label className="tn-entry-check"><input type="checkbox" checked={precalculate} onChange={e=>setPrecalculate(e.target.checked)}/> 进入台风网时提前计算集合预报图片</label>
          <small>使用普通气象图产品中心的全部原生选项（NMC、JMA、集系、相空间、风场、降水、分辨率和机构设置），没有独立的简化参数。已保存的选项与默认值在两处完全共用。</small>
          <button className="tn-entry-original-settings" type="button" onClick={()=>setOpenEditor(true)}>打开完整气象图产品参数抽屉 →</button>
          <small>进入抽屉后选择气象图产品并调整所有原有参数，关闭抽屉即保存；确认进入时会读取其最新设置。概率页固定生成袭击概率和经典八机构中心图，版式与正常产品完全相同。</small>
        </div>}
      </div>
      <div className="tn-entry-actions"><button type="button" onClick={onCancel}>取消</button><button type="button" className="tn-entry-confirm" onClick={()=>onConfirm(config,readNetworkChartSettingsFromProducts(precalculate))}>确认并进入台风网 →</button></div>
    </section>
    {openEditor&&<div className="tn-entry-product-drawer" role="region" aria-label="完整气象图产品参数">
      <ForecastImageModal isOpen={true} onClose={()=>setOpenEditor(false)} typhoon={storm} typhoons={[storm]}
        currentHour={currentHour} startDate={startDate} config={config} mobileMode={mobileMode} settingsOnly={true}
        onStartSynopticMapSelection={onStartSynopticMapSelection}/>
    </div>}
  </div>;
}
