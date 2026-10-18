/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, type ReactNode } from "react";
import { X, Video, Download, Play, RefreshCw, Layers, ShieldAlert, Sparkles, Check, CheckCircle2, Film, ChevronDown } from "lucide-react";
import { Typhoon } from "../types";
import {
  VideoExportConfig,
  RenderProgress,
  getCanvasDimensions,
  renderVideoFrameOnCanvas,
  generateTyphoonVideo,
  globalTileCache,
  getMercatorZoom
} from "../utils/VideoRenderEngine";
import { getTyphoonDisplayName } from "../utils/TyphoonDisplayName";
import { isLocalVectorBasemap } from "../utils/LocalVectorBasemaps";
import { loadProductNaturalEarthData } from "../simulation/NaturalEarthLoader";
import SynopticWindPressureRecordVideoPanel from "./SynopticWindPressureRecordVideoPanel";
import type { SynopticProductAspect, SynopticProductStyle } from "../utils/SynopticProductLayout";

interface VideoExportModalProps {
  typhoon: Typhoon;
  startDate?: Date;
  onClose: () => void;
  onStartSynopticRecordSelection?: (style:SynopticProductStyle,aspect:SynopticProductAspect)=>void;
}

const DEFAULT_EXPORT_CONFIG: VideoExportConfig = {
  agencyStyle: "CMA",
  replayStyle: "standard",
  jmaReplayTyphoonNumber: 18,
  intensityAgency: "CMA",
  intensityReportingMode: "public",
  trackStyle: "CMA",
  trackDotStyle: "CMA",
  windRadiiStyle: "CMA",
  centerStyle: "CMA",
  mechanismStyle: "CMA",
  mode: "trajectory",
  baseMap: "dark",
  referenceBasemapColorGrade: false,
  blueMarbleVersion: "2002",
  jmaAzimuthalEqualAreaProjection: false,
  jmaNorthPolarStereographicProjection: false,
  forecastHours: 24,
  showCoastline: false,
  rasterResolution: "high",
  showGrid: false,
  showForecast: true,
  showUncertaintyCone: true,
  showWindRadii: true,
  showStations: false,
  stationSizeScale: 0.8,
  fps: 30,
  endAction: "none",
  dotInterval: 3,
  showDataLabel: true,
  infoBoxStyle: "agency",
  labelContent: "all",
  showStatus: true,
  showDateTime: true,
  dateTimeFormat: "relative",
  showCasualties: false,
  labelSize: "medium",
  labelPosition: "top-right",
  centerFollow: true,
  zoomLevel: 3,
  aspectRatio: "16:9",
  videoResolution: "1080p",
  videoCodec: "H.264",
  durationSec: 10,
  animSpeed: 2
};

const CONFIG_STORAGE_KEY = "typhoon_video_export_config_v2";
const CUSTOM_PRESET_KEY = "typhoon_video_custom_preset_v1";

const VIDEO_PRESETS: Array<{ id: string; label: string; description: string; values: Partial<VideoExportConfig> }> = [
  {
    id: "cma-standard",
    label: "CMA 标准复盘",
    description: "现有 CMA 轨迹 / 三层风圈 / 机构信息牌",
    values: { replayStyle: "standard", agencyStyle: "CMA", intensityAgency: "CMA", intensityReportingMode: "public", trackStyle: "CMA", trackDotStyle: "CMA", windRadiiStyle: "CMA", centerStyle: "CMA", mechanismStyle: "CMA", baseMap: "dark", showGrid: false, showCoastline: false, infoBoxStyle: "agency", dotInterval: 3, aspectRatio: "16:9", videoResolution: "1080p", fps: 30 }
  },
  {
    id: "jma-besttrack",
    label: "JMA Best Track",
    description: "JMA 白轨迹圆点（24h）/ 黄红风圈 / 白色叉号",
    values: { replayStyle: "jma_best_track", referenceBasemapColorGrade: false, blueMarbleVersion: "2002", jmaAzimuthalEqualAreaProjection: false, jmaNorthPolarStereographicProjection: false, agencyStyle: "JMA", intensityAgency: "JMA", intensityReportingMode: "public", trackStyle: "JMA", trackDotStyle: "JMA", windRadiiStyle: "JMA", centerStyle: "JMA", mechanismStyle: "JMA", baseMap: "jma", showGrid: true, showCoastline: false, showForecast: false, showUncertaintyCone: false, showStations: false, infoBoxStyle: "minimal", dotInterval: 24, showDataLabel: true, showStatus: false, showDateTime: true, dateTimeFormat: "calendar", labelSize: "medium", labelPosition: "bottom-right", centerFollow: true, zoomLevel: 3, aspectRatio: "4:3", videoResolution: "1080p", videoCodec: "H.264", fps: 30, durationSec: 10 }
  },
  {
    id: "himawari8-observation",
    label: "ひまわり8号 監測",
    description: "参考图复刻：日文信息牌 / JMA黄红风圈 / 最大风速着色路径；不叠加云图与水印",
    values: {
      replayStyle: "himawari8_observation",
      jmaReplayTyphoonNumber: 18,
      jmaAzimuthalEqualAreaProjection: false,
      jmaNorthPolarStereographicProjection: false,
      mode: "trajectory",
      agencyStyle: "JMA",
      intensityAgency: "JMA",
      intensityReportingMode: "public",
      trackStyle: "JMA",
      trackDotStyle: "JMA",
      windRadiiStyle: "JMA",
      centerStyle: "JMA",
      mechanismStyle: "JMA",
      baseMap: "none",
      showCoastline: true,
      showGrid: false,
      showForecast: false,
      showUncertaintyCone: false,
      showWindRadii: true,
      showStations: false,
      dotInterval: 0,
      showDataLabel: false,
      showStatus: false,
      showDateTime: true,
      dateTimeFormat: "calendar",
      centerFollow: true,
      zoomLevel: 4,
      aspectRatio: "4:3",
      videoResolution: "1080p",
      fps: 30
    }
  },
  {
    id: "research",
    label: "科研报告",
    description: "浅色底图 / 经纬网 / 高分辨率 / 完整数据",
    values: { replayStyle: "standard", agencyStyle: "CMA", intensityAgency: "CMA", intensityReportingMode: "continuous", baseMap: "light", showGrid: true, showCoastline: true, infoBoxStyle: "monochrome", labelContent: "all", videoResolution: "2K", fps: 30, aspectRatio: "16:9", centerFollow: false }
  },
  {
    id: "vertical",
    label: "竖屏快报",
    description: "9:16 / 中心跟随 / 大字号 / 1080p",
    values: { replayStyle: "standard", aspectRatio: "9:16", videoResolution: "1080p", centerFollow: true, labelSize: "large", labelPosition: "top-right", zoomLevel: 4, fps: 30 }
  }
];

function FoldSection({
  title,
  icon,
  children,
  defaultOpen = true
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/45 shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-slate-900/70 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-bold tracking-wide text-slate-200">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-slate-700 bg-slate-900 text-sky-300">
            {icon}
          </span>
          {title}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-3 border-t border-slate-800/80 p-3.5">{children}</div>}
    </section>
  );
}

