import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FileText, X, SlidersHorizontal } from "lucide-react";
import type { Typhoon } from "../types";
import {
  buildSeasonStationReportDataset,
  selectStationReportRange,
  DEFAULT_STATION_REPORT_OPTIONS,
  drawStationReportCanvas,
  getStationReportCanvasDimensions,
  StationChartMetric,
  StationReportOptions
} from "../utils/StationReportRenderer";

interface StationReportModalProps {
  station: { id: string; name: string; lat: number; lon: number; temporary?: boolean; sourceName?: string };
  typhoons: Typhoon[];
  startDate?: Date;
  onClose: () => void;
}

const chartChoices: Array<{ id: StationChartMetric; label: string }> = [
  { id: "wind", label: "风速 / 阵风曲线" },
  { id: "pressure", label: "气压曲线" },
  { id: "precipitation", label: "小时降水柱状图" },
  { id: "surge", label: "风暴潮曲线（黑色）" }
];

function loadChartCount(): 1 | 2 | 3 {
  const n = Number(localStorage.getItem("station_report_chart_count") || 3);
  return n === 1 || n === 2 ? n : 3;
}
function loadCharts(): StationChartMetric[] {
  try {
    const arr = JSON.parse(localStorage.getItem("station_report_charts") || "null");
    if (Array.isArray(arr)) return [0, 1, 2].map((i) => chartChoices.some((c) => c.id === arr[i]) ? arr[i] : DEFAULT_STATION_REPORT_OPTIONS.charts[i]);
  } catch {}
  return [...DEFAULT_STATION_REPORT_OPTIONS.charts];
}

