import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, MapPin, Navigation, ShieldCheck, Wind } from "lucide-react";
import type { SimulationConfig, Typhoon } from "../types";
import { getAgencyIntensity } from "../simulation/Engine";

interface Props {
  typhoon: Typhoon;
  config: SimulationConfig;
  currentHour: number;
}

const EARTH_KM = 6371.0088;
const rad = (v:number) => v * Math.PI / 180;
const clamp = (v:number,a:number,b:number) => Math.max(a,Math.min(b,v));

function haversineKm(lat1:number,lon1:number,lat2:number,lon2:number){
  const dLat=rad(lat2-lat1), dLon=rad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return 2*EARTH_KM*Math.asin(Math.min(1,Math.sqrt(a)));
}

function meanRadius(q?: {ne:number;se:number;sw:number;nw:number}){
  if(!q) return 0;
  return Math.max(0,(Number(q.ne||0)+Number(q.se||0)+Number(q.sw||0)+Number(q.nw||0))/4);
}

/** Lightweight simulated impact estimate used by the always-on desktop advisory panel.
 * It deliberately avoids any satellite/raster rendering and does not represent an official warning.
 */
export default function AetherLocalAdvisory({typhoon,config,currentHour}:Props){
  const [collapsed,setCollapsed]=useState(false);
  const hasLocation=Number.isFinite(config.localAdvisoryLat)&&Number.isFinite(config.localAdvisoryLon);
  const info=useMemo(()=>{
    if(!hasLocation) return null;
    const lat=Number(config.localAdvisoryLat), lon=Number(config.localAdvisoryLon);
    const distance=haversineKm(lat,lon,typhoon.lat,typhoon.lon);
    const r34=Math.max(meanRadius(typhoon.r7), Number(typhoon.rmw||30)*2.4, 90);
    const r50=Math.max(meanRadius(typhoon.r10), Number(typhoon.rmw||30)*1.7, 50);
    const r64=Math.max(meanRadius(typhoon.r12), Number(typhoon.rmw||30)*1.25, 25);
    const rmw=Math.max(8,Number(typhoon.rmw||30));
    const x=Math.max(.1,distance/rmw);
    const coreShape=x<=1?Math.pow(x,.55):Math.exp(-.50*(x-1));
    const envelope=distance<=r64?1:distance<=r50?.82:distance<=r34?.58:Math.exp(-Math.max(0,distance-r34)/150)*.36;
    const localWind=Math.max(0,typhoon.vmax*Math.min(1.05,Math.max(coreShape*.92,envelope)));
    const gust=localWind*(1.22+0.08*clamp((typhoon.shear||0)/30,0,1));
    const pressure=1010-Math.max(0,1010-typhoon.pmin)*Math.exp(-Math.pow(distance/Math.max(35,rmw*4.0),1.28));
    const rainfall=Math.max(0,18*Math.exp(-distance/240)*(0.45+clamp((typhoon.deepConvectiveCoverage||.45),0,1))*(1+0.7*clamp((typhoon.shear||0)/30,0,1)));
    let level:"平稳"|"关注"|"警戒"|"严重"="平稳";
    if(localWind>=32.7||distance<r64) level="严重";
    else if(localWind>=24.5||distance<r50) level="警戒";
    else if(localWind>=17.2||distance<r34*1.15) level="关注";
    const assessed=getAgencyIntensity(localWind,config.intensityAgency||"CMA",config.intensityReportingMode||"public");
    return {lat,lon,distance,localWind,gust,pressure,rainfall,level,assessed};
  },[hasLocation,config.localAdvisoryLat,config.localAdvisoryLon,config.intensityAgency,config.intensityReportingMode,typhoon.lat,typhoon.lon,typhoon.vmax,typhoon.pmin,typhoon.rmw,typhoon.r7,typhoon.r10,typhoon.r12,typhoon.deepConvectiveCoverage,typhoon.shear]);

  const levelClass=info?.level==="严重"?"text-rose-300 border-rose-500/35 bg-rose-500/10":info?.level==="警戒"?"text-orange-300 border-orange-500/35 bg-orange-500/10":info?.level==="关注"?"text-amber-300 border-amber-500/30 bg-amber-500/10":"text-emerald-300 border-emerald-500/25 bg-emerald-500/10";
  return <div className="mb-3 rounded-xl border border-slate-700/55 bg-[#06101d]/85 overflow-hidden">
    <button type="button" onClick={()=>setCollapsed(v=>!v)} className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-900/55 transition">
      <div className="flex items-center gap-2 min-w-0"><MapPin className="w-4 h-4 text-cyan-300 shrink-0"/><div className="text-left min-w-0"><div className="text-[10px] font-extrabold tracking-[.15em] text-cyan-200">WMC 所在地模拟公告</div><div className="text-[9px] text-slate-500 truncate">{hasLocation?(config.localAdvisoryLabel||`${Number(config.localAdvisoryLat).toFixed(2)}°, ${Number(config.localAdvisoryLon).toFixed(2)}°`):"未设置 · 菜单 → 模拟 → 选择所在地"}</div></div></div>
      {collapsed?<ChevronDown className="w-4 h-4 text-slate-500"/>:<ChevronUp className="w-4 h-4 text-slate-500"/>}
    </button>
    {!collapsed&&<div className="px-3 pb-3 border-t border-slate-800/70 pt-2">
      {!info?<div className="rounded-lg border border-slate-800 bg-slate-950/55 px-3 py-2 text-[10px] leading-relaxed text-slate-400">尚未选择所在地。此面板不会调用卫星云图或高成本栅格计算；设置后将只根据当前模拟台风位置、风圈和强度给出轻量实时影响估计。</div>:<>
        <div className={`rounded-lg border px-2.5 py-2 flex items-center justify-between ${levelClass}`}><div className="flex items-center gap-2">{info.level==="平稳"?<ShieldCheck className="w-4 h-4"/>:<AlertTriangle className="w-4 h-4"/>}<span className="text-[11px] font-bold">{info.level} · 模拟影响</span></div><span className="text-[9px] font-mono">T+{Math.round(currentHour)}h</span></div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[9px]">
          <div className="rounded-lg bg-slate-950/55 border border-slate-800 px-2 py-1.5"><span className="text-slate-500">距中心</span><div className="font-mono text-slate-100 mt-0.5">{Math.round(info.distance)} km</div></div>
          <div className="rounded-lg bg-slate-950/55 border border-slate-800 px-2 py-1.5"><span className="text-slate-500">当地风速</span><div className="font-mono text-cyan-200 mt-0.5">{info.assessed.value} {info.assessed.unit}</div></div>
          <div className="rounded-lg bg-slate-950/55 border border-slate-800 px-2 py-1.5"><span className="text-slate-500">阵风估计</span><div className="font-mono text-slate-100 mt-0.5">{info.gust.toFixed(1)} m/s</div></div>
          <div className="rounded-lg bg-slate-950/55 border border-slate-800 px-2 py-1.5"><span className="text-slate-500">海平面气压</span><div className="font-mono text-slate-100 mt-0.5">{Math.round(info.pressure)} hPa</div></div>
        </div>
        <div className="mt-2 flex items-start gap-2 text-[9px] leading-relaxed text-slate-500"><Navigation className="w-3.5 h-3.5 shrink-0 mt-0.5"/><span>估计小时降水 {info.rainfall.toFixed(1)} mm/h。该信息只反映 WMC 当前模拟，不是现实气象部门公告。</span></div>
      </>}
    </div>}
  </div>;
}
