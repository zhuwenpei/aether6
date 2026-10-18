/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from "react";
import { Play, Pause, SkipBack, SkipForward, RotateCcw, ChevronUp, ChevronDown, Calendar, OctagonX, Images, PanelBottomOpen, Activity, Clock3, Compass } from "lucide-react";

interface TimelineProps {
  currentHour: number;
  maxHour: number;
  isPlaying: boolean;
  onPlayToggle: () => void;
  onTerminate: () => void;
  isTerminationReport?: boolean;
  onOpenForecast?: () => void;
  onOpenInfluence?: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onReset: () => void;
  onSeek: (hour: number, mode?: "preview" | "commit") => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  startDate: Date;
  onStartDateChange?: (newDate: Date) => void;
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

export default function Timeline({
  currentHour,
  maxHour,
  isPlaying,
  onPlayToggle,
  onTerminate,
  isTerminationReport = false,
  onOpenForecast,
  onOpenInfluence,
  onStepForward,
  onStepBackward,
  onReset,
  onSeek,
  speed,
  onSpeedChange,
  startDate,
  onStartDateChange,
  collapsed,
  onCollapseChange
}: TimelineProps) {
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const isCollapsed = collapsed !== undefined ? collapsed : localCollapsed;
  const setIsCollapsed = (val: boolean) => {
    if (onCollapseChange) {
      onCollapseChange(val);
    } else {
      setLocalCollapsed(val);
    }
  };

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [clockDraftDate, setClockDraftDate] = useState("");
  const [clockDraftHour, setClockDraftHour] = useState("00");

  // 3.3.2 timeline scrubbing: keep the thumb fully local and only restore the expensive
  // typhoon/map snapshot at a bounded rate. The old range handler restored the entire state,
  // rebuilt Leaflet layers, played audio and created a toast for every pointer event. Event
  // queues became especially visible when the pointer reversed direction.
  const [seekPreviewHour, setSeekPreviewHour] = useState(currentHour);
  const pendingSeekHourRef = useRef(currentHour);
  const seekRafRef = useRef<number | null>(null);
  const lastSeekDispatchRef = useRef(0);
  const scrubbingRef = useRef(false);

  useEffect(() => {
    if (!scrubbingRef.current) {
      setSeekPreviewHour(currentHour);
      pendingSeekHourRef.current = currentHour;
    }
  }, [currentHour]);

  useEffect(() => () => {
    if (seekRafRef.current !== null) cancelAnimationFrame(seekRafRef.current);
    document.documentElement.classList.remove("aether-timeline-scrubbing");
  }, []);

  const queueSeekPreview = (hour: number) => {
    pendingSeekHourRef.current = hour;
    if (seekRafRef.current !== null) return;
    const pump = (now: number) => {
      // Coalesce pointer events into paint-aligned preview restores.  A ~24 fps ceiling is much
      // smoother than the old 80 ms timeout while still leaving enough main-thread budget for the
      // Leaflet layer swap.  Crucially, no timeout queue can pile up when the thumb changes direction.
      if (now - lastSeekDispatchRef.current >= 42) {
        lastSeekDispatchRef.current = now;
        seekRafRef.current = null;
        onSeek(pendingSeekHourRef.current, "preview");
      } else {
        seekRafRef.current = requestAnimationFrame(pump);
      }
    };
    seekRafRef.current = requestAnimationFrame(pump);
  };

  const handleSeekInput = (hour: number) => {
    scrubbingRef.current = true;
    document.documentElement.classList.add("aether-timeline-scrubbing");
    setSeekPreviewHour(hour);
    queueSeekPreview(hour);
  };

  const commitSeek = () => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    document.documentElement.classList.remove("aether-timeline-scrubbing");
    if (seekRafRef.current !== null) {
      cancelAnimationFrame(seekRafRef.current);
      seekRafRef.current = null;
    }
    const hour = pendingSeekHourRef.current;
    setSeekPreviewHour(hour);
    onSeek(hour, "commit");
  };

