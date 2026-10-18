import { Activity, HelpCircle, Images, Maximize2, MoreHorizontal, Settings, Volume2, VolumeX, X } from "lucide-react";
import { useState } from "react";
import type { SimulationConfig, Typhoon } from "../types";
import { getAgencyIntensity } from "../simulation/Engine";
import { aceOf } from "../utils/TyphoonReportMetrics";
import { getStormStatus } from "../utils/StormStatus";

interface Props {
  typhoon: Typhoon | null;
  currentHour: number;
  startDate: Date;
  isPlaying: boolean;
  maxHour: number;
  config: SimulationConfig;
  soundEnabled: boolean;
  onProducts: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onInfluence: () => void;
  onToggleSound: () => void;
  onFullscreen: () => void;
  brandText?: string;
  sandboxMode?: boolean;
  /** Forecast only: pause as soon as the shortcuts/overflow menu opens. */
  onMoreOpen?: () => void;
  onApplyCurrentSimulationToForecast?: () => void;
  onRealisticMotion?: () => void;
  onUndoRealisticMotion?: () => void;
}

export default function AetherDesktopChrome({ typhoon, currentHour, startDate, isPlaying, maxHour, config, soundEnabled, onProducts, onSettings, onHelp, onInfluence, onToggleSound, onFullscreen,brandText="WMC",sandboxMode=false,onMoreOpen,onApplyCurrentSimulationToForecast,onRealisticMotion,onUndoRealisticMotion }: Props) {
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const ace = typhoon ? aceOf(typhoon) : 0;
  // Absolute simulated local clock time; use the same UTC+8 convention as Timeline.
  const simDate = new Date(startDate.getTime() + currentHour * 3600000 + 8 * 3600000);
  const clock = `${String(simDate.getUTCHours()).padStart(2, "0")}:00`;
  const phase = typhoon ? getStormStatus(typhoon, isPlaying, !isPlaying && currentHour < maxHour - 1e-6) : "";
  const agency = (config.intensityAgency || config.agencyStyle || "CMA") as "CMA" | "JMA" | "JTWC";
  const intensity = typhoon ? getAgencyIntensity(typhoon.vmax, agency, config.intensityReportingMode || "public") : null;
  const runAndClose = (action: () => void) => { setMobileMoreOpen(false); action(); };
  return <>
    <header className="storminc-topbar pointer-events-none">
      <div className="storminc-brand"><b>{brandText}</b><span>TYPHOON SIMULATION SYSTEM</span></div>
      {typhoon && intensity && <div className="storminc-live-pill"><span title="模拟时间（UTC+8）">{clock}</span><i /><span className="storminc-phase" title="结构与连续强度趋势">{phase}</span><i /> <strong>{intensity.category} · {intensity.value}{intensity.unit.toUpperCase()}</strong><i /><span>{Math.round(typhoon.pmin)}hPa</span><i /><span>{Math.round(typhoon.direction)}° / {Math.round(typhoon.speed / 1.852)}KT</span></div>}

      <div className="storminc-top-actions storminc-top-actions-desktop pointer-events-auto">
        {!sandboxMode&&<button title="气象产品（P / 手柄 X）" onClick={onProducts}><Images /></button>}
        <button title="台风状态 / 强制影响（O / 手柄 B）" onClick={onInfluence}><Activity /></button>
        <button title="帮助" onClick={onHelp}><HelpCircle /></button>
        <button title="全屏" onClick={onFullscreen}><Maximize2 /></button>
        <button title={soundEnabled ? "关闭声音" : "开启声音"} onClick={onToggleSound}>{soundEnabled ? <Volume2 /> : <VolumeX />}</button>
        <button title="设置" onClick={onSettings}><Settings /></button>
        {!sandboxMode&&<button aria-label={mobileMoreOpen?'关闭更多操作':'更多操作'} title="更多操作" onClick={()=>{if(!mobileMoreOpen)onMoreOpen?.();setMobileMoreOpen(v=>!v);}}><MoreHorizontal /></button>}
      </div>

      {!sandboxMode&&mobileMoreOpen&&<div className="aether-realistic-desktop-menu pointer-events-auto" role="menu" aria-label="更多操作" style={{position:'fixed',right:16,top:60,zIndex:1100}}>
        <div className="px-3 py-1 text-xs font-semibold text-sky-200">真实化参数</div>
        <button role="menuitem" disabled={!typhoon||(typhoon.history.length<7||(typhoon.history.at(-1)?.simHour??0)-(typhoon.history[0]?.simHour??0)<6)} onClick={()=>onRealisticMotion&&runAndClose(onRealisticMotion)}>真实化参数</button>
        <button role="menuitem" disabled={!typhoon?.realisticMotion} onClick={()=>onUndoRealisticMotion&&runAndClose(onUndoRealisticMotion)}>撤销真实化参数</button>
      </div>}
      {/* Phone chrome keeps only the three high-frequency actions in the thumb zone. Less common
          actions live in one touch-sized overflow sheet instead of shrinking six icons into the top bar. */}
      <div className="storminc-mobile-actions pointer-events-auto">
        {!sandboxMode&&<button aria-label="气象产品" title="气象产品" onClick={onProducts}><Images /></button>}
        <button aria-label="台风状态与影响" title="台风状态与影响" onClick={onInfluence}><Activity /></button>
        <button aria-label="设置" title="设置" onClick={onSettings}><Settings /></button>
        <button aria-label={mobileMoreOpen ? "关闭更多操作" : "更多操作"} title="更多操作" onClick={() => {if(!mobileMoreOpen)onMoreOpen?.();setMobileMoreOpen(v => !v);}}>{mobileMoreOpen ? <X /> : <MoreHorizontal />}</button>
        {mobileMoreOpen && <div className="storminc-mobile-more-menu" role="menu" aria-label="更多操作">
          {!sandboxMode&&onApplyCurrentSimulationToForecast&&<button role="menuitem"
            onClick={()=>runAndClose(onApplyCurrentSimulationToForecast)}>
            将当前模拟数据应用到预报
          </button>}
          {!sandboxMode&&<div className="px-3 py-1 text-xs font-semibold text-sky-200">真实化参数</div>}
          {!sandboxMode&&<button role="menuitem" onClick={()=>onRealisticMotion&&runAndClose(onRealisticMotion)}
            disabled={!onRealisticMotion||!typhoon||((typhoon.history?.length||0)<7||(typhoon.history.at(-1)?.simHour??0)-(typhoon.history[0]?.simHour??0)<6)}>真实化参数</button>}
          {!sandboxMode&&<button role="menuitem" onClick={()=>onUndoRealisticMotion&&runAndClose(onUndoRealisticMotion)}
            disabled={!onUndoRealisticMotion||!typhoon?.realisticMotion}>撤销真实化参数</button>}
          <button role="menuitem" onClick={() => runAndClose(onHelp)}><HelpCircle /><span>帮助 / 使用指南</span></button>
          <button role="menuitem" onClick={() => runAndClose(onFullscreen)}><Maximize2 /><span>全屏显示</span></button>
          <button role="menuitem" onClick={() => runAndClose(onToggleSound)}>{soundEnabled ? <Volume2 /> : <VolumeX />}<span>{soundEnabled ? "关闭声音" : "开启声音"}</span></button>
        </div>}
      </div>
    </header>
    {typhoon && <div className="storminc-ace-chip pointer-events-none"><span>ACE</span><b>{ace.toFixed(2)}</b></div>}
  </>;
}
