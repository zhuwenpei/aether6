import { loadAgencyBranding } from "../utils/AgencyBranding";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Film, RefreshCw, Wind, X } from "lucide-react";
import type { SimulationConfig, Typhoon } from "../types";
import { DEFAULT_CONFIG } from "../config/DefaultSettings";
import { loadProductNaturalEarthData } from "../simulation/NaturalEarthLoader";
import { getTyphoonDisplayName } from "../utils/TyphoonDisplayName";
import { createSynopticWindPressureRenderCache, drawSynopticWindPressureMap, type SynopticWindPressureStyle } from "../utils/SynopticWindPressureMap";
import { generateSynopticWindPressureRecordVideo } from "../utils/SynopticWindPressureRecordVideo";
import type { SynopticVideoResolution } from "../utils/SynopticWindPressureVideo";
import { synopticProductLayout, type SynopticProductAspect, type SynopticProductStyle } from "../utils/SynopticProductLayout";
import { drawSynopticRecordMapPreview } from "../utils/SynopticRecordMapPreview";

interface Props {
  typhoon: Typhoon;
  startDate: Date;
  onSwitchStandard: () => void;
  onClose: () => void;
  onStartMapSelection?: (style:SynopticProductStyle,aspect:SynopticProductAspect)=>void;
}

interface RecordVideoSettings {
  videoMode: "follow" | "fixed";
  aspectRatio: SynopticProductAspect;
  fixedBoundsConfirmed: boolean;
  quality: "standard" | "high" | "ultra";
  clipStartHour?: number;
  clipEndHour?: number;
  resolution: SynopticVideoResolution;
  fps: number;
  durationSec: number;
  pngFrameCount: number;
  domainMode: "reference" | "follow_storm" | "custom";
  mapZoom: number;
  gridResolutionDeg: 0.1 | 0.125 | 0.25 | 0.5;
  showContours: boolean;
  contourIntervalHpa: number;
  showTrackOverlay: boolean;
  modelLabel: string;
  stylePreset: SynopticWindPressureStyle;
  roundedClearEye: boolean;
  customBounds: { lonMin: number; lonMax: number; latMin: number; latMax: number };
}

const STORAGE_KEY = "typhoon_synoptic_record_video_v1";
const DEFAULT_SETTINGS: RecordVideoSettings = {
  videoMode: "follow",
  aspectRatio: "default",
  fixedBoundsConfirmed: false,
  quality: "standard",
  resolution: "1080p",
  fps: 24,
  durationSec: 12,
  pngFrameCount: 120,
  domainMode: "follow_storm",
  mapZoom: 1,
  gridResolutionDeg: 0.25,
  showContours: true,
  contourIntervalHpa: 4,
  showTrackOverlay: true,
  modelLabel: "WMC RECORD",
  stylePreset: "default",
  roundedClearEye: false,
  customBounds: { lonMin: 105, lonMax: 145, latMin: 5, latMax: 40 }
};

function loadSettings(): RecordVideoSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {...DEFAULT_SETTINGS,modelLabel:`${loadAgencyBranding('synoptic_video').agencyCode} RECORD`};
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed, customBounds: { ...DEFAULT_SETTINGS.customBounds, ...(parsed?.customBounds || {}) } };
  } catch {
    return {...DEFAULT_SETTINGS,modelLabel:`${loadAgencyBranding('synoptic_video').agencyCode} RECORD`};
  }
}

function simulationConfig(typhoon: Typhoon): SimulationConfig {
  let saved: Partial<SimulationConfig> = {};
  try { saved = JSON.parse(localStorage.getItem("typhoon_sim_config") || "{}"); } catch {}
  return { ...DEFAULT_CONFIG, ...saved, ...((typhoon as any).configSnapshot || {}) } as SimulationConfig;
}

