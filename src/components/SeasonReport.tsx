import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Download, FileImage, X, ArrowLeft } from "lucide-react";
import type { Typhoon } from "../types";
import { aceOf, casualtiesOf, estimatedLossBillionCny, minPressureOf, peakOf } from "../utils/TyphoonReportMetrics";
import { drawSeasonTrackReport } from "./TyphoonReportModal";
import { loadProductNaturalEarthData } from "../simulation/NaturalEarthLoader";

interface SeasonReportProps {
  typhoons: Typhoon[];
  startDate: Date;
  onClose: () => void;
  onOpenTyphoonReport: (typhoon: Typhoon) => void;
}

const fmt = (v: number, d = 1) => Number.isFinite(v) ? v.toFixed(d) : "—";

function orderedStorms(typhoons: Typhoon[]) {
  return [...typhoons]
    .filter((t) => (t.history || []).length > 0)
    .sort((a, b) => Number(a.seasonStartHour ?? a.history?.[0]?.simHour ?? 0) - Number(b.seasonStartHour ?? b.history?.[0]?.simHour ?? 0));
}

export default function SeasonReport({ typhoons, startDate, onClose, onOpenTyphoonReport }: SeasonReportProps) {
  const storms = useMemo(() => orderedStorms(typhoons), [typhoons]);
  const summaries = useMemo(() => storms.map((ty) => {
    const peak = peakOf(ty);
    return {
      ty,
      peak,
      maxWind: Number(peak?.vmax || 0),
      minPressure: minPressureOf(ty),
      ace: aceOf(ty),
      casualties: casualtiesOf(ty),
      loss: estimatedLossBillionCny(ty),
      landfalls: ty.landfallRecords?.length || 0
    };
  }), [storms]);
  const totalAce = summaries.reduce((a, s) => a + s.ace, 0);
  const totalCasualties = summaries.reduce((a, s) => a + s.casualties, 0);
  const totalLoss = summaries.reduce((a, s) => a + s.loss, 0);
  const totalLandfalls = summaries.reduce((a, s) => a + s.landfalls, 0);
  const affectedStorms = summaries.filter((s) => s.landfalls > 0 || Number((s.ty as any).landContactHours || 0) > 0).length;
  const strongest = summaries.reduce<(typeof summaries)[number] | null>((best, s) => !best || s.maxWind > best.maxWind ? s : best, null);
  const regions = Array.from(new Set(storms.flatMap((t) => (t.landfallRecords || []).map((r) => r.region).filter(Boolean))));

  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => storms.map((s) => s.id));
  const [resolution, setResolution] = useState<"1080p" | "2K" | "4K">("2K");
  const [aspect, setAspect] = useState<"16:9" | "4:3">("16:9");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => setSelectedIds((prev) => {
    const valid = new Set(storms.map((s) => s.id));
    const kept = prev.filter((id) => valid.has(id));
    return kept.length ? kept : storms.map((s) => s.id);
  }), [storms]);

  const openDetail = (ty: Typhoon) => {
    // Wind-season detail is the same canonical report page as a normal single-storm report.
    // Passing the archived Typhoon object directly keeps its complete history/station observations
    // intact instead of rebuilding a partial detail-only dataset.
    onOpenTyphoonReport(ty);
  };

  const reportStorms = useMemo(() => storms.filter((s) => selectedIds.includes(s.id)), [storms, selectedIds]);
  useEffect(() => {
    if (!generatorOpen || !canvasRef.current || !reportStorms.length) return;
    const canvas = canvasRef.current;
    const ratio = aspect === "16:9" ? 16 / 9 : 4 / 3;
    canvas.width = 1180;
    canvas.height = Math.round(1180 / ratio);
    const ctx = canvas.getContext("2d");
    if (ctx) drawSeasonTrackReport(ctx, canvas.width, canvas.height, reportStorms, startDate);
  }, [generatorOpen, reportStorms, aspect, startDate]);

  const exportSeasonMap = () => {
    if (!reportStorms.length) return;
    const long = resolution === "1080p" ? 1920 : resolution === "2K" ? 2560 : 3840;
    const ratio = aspect === "16:9" ? 16 / 9 : 4 / 3;
    const width = aspect === "16:9" ? long : Math.round(long * 0.75);
    const height = Math.round(width / ratio);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    drawSeasonTrackReport(ctx, width, height, reportStorms, startDate);
    const a = document.createElement("a");
    a.download = `TyphoonSIM_风季_CMA路径图_${reportStorms.length}台风.png`;
    a.href = canvas.toDataURL("image/png"); a.click();
  };

  if (generatorOpen) {
    return <div className="fixed inset-0 z-[9300] bg-[#07111f] text-slate-100 flex flex-col">
      <header className="h-14 shrink-0 px-4 sm:px-6 border-b border-slate-800 bg-[#0b1420] flex items-center justify-between">
        <div className="flex items-center gap-3"><button onClick={() => setGeneratorOpen(false)} className="w-9 h-9 rounded-lg border border-slate-700 flex items-center justify-center"><ArrowLeft className="w-4 h-4"/></button><div><h2 className="text-sm font-bold">风季报告图生成</h2><p className="text-[10px] text-slate-500">仅提供 CMA 风格多台风叠加路径图</p></div></div>
        <button onClick={onClose} className="w-9 h-9 rounded-lg border border-slate-700 flex items-center justify-center"><X className="w-4 h-4"/></button>
      </header>
      <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1.7fr)_360px]">
        <section className="min-h-0 p-4 bg-slate-950 flex items-center justify-center overflow-auto"><canvas ref={canvasRef} className="max-w-full max-h-full bg-white shadow-2xl"/></section>
        <aside className="min-h-0 overflow-y-auto border-l border-slate-800 bg-[#0b1420] p-4 space-y-4">
          <div className="rounded-xl border border-sky-700/30 bg-sky-500/5 p-3"><div className="text-xs font-bold text-sky-300">CMA 风格路径图</div><p className="text-[10px] text-slate-500 mt-1">海陆底色、气压连续着色、业务时次打点与正常单台风 CMA 路径报告共用同一绘制规范。</p></div>
          <section><div className="flex items-center justify-between mb-2"><h3 className="text-xs font-bold">选择台风</h3><button onClick={() => setSelectedIds(selectedIds.length === storms.length ? [] : storms.map((s) => s.id))} className="text-[10px] text-sky-400">{selectedIds.length === storms.length ? "全不选" : "全选"}</button></div><div className="space-y-1.5">{storms.map((s, i) => <label key={s.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] cursor-pointer"><span>{i + 1}. {s.name}</span><input type="checkbox" checked={selectedIds.includes(s.id)} onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id))} className="accent-sky-500"/></label>)}</div></section>
          <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-500">分辨率<select value={resolution} onChange={(e) => setResolution(e.target.value as any)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200"><option value="1080p">1080p</option><option value="2K">2K</option><option value="4K">4K</option></select></label><label className="text-[10px] text-slate-500">比例<select value={aspect} onChange={(e) => setAspect(e.target.value as any)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200"><option value="16:9">16:9</option><option value="4:3">4:3</option></select></label></div>
          <button disabled={!reportStorms.length} onClick={exportSeasonMap} className="w-full py-3 rounded-xl bg-sky-500 disabled:opacity-40 text-slate-950 text-xs font-bold flex items-center justify-center gap-2"><Download className="w-4 h-4"/>生成并下载 PNG</button>
        </aside>
      </div>
    </div>;
  }

  return <div className="fixed inset-0 z-[9200] bg-[#07111f] text-slate-100 overflow-y-auto">
    <header className="sticky top-0 z-10 h-14 px-4 sm:px-6 border-b border-slate-800 bg-[#0b1420]/96 backdrop-blur flex items-center justify-between"><div><h1 className="font-bold">风季模拟报告</h1><p className="text-[10px] text-slate-500">{storms.length} 个台风 · {startDate.toLocaleDateString()} 起</p></div><button onClick={onClose} className="w-9 h-9 rounded-lg border border-slate-700 flex items-center justify-center"><X className="w-4 h-4"/></button></header>
    <main className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[['总 ACE', totalAce.toFixed(2)], ['总伤亡', `${Math.round(totalCasualties)} 人`], ['模拟经济损失', `¥${totalLoss.toFixed(1)} 亿`], ['影响陆地台风', `${affectedStorms}/${storms.length}`], ['登陆次数', String(totalLandfalls)]].map(([k,v]) => <div key={k} className="rounded-xl border border-slate-800 bg-slate-900/55 p-3"><div className="text-[10px] text-slate-500">{k}</div><div className="mt-1 text-lg font-bold text-slate-100">{v}</div></div>)}
      </section>
      <section className="rounded-xl border border-slate-800 bg-slate-900/45 p-4 grid md:grid-cols-2 gap-4"><div><div className="text-[10px] text-slate-500">风王</div><div className="mt-1 text-xl font-bold text-sky-300">{strongest?.ty.name || "—"}</div><div className="text-xs text-slate-400">最大风速 {strongest ? fmt(strongest.maxWind) : "—"} m/s · 最低气压 {strongest ? Math.round(strongest.minPressure) : "—"} hPa</div></div><div><div className="text-[10px] text-slate-500">主要受灾区域</div><div className="mt-1 text-sm text-slate-300">{regions.length ? regions.slice(0, 8).join("、") : "本风季未记录明确登陆区域"}</div><div className="mt-1 text-[10px] text-slate-600">经济损失为基于模拟风强、陆地接触时长、登陆次数与伤亡的模型估算值。</div></div></section>

      <section className="space-y-2"><div className="flex items-end justify-between"><div><h2 className="text-sm font-bold">台风列表</h2><p className="text-[10px] text-slate-500">按风季生成顺序排列</p></div></div>{summaries.map((s, i) => <div key={s.ty.id} className="rounded-xl border border-slate-800 bg-slate-900/45 px-3 py-3 grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center"><div className="min-w-0"><div className="font-bold text-sm truncate">{i + 1}. {s.ty.name}</div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400"><span>最大风速 <b className="text-slate-200">{fmt(s.maxWind)} m/s</b></span><span>最低气压 <b className="text-slate-200">{Math.round(s.minPressure)} hPa</b></span><span>ACE <b className="text-slate-200">{s.ace.toFixed(2)}</b></span><span>伤亡 <b className="text-slate-200">{Math.round(s.casualties)}</b></span></div></div><button title="详细信息" onClick={() => openDetail(s.ty)} className="w-9 h-9 rounded-lg border border-sky-700/40 bg-sky-500/10 text-sky-300 flex items-center justify-center hover:bg-sky-500/20"><AlertCircle className="w-4 h-4"/></button></div>)}</section>

      <button onClick={async () => { await loadProductNaturalEarthData(); setGeneratorOpen(true); }} className="w-full py-3 rounded-xl bg-sky-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2"><FileImage className="w-4 h-4"/>生成风季报告图</button>
    </main>

  </div>;
}