function getSavedExportConfig(): VideoExportConfig {
  try {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // v1.1 removes the former Best Track-specific basemap source. Migrate
      // older saved exports to the standard Blue Marble 2002 source.
      if (parsed?.baseMap === "digitalTyphoon") parsed.baseMap = "blueMarble";
        if (!parsed?.blueMarbleVersion) parsed.blueMarbleVersion = "2002";
      if (parsed?.mode && !["trajectory", "wind_forecast", "rain_forecast"].includes(parsed.mode)) parsed.mode = "trajectory";
      if (parsed?.replayStyle === "himawari9_observation") parsed.replayStyle = "himawari8_observation";
      if (!["standard", "jma_best_track", "himawari8_observation"].includes(parsed?.replayStyle)) parsed.replayStyle = "standard";
      if (!Number.isFinite(Number(parsed?.jmaReplayTyphoonNumber))) parsed.jmaReplayTyphoonNumber = 18;
      return { ...DEFAULT_EXPORT_CONFIG, ...parsed };
    }
    const simSaved = localStorage.getItem("typhoon_sim_config");
    if (simSaved) {
      const sim = JSON.parse(simSaved);
      return {
        ...DEFAULT_EXPORT_CONFIG,
        agencyStyle: sim.agencyStyle || "CMA",
        intensityAgency: sim.intensityAgency || "CMA",
        intensityReportingMode: sim.intensityReportingMode || "public",
        trackStyle: sim.trackStyle || sim.agencyStyle || "CMA",
        trackDotStyle: sim.trackDotStyle || sim.agencyStyle || "CMA",
        windRadiiStyle: sim.windRadiiStyle || sim.agencyStyle || "CMA",
        centerStyle: sim.centerStyle || sim.agencyStyle || "CMA",
        mechanismStyle: sim.mechanismStyle || sim.agencyStyle || "CMA"
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_EXPORT_CONFIG;
}

export default function VideoExportModal({ typhoon, startDate, onClose, onStartSynopticRecordSelection }: VideoExportModalProps) {
  const [config, setConfig] = useState<VideoExportConfig>(getSavedExportConfig);
  const [exportContentType, setExportContentType] = useState<"standard" | "synoptic_record">(() => {
    const saved = localStorage.getItem("typhoon_video_content_type");
    return saved === "synoptic_record" ? saved : "standard";
  });
  const effectiveStartDate = startDate || (localStorage.getItem("typhoon_sim_start_date") ? new Date(localStorage.getItem("typhoon_sim_start_date")!) : new Date("2027-06-30T20:00:00"));
  const currentDisplayName = getTyphoonDisplayName(typhoon, typhoon.simHour, effectiveStartDate);
  const [productGeoReady, setProductGeoReady] = useState(false);

  // Video/export frames use the product coastline plate (global coverage, >=20° margin), while
  // the live simulator keeps its lighter 5°-expanded plate. Trigger a preview refresh once loaded.
  useEffect(() => {
    let cancelled = false;
    void loadProductNaturalEarthData().then(() => { if (!cancelled) setProductGeoReady(true); });
    return () => { cancelled = true; };
  }, []);
  
  // Automatically save export parameters whenever config changes
  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch {
      // ignore
    }
  }, [config]);

  useEffect(() => {
    try { localStorage.setItem("typhoon_video_content_type", exportContentType); } catch {}
  }, [exportContentType]);

  // Reprojection is valid for local/offline vector plates, blank plates, and both built-in Blue
  // Marble versions. Blue Marble 2002/2004 have dedicated projected renderers; arbitrary network
  // raster tiles remain Web-Mercator. Clean stale flags only when switching to an unsupported map.
  useEffect(() => {
    const projectionSafe = config.baseMap === "none" || config.baseMap === "blueMarble" || isLocalVectorBasemap(config.baseMap);
    if (!projectionSafe && (config.jmaAzimuthalEqualAreaProjection || config.jmaNorthPolarStereographicProjection)) {
      setConfig((prev) => ({ ...prev, jmaAzimuthalEqualAreaProjection: false, jmaNorthPolarStereographicProjection: false }));
    }
  }, [config.baseMap, config.jmaAzimuthalEqualAreaProjection, config.jmaNorthPolarStereographicProjection]);
  
  // Timeline slider for live previewing a frame
  const history = typhoon.history || [];
  const minHour = history.length > 0 ? history[0].simHour : 0;
  const maxHour = history.length > 0 ? history[history.length - 1].simHour : 0;
  const peakHour = history.length > 0
    ? history.reduce((prev, curr) => (curr.vmax > prev.vmax ? curr : prev), history[0]).simHour
    : 0;

  const [previewHour, setPreviewHour] = useState<number>(peakHour);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRenderSeqRef = useRef(0);

  // Generation state
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const lastProgressRef = useRef<RenderProgress | null>(null);
  const lastProgressPaintAtRef = useRef(0);

  // Re-render live preview frame whenever parameters or previewHour change.
  // The visible canvas is sized and painted synchronously first, so a slow/failed tile
  // request can never leave the preview as a transparent/blank element.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const seq = ++previewRenderSeqRef.current;

    const output = getCanvasDimensions(config.aspectRatio, config.videoResolution);
    const previewScale = Math.min(1, 1280 / output.width, 900 / output.height);
    const width = Math.max(320, Math.round(output.width * previewScale));
    const height = Math.max(240, Math.round(output.height * previewScale));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const visibleCtx = canvas.getContext("2d");
    if (visibleCtx) {
      visibleCtx.fillStyle = "#07111F";
      visibleCtx.fillRect(0, 0, width, height);
      visibleCtx.fillStyle = "rgba(226,232,240,0.72)";
      visibleCtx.font = `600 ${Math.max(12, Math.round(width * 0.014))}px sans-serif`;
      visibleCtx.textAlign = "center";
      visibleCtx.textBaseline = "middle";
      visibleCtx.fillText("正在渲染预览…", width / 2, height / 2);
    }

    const offscreen = document.createElement("canvas");
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    const drawFallback = (message: string) => {
      offCtx.fillStyle = "#07111F";
      offCtx.fillRect(0, 0, width, height);
      const hist = typhoon.history || [];
      const state = hist.reduce((best, item) => Math.abs(item.simHour - previewHour) < Math.abs(best.simHour - previewHour) ? item : best, hist[0] || typhoon as any);
      offCtx.fillStyle = "rgba(30,156,255,0.16)";
      offCtx.beginPath();
      offCtx.arc(width / 2, height / 2, Math.min(width, height) * 0.14, 0, Math.PI * 2);
      offCtx.fill();
      offCtx.fillStyle = "#e2e8f0";
      offCtx.font = `700 ${Math.max(15, Math.round(width * 0.019))}px sans-serif`;
      offCtx.textAlign = "center";
      offCtx.fillText(getTyphoonDisplayName(typhoon, previewHour, effectiveStartDate), width / 2, height / 2 - 22);
      offCtx.font = `600 ${Math.max(12, Math.round(width * 0.014))}px monospace`;
      offCtx.fillStyle = "#7dd3fc";
      offCtx.fillText(`${Number(state?.vmax || typhoon.vmax || 0).toFixed(1)} m/s  ·  ${Math.round(previewHour)} h`, width / 2, height / 2 + 4);
      offCtx.font = `500 ${Math.max(10, Math.round(width * 0.010))}px sans-serif`;
      offCtx.fillStyle = "#94a3b8";
      offCtx.fillText(message, width / 2, height / 2 + 30);
    };

    void (async () => {
      try {
        await renderVideoFrameOnCanvas(offCtx, width, height, typhoon, previewHour, config);
      } catch (err) {
        console.warn("Video preview render fallback:", err);
        // A basemap/network/CORS failure must not blank the preview. Render an explicit
        // local fallback frame that still reflects the selected time and storm intensity.
        drawFallback("底图暂不可用，已显示本地预览占位");
      }

      if (seq !== previewRenderSeqRef.current || !previewCanvasRef.current) return;
      const target = previewCanvasRef.current;
      const targetCtx = target.getContext("2d");
      if (!targetCtx) return;
      targetCtx.clearRect(0, 0, width, height);
      targetCtx.drawImage(offscreen, 0, 0);
    })();

    return () => {
      if (seq === previewRenderSeqRef.current) previewRenderSeqRef.current++;
    };
  }, [config, previewHour, typhoon, productGeoReady]);

  // Preload base map tiles when baseMap or zoomLevel changes for instant live preview
  useEffect(() => {
    if (config.baseMap === "none" || isLocalVectorBasemap(config.baseMap)) return;
    const { width } = getCanvasDimensions(config.aspectRatio, config.videoResolution);
    const zoom = getMercatorZoom(config.zoomLevel, width);
    const tileZoom = Math.floor(zoom);

    let sumLat = 0;
    let sumLon = 0;
    history.forEach((h) => {
      sumLat += h.lat;
      sumLon += h.lon;
    });
    const avgLat = sumLat / Math.max(1, history.length);
    const avgLon = sumLon / Math.max(1, history.length);

    const worldSize = 256 * Math.pow(2, tileZoom);
    const cx = ((avgLon + 180) / 360) * worldSize;
    const centerLatRad = (avgLat * Math.PI) / 180;
    const cy = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) * (worldSize / 2);

    for (let tx = Math.floor(cx / 256) - 2; tx <= Math.ceil(cx / 256) + 2; tx++) {
      for (let ty = Math.floor(cy / 256) - 2; ty <= Math.ceil(cy / 256) + 2; ty++) {
        const url = globalTileCache.getTileUrl(config.baseMap, tileZoom, tx, ty);
        globalTileCache.loadTile(url).catch(() => {});
      }
    }
  }, [config.baseMap, config.zoomLevel]);

  // Keep export progress monotonic and throttle UI paints. Rendering can emit
  // dozens of callbacks per second; updating React on every frame made the
  // progress bar/text visibly reflow and flash on phones.
  const publishRenderProgress = (next: RenderProgress) => {
    const prev = lastProgressRef.current;
    const normalized: RenderProgress = {
      ...next,
      percentage: Math.max(prev?.percentage ?? 0, Math.min(100, Math.round(next.percentage))),
      currentFrame: Math.max(prev?.currentFrame ?? 0, Math.round(next.currentFrame)),
      totalFrames: Math.max(prev?.totalFrames ?? 0, Math.round(next.totalFrames))
    };
    normalized.currentFrame = Math.min(normalized.currentFrame, normalized.totalFrames || normalized.currentFrame);
    lastProgressRef.current = normalized;

    const now = performance.now();
    const shouldPaint =
      normalized.percentage >= 100 ||
      !prev ||
      normalized.percentage !== prev.percentage ||
      now - lastProgressPaintAtRef.current >= 90;
    if (shouldPaint) {
      lastProgressPaintAtRef.current = now;
      setRenderProgress(normalized);
    }
  };

  // Handle video generation
  const handleStartRender = async () => {
    setIsRendering(true);
    setErrorMessage(null);
    const initialProgress: RenderProgress = {
      percentage: 0,
      currentFrame: 0,
      totalFrames: 1,
      statusText: "准备渲染器..."
    };
    lastProgressRef.current = initialProgress;
    lastProgressPaintAtRef.current = performance.now();
    setRenderProgress(initialProgress);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await loadProductNaturalEarthData();
      const blob = await generateTyphoonVideo(
        typhoon,
        { ...config, startDate: effectiveStartDate },
        (prog) => publishRenderProgress(prog),
        controller.signal
      );

      const url = URL.createObjectURL(blob);
      setGeneratedVideoUrl(url);
      setIsRendering(false);
    } catch (err: any) {
      if (err.message !== "Video rendering cancelled by user") {
        setErrorMessage(err.message || "视频生成过程中发生异常，请重试");
      }
      setIsRendering(false);
    }
  };

  const handleCancelRender = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsRendering(false);
    setRenderProgress(null);
    lastProgressRef.current = null;
  };

  const showPreview = true;
  const isPortraitPreview = config.aspectRatio === "9:16" || config.aspectRatio === "3:4";
  const isJmaBestTrackProfile = config.replayStyle === "jma_best_track";
  const isHimawari8Profile = config.replayStyle === "himawari8_observation" || config.replayStyle === "himawari9_observation";
  const specialReplayProfile = isJmaBestTrackProfile || isHimawari8Profile;
  const projectionBasemapSupportsReprojection = config.baseMap === "none" || config.baseMap === "blueMarble" || isLocalVectorBasemap(config.baseMap);
  // Built-in presets are complete visual profiles. Rebuild from the neutral defaults rather than
  // layering one agency on top of another; this prevents JMA-only labels/projection flags from
  // surviving after the user switches back to CMA.
  const applyPreset = (values: Partial<VideoExportConfig>) => setConfig({ ...DEFAULT_EXPORT_CONFIG, ...values });
  const saveCustomPreset = () => {
    try { localStorage.setItem(CUSTOM_PRESET_KEY, JSON.stringify(config)); } catch { /* ignore */ }
  };
  const applyCustomPreset = () => {
    try {
      const saved = localStorage.getItem(CUSTOM_PRESET_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.baseMap === "digitalTyphoon") parsed.baseMap = "blueMarble";
      if (!parsed?.blueMarbleVersion) parsed.blueMarbleVersion = "2002";
      if (parsed?.replayStyle === "himawari9_observation") parsed.replayStyle = "himawari8_observation";
        setConfig({ ...DEFAULT_EXPORT_CONFIG, ...parsed });
      }
    } catch { /* ignore */ }
  };

  if (exportContentType === "synoptic_record") {
    return <SynopticWindPressureRecordVideoPanel typhoon={typhoon} startDate={effectiveStartDate} onSwitchStandard={() => setExportContentType("standard")} onClose={onClose} onStartMapSelection={onStartSynopticRecordSelection}/>;
  }

  return (
    <div className="video-export-workstation fixed inset-0 z-[100000] bg-zinc-950/94 text-slate-100 flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease-out]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-white/10 bg-zinc-900/70 backdrop-blur-2xl shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-900 border border-slate-700 rounded-lg text-blue-400">
            <Video className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              台风模拟视频渲染与导出
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-blue-500/20 text-sky-300 border border-blue-500/30">
                {currentDisplayName} ({maxHour}小时轨迹)
              </span>
            </h2>
            <p className="text-xs text-slate-400">配置视频导出参数，自定义动画时长、帧率、底图及图层效果。</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
        >
          <X size={20} />
        </button>
      </div>

      {/* Mode Selector Tabs */}
      <div className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0 overflow-x-auto">
        <button
          onClick={() => setConfig({ ...config, mode: "trajectory" })}
          className={`px-4 py-2 shrink-0 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            (config.mode || "trajectory") === "trajectory"
              ? "bg-white/10 border border-white/65 text-white shadow-lg shadow-white/10"
              : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-white"
          }`}
        >
          <Video className="w-4 h-4" />
          台风轨迹复盘视频
        </button>
        <button
          onClick={() => setExportContentType("synoptic_record")}
          className="px-4 py-2 shrink-0 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer bg-slate-950 text-cyan-300 border border-cyan-800 hover:border-cyan-500"
        >
          <Layers className="w-4 h-4" />
          气压风场图视频
        </button>

      </div>

      {/* Main Content Area */}
      <div className="video-export-main flex-1 grid grid-cols-1 xl:grid-cols-12 overflow-hidden min-h-0">
        
        {/* Left Column: Live Preview & Canvas Screen */}
        {showPreview && (
          <div className="video-export-preview-column xl:col-span-7 bg-black/35 p-4 sm:p-5 flex flex-col justify-between border-b xl:border-b-0 xl:border-r border-white/10 overflow-y-auto min-w-0">
            
            <div className="flex flex-col h-full justify-center items-center">
              <div className="w-full max-w-4xl flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Film className="w-4 h-4 text-blue-400" />
                  实时画面预览 (支持拉动进度轴切帧)
                </span>
                <span className="text-xs font-mono text-blue-400 bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
                  比例 {config.aspectRatio} | 缩放 档位{config.zoomLevel} | 第 {Math.round(previewHour)} 小时
                </span>
              </div>

              {/* Video Player or Live Preview Canvas */}
              <div className="video-export-preview-stage flex-1 w-full flex items-center justify-center min-h-0 p-2">
                <div 
                  className="video-export-preview-frame relative bg-[#07111F] rounded-xl border border-slate-800 shadow-2xl overflow-hidden flex items-center justify-center transition-all duration-200"
                  style={isPortraitPreview ? {
                    aspectRatio: config.aspectRatio.replace(":", "/"),
                    height: "min(62vh, 720px)",
                    maxWidth: "100%",
                    width: "auto"
                  } : {
                    aspectRatio: config.aspectRatio.replace(":", "/"),
                    width: "min(100%, 1100px)",
                    maxHeight: "62vh",
                    height: "auto"
                  }}
                >
                  {generatedVideoUrl ? (
                    <video
                      src={generatedVideoUrl}
                      controls
                      autoPlay
                      loop
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <canvas
                      ref={previewCanvasRef}
                      className="w-full h-full object-contain"
                    />
                  )}

                  {/* Status Badge inside Canvas */}
                  {!generatedVideoUrl && (
                    <div className="absolute top-3 left-3 px-2.5 py-1 bg-black/70 backdrop-blur-md rounded-md border border-slate-700/60 text-[10px] font-mono text-slate-300 z-10">
                      实时效果预览
                    </div>
                  )}
                </div>
              </div>

              {/* Preview Frame Scrubbing Slider */}
              {!generatedVideoUrl && (
                <div className="w-full max-w-4xl mt-3 bg-slate-900/80 border border-slate-800 p-3 rounded-xl flex items-center gap-4">
                  <span className="text-xs font-semibold text-slate-400 shrink-0">预览时间轴:</span>
                  <input
                    type="range"
                    min={minHour}
                    max={maxHour}
                    step={1}
                    value={previewHour}
                    onChange={(e) => setPreviewHour(Number(e.target.value))}
                    className="flex-1 accent-sky-400 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
                  />
                  <span className="text-xs font-mono text-white shrink-0 font-bold">{Math.round(previewHour)} h</span>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Right Column: Detailed Parameter Options */}
        <div className={`video-export-config-column ${showPreview ? "xl:col-span-5" : "xl:col-span-12 max-w-4xl mx-auto w-full"} p-4 sm:p-5 overflow-y-auto space-y-4 bg-zinc-900/45 backdrop-blur-xl min-w-0`}>
          
              {/* Presets */}
              <FoldSection title="预设方案" icon={<Sparkles className="h-4 w-4" />} defaultOpen={false}>
                <div className="grid grid-cols-1 2xl:grid-cols-2 gap-2">
                  {VIDEO_PRESETS.map((preset) => (
                    <button key={preset.id} onClick={() => applyPreset(preset.values)} className="text-left p-2.5 rounded-xl border border-white/10 bg-white/[0.035] hover:border-white/25 hover:bg-white/[0.075] transition">
                      <div className="text-xs font-bold text-slate-200">{preset.label}</div>
                      <div className="text-[9px] text-slate-500 leading-relaxed mt-1">{preset.description}</div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={saveCustomPreset} className="flex-1 py-1.5 rounded-lg border border-slate-700 bg-slate-950 text-[10px] text-slate-300 hover:text-white">保存当前为自定义预设</button>
                  <button onClick={applyCustomPreset} className="flex-1 py-1.5 rounded-lg border border-slate-700 bg-slate-950 text-[10px] text-slate-300 hover:text-white">应用自定义预设</button>
                </div>
              </FoldSection>

              {specialReplayProfile && (
                <FoldSection
                  title={isJmaBestTrackProfile ? "JMA Best Track 专用设置" : "向日葵8号监测专用设置"}
                  icon={<Layers className="h-4 w-4" />}
                  defaultOpen={true}
                >
                  <div className="rounded-xl border border-cyan-800/50 bg-cyan-950/20 p-3 text-[10px] leading-relaxed text-cyan-100/80">
                    {isJmaBestTrackProfile
                      ? "JMA Best Track 使用独立的JMA轨迹、中心与风圈规则。这里仅显示该产品真正需要的画面设置；视频输出参数位于下方同一专用页面。"
                      : "向日葵8号监测使用独立广播式渲染器。轨迹以3小时节点形成折线，最新线段始终连接当前中心，温带化后仍继续追踪并标记为温帯低気圧(ET)。"}
                  </div>

                  {isJmaBestTrackProfile && (
                    <div className="space-y-2 rounded-xl border border-sky-900/50 bg-slate-950/55 p-3">
                      <div>
                        <label className="text-xs text-slate-300 block mb-1.5 font-semibold">底图选择</label>
                        <div className="grid grid-cols-2 gap-2">
                          {(["2002", "2004"] as const).map((version) => (
                            <button
                              key={version}
                              type="button"
                              onClick={() => setConfig({ ...config, baseMap: "blueMarble", blueMarbleVersion: version })}
                              className={`py-2 rounded-lg border text-xs font-bold transition-all ${(config.baseMap === "blueMarble" && (config.blueMarbleVersion || "2002") === version) ? "bg-sky-500/20 border-sky-400 text-sky-200" : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600"}`}
                            >
                              {version}
                            </button>
                          ))}
                        </div>
                        <div className="mt-1.5 text-[9px] text-slate-500 leading-relaxed">2004 使用旧版 WMC Wiki 路径图一致的 NASA GIBS BlueMarble_NextGeneration。</div>
                      </div>

                      <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 cursor-pointer">
                        <div>
                          <div className="text-[11px] font-semibold text-amber-200">旧站调色</div>
                          <div className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">开启后将海洋调整为蓝紫色、陆地调整为偏黄绿色，尽量贴近 Digital Typhoon 老式复盘画面。</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={!!config.referenceBasemapColorGrade}
                          onChange={(e) => setConfig({ ...config, referenceBasemapColorGrade: e.target.checked })}
                          className="w-4 h-4 accent-amber-400 cursor-pointer mt-0.5 shrink-0"
                        />
                      </label>

                      <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 cursor-pointer">
                        <div>
                          <div className="text-[11px] font-semibold text-cyan-200">LAEA 新投影</div>
                          <div className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">关闭：原 Web Mercator。开启：以当前台风中心为中心的 Lambert Azimuthal Equal-Area；底图和路径共用同一投影，风圈与打点继续按屏幕正圆绘制。</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={projectionBasemapSupportsReprojection && !!config.jmaAzimuthalEqualAreaProjection}
                          disabled={!projectionBasemapSupportsReprojection}
                          onChange={(e) => setConfig({ ...config, jmaAzimuthalEqualAreaProjection: e.target.checked, jmaNorthPolarStereographicProjection: e.target.checked ? false : config.jmaNorthPolarStereographicProjection })}
                          className="w-4 h-4 accent-white cursor-pointer mt-0.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-35"
                        />
                      </label>
                      <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 cursor-pointer">
                        <div>
                          <div className="text-[11px] font-semibold text-sky-200">JMA预报图投影</div>
                          <div className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">North Polar Stereographic（lat₀=90°N、lon₀=140°E、lat_ts=60°N）。底图、海岸线、经纬网与轨迹统一重投影，文字、风圈和信息牌保持屏幕形状不变。</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={projectionBasemapSupportsReprojection && !!config.jmaNorthPolarStereographicProjection}
                          disabled={!projectionBasemapSupportsReprojection}
                          onChange={(e) => setConfig({ ...config, jmaNorthPolarStereographicProjection: e.target.checked, jmaAzimuthalEqualAreaProjection: e.target.checked ? false : config.jmaAzimuthalEqualAreaProjection })}
                          className="w-4 h-4 accent-white cursor-pointer mt-0.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-35"
                        />
                      </label>
                    </div>
                  )}

                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5 font-medium">地图范围选择 / 缩放档位</label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                      {[
                        { level: 1, label: "远景" }, { level: 1.5, label: "远景+" },
                        { level: 2, label: "区域" }, { level: 2.5, label: "区域+" },
                        { level: 3, label: "标准" }, { level: 3.5, label: "标准+" },
                        { level: 4, label: "细节" }, { level: 4.5, label: "细节+" },
                        { level: 5, label: "特写" }
                      ].map((item) => (
                        <button
                          key={item.level}
                          type="button"
                          onClick={() => setConfig({ ...config, zoomLevel: item.level })}
                          className={`py-1.5 px-1 text-[10px] font-semibold rounded-lg border transition-all ${config.zoomLevel === item.level ? "bg-sky-500/20 border-sky-400 text-sky-200" : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600"}`}
                        >
                          <div>{item.level}</div><div className="text-[8px] opacity-75">{item.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {isHimawari8Profile && (
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 text-[10px] text-slate-300">
                      <span><b className="block text-slate-200">信息牌台風番号</b><span className="text-[8px] text-slate-500">显示于左侧日文监测信息牌</span></span>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={config.jmaReplayTyphoonNumber ?? 18}
                        onChange={(e) => setConfig({ ...config, jmaReplayTyphoonNumber: Math.max(1, Math.min(99, Number(e.target.value) || 18)) })}
                        className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-right font-mono text-slate-100"
                      />
                    </label>
                  )}
                  {isHimawari8Profile && (
                    <>
                      <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 cursor-pointer">
                        <div>
                          <div className="text-[11px] font-semibold text-cyan-200">LAEA 新投影</div>
                          <div className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">关闭：原 Web Mercator。开启：以当前台风中心为 Lambert Azimuthal Equal-Area 投影中心；地图、经纬网和路径同步投影，风圈保持屏幕正圆。</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={projectionBasemapSupportsReprojection && !!config.jmaAzimuthalEqualAreaProjection}
                          disabled={!projectionBasemapSupportsReprojection}
                          onChange={(e) => setConfig({ ...config, jmaAzimuthalEqualAreaProjection: e.target.checked, jmaNorthPolarStereographicProjection: e.target.checked ? false : config.jmaNorthPolarStereographicProjection })}
                          className="w-4 h-4 accent-white cursor-pointer mt-0.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-35"
                        />
                      </label>
                      <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 cursor-pointer mt-2">
                        <div>
                          <div className="text-[11px] font-semibold text-sky-200">JMA预报图投影</div>
                          <div className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">采用与 JMA 预报图一致的 North Polar Stereographic（lat₀=90°N、lon₀=140°E、lat_ts=60°N）。路径与地图使用同一投影，文字、信息牌、打点和风圈保持屏幕形状不变形。</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={projectionBasemapSupportsReprojection && !!config.jmaNorthPolarStereographicProjection}
                          disabled={!projectionBasemapSupportsReprojection}
                          onChange={(e) => setConfig({ ...config, jmaNorthPolarStereographicProjection: e.target.checked, jmaAzimuthalEqualAreaProjection: e.target.checked ? false : config.jmaAzimuthalEqualAreaProjection })}
                          className="w-4 h-4 accent-white cursor-pointer mt-0.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-35"
                        />
                      </label>
                    </>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <span className="text-[10px] font-medium text-slate-300">中心跟随</span>
                      <input type="checkbox" checked={config.centerFollow} onChange={(e) => setConfig({ ...config, centerFollow: e.target.checked })} className="w-3.5 h-3.5 accent-sky-400" />
                    </label>
                    <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <span className="text-[10px] font-medium text-slate-300">风圈显示</span>
                      <input type="checkbox" checked={config.showWindRadii} onChange={(e) => setConfig({ ...config, showWindRadii: e.target.checked })} className="w-3.5 h-3.5 accent-sky-400" />
                    </label>
                    {isJmaBestTrackProfile && <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <span className="text-[10px] font-medium text-slate-300">数据标注</span>
                      <input type="checkbox" checked={config.showDataLabel} onChange={(e) => setConfig({ ...config, showDataLabel: e.target.checked })} className="w-3.5 h-3.5 accent-sky-400" />
                    </label>}
                    {isJmaBestTrackProfile && <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <span className="text-[10px] font-medium text-slate-300">日期时间</span>
                      <input type="checkbox" checked={config.showDateTime} onChange={(e) => setConfig({ ...config, showDateTime: e.target.checked })} className="w-3.5 h-3.5 accent-sky-400" />
                    </label>}
                  </div>
                </FoldSection>
              )}

              {!specialReplayProfile && <>
              {/* Agency / element style */}
              <FoldSection title="机构与元素风格" icon={<Layers className="h-4 w-4" />} defaultOpen={false}>
                <div className="grid grid-cols-2 gap-2">
                  {(["CMA", "JMA"] as const).map((style) => (
                    <button key={style} onClick={() => setConfig({ ...config, replayStyle: "standard", agencyStyle: style, trackStyle: style, trackDotStyle: style, windRadiiStyle: style, centerStyle: style, mechanismStyle: style, ...(style === "JMA" ? { baseMap: "jma" as const, blueMarbleVersion: "2002" as const, referenceBasemapColorGrade: false, infoBoxStyle: "minimal" as const, dateTimeFormat: "calendar" as const, dotInterval: 24 } : {}) })} className={`py-2 rounded-lg border text-xs font-bold ${(config.agencyStyle || "CMA") === style ? "bg-fuchsia-500/15 border-fuchsia-400 text-fuchsia-300" : "bg-slate-950 border-slate-800 text-slate-400"}`}>
                      {style} 全局
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {([
                    ["trackStyle", "路径"], ["trackDotStyle", "路径打点"], ["windRadiiStyle", "风圈"], ["centerStyle", "中心叉/点"], ["mechanismStyle", "机制信息"]
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">{label}</span>
                      <select value={(config as any)[key] || config.agencyStyle || "CMA"} onChange={(e) => setConfig({ ...config, [key]: e.target.value as "CMA" | "JMA" })} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] text-slate-300">
                        <option value="CMA">CMA</option><option value="JMA">JMA</option>
                      </select>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div>
                        <div className="text-[10px] font-semibold text-slate-300">风速检测标准</div>
                        <div className="text-[9px] text-slate-500 mt-0.5">仅改变视频中的风速数值、单位与强度划分，不改变模拟物理强度</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        { id: "CMA", label: "CMA", sub: "2分钟 · m/s" },
                        { id: "JMA", label: "JMA", sub: "10分钟 · kt" },
                        { id: "JTWC", label: "JTWC", sub: "1分钟 · kt" }
                      ] as const).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setConfig({ ...config, intensityAgency: item.id })}
                          className={`py-2 px-1 rounded-lg border transition text-center ${(config.intensityAgency || "CMA") === item.id ? "bg-cyan-500/15 border-cyan-400 text-cyan-200" : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600"}`}
                        >
                          <div className="text-[10px] font-bold">{item.label}</div>
                          <div className="text-[8px] mt-0.5 opacity-75">{item.sub}</div>
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 mt-2">
                      {([
                        ["public", "公开档位"],
                        ["continuous", "无级档位"]
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setConfig({ ...config, intensityReportingMode: mode })}
                          className={`py-1.5 rounded-lg border text-[9px] font-semibold ${(config.intensityReportingMode || "public") === mode ? "bg-cyan-500/15 border-cyan-400 text-cyan-200" : "bg-slate-950 border-slate-800 text-slate-400"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-1.5 text-[8px] text-slate-500 leading-relaxed">公开档位按机构发布风速档位离散化；无级档位保留连续计算值。该选项同步作用于视频信息框、曲线和片尾报告。</div>
                  </div>
              </FoldSection>

              {/* Section 1: 地图与视角 */}
          <FoldSection title="地图样式与视角" icon={<Layers className="h-4 w-4" />} defaultOpen={true}>

            {/* 底图样式 */}
            <div>
              <label className="text-xs text-slate-400 block mb-1.5 font-medium">底图风格</label>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { id: "dark", label: "暗黑" },
                  { id: "jma", label: "JMA" },
                  { id: "blackGray", label: "黑灰" },
                  { id: "himawari", label: "向日葵" },
                  { id: "satellite", label: "卫星" },
                  { id: "terrain", label: "地形" },
                  { id: "light", label: "高亮" },
                  { id: "googleSatellite", label: "谷歌卫星" },
                  { id: "googleStreet", label: "谷歌街道" },
                  { id: "blueMarble", label: "蓝色弹珠" },
                  { id: "none", label: "无" }
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => { const nextBase = item.id as VideoExportConfig["baseMap"]; const projectionSafe = nextBase === "none" || nextBase === "blueMarble" || isLocalVectorBasemap(nextBase); setConfig({ ...config, baseMap: nextBase, ...(projectionSafe ? {} : { jmaAzimuthalEqualAreaProjection: false, jmaNorthPolarStereographicProjection: false }) }); }}
                    className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      config.baseMap === item.id
                        ? "bg-blue-500/20 border-sky-400 text-sky-300 shadow-md"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {config.baseMap === "blueMarble" && (
                <div className="mt-2 space-y-2">
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1 font-medium">Blue Marble 版本</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {["2002", "2004"].map((version) => (
                        <button
                          key={version}
                          onClick={() => setConfig({ ...config, blueMarbleVersion: version as "2002" | "2004" })}
                          className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                            (config.blueMarbleVersion || "2002") === version
                              ? "bg-blue-500/20 border-sky-400 text-sky-300 shadow-md"
                              : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800"
                          }`}
                        >
                          {version}
                        </button>
                      ))}
                    </div>
                  </div>

                  {isJmaBestTrackProfile && (
                    <label className="flex items-start justify-between gap-3 p-2 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <div>
                        <div className="text-[11px] font-semibold text-amber-200">旧站调色</div>
                        <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">将 Blue Marble 调整成更接近 Digital Typhoon / 旧 JMA 复盘视频的蓝紫海洋与黄绿色陆地色调。</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={!!config.referenceBasemapColorGrade}
                        onChange={(e) => setConfig({ ...config, referenceBasemapColorGrade: e.target.checked })}
                        className="w-3.5 h-3.5 accent-amber-400 cursor-pointer mt-0.5"
                      />
                    </label>
                  )}
                  {isJmaBestTrackProfile && (
                    <label className="flex items-start justify-between gap-3 p-2 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <div>
                        <div className="text-[11px] font-semibold text-cyan-200">新投影</div>
                        <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">开启：以当前台风中心为投影中心的 Lambert Azimuthal Equal-Area 方位等面积投影。关闭：保持原 Web Mercator。路径点按同一投影定位，风圈/打点仍作为正圆绘制。</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={!!config.jmaAzimuthalEqualAreaProjection}
                        onChange={(e) => setConfig({ ...config, jmaAzimuthalEqualAreaProjection: e.target.checked, jmaNorthPolarStereographicProjection: e.target.checked ? false : config.jmaNorthPolarStereographicProjection })}
                        className="w-3.5 h-3.5 accent-white cursor-pointer mt-0.5 disabled:cursor-not-allowed disabled:opacity-35"
                      />
                    </label>
                  )}
                </div>
              )}

              {!projectionBasemapSupportsReprojection && (
                <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[9px] leading-relaxed text-slate-400">
                  当前底图不支持重投影。LAEA 与 JMA 北极立体投影仅对本地矢量/无底图，以及内置 Blue Marble 2002、Blue Marble 2004 开放；其他联网栅格底图保持 Web Mercator。
                </div>
              )}
              <label className={`mt-2 flex items-start justify-between gap-3 p-2 rounded-xl border border-slate-800 ${projectionBasemapSupportsReprojection ? "bg-slate-950 cursor-pointer" : "bg-slate-950/45 opacity-55 cursor-not-allowed"}`}>
                <div>
                  <div className="text-[11px] font-semibold text-slate-200">LAEA 新投影</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">开启：以当前台风中心为中心的 Lambert Azimuthal Equal-Area 方位等面积投影；当前选择的底图、路径与信息同步投影，风圈/打点保持屏幕正圆。关闭：保持原 Web Mercator。</div>
                </div>
                <input
                  type="checkbox"
                  checked={projectionBasemapSupportsReprojection && !!config.jmaAzimuthalEqualAreaProjection}
                  disabled={!projectionBasemapSupportsReprojection}
                  onChange={(e) => setConfig({ ...config, jmaAzimuthalEqualAreaProjection: e.target.checked, jmaNorthPolarStereographicProjection: e.target.checked ? false : config.jmaNorthPolarStereographicProjection })}
                  className="w-3.5 h-3.5 accent-white cursor-pointer mt-0.5 disabled:cursor-not-allowed disabled:opacity-35"
                />
              </label>
              <label className={`mt-2 flex items-start justify-between gap-3 p-2 rounded-xl border border-slate-800 ${projectionBasemapSupportsReprojection ? "bg-slate-950 cursor-pointer" : "bg-slate-950/45 opacity-55 cursor-not-allowed"}`}>
                <div>
                  <div className="text-[11px] font-semibold text-slate-200">JMA预报图投影</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">开启：使用 North Polar Stereographic（90°N / 140°E / true scale 60°N）。当前底图、路径、海岸线和经纬网统一重投影；文字、风圈和信息框不拉伸。与 LAEA 互斥。</div>
                </div>
                <input
                  type="checkbox"
                  checked={projectionBasemapSupportsReprojection && !!config.jmaNorthPolarStereographicProjection}
                  disabled={!projectionBasemapSupportsReprojection}
                  onChange={(e) => setConfig({ ...config, jmaNorthPolarStereographicProjection: e.target.checked, jmaAzimuthalEqualAreaProjection: e.target.checked ? false : config.jmaAzimuthalEqualAreaProjection })}
                  className="w-3.5 h-3.5 accent-white cursor-pointer mt-0.5 disabled:cursor-not-allowed disabled:opacity-35"
                />
              </label>
            </div>

            {/* 地图缩放档位 */}
            <div>
              <label className="text-xs text-slate-400 block mb-1.5 font-medium">地图选区大小 / 缩放档位 (9个档位)</label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {[
                  { level: 1, label: "1 远景" }, { level: 1.5, label: "1.5" },
                  { level: 2, label: "2 区域" }, { level: 2.5, label: "2.5" },
                  { level: 3, label: "3 标准" }, { level: 3.5, label: "3.5" },
                  { level: 4, label: "4 细节" }, { level: 4.5, label: "4.5" },
                  { level: 5, label: "5 特写" }
                ].map((item) => (
                  <button
                    key={item.level}
                    onClick={() => setConfig({ ...config, zoomLevel: item.level })}
                    className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      config.zoomLevel === item.level
                        ? "bg-blue-500/20 border-sky-400 text-sky-300 shadow-md"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 海岸线叠加 & 中心跟随 & 经纬度网格 */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <label className="flex items-center justify-between p-2 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                <span className="text-[11px] font-medium text-slate-300">海岸线叠加</span>
                <input
                  type="checkbox"
                  checked={config.showCoastline}
                  onChange={(e) => setConfig({ ...config, showCoastline: e.target.checked })}
                  className="w-3.5 h-3.5 accent-sky-400 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                <span className="text-[11px] font-medium text-slate-300">中心跟随</span>
                <input
                  type="checkbox"
                  checked={config.centerFollow}
                  onChange={(e) => setConfig({ ...config, centerFollow: e.target.checked })}
                  className="w-3.5 h-3.5 accent-sky-400 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                <span className="text-[11px] font-medium text-slate-300">经纬网格</span>
                <input
                  type="checkbox"
                  checked={config.showGrid}
                  onChange={(e) => setConfig({ ...config, showGrid: e.target.checked })}
                  className="w-3.5 h-3.5 accent-sky-400 cursor-pointer"
                />
              </label>
            </div>
          </FoldSection>

          {/* Section 2: 气象图层与路径打点 */}
          <FoldSection title="气象数据与图层" icon={<Sparkles className="h-4 w-4" />} defaultOpen={false}>

            {/* 预报路线 & 不确定性锥 & 风圈 */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                  <span className="text-xs font-medium text-slate-300">预测路线图层</span>
                  <input
                    type="checkbox"
                    checked={config.showForecast}
                    onChange={(e) => setConfig({ ...config, showForecast: e.target.checked })}
                    className="w-4 h-4 accent-sky-400 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                  <span className="text-xs font-medium text-slate-300">3层4象限风圈</span>
                  <input
                    type="checkbox"
                    checked={config.showWindRadii}
                    onChange={(e) => setConfig({ ...config, showWindRadii: e.target.checked })}
                    className="w-4 h-4 accent-sky-400 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                  <span className="text-xs font-medium text-slate-300">叠加气象站点</span>
                  <input
                    type="checkbox"
                    checked={config.showStations}
                    onChange={(e) => setConfig({ ...config, showStations: e.target.checked })}
                    className="w-4 h-4 accent-sky-400 cursor-pointer"
                  />
                </label>
              </div>

              {/* 站点大小（帧率统一在“编码与输出”中设置，避免重复） */}
              <div className="grid grid-cols-1 gap-3 mt-3">
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider ml-1">站点大小 ({config.stationSizeScale?.toFixed(1)})</span>
                  <input
                    type="range"
                    min="0.3"
                    max="1.5"
                    step="0.1"
                    value={config.stationSizeScale}
                    onChange={(e) => setConfig({ ...config, stationSizeScale: parseFloat(e.target.value) })}
                    className="w-full accent-sky-400 mt-2"
                  />
                </div>
              </div>

              {/* 结束后动作 */}
              <div className="space-y-1.5 mt-3">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider ml-1">结束后动作 (2秒)</span>
                <div className="flex gap-2">
                  {(["none", "pause", "report"] as const).map((action) => (
                    <button
                      key={action}
                      onClick={() => setConfig({ ...config, endAction: action })}
                      className={`flex-1 py-2 text-[10px] font-medium rounded-lg border transition-all ${
                        config.endAction === action
                          ? "bg-blue-500/10 border-sky-500/50 text-blue-400"
                          : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700"
                      }`}
                    >
                      {action === "none" ? "无停顿" : action === "pause" ? "末帧停顿" : "显示报告"}
                    </button>
                  ))}
                </div>
              </div>

              {/* 可选叠加不确定性锥 (概率圈) */}
              {config.showForecast && (
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 cursor-pointer animate-[fadeIn_0.15s_ease-out]">
                  <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    叠加预测不确定性锥 (概率圆/概率圈)
                  </span>
                  <input
                    type="checkbox"
                    checked={config.showUncertaintyCone}
                    onChange={(e) => setConfig({ ...config, showUncertaintyCone: e.target.checked })}
                    className="w-4 h-4 accent-amber-400 cursor-pointer"
                  />
                </label>
              )}
            </div>

            {/* 路径打点业务时次：全局固定 CMA/NMC 北京时间，不随视觉机构切换。 */}
            <div>
              <label className="text-xs text-slate-400 block mb-1.5 font-medium">路径打点时次</label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { interval: 3, label: "CMA 02/05/08/11/14/17/20/23" },
                  { interval: 0, label: "不显示" }
                ].map((item) => (
                  <button
                    key={item.interval}
                    onClick={() => setConfig({ ...config, dotInterval: item.interval })}
                    className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      (item.interval === 0 ? config.dotInterval === 0 : config.dotInterval > 0)
                        ? "bg-orange-500/20 border-amber-400 text-amber-300 shadow-md"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 数据标注配置 */}
            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">数据标注 HUD</span>
                <input
                  type="checkbox"
                  checked={config.showDataLabel}
                  onChange={(e) => setConfig({ ...config, showDataLabel: e.target.checked })}
                  className="w-4 h-4 accent-sky-400 cursor-pointer"
                />
              </div>

              {config.showDataLabel && (
                <div className="space-y-2 pt-1 border-t border-slate-800/80">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1.5">信息框样式</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: "agency", label: "气象机构", desc: "浅底 / 中性数据" },
                        { id: "broadcast", label: "播报台", desc: "深底 / 层级突出" },
                        { id: "monochrome", label: "黑白专业", desc: "无彩色状态" },
                        { id: "minimal", label: "极简字幕", desc: "无卡片边框" }
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setConfig({ ...config, infoBoxStyle: item.id as any })}
                          className={`px-2.5 py-2 rounded-md border text-left transition-all cursor-pointer ${
                            (config.infoBoxStyle || "agency") === item.id
                              ? "bg-slate-200 border-slate-100 text-slate-950"
                              : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600"
                          }`}
                        >
                          <div className="text-[11px] font-bold">{item.label}</div>
                          <div className={`text-[9px] mt-0.5 ${(config.infoBoxStyle || "agency") === item.id ? "text-slate-600" : "text-slate-500"}`}>{item.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">标注内容</label>
                      <select
                        value={config.labelContent}
                        onChange={(e) => setConfig({ ...config, labelContent: e.target.value as any })}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200 cursor-pointer"
                      >
                        <option value="all">气压与风力 (全部)</option>
                        <option value="pressure">仅气压 (hPa)</option>
                        <option value="windSpeed">仅风力</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">标注位置</label>
                      <select
                        value={config.labelPosition}
                        onChange={(e) => setConfig({ ...config, labelPosition: e.target.value as any })}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200 cursor-pointer"
                      >
                        <option value="top-right">右上角</option>
                        <option value="top-left">左上角</option>
                        <option value="bottom-right">右下角</option>
                        <option value="bottom-left">左下角</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                    <span className="text-[11px] font-medium text-purple-300 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                      显示台风物理状态 (如眼墙置换/爆发增强/冷水上翻/已登陆等)
                    </span>
                    <input
                      type="checkbox"
                      checked={config.showStatus}
                      onChange={(e) => setConfig({ ...config, showStatus: e.target.checked })}
                      className="w-3.5 h-3.5 accent-purple-400 cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                    <span className="text-[11px] font-medium text-rose-300 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                      显示估计伤亡人数信息
                    </span>
                    <input
                      type="checkbox"
                      checked={config.showCasualties}
                      onChange={(e) => setConfig({ ...config, showCasualties: e.target.checked })}
                      className="w-3.5 h-3.5 accent-rose-400 cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                    <span className="text-[11px] font-medium text-sky-300 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                      显示时间与日期标注 (h)
                    </span>
                    <input
                      type="checkbox"
                      checked={config.showDateTime}
                      onChange={(e) => setConfig({ ...config, showDateTime: e.target.checked })}
                      className="w-3.5 h-3.5 accent-sky-400 cursor-pointer"
                    />
                  </div>

                  {config.showDateTime && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-800/40 pl-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfig({ ...config, dateTimeFormat: "relative" })}
                          className={`flex-1 py-1 text-[10px] font-semibold rounded border transition-all ${
                            config.dateTimeFormat === "relative" 
                              ? "bg-blue-500/20 border-sky-400 text-sky-300" 
                              : "bg-slate-900 border-slate-800 text-slate-400"
                          }`}
                        >
                          相对小时
                        </button>
                        <button
                          onClick={() => setConfig({ ...config, dateTimeFormat: "calendar" })}
                          className={`flex-1 py-1 text-[10px] font-semibold rounded border transition-all ${
                            config.dateTimeFormat === "calendar" 
                              ? "bg-blue-500/20 border-sky-400 text-sky-300" 
                              : "bg-slate-900 border-slate-800 text-slate-400"
                          }`}
                        >
                          真实日期
                        </button>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1 font-medium">日期显示位置</label>
                        <select
                          value={config.dateTimePosition || "inside"}
                          onChange={(e) => setConfig({ ...config, dateTimePosition: e.target.value as any })}
                          className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200 cursor-pointer font-medium"
                        >
                          <option value="inside">在信息框内部显示</option>
                          <option value="top-left">四个角: 画面左上角</option>
                          <option value="top-right">四个角: 画面右上角</option>
                          <option value="bottom-left">四个角: 画面左下角</option>
                          <option value="bottom-right">四个角: 画面右下角</option>
                        </select>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">数据显示大小 (实时预览)</label>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { id: "small", label: "小" },
                        { id: "medium", label: "中" },
                        { id: "large", label: "大" },
                        { id: "extraLarge", label: "特大" }
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setConfig({ ...config, labelSize: item.id as any })}
                          className={`py-1 text-xs font-semibold rounded border transition-all cursor-pointer ${
                            config.labelSize === item.id
                              ? "bg-blue-500/20 border-sky-400 text-sky-300 shadow-sm"
                              : "bg-slate-900 border-slate-700 text-slate-400 hover:text-white"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </FoldSection>

              </>}

          {/* Every profile, including JMA Best Track and Himawari 8, keeps the full video-output controls on its own page. */}
          <FoldSection title={specialReplayProfile ? "视频输出设置" : "编码、画质与输出"} icon={<Film className="h-4 w-4" />} defaultOpen={true}>

            {/* 画面比例 */}
            <div>
              <label className="text-xs text-slate-400 block mb-1.5 font-medium">画面比例</label>
              <div className="grid grid-cols-5 gap-1.5">
                {["16:9", "4:3", "3:4", "1:1", "9:16"].map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => setConfig({ ...config, aspectRatio: ratio as any })}
                    className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      config.aspectRatio === ratio
                        ? "bg-teal-500/20 border-emerald-400 text-emerald-300 shadow-md"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            {/* 画质分辨率 */}
            <div>
              <label className="text-xs text-slate-400 block mb-1.5 font-medium">画质分辨率</label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: "360p", label: "360p (旧站低清)" },
                  { id: "480p", label: "480p (标清)" },
                  { id: "720p", label: "720p (高清)" },
                  { id: "1080p", label: "1080p (全高清)" },
                  { id: "2K", label: "2K (2.5K 极清)" },
                  { id: "4K", label: "4K (超清全尺寸)" }
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setConfig({
                        ...config,
                        videoResolution: item.id as any
                      });
                    }}
                    className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      config.videoResolution === item.id
                        ? "bg-teal-500/20 border-emerald-400 text-emerald-300 shadow-md"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {isJmaBestTrackProfile && (
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">JMA 复盘视频已开放更低清晰度输出；若想更接近旧版参考观感，建议选择 360p / 480p，并配合“旧站调色”。</p>
              )}

              <div className="mt-3">
                <label className="text-xs text-slate-400 block mb-1.5 font-medium">视频编码格式 (HEVC / AVC)</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: "H.264", label: "H.264 (兼容/AVC)" },
                    { id: "H.265", label: "H.265 (高效/HEVC)" }
                  ].map((codecItem) => (
                    <button
                      key={codecItem.id}
                      onClick={() => setConfig({ ...config, videoCodec: codecItem.id as any })}
                      className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                        (config.videoCodec || "H.264") === codecItem.id
                          ? "bg-teal-500/20 border-emerald-400 text-emerald-300 shadow-md"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800"
                      }`}
                    >
                      {codecItem.label}
                    </button>
                  ))}
                </div>
                {config.videoResolution === "4K" && config.videoCodec === "H.264" && (
                  <p className="text-[10px] text-teal-400 mt-1.5 flex items-start gap-1 animate-[fadeIn_0.15s_ease-out] bg-emerald-500/5 p-1.5 rounded-lg border border-emerald-500/20">
                    <ShieldAlert className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>4K 模式使用 H.264 时，将自动启用 Level 5.2 规范并微调尺寸以确保硬件编码兼容性。</span>
                  </p>
                )}
              </div>

              {/* 视频码率 */}
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                  <span>视频码率 (Bitrate)</span>
                  <span className="text-teal-400 font-mono font-bold">
                    {config.bitrate ? (config.bitrate / 1000000).toFixed(1) : "自动"} Mbps
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={120000000}
                  step={2000000}
                  value={config.bitrate || 0}
                  onChange={(e) => setConfig({ ...config, bitrate: Number(e.target.value) || undefined })}
                  className="w-full accent-emerald-500 h-1.5 bg-slate-950 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-slate-500 font-mono px-1">
                  <span>自动</span>
                  <span>60M</span>
                  <span>120M</span>
                </div>
              </div>
            </div>

            {/* 动画时长 (2-30秒) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                <span>动画时长 (2 - 30 秒)</span>
                <span className="text-teal-400 font-mono font-bold">{config.durationSec || 10} 秒</span>
              </div>
              <input
                type="range"
                min={2}
                max={30}
                step={1}
                value={config.durationSec || 10}
                onChange={(e) => setConfig({ ...config, durationSec: Number(e.target.value) })}
                className="w-full accent-emerald-500 h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer border border-slate-800"
              />
            </div>

            {/* 动画帧率 (1-60fps) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                <span>动画帧率 (1 - 60 FPS)</span>
                <span className="text-teal-400 font-mono font-bold">{config.fps || 30} FPS</span>
              </div>
              <input
                type="range"
                min={1}
                max={60}
                step={1}
                value={config.fps || 30}
                onChange={(e) => setConfig({ ...config, fps: Number(e.target.value) })}
                className="w-full accent-emerald-500 h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer border border-slate-800"
              />
            </div>
          </FoldSection>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Footer */}
          <div className="sticky bottom-0 z-20 -mx-2 px-2 py-3 border-t border-white/10 bg-zinc-950/82 backdrop-blur-2xl flex items-center justify-between gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              取消
            </button>

            {generatedVideoUrl ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setGeneratedVideoUrl(null)}
                  className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  重新配置
                </button>
                <a
                  href={generatedVideoUrl}
                  download={`台风_${currentDisplayName}_模拟动画视频.mp4`}
                  className="aether-button px-5 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-all cursor-pointer shadow-lg flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  下载视频文件
                </a>
              </div>
            ) : (
              <button
                onClick={handleStartRender}
                disabled={isRendering}
                className="px-6 py-2.5 text-xs font-bold bg-white/10 hover:bg-white/15 border border-white/65 text-white rounded-lg transition-all cursor-pointer shadow-lg shadow-white/10 flex items-center gap-2 disabled:opacity-50"
              >
                <Video className="w-4 h-4" />
                开始生成视频
              </button>
            )}
          </div>

        </div>

      </div>

      {/* Rendering Progress Modal Overlay */}
      {isRendering && renderProgress && (
        <div className="fixed inset-0 z-[110000] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-6 sm:p-8 rounded-xl w-full max-w-md shadow-2xl flex flex-col items-center text-center space-y-5 animate-[scaleUp_0.2s_ease-out]">
            
            <div className="relative flex items-center justify-center">
              {/* Outer pulsing ring */}
              <div className="w-20 h-20 rounded-full border-4 border-white/10 border-t-white/80 animate-spin" />
              <Film className="w-8 h-8 text-white/80 absolute" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-white mb-1">正在生成台风模拟动画视频</h3>
              <p className="min-h-[1rem] text-xs text-slate-400 font-mono tabular-nums">{renderProgress.statusText}</p>
            </div>

            {/* Progress Bar */}
            <div className="w-full space-y-2">
              <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-zinc-300 to-white rounded-full transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(0, Math.min(100, renderProgress.percentage))}%` }}
                />
              </div>

              <div className="grid grid-cols-[1fr_4.5rem] items-center text-xs font-mono tabular-nums text-slate-400">
                <span className="block min-w-0 text-left whitespace-nowrap">
                  <span className="inline-block w-[4.25rem] text-right">{renderProgress.currentFrame}</span>
                  <span className="inline-block px-1.5">/</span>
                  <span className="inline-block w-[4.25rem] text-left">{renderProgress.totalFrames}</span>
                  <span className="pl-1">帧</span>
                </span>
                <span className="block w-[4.5rem] text-right text-white font-bold">{renderProgress.percentage}%</span>
              </div>
            </div>

            {/* Cancel Button */}
            <button
              onClick={handleCancelRender}
              className="px-5 py-2 text-xs font-semibold text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors border border-slate-800 cursor-pointer"
            >
              中断并取消生成
            </button>

          </div>
        </div>
      )}

    </div>
  );
}