function fmt(startDate: Date, hour: number) {
  const d = new Date(startDate.getTime() + hour * 3600_000);
  return d.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function SynopticWindPressureRecordVideoPanel({ typhoon, startDate, onSwitchStandard, onClose, onStartMapSelection }: Props) {
  const config = useMemo(() => simulationConfig(typhoon), [typhoon]);
  const history = useMemo(() => (typhoon.history || []).slice().sort((a, b) => a.simHour - b.simHour), [typhoon.history]);
  const minHour = history[0]?.simHour ?? 0;
  const maxHour = history[history.length - 1]?.simHour ?? Number(typhoon.simHour || minHour);
  const [settings, setSettings] = useState<RecordVideoSettings>(loadSettings);
  const [previewHour, setPreviewHour] = useState(() => minHour + (maxHour - minHour) * 0.5);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ p: 0, frame: 0, total: 0, status: "" });
  const [error, setError] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [generatedMime, setGeneratedMime] = useState("video/mp4");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const replayCanvasRef=useRef<HTMLCanvasElement | null>(null);
  const [activeRangeHandle,setActiveRangeHandle]=useState<"start"|"end">("start");
  const fixedMode = settings.videoMode === "fixed";
  const clipStart = Math.max(minHour,Math.min(maxHour-0.5,settings.clipStartHour ?? minHour));
  const clipEnd = Math.max(clipStart+0.5,Math.min(maxHour,settings.clipEndHour ?? maxHour));
  const selectedAspect = synopticProductLayout(settings.stylePreset,settings.aspectRatio).mapAspect;
  const fixedBoundsValid = settings.fixedBoundsConfirmed &&
    [settings.customBounds.lonMin,settings.customBounds.lonMax,settings.customBounds.latMin,settings.customBounds.latMax].every(Number.isFinite) &&
    settings.customBounds.lonMin < settings.customBounds.lonMax && settings.customBounds.latMin < settings.customBounds.latMax;

  const previewRenderCache = useRef(createSynopticWindPressureRenderCache());
  const previewSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const displayName = getTyphoonDisplayName(typhoon, maxHour, startDate);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (generatedUrl) URL.revokeObjectURL(generatedUrl);
  }, [generatedUrl]);

  const patch = <K extends keyof RecordVideoSettings>(key: K, value: RecordVideoSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(()=>{
    if(fixedMode && (previewHour < clipStart || previewHour > clipEnd)) setPreviewHour(clipStart);
  },[fixedMode,previewHour,clipStart,clipEnd]);

  const renderPreview = async () => {
    if (settings.videoMode === "fixed") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const seq = ++previewSeq.current;
    setPreviewBusy(true);
    setError(null);
    try {
      await loadProductNaturalEarthData();
      if (seq !== previewSeq.current) return;
      await drawSynopticWindPressureMap({
        canvas,
        typhoons: [typhoon],
        primaryTyphoon: typhoon,
        initHour: previewHour,
        validHour: previewHour,
        startDate,
        config,
        modelLabel: settings.modelLabel,
        stylePreset: settings.stylePreset,
        roundedClearEye: settings.roundedClearEye === true,
        domainMode: settings.domainMode,
        customBounds: settings.domainMode === "custom" ? settings.customBounds : undefined,
        contourIntervalHpa: settings.contourIntervalHpa,
        showContours: settings.showContours,
        gridResolutionDeg: Math.max(0.25, settings.gridResolutionDeg) as 0.25 | 0.5,
        mapZoom: settings.mapZoom,
        outputWidth: 900,
        showTrackOverlay: settings.showTrackOverlay,
        timePresentation: "record",
        renderCache: previewRenderCache.current
      });
    } catch (e: any) {
      if (seq === previewSeq.current) setError(e?.message || "气压风场预览生成失败");
    } finally {
      if (seq === previewSeq.current) setPreviewBusy(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => { void renderPreview(); }, 220);
    return () => clearTimeout(timer);
  }, [settings.videoMode, previewHour, settings.domainMode, settings.mapZoom, settings.gridResolutionDeg, settings.showContours, settings.contourIntervalHpa, settings.showTrackOverlay, settings.modelLabel, settings.stylePreset, settings.roundedClearEye, settings.customBounds, typhoon]);

  // Unlike the full wind product, the archived replay preview never advances the physics.
  useEffect(()=>{
    if(!fixedMode || !fixedBoundsValid || !replayCanvasRef.current)return;
    let cancelled=false;
    const timer=window.setTimeout(()=>{
      void loadProductNaturalEarthData().then(()=>{
        if(cancelled||!replayCanvasRef.current)return;
        const width=620,height=Math.max(180,Math.round(width/selectedAspect));
        drawSynopticRecordMapPreview(replayCanvasRef.current,typhoon,settings.customBounds,previewHour,width,height);
      }).catch(()=>{});
    },100);
    return ()=>{cancelled=true;window.clearTimeout(timer);};
  },[fixedMode,fixedBoundsValid,typhoon,previewHour,selectedAspect,settings.customBounds]);

  const selectFixedMapArea=()=>{
    if(!onStartMapSelection)return;
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(settings));}catch{}
    onStartMapSelection(settings.stylePreset,settings.aspectRatio);
  };
  const changeClipStart=(value:number)=>{
    const next=Math.min(clipEnd-0.5,Math.max(minHour,value));
    patch('clipStartHour',next);setActiveRangeHandle('start');setPreviewHour(next);
  };
  const changeClipEnd=(value:number)=>{
    const next=Math.max(clipStart+0.5,Math.min(maxHour,value));
    patch('clipEndHour',next);setActiveRangeHandle('end');setPreviewHour(next);
  };

  const startRender = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if(fixedMode && !fixedBoundsValid){setError('请先返回模拟地图确认固定位置选区');return;}
    setBusy(true);
    setError(null);
    setProgress({ p: 0, frame: 0, total: settings.pngFrameCount, status: fixedMode ? "准备固定选区历史片段" : "准备全生命周期 PNG 序列" });
    try {
      await loadProductNaturalEarthData();
      const blob = await generateSynopticWindPressureRecordVideo({
        typhoon,
        startDate,
        config,
        modelLabel: settings.modelLabel,
        stylePreset: settings.stylePreset,
        roundedClearEye: settings.roundedClearEye === true,
        videoMode: settings.videoMode,
        aspectRatio: settings.aspectRatio,
        startHour: clipStart,
        endHour: clipEnd,
        quality: fixedMode ? settings.quality : "standard",
        domainMode: fixedMode ? "custom" : settings.domainMode,
        customBounds: fixedMode ? settings.customBounds : settings.domainMode === "custom" ? settings.customBounds : undefined,
        contourIntervalHpa: settings.contourIntervalHpa,
        showContours: settings.showContours,
        gridResolutionDeg: settings.gridResolutionDeg,
        mapZoom: fixedMode ? 1 : settings.mapZoom,
        showTrackOverlay: settings.showTrackOverlay,
        resolution: settings.resolution,
        fps: settings.fps,
        durationSec: settings.durationSec,
        pngFrameCount: settings.pngFrameCount,
        signal: controller.signal,
        onProgress: (p, frame, total, status) => setProgress({ p: Math.max(0, Math.min(100, p)), frame, total, status })
      });
      if (controller.signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
      if (generatedUrl) URL.revokeObjectURL(generatedUrl);
      setGeneratedMime(blob.type || "video/mp4");
      setGeneratedUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e?.message || "气压风场视频生成失败");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const download = () => {
    if (!generatedUrl) return;
    const a = document.createElement("a");
    a.href = generatedUrl;
    a.download = `台风_${displayName}_${fixedMode ? `固定选区_${clipStart.toFixed(1)}-${clipEnd.toFixed(1)}h` : "全程跟随"}_风场.${generatedMime.includes("webm") ? "webm" : "mp4"}`;
    a.click();
  };

  const effectivePngFrames = Math.min(
    settings.pngFrameCount,
    settings.fps * settings.durationSec,
    settings.resolution === "2K" ? 160 : settings.resolution === "1080p" ? 200 : 240
  );

  return (
    <div className="fixed inset-0 z-[100000] bg-zinc-950 text-slate-100 flex flex-col overflow-hidden">
      <header className="shrink-0 border-b border-slate-800 bg-zinc-900/90 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onSwitchStandard} className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800"><ArrowLeft className="w-4 h-4"/></button>
          <div className="min-w-0"><h2 className="font-bold truncate">台风报告 · 气压风场图视频</h2><p className="text-[10px] text-slate-500 truncate">{displayName} · {fixedMode ? '固定位置历史片段 RECORD' : '全生命周期 RECORD'} · 逐帧计算并编码</p></div>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800"><X className="w-4 h-4"/></button>
      </header>

      <div className="flex-1 min-h-0 grid xl:grid-cols-[minmax(0,1.4fr)_minmax(390px,.8fr)]">
        <section className="min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4 bg-black/30">
          {generatedUrl ? (
            <video src={generatedUrl} controls autoPlay loop className="w-full max-h-[65vh] rounded-xl bg-black border border-slate-800" />
          ) : fixedMode ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-200">
                <span>选区内模拟历史回放预览（非风场图）</span><span className="font-mono text-cyan-300">T+{previewHour.toFixed(1)}h</span>
              </div>
              {fixedBoundsValid ? <canvas ref={replayCanvasRef} className="w-full block bg-[#0d2930]" style={{aspectRatio:String(selectedAspect)}}/> :
                <div className="p-10 text-center text-xs text-slate-400">请先选择固定位置风场范围，再预览历史回放</div>}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-white overflow-hidden relative">
              <canvas ref={canvasRef} className="w-full h-auto block" />
              {previewBusy && <div className="absolute inset-0 bg-black/25 backdrop-blur-[1px] grid place-items-center text-xs font-semibold text-white">正在重算 RECORD 风场预览…</div>}
            </div>
          )}
          {!generatedUrl && (fixedMode ? (
            <div className="rounded-xl border border-slate-800 bg-zinc-900/70 p-4 space-y-3">
              <div className="text-xs font-semibold text-white">视频片段范围 · 双滑块</div>
              <div className="flex justify-between gap-3 text-[11px] text-cyan-300 font-mono"><span>开始 {clipStart.toFixed(1)}h · {fmt(startDate,clipStart)}</span><span>结束 {clipEnd.toFixed(1)}h · {fmt(startDate,clipEnd)}</span></div>
              <div className="relative h-10 aether-video-dual-range" aria-label="历史视频双端时间裁剪">
                <div className="absolute left-0 right-0 top-[19px] h-1 rounded-full bg-slate-700"/>
                <div className="absolute top-[19px] h-1 rounded-full bg-cyan-400" style={{left:`${(clipStart-minHour)/Math.max(1,maxHour-minHour)*100}%`,right:`${(maxHour-clipEnd)/Math.max(1,maxHour-minHour)*100}%`}}/>
                <input aria-label="视频开始小时" type="range" min={minHour} max={maxHour} step={0.5} value={clipStart} onFocus={()=>setActiveRangeHandle('start')} onChange={e=>changeClipStart(Number(e.target.value))} className="absolute inset-0 w-full accent-cyan-400" style={{zIndex:activeRangeHandle==='start'?4:3}} />
                <input aria-label="视频结束小时" type="range" min={minHour} max={maxHour} step={0.5} value={clipEnd} onFocus={()=>setActiveRangeHandle('end')} onChange={e=>changeClipEnd(Number(e.target.value))} className="absolute inset-0 w-full accent-amber-400" style={{zIndex:activeRangeHandle==='end'?4:3}} />
              </div>
              <div className="flex justify-between text-[10px] text-slate-500"><span>{minHour.toFixed(1)}h</span><span>截取 {(clipEnd-clipStart).toFixed(1)} 小时 · 拖动端点预览对应时刻</span><span>{maxHour.toFixed(1)}h</span></div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-zinc-900/70 p-4 space-y-2">
              <div className="flex justify-between text-xs"><span className="text-slate-400">历史预览时刻</span><span className="font-mono text-cyan-300">{previewHour.toFixed(1)}h · {fmt(startDate,previewHour)}</span></div>
              <input type="range" min={minHour} max={maxHour} step={0.5} value={previewHour} onChange={(e) => setPreviewHour(Number(e.target.value))} className="w-full accent-cyan-500" />
              <div className="flex justify-between text-[10px] text-slate-500"><span>{minHour.toFixed(0)}h</span><span>全程 {Math.max(0,maxHour-minHour).toFixed(0)} 小时</span><span>{maxHour.toFixed(0)}h</span></div>
            </div>
          ))}
        </section>

        <aside className="min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4 bg-zinc-900/50 border-l border-slate-800">
          <section className="rounded-xl border border-cyan-800/70 bg-slate-950/70 p-3 space-y-2">
            <div className="text-xs font-semibold">风场视频模式</div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <button type="button" onClick={()=>patch('videoMode','follow')} className={`rounded-lg border p-2 ${!fixedMode?'border-cyan-400 text-cyan-200 bg-cyan-950/40':'border-slate-700 text-slate-400'}`}>台风全程跟随风场图</button>
              <button type="button" onClick={()=>patch('videoMode','fixed')} className={`rounded-lg border p-2 ${fixedMode?'border-cyan-400 text-cyan-200 bg-cyan-950/40':'border-slate-700 text-slate-400'}`}>固定位置风场图</button>
            </div>
            {fixedMode && <p className="text-[10px] text-slate-400">先设置风格与成图比例，再返回地图调整地理选区；确认后裁剪历史时段。</p>}
          </section>
          <div className="rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-3 text-[11px] leading-relaxed text-cyan-100">
            {fixedMode ? '固定位置模式：仅计算选定历史时段内的风场帧，地图范围在整段视频中保持不变；回放预览只读历史数据。' : '全程跟随模式：保持原有全生命周期计算与视频编码流程。'}
          </div>

          <section className="rounded-xl border border-slate-800 bg-slate-950/55 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold"><Wind className="w-4 h-4 text-cyan-300"/>风场产品参数</div>
            <label className="block text-[11px] text-slate-400">产品标识<input value={settings.modelLabel} onChange={(e) => patch("modelLabel", e.target.value)} className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-xs text-white" /></label>
            <label className="block text-[11px] text-slate-400">风场图风格<select value={settings.stylePreset} onChange={(e) => setSettings(prev=>({...prev,stylePreset:e.target.value as SynopticWindPressureStyle,fixedBoundsConfirmed:false}))} className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2 text-xs text-white"><option value="default">默认</option><option value="hmon">HMON 参考风格</option><option value="hwrf">HWRF 参考风格</option></select></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-slate-400">计算网格<select value={settings.gridResolutionDeg} onChange={(e) => patch("gridResolutionDeg", Number(e.target.value) as any)} className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2 text-xs"><option value={0.5}>0.50° 快速</option><option value={0.25}>0.25° 标准</option><option value={0.125}>0.125° 精细</option><option value={0.1}>0.10° 极细</option></select></label>
              <label className="text-[11px] text-slate-400">等压线间隔<select value={settings.contourIntervalHpa} onChange={(e) => patch("contourIntervalHpa", Number(e.target.value))} disabled={!settings.showContours} className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2 text-xs disabled:opacity-40"><option value={2}>2 hPa</option><option value={4}>4 hPa</option><option value={8}>8 hPa</option></select></label>
            </div>
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-2 text-[11px]">
              <input type="checkbox" aria-label="圆润清晰风眼" checked={settings.roundedClearEye} onChange={e=>patch("roundedClearEye",e.target.checked)} className="mt-0.5 accent-cyan-500" />
              <span>圆润清晰风眼（默认关闭）<span className="block text-[9px] text-slate-500">仅增强已存在的完整/部分眼墙，不凭空生成风眼。</span></span>
            </label>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <button onClick={() => patch("showContours", !settings.showContours)} className={`rounded-lg border px-2 py-2 ${settings.showContours ? "border-cyan-500 bg-cyan-500/15 text-cyan-200" : "border-slate-700 bg-slate-900 text-slate-400"}`}>等压线 {settings.showContours ? "开启" : "关闭"}</button>
              <button onClick={() => patch("showTrackOverlay", !settings.showTrackOverlay)} className={`rounded-lg border px-2 py-2 ${settings.showTrackOverlay ? "border-cyan-500 bg-cyan-500/15 text-cyan-200" : "border-slate-700 bg-slate-900 text-slate-400"}`}>历史路径 {settings.showTrackOverlay ? "开启" : "关闭"}</button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/55 p-4 space-y-3">
            <div className="text-xs font-bold">地图范围与取景</div>
            {fixedMode && <>
              <label className="block text-[11px] text-slate-400">视频完整画面比例（包含图例）
                <select value={settings.aspectRatio} onChange={e=>setSettings(prev=>({...prev,aspectRatio:e.target.value as SynopticProductAspect,fixedBoundsConfirmed:false}))} className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs">
                  <option value="default">默认（按风场风格）</option><option value="3:4">3:4</option><option value="4:3">4:3</option><option value="9:16">9:16</option><option value="16:9">16:9</option>
                </select>
              </label>
              <button onClick={selectFixedMapArea} disabled={!onStartMapSelection} className="w-full rounded-lg border border-cyan-500 bg-cyan-500/15 p-3 text-xs font-bold text-cyan-200 disabled:opacity-40">返回模拟地图 · 自由选区</button>
              <div className={`text-[10px] ${fixedBoundsValid?'text-emerald-300':'text-amber-300'}`}>{fixedBoundsValid ? `已确认：${settings.customBounds.lonMin.toFixed(2)}°～${settings.customBounds.lonMax.toFixed(2)}°E，${settings.customBounds.latMin.toFixed(2)}°～${settings.customBounds.latMax.toFixed(2)}°N`:'尚未确认与当前风格/画幅对应的选区'}</div>
            </>}

            {!fixedMode && (<>
            <div className="grid grid-cols-3 gap-1.5">
              {([['follow_storm','跟随台风'],['reference','标准范围'],['custom','自定义']] as const).map(([id,label]) => <button key={id} onClick={() => patch("domainMode", id)} className={`rounded-lg border py-2 text-[10px] ${settings.domainMode===id?"border-cyan-500 bg-cyan-500/15 text-cyan-200":"border-slate-700 bg-slate-900 text-slate-400"}`}>{label}</button>)}
            </div>
            <div className="space-y-1"><div className="flex justify-between text-[11px] text-slate-400"><span>地图倍率</span><span className="font-mono">{settings.mapZoom.toFixed(2)}×</span></div><input type="range" min={0.6} max={2.2} step={0.05} value={settings.mapZoom} onChange={(e)=>patch("mapZoom",Number(e.target.value))} className="w-full accent-cyan-500"/></div>
            {settings.domainMode === "custom" && <div className="grid grid-cols-2 gap-2">{([['lonMin','西界'],['lonMax','东界'],['latMin','南界'],['latMax','北界']] as const).map(([k,label])=><label key={k} className="text-[10px] text-slate-500">{label}<input type="number" value={settings.customBounds[k]} onChange={(e)=>setSettings(prev=>({...prev,customBounds:{...prev.customBounds,[k]:Number(e.target.value)}}))} className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2 text-xs text-white"/></label>)}</div>}
            </>)}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/55 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold"><Film className="w-4 h-4 text-cyan-300"/>PNG 序列与视频参数</div>
            {fixedMode && <label className="block text-[11px] text-slate-400">编码画质
              <select value={settings.quality} onChange={e=>patch('quality',e.target.value as RecordVideoSettings['quality'])} className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs">
                <option value="standard">标准</option><option value="high">高清</option><option value="ultra">超清（高码率）</option>
              </select>
            </label>}
            <div className="grid grid-cols-3 gap-1.5">{(["720p","1080p","2K"] as SynopticVideoResolution[]).map(r=><button key={r} onClick={()=>patch("resolution",r)} className={`rounded-lg border py-2 text-[11px] ${settings.resolution===r?"border-cyan-500 bg-cyan-500/15 text-cyan-200":"border-slate-700 bg-slate-900 text-slate-400"}`}>{r}</button>)}</div>
            <div className="space-y-1"><div className="flex justify-between text-[11px] text-slate-400"><span>PNG 序列目标帧数</span><span className="font-mono text-cyan-300">{settings.pngFrameCount}</span></div><input type="range" min={24} max={240} step={12} value={settings.pngFrameCount} onChange={(e)=>patch("pngFrameCount",Number(e.target.value))} className="w-full accent-cyan-500"/><p className="text-[9px] text-slate-600">实际本次最多生成 {effectivePngFrames} 张；2K 自动限制 160、1080p 200、720p 240，避免浏览器内存溢出。</p></div>
            <div className="space-y-1"><div className="flex justify-between text-[11px] text-slate-400"><span>每秒帧数</span><span className="font-mono text-cyan-300">{settings.fps} FPS</span></div><input type="range" min={1} max={60} step={1} value={settings.fps} onChange={(e)=>patch("fps",Number(e.target.value))} className="w-full accent-cyan-500"/></div>
            <div className="space-y-1"><div className="flex justify-between text-[11px] text-slate-400"><span>视频时长</span><span className="font-mono text-cyan-300">{settings.durationSec} 秒</span></div><input type="range" min={2} max={30} step={1} value={settings.durationSec} onChange={(e)=>patch("durationSec",Number(e.target.value))} className="w-full accent-cyan-500"/></div>
            <div className="text-[10px] text-slate-500">输出编码帧：{settings.fps * settings.durationSec} · 历史范围：{fixedMode?clipStart.toFixed(1):minHour.toFixed(0)}–{fixedMode?clipEnd.toFixed(1):maxHour.toFixed(0)}h · {fixedMode?`完整成图 ${settings.aspectRatio==='default'?'默认':settings.aspectRatio}`:'跟随画面 3:2'}</div>
          </section>

          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>}

          <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-slate-800 bg-zinc-950/90 py-3 backdrop-blur-xl">
            <button onClick={onClose} className="px-3 py-2 text-xs text-slate-400 hover:text-white">取消</button>
            {generatedUrl ? <div className="flex gap-2"><button onClick={()=>{URL.revokeObjectURL(generatedUrl);setGeneratedUrl(null);}} className="px-3 py-2 rounded-lg border border-slate-700 text-xs"><RefreshCw className="inline w-3.5 h-3.5 mr-1"/>重新生成</button><button onClick={download} className="px-4 py-2 rounded-lg bg-cyan-400 text-slate-950 text-xs font-bold"><Download className="inline w-4 h-4 mr-1"/>下载视频</button></div> : <button onClick={startRender} disabled={busy || history.length < 2} className="px-5 py-2.5 rounded-lg bg-cyan-400 text-slate-950 text-xs font-bold disabled:opacity-40"><Film className="inline w-4 h-4 mr-1"/>先生成 PNG 序列并导出视频</button>}
          </div>
        </aside>
      </div>

      {busy && <div className="fixed inset-0 z-[110000] bg-black/82 backdrop-blur-sm grid place-items-center p-4"><div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-full border-4 border-white/15 border-t-cyan-300 animate-spin"/><div><div className="font-bold">正在生成全程气压风场 RECORD 视频</div><div className="text-[11px] text-slate-400 mt-1">{progress.status}</div></div></div><div className="space-y-1"><div className="flex justify-between text-xs"><span className="text-slate-400">{progress.frame}/{progress.total}</span><span className="font-mono text-cyan-300">{Math.round(progress.p)}%</span></div><div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-cyan-400 transition-[width]" style={{width:`${progress.p}%`}}/></div></div><button onClick={()=>abortRef.current?.abort()} className="w-full py-2 rounded-lg border border-red-500/40 text-red-300 text-xs">停止生成</button></div></div>}
    </div>
  );
}