export default function StationReportModal({ station, typhoons, startDate: propStartDate, onClose }: StationReportModalProps) {
  const typhoon = typhoons[0];
  const savedStart = localStorage.getItem("typhoon_sim_start_date");
  const startDate = propStartDate || (savedStart ? new Date(savedStart) : new Date("2027-06-30T20:00:00"));
  const dataset = useMemo(() => typhoons.length ? buildSeasonStationReportDataset(station, typhoons, startDate) : null, [station.id, station.name, station.lat, station.lon, station.temporary, station.sourceName, typhoons, startDate.getTime()]);
  const displayName = "整个风季";
  const [rangeMode, setRangeMode] = useState(false);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);

  const [showMaxWind, setShowMaxWind] = useState(() => localStorage.getItem("station_showMaxWind") !== "false");
  const [showMaxGust, setShowMaxGust] = useState(() => localStorage.getItem("station_showMaxGust") !== "false");
  const [showMinPressure, setShowMinPressure] = useState(() => localStorage.getItem("station_showMinPressure") !== "false");
  const [showMaxSurge, setShowMaxSurge] = useState(() => localStorage.getItem("station_showMaxSurge") !== "false");
  const [showCasualties, setShowCasualties] = useState(() => localStorage.getItem("station_showCasualties") !== "false");
  const [showCityName, setShowCityName] = useState(() => localStorage.getItem("station_showCityName") !== "false");
  const [chartCount, setChartCount] = useState<1 | 2 | 3>(loadChartCount);
  const [charts, setCharts] = useState<StationChartMetric[]>(loadCharts);
  const [resolution, setResolution] = useState<"720p" | "1080p" | "2K" | "4K">(() => (localStorage.getItem("station_resolution") as any) || "2K");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "4:3" | "1:1" | "9:16">(() => (localStorage.getItem("station_aspectRatio") as any) || "4:3");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!dataset) return;
    setRangeStart((v) => v === 0 ? dataset.firstHour : Math.max(dataset.firstHour, Math.min(v, dataset.currentHour)));
    setRangeEnd((v) => v === 0 ? dataset.currentHour : Math.max(dataset.firstHour, Math.min(v, dataset.currentHour)));
  }, [dataset?.firstHour, dataset?.currentHour]);

  const rangedDataset = useMemo(() => dataset ? selectStationReportRange(dataset, rangeStart || dataset.firstHour, rangeEnd || dataset.currentHour, 230) : null, [dataset, rangeStart, rangeEnd]);

  const options: StationReportOptions = useMemo(() => ({ showMaxWind, showMaxGust, showMinPressure, showMaxSurge, showCasualties, showCityName, chartCount, charts }), [showMaxWind, showMaxGust, showMinPressure, showMaxSurge, showCasualties, showCityName, chartCount, charts]);

  useEffect(() => {
    localStorage.setItem("station_showMaxWind", String(showMaxWind));
    localStorage.setItem("station_showMaxGust", String(showMaxGust));
    localStorage.setItem("station_showMinPressure", String(showMinPressure));
    localStorage.setItem("station_showMaxSurge", String(showMaxSurge));
    localStorage.setItem("station_showCasualties", String(showCasualties));
    localStorage.setItem("station_showCityName", String(showCityName));
    localStorage.setItem("station_report_chart_count", String(chartCount));
    localStorage.setItem("station_report_charts", JSON.stringify(charts));
    localStorage.setItem("station_resolution", resolution);
    localStorage.setItem("station_aspectRatio", aspectRatio);
  }, [showMaxWind, showMaxGust, showMinPressure, showMaxSurge, showCasualties, showCityName, chartCount, charts, resolution, aspectRatio]);

  // Lightweight preview only. Full requested resolution is rendered only when exporting,
  // avoiding repeated 2K/4K redraws while toggling controls on mobile.
  useEffect(() => {
    if (!rangedDataset || !canvasRef.current) return;
    const ratio = aspectRatio === "16:9" ? 16 / 9 : aspectRatio === "4:3" ? 4 / 3 : aspectRatio === "1:1" ? 1 : 9 / 16;
    const w = aspectRatio === "9:16" ? 720 : 1120;
    const h = Math.round(w / ratio);
    const canvas = canvasRef.current;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) drawStationReportCanvas(ctx, w, h, rangedDataset, options, rangedDataset.currentHour);
  }, [rangedDataset, options, aspectRatio]);

  const renderFull = () => {
    if (!rangedDataset) return null;
    const { width, height } = getStationReportCanvasDimensions(resolution, aspectRatio);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawStationReportCanvas(ctx, width, height, rangedDataset, options, rangedDataset.currentHour);
    return canvas;
  };

  const handleDownload = () => {
    const canvas = renderFull();
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `${station.name}_风季气象站报告_${Math.round(rangeStart)}-${Math.round(rangeEnd)}h.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };
  const handlePreview = () => {
    const canvas = renderFull();
    if (!canvas) return;
    setPreviewUrl(canvas.toDataURL("image/png"));
  };
  const changeChart = (index: number, metric: StationChartMetric) => setCharts((prev) => {
    const next = [...prev]; next[index] = metric; return next;
  });

  if (!typhoon || !dataset || !rangedDataset) return null;

  return (
    <div className="fixed inset-0 z-[8200] bg-[#07111F] text-slate-100 flex flex-col overflow-hidden">
      <header className="h-14 shrink-0 border-b border-slate-800 bg-[#0b1420] px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0"><FileText className="w-5 h-5 text-sky-400 shrink-0"/><div className="min-w-0"><h2 className="font-bold text-sm sm:text-base truncate">气象站报告图制作</h2><p className="text-[10px] text-slate-500 truncate">{station.name} · {displayName}</p></div></div>
        <button onClick={onClose} className="w-9 h-9 rounded-lg border border-slate-700 bg-slate-900 flex items-center justify-center"><X className="w-4 h-4"/></button>
      </header>

      <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1.7fr)_minmax(310px,.8fr)]">
        <section className="min-h-0 bg-slate-950 p-3 sm:p-5 flex flex-col gap-3 overflow-hidden">
          <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto">
            <canvas ref={canvasRef} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl bg-white" />
          </div>
          {rangeMode && (
            <div className="shrink-0 rounded-xl border border-slate-800 bg-[#0b1420] p-3">
              <div className="flex items-center justify-between gap-3 mb-2 text-[10px]">
                <span className="font-bold text-sky-300">风季查询时段</span>
                <span className="font-mono text-slate-400">{Math.round(rangeStart)}h — {Math.round(rangeEnd)}h · 已绘制 {rangedDataset.points.length} 个自适应采样点</span>
              </div>
              <div className="relative h-8 mx-1">
                <div className="absolute left-0 right-0 top-3 h-1 rounded-full bg-slate-800" />
                <div className="absolute top-3 h-1 rounded-full bg-sky-500/60" style={{ left: `${100 * (rangeStart - dataset.firstHour) / Math.max(1, dataset.currentHour - dataset.firstHour)}%`, right: `${100 - 100 * (rangeEnd - dataset.firstHour) / Math.max(1, dataset.currentHour - dataset.firstHour)}%` }} />
                <input aria-label="起始时间" type="range" min={dataset.firstHour} max={dataset.currentHour} step={1} value={rangeStart} onChange={(e) => setRangeStart(Math.min(Number(e.target.value), rangeEnd - 1))} className="absolute inset-0 w-full h-7 appearance-none bg-transparent accent-sky-400 pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto" />
                <input aria-label="结束时间" type="range" min={dataset.firstHour} max={dataset.currentHour} step={1} value={rangeEnd} onChange={(e) => setRangeEnd(Math.max(Number(e.target.value), rangeStart + 1))} className="absolute inset-0 w-full h-7 appearance-none bg-transparent accent-cyan-300 opacity-80 pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto" />
              </div>
              <div className="flex justify-between text-[9px] font-mono text-slate-500"><span>{new Date(startDate.getTime() + rangeStart * 3600000).toLocaleString()}</span><span>{new Date(startDate.getTime() + rangeEnd * 3600000).toLocaleString()}</span></div>
              <p className="mt-1.5 text-[9px] text-slate-600">长时间跨度仅降低绘图采样密度，不删除原始小时资料；每个采样桶会保留阵风、降水、最低气压和风暴潮极值。</p>
            </div>
          )}
        </section>
        <aside className="min-h-0 overflow-y-auto border-t lg:border-t-0 lg:border-l border-slate-800 bg-[#0b1420] p-4 space-y-5">
          <div><button onClick={() => setRangeMode((v) => !v)} className={`w-full py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 ${rangeMode ? "border-sky-400 bg-sky-500/15 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-300"}`}><SlidersHorizontal className="w-4 h-4"/>{rangeMode ? "关闭时间段" : "风季时间段"}</button></div>
          <section className="space-y-2"><h3 className="text-xs font-bold text-slate-300">信息显示</h3><div className="grid grid-cols-2 gap-2 text-[11px]">
            {[
              ["最大平均风", showMaxWind, setShowMaxWind], ["最大阵风", showMaxGust, setShowMaxGust], ["最低气压", showMinPressure, setShowMinPressure],
              ["最大风暴潮", showMaxSurge, setShowMaxSurge], ["伤亡", showCasualties, setShowCasualties], ["站点坐标", showCityName, setShowCityName]
            ].map(([label, checked, setter]: any) => <label key={label} className={`rounded-lg border px-3 py-2 flex items-center gap-2 cursor-pointer ${checked ? "border-sky-500/40 bg-sky-500/10 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-400"}`}><input type="checkbox" checked={checked} onChange={(e) => setter(e.target.checked)} className="accent-sky-500"/>{label}</label>)}
          </div></section>

          <section className="space-y-3"><div><h3 className="text-xs font-bold text-slate-300">图表布局</h3><p className="text-[10px] text-slate-500 mt-1">1 个全幅；2 个上下；3 个上 / 中 / 下。每个图表可独立选择。</p></div>
            <div className="grid grid-cols-3 gap-2">{([1,2,3] as const).map((n) => <button key={n} onClick={() => setChartCount(n)} className={`py-2 rounded-lg border text-xs font-bold ${chartCount === n ? "border-sky-400 bg-sky-500/15 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-400"}`}>{n} 个图表</button>)}</div>
            {Array.from({ length: chartCount }, (_, i) => <label key={i} className="block"><span className="text-[10px] text-slate-500 block mb-1">{chartCount === 3 ? ["上方图表","中间图表","下方图表"][i] : chartCount === 2 ? ["上方图表","下方图表"][i] : "图表"}</span><select value={charts[i]} onChange={(e) => changeChart(i, e.target.value as StationChartMetric)} className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2.5 text-xs text-slate-200">{chartChoices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>)}
          </section>

          <section className="grid grid-cols-2 gap-3"><label><span className="text-[10px] text-slate-500 block mb-1">分辨率</span><select value={resolution} onChange={(e) => setResolution(e.target.value as any)} className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2.5 text-xs"><option value="720p">720p</option><option value="1080p">1080p</option><option value="2K">2K</option><option value="4K">4K</option></select></label><label><span className="text-[10px] text-slate-500 block mb-1">比例</span><select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as any)} className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2.5 text-xs"><option value="4:3">4:3</option><option value="16:9">16:9</option><option value="1:1">1:1</option><option value="9:16">9:16</option></select></label></section>
          <div className="grid grid-cols-2 gap-2"><button onClick={handlePreview} className="py-2.5 rounded-xl border border-slate-700 bg-slate-900 text-xs font-semibold flex items-center justify-center gap-2"><ExternalLink className="w-4 h-4"/>查看原图</button><button onClick={handleDownload} className="py-2.5 rounded-xl bg-sky-500 text-slate-950 text-xs font-bold flex items-center justify-center gap-2"><Download className="w-4 h-4"/>下载 PNG</button></div>
        </aside>
      </div>

      {previewUrl && <div className="fixed inset-0 z-[8300] bg-black/90 p-4 flex items-center justify-center" onClick={() => setPreviewUrl(null)}><img src={previewUrl} className="max-w-full max-h-full object-contain" alt="station report preview"/></div>}
    </div>
  );
}
