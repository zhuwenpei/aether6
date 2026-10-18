/** R217: one issued NMC intensity solution is the ONLY authority for the
 * simulated Chinese forecast AND the network NMC reference image. The main
 * physical history and all normal weather-product settings stay untouched.
 */
import type {SimulationConfig,Typhoon,TyphoonCategory} from '../types';
import {materializeForecastPath} from '../simulation/Engine';
import {issuePreSimulationReference} from '../simulation/PreSimulationReference';
import {limitNmcGenesisPeak,shapeNmcPeakIntensity} from '../simulation/NmcIntensityGuidance';
import {selectNmcIssuedForecast} from './NmcForecastProduct';
import {sampleNetworkFix,NETWORK_FORECAST_STYLE,type NetworkFix,type NetworkForecast} from './TyphoonNetworkData';
import type {NetworkChartSettings} from '../components/NetworkEntrySettings';

type NmcFix=NetworkFix & {category:TyphoonCategory;landed?:boolean};
const category=(v:number,c?:string):TyphoonCategory=>(c||(
  v>=51?'超强台风':v>=41.5?'强台风':v>=32.7?'台风':v>=24.5?'强热带风暴':v>=17.2?'热带风暴':'热带低压')) as TyphoonCategory;
const isEarlyGenesis=(storm:Typhoon,issue:NetworkFix)=>{
  if(issue.vmax>=17.2||issue.dissipated)return false;
  const history=(storm.history||[]).filter(p=>p.simHour<=issue.simHour+1e-6);
  return !history.some(p=>p.vmax>=17.2)&&Number((issue as any).lowLevelVortexIntegrity??0.58)>0.18;
};
/** The same NMC-specific switches, forecast duration/termination, conservative
 * genesis mode and strict exact-peak logic as the ordinary NMC product.
 * Never independently retarget the Chinese forecast after this call. */
export function buildSharedNetworkNmcForecast(storm:Typhoon,publicIssue:NetworkFix,config:SimulationConfig,settings:NetworkChartSettings):{
  issue:NetworkFix; china:NetworkForecast; issuedEndHour:number
}{
  const history=(storm.history||[]).filter(p=>Number.isFinite(p.simHour)&&p.simHour<=publicIssue.simHour+1e-6);
  const issue=history.length?sampleNetworkFix(history,publicIssue.simHour):{...publicIssue};
  const seed={...storm,...issue,history,simHour:issue.simHour,forecastPath:[]} as Typhoon;
  const horizon=settings.forecastHours;
  // Identical materialisation intensity-policy switch to ForecastImageModal.
  let raw=materializeForecastPath(seed,config,horizon,undefined,false,
    {intensityPolicy:settings.nmcCoarseIntensity?'adaptive':'round164'});
  if(isEarlyGenesis(storm,issue)&&raw.every(p=>p.simHour<=1e-6)){
    raw=materializeForecastPath(seed,config,horizon,undefined,true,
      {intensityPolicy:settings.nmcCoarseIntensity?'adaptive':'round164'});
  }
  const current={...issue,category:category(issue.vmax,issue.category)} as NmcFix;
  const rawFixes:NmcFix[]=raw.filter(p=>p.simHour>0 && Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Number.isFinite(p.vmax))
    .map(p=>({...issue,...p,simHour:issue.simHour+p.simHour,category:category(p.vmax,p.category)}))
    .sort((a,b)=>a.simHour-b.simHour);
  const issued=selectNmcIssuedForecast(current,rawFixes,issue.simHour,horizon);
  const end=issued.at(-1)?.simHour??issue.simHour;
  const maxLead=Math.max(0,end-issue.simHour);
  let limited=rawFixes.filter(p=>p.simHour<=end+1e-6);
  if(maxLead>1e-6 && !limited.some(p=>Math.abs(p.simHour-end)<1e-5)){
    const previous=[current,...rawFixes].filter(p=>p.simHour<end).at(-1);
    const next=rawFixes.find(p=>p.simHour>end);
    if(previous&&next){
      const t=(end-previous.simHour)/(next.simHour-previous.simHour);
      const endFix=issued.at(-1)!;
      limited=[...limited,{...next,simHour:end,lat:endFix.lat,lon:endFix.lon,
        vmax:previous.vmax+(next.vmax-previous.vmax)*t,
        pmin:previous.pmin+(next.pmin-previous.pmin)*t,
        category:category(endFix.vmax,endFix.category)}];
    }
  }
  const genesisAgeHours=history.length?Math.max(0,issue.simHour-history[0].simHour):Infinity;
  const manualIntensity=!!config.manualForecastRouteEnabled&&!!config.manualForecastIntensityEnabled
    &&!!config.manualForecastIntensityCurve?.length;
  const mainHistoryVerified=issuePreSimulationReference(storm,issue.simHour)?.origin==='main-history';
  if(settings.nmcCoarseIntensity&&!manualIntensity&&!mainHistoryVerified){
    // Guidance works on LEAD-relative 3h nodes (as in the ordinary NMC editor).
    limited=limitNmcGenesisPeak(limited.map(p=>({...p,simHour:p.simHour-issue.simHour})),genesisAgeHours,issue.vmax)
      .map(p=>({...p,simHour:p.simHour+issue.simHour}));
  }
  if(settings.nmcCustomPeakEnabled){
    limited=shapeNmcPeakIntensity(limited.map(p=>({...p,simHour:p.simHour-issue.simHour})),
      Math.max(Math.ceil(issue.vmax),Math.round(settings.nmcCustomPeak)),issue.vmax)
      .map(p=>({...p,simHour:p.simHour+issue.simHour}));
  }
  return {issue,issuedEndHour:end,china:{agency:'中国',color:NETWORK_FORECAST_STYLE[0].color,fixes:limited}};
}
