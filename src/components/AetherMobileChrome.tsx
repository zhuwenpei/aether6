import { Activity, HelpCircle, Images, Maximize2, MoreHorizontal, Settings, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SimulationConfig, Typhoon } from "../types";
import { getAgencyIntensity } from "../simulation/Engine";
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
  onStartForecastRoute: () => void;
  onClearForecastRoute: () => void;
  onForecastPeakChange: (value: number, enabled: boolean) => void;
  brandText?: string;
  sandboxMode?: boolean;
  /** Forecast only: pause as soon as the shortcuts/overflow menu opens. */
  onMoreOpen?: () => void;
  onClearPreSimulationReference?: () => void;
  onApplyCurrentSimulationToForecast?: () => void;
  onRealisticMotion?: () => void;
  onUndoRealisticMotion?: () => void;
  hasPreSimulationReference?: boolean;
}

/** Dedicated phone chrome. The More popover owns forecast-framework/environment drawing tools. */
export default function AetherMobileChrome({
  typhoon, currentHour, startDate, isPlaying, maxHour, config, soundEnabled,
  onProducts, onSettings, onHelp, onInfluence, onToggleSound, onFullscreen,
  onStartForecastRoute, onClearForecastRoute, onForecastPeakChange,brandText="WMC",sandboxMode=false,
  onClearPreSimulationReference,onApplyCurrentSimulationToForecast,onRealisticMotion,onUndoRealisticMotion,hasPreSimulationReference=false,onMoreOpen
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [peakDraft, setPeakDraft] = useState(config.forecastPeakIntensityReference ?? 70);
  useEffect(() => setPeakDraft(config.forecastPeakIntensityReference ?? 70), [config.forecastPeakIntensityReference]);

  const simDate = new Date(startDate.getTime() + currentHour * 3600000 + 8 * 3600000);
  const clock = `${String(simDate.getUTCHours()).padStart(2, "0")}:00`;
  const phase = typhoon ? getStormStatus(typhoon, isPlaying, !isPlaying && currentHour < maxHour - 1e-6) : "等待生成";
  const agency = (config.intensityAgency || config.agencyStyle || "CMA") as "CMA" | "JMA" | "JTWC";
  const intensity = typhoon ? getAgencyIntensity(typhoon.vmax, agency, config.intensityReportingMode || "public") : null;
  const run = (fn: () => void) => { setMoreOpen(false); fn(); };
  const commitPeak = (value = peakDraft) => onForecastPeakChange(Math.max(5, Math.min(110, value)), true);

  return <>
    <header className={`aether-mobile-header${moreOpen ? " aether-mobile-more-open" : ""}`} aria-label={sandboxMode?"Forecast 预模拟主控栏":"AETHER 手机主控栏"}>
      <div className="aether-mobile-brand" aria-label={brandText}><b>{brandText}</b></div>
      <div className="aether-mobile-header-actions">
        {!sandboxMode&&<button className="aether-landscape-tool-products" aria-label="气象产品" onClick={onProducts}><Images /></button>}
        <button className="aether-landscape-tool-shortcuts" aria-label="台风状态与影响" onClick={onInfluence}><Activity /></button>
        <button className="aether-landscape-tool-menu" aria-label="设置" onClick={onSettings}><Settings /></button>
        <button className="aether-landscape-tool-more" aria-label="更多" aria-expanded={moreOpen} onClick={() => {if(!moreOpen)onMoreOpen?.();setMoreOpen(v => !v);}}>{moreOpen ? <X /> : <MoreHorizontal />}</button>
      </div>
      {moreOpen && <div className="aether-mobile-overflow aether-mobile-tools-overflow" role="menu">
        {sandboxMode&&<section className="aether-more-tool-section">
          <div className="aether-more-tool-title"><b>预模拟快捷工具</b></div>
          <div className="aether-more-tool-actions">
            <button type="button" onClick={()=>run(onStartForecastRoute)}>画点控制</button>
            <button type="button" onClick={()=>run(onClearForecastRoute)}>清空画点</button>
          </div>
        </section>}
        {!sandboxMode&&<section className="aether-more-tool-section">
          <div className="aether-more-tool-title"><b>🗺️ 大体预报路径</b><span>{config.manualForecastRoute?.length || 0} 节点</span></div>
          <div className="aether-more-tool-actions">
            <button type="button" onClick={() => run(onStartForecastRoute)} disabled={!typhoon}>开始绘制</button>
            <button type="button" onClick={() => { onClearForecastRoute(); }} disabled={(config.manualForecastRoute?.length || 0) < 2}>清除</button>
          </div>
          {onApplyCurrentSimulationToForecast&&<div className="aether-more-tool-actions">
            <button type="button" onClick={()=>run(onApplyCurrentSimulationToForecast)} disabled={!typhoon || (typhoon.history?.length||0)<2}>
              将当前模拟数据应用到预报
            </button>
          </div>}
          {onClearPreSimulationReference&&<div className="aether-more-tool-actions">
            <button type="button" onClick={()=>run(onClearPreSimulationReference)} disabled={!hasPreSimulationReference}>
              清空预模拟预报
            </button>
          </div>}
        </section>}

        {!sandboxMode&&<section className="aether-more-tool-section">
          <div className="aether-more-tool-title"><b>真实化参数</b></div>
          <div className="aether-more-tool-actions">
            <button type="button" onClick={()=>onRealisticMotion&&run(onRealisticMotion)}
              disabled={!onRealisticMotion||!typhoon||((typhoon.history?.length||0)<7||(typhoon.history.at(-1)?.simHour??0)-(typhoon.history[0]?.simHour??0)<6)}
              title={!typhoon||(typhoon.history.length<7||(typhoon.history.at(-1)?.simHour??0)-(typhoon.history[0]?.simHour??0)<6)?'至少需要6小时历史':'气压、风速、移速等按三小时折线节点记录，路径节点小幅偏移'}>真实化参数</button>
            <button type="button" onClick={()=>onUndoRealisticMotion&&run(onUndoRealisticMotion)}
              disabled={!onUndoRealisticMotion||!typhoon?.realisticMotion}>撤销真实化参数</button>
          </div>
        </section>}
        {!sandboxMode&&<section className="aether-more-tool-section">
          <div className="aether-more-tool-title"><b>📈 预报最大强度</b><label><input type="checkbox" checked={!!config.forecastPeakIntensityEnabled} onChange={(e) => onForecastPeakChange(peakDraft, e.target.checked)} /> 启用</label></div>
          <div className="aether-more-slider-row">
            <input className="aether-menu-range" type="range" min={5} max={110} step={1} value={peakDraft}
              onChange={(e) => setPeakDraft(Number(e.target.value))}
              onPointerUp={(e) => commitPeak(Number(e.currentTarget.value))}
              onPointerCancel={() => setPeakDraft(config.forecastPeakIntensityReference ?? 70)}
              onBlur={(e) => { if (e.currentTarget === document.activeElement) return; commitPeak(Number(e.currentTarget.value)); }}
              onKeyUp={(e) => { if (["ArrowLeft","ArrowRight","Home","End","PageUp","PageDown"].includes(e.key)) commitPeak(Number(e.currentTarget.value)); }} />
            <span>{Math.round(peakDraft)} m/s</span>
          </div>
          <p>软约束未来预报，集合成员整体平移，不压窄原有离散。</p>
        </section>}

        <div className="aether-more-system-actions">
          <button role="menuitem" onClick={() => run(onHelp)}><HelpCircle /><span>帮助与指南</span></button>
          <button role="menuitem" onClick={() => run(onFullscreen)}><Maximize2 /><span>全屏显示</span></button>
          <button role="menuitem" onClick={() => run(onToggleSound)}>{soundEnabled ? <Volume2 /> : <VolumeX />}<span>{soundEnabled ? "关闭声音" : "开启声音"}</span></button>
        </div>
      </div>}
    </header>

    {typhoon && intensity && <section className="aether-mobile-statusrail" aria-label="当前台风状态">
      <div className="aether-landscape-status-title">当前台风信息</div>
      <div className="aether-landscape-storm-name">{typhoon.name || '未命名台风'}</div>
      <div className="aether-landscape-status-title">当前台风信息</div>
      <div className="aether-landscape-storm-name">{typhoon.name || '未命名台风'}</div>
      <div className="aether-landscape-status-title">当前台风信息</div>
      <div className="aether-landscape-storm-name">{typhoon.name || '未命名台风'}</div>
      <div className="aether-landscape-status-title">当前台风信息</div>
      <div className="aether-landscape-storm-name">{typhoon.name || '未命名台风'}</div>
      <span className="aether-mobile-status-time">{clock}</span><i />
      <span className="aether-mobile-status-phase">{phase}</span>
      <i /><strong>{intensity.category}</strong><span>{intensity.value}{intensity.unit.toUpperCase()}</span>
      <i /><span>{Math.round(typhoon.pmin)} hPa</span>
      <i /><span>{Math.round(typhoon.direction)}° · {Math.round(typhoon.speed)} km/h</span>
      <div className="aether-landscape-position">{Math.abs(typhoon.lat).toFixed(1)}°{typhoon.lat >= 0 ? 'N' : 'S'} · {Math.abs(typhoon.lon).toFixed(1)}°{typhoon.lon >= 0 ? 'E' : 'W'}</div>
    </section>}
  </>;
}