  const handlePlayPauseClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onPlayToggle();
  };

  // Format current simulation date based on elapsed hours
  const getSimulatedDateString = (elapsedHours: number) => {
    const timeMs = startDate.getTime() + elapsedHours * 60 * 60 * 1000;
    const currentSimTime = new Date(timeMs);
    const mm = String(currentSimTime.getMonth() + 1).padStart(2, "0");
    const dd = String(currentSimTime.getDate()).padStart(2, "0");
    const hh = String(currentSimTime.getHours()).padStart(2, "0");
    return `${currentSimTime.getFullYear()}-${mm}-${dd} ${hh}:00`;
  };

  const getCurrentStateDate = () => new Date(startDate.getTime() + currentHour * 3600000);

  const openClockEditor = () => {
    const d = getCurrentStateDate();
    setClockDraftDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    setClockDraftHour(String(d.getHours()).padStart(2, "0"));
    setShowDatePicker(true);
  };

  const applyClockEditor = () => {
    if (!clockDraftDate) return;
    const d = new Date(`${clockDraftDate}T${clockDraftHour}:00:00`);
    if (!Number.isNaN(d.getTime())) onStartDateChange?.(d);
    setShowDatePicker(false);
  };

  if (isCollapsed) {
    const simDate = new Date(startDate.getTime() + seekPreviewHour * 3600000);
    const month = simDate.toLocaleString("en-US", { month: "short" }).toUpperCase();
    return (
      <div id="simulation-timeline-collapsed" className="storminc-dock">
        <button id="btn-reset-simulation-collapsed" onClick={onReset} className="storminc-restart" title="重新开始">
          <RotateCcw className="w-4 h-4"/><span>RESTART</span>
        </button>
        <span className="storminc-divider" />
        <button className="storminc-chip" title="海盆">WPAC</button>
        <button className="storminc-chip" title="月份">{month}</button>
        <span className="storminc-divider" />
        <button id="btn-play-pause-collapsed" onClick={onPlayToggle} className={`storminc-icon ${isPlaying ? "active" : ""}`} title={isPlaying ? "暂停" : "继续"}>{isPlaying ? <Pause className="w-4 h-4 fill-current"/> : <Play className="w-4 h-4 fill-current"/>}</button>
        <button className="storminc-icon" onClick={onStepBackward} disabled={currentHour===0} title="上一个时次（[ / 手柄 LB）"><SkipBack className="w-4 h-4"/></button>
        <button className="storminc-icon" onClick={onStepForward} title="下一个时次（] / 手柄 RB）"><SkipForward className="w-4 h-4"/></button>
        <button id="btn-more-options" className="storminc-icon cyan" onClick={onOpenForecast} disabled={!onOpenForecast} title="AETHER 气象产品（P / 手柄 X）"><Images className="w-4 h-4"/></button>
        <button className="storminc-icon" onClick={onOpenInfluence} disabled={!onOpenInfluence} title="台风状态 / 强制影响（O / 手柄 B）"><Activity className="w-4 h-4"/></button>
        <button className="storminc-icon" onClick={() => setIsCollapsed(false)} title="展开详细时间轴（T / 手柄 Start）"><PanelBottomOpen className="w-4 h-4"/></button>
        <button className="storminc-icon" onClick={() => setIsCollapsed(false)} title={getSimulatedDateString(seekPreviewHour)}><Clock3 className="w-4 h-4"/></button>
        <span className="storminc-divider" />
        <button id="btn-terminate-collapsed" onClick={onTerminate} className="storminc-terminate" title={isTerminationReport ? "打开台风报告" : "停编 / 终止"}>{isTerminationReport ? <Images className="w-4 h-4"/> : <OctagonX className="w-4 h-4"/>}<span>{isTerminationReport ? "报告" : "停编"}</span></button>
      </div>
    );
  }

  return (
    <div
      id="simulation-timeline"
      className="storminc-timeline-expanded fixed left-1/2 -translate-x-1/2 bottom-3 w-[min(1040px,calc(100vw-24px))] z-[1600] rounded-2xl bg-[#050a11]/96 border border-slate-700/45 p-3 sm:p-4 shadow-2xl backdrop-blur-md text-white select-none transition-all duration-200 flex flex-col md:flex-row items-stretch md:items-center gap-3"
      style={{
        marginBottom: "env(safe-area-inset-bottom, 0px)"
      }}
    >
      {/* 1. Date details / clock */}
      <div className="flex flex-col justify-center min-w-[145px] border-r border-slate-800/80 pr-3 relative">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-slate-500 uppercase tracking-widest">模拟时间 (UTC+8)</span>
          <button
            onClick={() => showDatePicker ? setShowDatePicker(false) : openClockEditor()}
            className="p-0.5 rounded text-slate-400 hover:text-[#1E9CFF] transition cursor-pointer"
            title="修改当前模拟状态的日期与小时"
          >
            <Calendar className="w-3 h-3" />
          </button>
        </div>

        {showDatePicker ? (
          <div className="absolute left-0 top-8 z-20 min-w-[230px] rounded-lg border border-[#1E9CFF]/55 bg-slate-950 p-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 text-[10px] text-slate-400">修改当前模拟状态时间</div>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={clockDraftDate}
                onChange={(e) => setClockDraftDate(e.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs font-mono text-[#1E9CFF] focus:border-[#1E9CFF] focus:outline-none"
              />
              <select
                aria-label="小时"
                value={clockDraftHour}
                onChange={(e) => setClockDraftHour(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs font-mono text-[#1E9CFF] focus:border-[#1E9CFF] focus:outline-none"
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={String(hour).padStart(2, "0")}>{String(hour).padStart(2, "0")}时</option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex justify-end gap-1.5">
              <button type="button" onClick={() => setShowDatePicker(false)} className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-400 hover:text-white">取消</button>
              <button type="button" onClick={applyClockEditor} className="rounded border border-[#1E9CFF]/60 bg-[#1E9CFF]/15 px-2 py-1 text-[10px] font-bold text-[#1E9CFF]">应用</button>
            </div>
          </div>
        ) : (
          <button
            onClick={openClockEditor}
            className="text-left group text-sm font-bold font-mono text-[#1E9CFF] mt-0.5 whitespace-nowrap hover:underline flex items-center gap-1 cursor-pointer"
            title="点击修改当前模拟状态的日期与小时"
          >
            {getSimulatedDateString(seekPreviewHour)}
          </button>
        )}

        <span className="text-[10px] text-slate-400 mt-0.5">
          累计时长: <strong className="font-mono">{maxHour}</strong> 小时
        </span>
      </div>

      {/* 2. Interactive Seeker & Ticks */}
      <div className="flex-1 flex flex-col justify-center px-1">
        <div className="relative flex items-center mb-1">
          <input
            id="timeline-slider"
            type="range"
            min={0}
            max={Math.max(1, maxHour)}
            value={seekPreviewHour}
            onPointerDown={() => { scrubbingRef.current = true; document.documentElement.classList.add("aether-timeline-scrubbing"); }}
            onChange={(e) => handleSeekInput(Number(e.target.value))}
            onPointerUp={commitSeek}
            onPointerCancel={commitSeek}
            onKeyUp={commitSeek}
            onBlur={commitSeek}
            className="w-full h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-[#1E9CFF] focus:outline-none"
            style={{
              background: `linear-gradient(to right, #1E9CFF ${
                (seekPreviewHour / Math.max(1, maxHour)) * 100
              }%, #0f1c2d ${(seekPreviewHour / Math.max(1, maxHour)) * 100}%)`
            }}
          />
        </div>

        {/* Hour markers/ticks */}
        <div className="flex justify-between text-[8px] text-slate-500 font-mono px-0.5">
          {[0, .2, .4, .6, .8, 1].map((fraction) => (
            <span key={fraction}>{Math.round(Math.max(1, maxHour) * fraction)}h</span>
          ))}
        </div>
      </div>

      {/* 3. Transport Controls */}
      <div className="flex items-center justify-between sm:justify-start gap-1.5 sm:gap-2 border-t md:border-t-0 md:border-l border-slate-800/80 pt-2.5 md:pt-0 md:pl-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            id="btn-step-backward"
            onClick={onStepBackward}
            disabled={currentHour === 0}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700 disabled:opacity-20 disabled:hover:bg-transparent transition cursor-pointer"
            title="切换到上一个时间点"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          <button
            id="btn-play-pause"
            onClick={handlePlayPauseClick}
            className={`p-2 rounded-xl border transition cursor-pointer ${
              isPlaying
                ? "bg-[#1E9CFF]/15 border-[#1E9CFF]/50 text-[#1E9CFF] hover:bg-[#1E9CFF]/25 animate-pulse"
                : "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-200"
            }`}
            title={isPlaying ? "暂停模拟" : "继续模拟"}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          </button>

          <button
            id="btn-step-forward"
            onClick={onStepForward}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700 transition cursor-pointer"
            title="切换到下一个时间点"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <button
            id="btn-terminate-simulation"
            onClick={onTerminate}
            className="p-1.5 rounded-lg hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 border border-rose-900/40 hover:border-rose-700/60 transition cursor-pointer"
            title={isTerminationReport ? "打开台风报告" : "终止 / 停编"}
          >
            {isTerminationReport ? <Images className="w-3.5 h-3.5" /> : <OctagonX className="w-3.5 h-3.5" />}
          </button>

          {!isPlaying && onOpenForecast && (
            <button
              id="btn-more-options"
              onClick={onOpenForecast}
              className="p-1.5 rounded-lg hover:bg-cyan-950/40 text-emerald-400 hover:text-emerald-300 border border-cyan-800/40 hover:border-cyan-600/60 transition cursor-pointer"
              title="生成及调整模拟预报图"
            >
              <Compass className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            id="btn-reset-simulation"
            onClick={onReset}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-red-400 border border-slate-800 hover:border-red-900/30 transition cursor-pointer"
            title="重置模拟"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Speed Selector */}
        <div className="flex items-center gap-1 bg-slate-900/80 border border-slate-800 rounded-lg p-0.5">
          <select
            id="playback-speed-select"
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="bg-transparent text-[10px] font-mono text-slate-300 font-semibold focus:outline-none px-1.5 py-1 cursor-pointer"
            title={`模拟速度：每真实秒推进 ${speed} 模拟小时`}
          >
            {PLAYBACK_SPEEDS.map((sp) => (
              <option key={sp} value={sp} className="bg-[#08121f] text-slate-300 text-xs">
                {sp} h/s
              </option>
            ))}
          </select>
        </div>

        {/* Collapse Button */}
        <button
          id="btn-collapse-timeline"
          onClick={() => setIsCollapsed(true)}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700 transition cursor-pointer ml-1"
          title="收起时间面板"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
