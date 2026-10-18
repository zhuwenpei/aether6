import { useEffect, useMemo, useState } from "react";
import { X, Award, ShieldAlert, Zap, Compass, Flame, CheckCircle, Activity, Video, FileText } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { SimulationConfig, Typhoon } from "../types";
import { fetchOsmStationName, getAgencyIntensity, getJtwcSshwsAssessment, getLandMetrics, isMinorIslandOperationalIgnored } from "../simulation/Engine";
import VideoExportModal from "./VideoExportModal";
import TyphoonReportModal from "./TyphoonReportModal";
import { getTyphoonDisplayName, getTyphoonOfficialNumber } from "../utils/TyphoonDisplayName";
import { DEFAULT_CONFIG } from "../config/DefaultSettings";
import { aceOf, casualtiesOf, estimatedLossBillionCny, formatReportTime, peakOf, scanLandExtremes, type LandExtremes } from "../utils/TyphoonReportMetrics";
import { nearestKnownCityName, stationCityDisplayName, stationCityName } from "../utils/CityNames";
import {threeHourlyReportNodes} from "../utils/ThreeHourlyReportNodes";

const cleanLandName = (rawName: string) => {
  return rawName
    .replace(/\s*\(OSM Geofabrik Asia 提取\)/g, "")
    .replace(/\s*\(精细气象观测掩膜\)/g, "")
    .replace(/\s*\(西太平洋.*\)/g, "")
    .replace(/\s*\(大湾区.*\)/g, "")
    .replace(/\s*\(东海.*\)/g, "")
    .replace(/\s*\(长江.*\)/g, "")
    .replace(/\s*\(高纬度.*\)/g, "")
    .replace(/\s*\(菲律宾\)/g, "")
    .replace(/\s*\(.*\)/g, "")
    .trim();
};

interface TyphoonReportProps {
  typhoon: Typhoon;
  startDate?: Date;
  config?: SimulationConfig;
  onClose: () => void;
  onOpenVideoExport?: (typhoon: Typhoon) => void;
  onOpenReportModal?: (typhoon: Typhoon) => void;
}

export default function TyphoonReport({ typhoon, startDate, config, onClose, onOpenVideoExport, onOpenReportModal }: TyphoonReportProps) {
  const [showVideoExportModal, setShowVideoExportModal] = useState(false);
  const [showTyphoonReportModal, setShowTyphoonReportModal] = useState(false);
  const displayName = getTyphoonDisplayName(typhoon, typhoon.simHour, startDate);
  const reportStartDate = startDate || new Date("2027-06-30T20:00:00");
  const reportConfig = (typhoon.history?.[typhoon.history.length - 1] as any)?.configSnapshot || config || DEFAULT_CONFIG;
  const peakState = peakOf(typhoon);
  const ace = aceOf(typhoon);
  const casualties = casualtiesOf(typhoon);
  const estimatedLoss = estimatedLossBillionCny(typhoon);
  const cmaPeak = getAgencyIntensity(Number(peakState?.vmax || 0), "CMA", "public");
  const jmaPeak = getAgencyIntensity(Number(peakState?.vmax || 0), "JMA", "public");
  const jtwcPeak = getAgencyIntensity(Number(peakState?.vmax || 0), "JTWC", "public");
  const [landExtremes, setLandExtremes] = useState<LandExtremes | null>(null);
  const [landExtremesBusy, setLandExtremesBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLandExtremesBusy(true);
    setLandExtremes(null);
    const timer = window.setTimeout(() => {
      const scanned = scanLandExtremes(typhoon, reportConfig);
      const fields: Array<keyof Pick<LandExtremes, "maxWind" | "maxRain" | "maxGust" | "minPressure" | "maxStormSurge">> = [
        "maxWind", "maxRain", "maxGust", "minPressure", "maxStormSurge"
      ];
      const immediate: LandExtremes = { ...scanned };
      fields.forEach((field) => {
        const ex = immediate[field];
        if (ex) immediate[field] = { ...ex, cityName: nearestKnownCityName(ex.lat, ex.lon) } as any;
      });
      if (!cancelled) {
        setLandExtremes(immediate);
        setLandExtremesBusy(false);
      }

      // Refine the city labels through the same city-level reverse geocoder used by temporary
      // stations. Failure/offline mode keeps the nearest-city fallback above, so report rendering
      // never blocks on the network.
      void Promise.all(fields.map(async (field) => {
        const ex = scanned[field];
        if (!ex) return [field, null] as const;
        const city = stationCityName(await fetchOsmStationName(ex.lat, ex.lon, reportConfig.coastlineSource), ex.lat, ex.lon);
        return [field, city] as const;
      })).then((resolved) => {
        if (cancelled) return;
        setLandExtremes((prev) => {
          if (!prev) return prev;
          const next: LandExtremes = { ...prev };
          resolved.forEach(([field, city]) => {
            const ex = next[field];
            if (ex && city && city !== "临时站点" && city !== "未知城市") next[field] = { ...ex, cityName: city } as any;
          });
          return next;
        });
      }).catch(() => undefined);
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [typhoon.id]);

  // R214: all report curves use unmodified three-hour physical nodes,
  // including older archived cyclones. Never inject presentation-only jitter.
  const rawData = (typhoon.history||[]).map(h=>({
    time:h.simHour,wind:h.vmax,pressure:h.pmin,speed:h.speed
  }));
  const maxWind = rawData.reduce((v,d)=>Math.max(v,d.wind),0);
  const minPressure = rawData.reduce((v,d)=>Math.min(v,d.pressure),1013);
  const chartHistoryData = threeHourlyReportNodes(rawData,d=>d.time);
  const threeHourParameters = true;

  // Calculate Landfalls
  const landfalls: { lat: number; lon: number; wind: number; time: number; region: string }[] = [];
  if (typhoon.landfallRecords && typhoon.landfallRecords.length > 0) {
    typhoon.landfallRecords.forEach((r) => {
      if (isMinorIslandOperationalIgnored(r.lat, r.lon)) return;
      landfalls.push({
        lat: r.lat,
        lon: r.lon,
        wind: r.vmax,
        time: r.simHour,
        region: r.region
      });
    });
  } else {
    let wasLanded = false;
    typhoon.history.forEach((h) => {
      if (h.landed && !wasLanded && !isMinorIslandOperationalIgnored(h.lat, h.lon)) {
        const metrics = getLandMetrics(h.lat, h.lon);
        const region = metrics.landName || "沿海地区";

        landfalls.push({
          lat: h.lat,
          lon: h.lon,
          wind: h.vmax,
          time: h.simHour,
          region
        });
      }
      wasLanded = h.landed;
    });
  }

  const lifeCycleHours = typhoon.history.length > 0
    ? Math.max(0, typhoon.history[typhoon.history.length - 1].simHour - typhoon.history[0].simHour)
    : 0;

  const getImpactAssessment = (maxV: number) => {
    const sshws = getJtwcSshwsAssessment(maxV, "public");
    const windText = `${Math.round(sshws.windKt)} kt JTWC 1-min`;
    switch (sshws.category) {
      case "C5":
        return {
          severity: "极度严重 (Category 5)",
          color: "text-indigo-400 border-indigo-500/30 bg-purple-500/10",
          description: `按 JTWC 1 分钟持续风折算为 ${windText}，达到 Saffir-Simpson Category 5。沿海与基础设施面临灾难性风害风险。`
        };
      case "C4":
        return {
          severity: "严重灾害 (Category 4)",
          color: "text-red-400 border-red-500/30 bg-red-500/10",
          description: `按 JTWC 1 分钟持续风折算为 ${windText}，达到 Saffir-Simpson Category 4。可能出现广泛且严重的结构和植被风害。`
        };
      case "C3":
        return {
          severity: "重大灾害 (Category 3)",
          color: "text-rose-400 border-rose-500/30 bg-rose-500/10",
          description: `按 JTWC 1 分钟持续风折算为 ${windText}，达到 Saffir-Simpson Category 3（major hurricane 等级）。`
        };
      case "C2":
        return {
          severity: "中等偏重 (Category 2)",
          color: "text-orange-400 border-orange-500/30 bg-orange-500/10",
          description: `按 JTWC 1 分钟持续风折算为 ${windText}，达到 Saffir-Simpson Category 2。`
        };
      case "C1":
        return {
          severity: "中等灾害 (Category 1)",
          color: "text-amber-400 border-amber-500/30 bg-amber-500/10",
          description: `按 JTWC 1 分钟持续风折算为 ${windText}，达到 Saffir-Simpson Category 1。`
        };
      default:
        return {
          severity: sshws.category === "TS" ? "热带风暴级影响" : "热带低压/扰动级影响",
          color: "text-blue-400 border-blue-500/30 bg-blue-500/10",
          description: `JTWC 1 分钟持续风约 ${Math.round(sshws.windKt)} kt，未达到 Saffir-Simpson Category 1 门槛。`
        };
    }
  };

  const impact = getImpactAssessment(maxWind);

  return (
    <div className="aether-report-summary-overlay fixed inset-0 z-[99999] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 md:p-8 overflow-hidden overscroll-none">
      <style>{`.typhoon-report-scroll, .typhoon-report-scroll * { touch-action: pan-y; } .typhoon-report-scroll { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }`}</style>
      <div className="aether-report-summary bg-slate-900 border border-slate-800 rounded-xl w-full my-auto h-[calc(100dvh-1.5rem)] sm:h-auto sm:max-h-[92vh] min-h-0 flex flex-col shadow-2xl overflow-hidden animate-[scaleUp_0.2s_ease-out]">
        
        {/* Header */}
        <div className="aether-report-summary-header flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <Award className="w-7 h-7 text-yellow-500" />
            <div>
              <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">台风模拟总结报告</h2>
              <p className="text-sm text-slate-400 font-medium">Typhoon Lifetime Simulation Summary</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="aether-report-summary-body typhoon-report-scroll flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6 touch-pan-y" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
          
          {/* Top Info Cards */}
          <div className="aether-report-kpi-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 sm:gap-4">
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-center shadow-md">
              <span className="text-xs text-slate-400 font-semibold mb-1">台风名称</span>
              <span className="text-lg sm:text-xl font-extrabold text-white">{displayName}</span>
            </div>
            
            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-center shadow-md">
              <span className="text-xs text-slate-400 font-semibold mb-1">生命周期</span>
              <span className="text-lg sm:text-xl font-extrabold text-[#1E9CFF] font-mono">{lifeCycleHours} <span className="text-xs font-normal">小时</span></span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-center shadow-md">
              <span className="text-xs text-slate-400 font-semibold mb-1">生命史极大风速</span>
              <span className="text-lg sm:text-xl font-extrabold text-rose-500 font-mono">{maxWind.toFixed(1)} <span className="text-xs font-normal">m/s</span></span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-center shadow-md">
              <span className="text-xs text-slate-400 font-semibold mb-1">生命史最低气压</span>
              <span className="text-lg sm:text-xl font-extrabold text-teal-400 font-mono">{minPressure.toFixed(0)} <span className="text-xs font-normal">hPa</span></span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-center shadow-md">
              <span className="text-xs text-slate-400 font-semibold mb-1">总伤亡人数估算</span>
              <span className="text-lg sm:text-xl font-extrabold text-red-400 font-mono">
                {Math.floor(casualties).toLocaleString()} <span className="text-xs font-normal text-slate-400">人</span>
              </span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-center shadow-md">
              <span className="text-xs text-slate-400 font-semibold mb-1">ACE</span>
              <span className="text-lg sm:text-xl font-extrabold text-amber-400 font-mono">{ace.toFixed(2)}</span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl flex flex-col justify-center shadow-md">
              <span className="text-xs text-slate-400 font-semibold mb-1">模拟经济损失</span>
              <span className="text-lg sm:text-xl font-extrabold text-orange-400 font-mono">¥{estimatedLoss.toFixed(2)} <span className="text-xs font-normal">亿</span></span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="bg-slate-950/50 border border-slate-800/80 p-5 rounded-xl shadow-md">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2 border-b border-slate-800 pb-2">
                <Award className="w-5 h-5 text-amber-400" />
                风季档案 / 机构巅峰
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                {[
                  ["CMA 巅峰", `${cmaPeak.value} ${cmaPeak.unit} · ${cmaPeak.category}`],
                  ["JMA 巅峰", `${jmaPeak.value} ${jmaPeak.unit} · ${jmaPeak.category}`],
                  ["JTWC 巅峰", `${jtwcPeak.value} ${jtwcPeak.unit} · ${jtwcPeak.category}`],
                  ["登陆次数", String(landfalls.length)],
                  ["巅峰时刻", peakState ? formatReportTime(reportStartDate, peakState.simHour) : "—"],
                  ["正式编号", getTyphoonOfficialNumber(typhoon, reportStartDate)],
                  ["风季序号", typhoon.seasonOrdinal ? `第 ${typhoon.seasonOrdinal} 个台风` : "单台模式"]
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                    <div className="text-[9px] text-slate-500">{k}</div><div className="mt-1 font-semibold text-slate-200">{v}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-slate-950/50 border border-slate-800/80 p-5 rounded-xl shadow-md">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2 border-b border-slate-800 pb-2">
                <Activity className="w-5 h-5 text-sky-400" />
                陆地城市气象站极值
              </h3>
              {landExtremesBusy ? (
                <div className="py-7 text-center text-xs text-slate-500">正在扫描受影响陆地区域并匹配城市…</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                    {[
                      ["最大平均风", landExtremes?.maxWind, "m/s"],
                      ["最大阵风", landExtremes?.maxGust, "m/s"],
                      ["最低气压", landExtremes?.minPressure, "hPa"],
                      ["极值 1h 降水", landExtremes?.maxRain, "mm/h"],
                      ["最大风暴增水", landExtremes?.maxStormSurge, "m"]
                    ].map(([label, exAny, unit]) => {
                      const ex = exAny as any;
                      const digits = unit === "m" ? 2 : 1;
                      return <div key={label as string} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                        <div className="text-[9px] text-slate-500">{label as string}</div>
                        <div className="mt-1 text-sm font-bold text-slate-100">{ex ? `${Number(ex.value).toFixed(digits)} ${unit}` : "未检测到陆地影响"}</div>
                        {ex && <div className="mt-1 text-[9px] text-slate-500" title={`${ex.lat},${ex.lon}`}>
                          <span className="font-semibold text-sky-300">{stationCityDisplayName(ex.cityName || nearestKnownCityName(ex.lat, ex.lon), ex.lat, ex.lon)}气象站</span><br/>
                          {ex.lat.toFixed(2)}°N, {ex.lon.toFixed(2)}°E<br/>{formatReportTime(reportStartDate, ex.simHour)}
                        </div>}
                      </div>;
                    })}
                  </div>
                  {landExtremes && <p className="mt-2 text-[9px] text-slate-600">已合并原“陆地动态格点极值”和“气象站点极值”：采用动态陆地格点诊断方法寻找真正的极值位置，再把该格点反查为城市级气象站名称。共抽取 {landExtremes.sampledStates} 个关键时次、评估 {landExtremes.sampledStations} 个陆地诊断格点；仅报告层抽样，不改变原始仿真。</p>}
                </>
              )}
            </section>
          </div>

          {/* Landfalls & Disaster Impact */}
          <div className="w-full">
            
            {/* Landfall Records */}
            <div className="bg-slate-950/50 border border-slate-800/80 p-5 rounded-xl flex flex-col w-full shadow-md">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2 border-b border-slate-800 pb-2">
                <Compass className="w-5 h-5 text-blue-400" />
                登陆事件记录
              </h3>
              
              {landfalls.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-6 text-slate-400 text-sm font-medium">
                  <CheckCircle className="w-8 h-8 text-teal-500/60 mb-2 animate-bounce" />
                  <span>本系统未曾在陆地区域登陆，为海上消散或转向路径。</span>
                </div>
              ) : (
                <div className="flex-1 space-y-3 max-h-[220px] overflow-y-auto pr-2 scrollbar-thin">
                  {landfalls.map((land, idx) => (
                    <div key={idx} className="flex justify-between items-center p-3 rounded-lg bg-slate-900 border border-slate-800">
                      <div>
                        <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-orange-500/20 text-amber-300 text-xs font-bold">第 {idx + 1} 次登陆</span>
                          {land.region}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 font-medium">
                          位置: {land.lat.toFixed(2)}°N, {land.lon.toFixed(2)}°E | 模拟第 {land.time} 小时
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-extrabold text-rose-400 font-mono">{land.wind.toFixed(1)} m/s</div>
                        <div className="text-xs text-slate-400">登陆风速</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Lifetime Curves */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            
            {/* Wind Chart */}
            <div className="bg-slate-950/50 border border-slate-800/80 p-5 rounded-xl shadow-md">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-400" />
                中心最大风速演变 (m/s)
              </h3>
              <div className="h-56 w-full bg-slate-900/80 rounded-lg p-3 border border-slate-800">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartHistoryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke="#64748b" 
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      tickFormatter={(val) => `${val}h`}
                      label={{ value: '生成时间 (小时)', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 12 }}
                    />
                    <YAxis 
                      stroke="#64748b" 
                      tick={{ fill: '#94a3b8', fontSize: 12 }} 
                      label={{ value: '风速 (m/s)', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12 }}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '13px' }}
                      labelFormatter={(val) => `第 ${val} 小时`}
                    />
                    <Line type="linear" dataKey="wind" name="中心风速" stroke="#06b6d4" strokeWidth={2.5} dot={{r:2}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Pressure Chart */}
            <div className="bg-slate-950/50 border border-slate-800/80 p-5 rounded-xl shadow-md">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-400" />
                最低中心气压演变 (hPa)
              </h3>
              <div className="h-56 w-full bg-slate-900/80 rounded-lg p-3 border border-slate-800">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartHistoryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke="#64748b" 
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      tickFormatter={(val) => `${val}h`}
                      label={{ value: '生成时间 (小时)', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 12 }}
                    />
                    <YAxis 
                      stroke="#64748b" 
                      domain={['auto', 'auto']}
                      tick={{ fill: '#94a3b8', fontSize: 12 }} 
                      label={{ value: '气压 (hPa)', angle: -90, position: 'insideRight', fill: '#94a3b8', fontSize: 12 }}
                      orientation="right"
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '13px' }}
                      labelFormatter={(val) => `第 ${val} 小时`}
                    />
                    <Line type="linear" dataKey="pressure" name="最低气压" stroke="#a855f7" strokeWidth={2.5} dot={{r:2}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Track motion, using the same three-hour nodes as wind and pressure. */}
            <div className="bg-slate-950/50 border border-slate-800/80 p-5 rounded-xl shadow-md">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">移速演变 (km/h)</h3>
              <div className="h-56 w-full bg-slate-900/80 rounded-lg p-3 border border-slate-800">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartHistoryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="time" stroke="#64748b" tick={{fill:'#94a3b8',fontSize:12}} tickFormatter={(v)=>`${v}h`} />
                    <YAxis stroke="#64748b" tick={{fill:'#94a3b8',fontSize:12}} />
                    <Tooltip contentStyle={{backgroundColor:'#0f172a',borderColor:'#334155',fontSize:'13px'}} labelFormatter={(v)=>`第 ${v} 小时`} />
                    <Line type="linear" dataKey="speed" name="移动速度" stroke="#f59e0b" strokeWidth={2.5} dot={{r:2}}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>

        </div>

        {/* Bottom action dock: keep all three actions on one row, including narrow mobile widths. */}
        <div className="shrink-0 border-t border-slate-800 bg-slate-900/95 px-3 sm:px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-12px_32px_rgba(2,6,23,0.36)]">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-2 sm:gap-3 items-stretch">
            <button
              onClick={() => {
                if (onOpenVideoExport) {
                  onOpenVideoExport(typhoon);
                } else {
                  setShowVideoExportModal(true);
                }
              }}
              className="h-12 min-w-0 px-2 sm:px-4 text-sm font-semibold bg-teal-600 hover:bg-teal-500 active:bg-teal-700 border border-teal-500/50 text-white rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <Video className="w-4 h-4 shrink-0" />
              <span className="truncate">生成视频</span>
            </button>
            <button
              onClick={() => {
                if (onOpenReportModal) {
                  onOpenReportModal(typhoon);
                } else {
                  setShowTyphoonReportModal(true);
                }
              }}
              className="h-12 min-w-0 px-2 sm:px-4 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 border border-indigo-500/50 text-white rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span className="truncate">生成报告</span>
            </button>
            <button
              onClick={onClose}
              className="h-12 w-11 border border-slate-700 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 rounded-xl transition-all shadow-md flex items-center justify-center cursor-pointer"
              title="关闭"
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
      
      {showVideoExportModal && (
        <VideoExportModal
          typhoon={typhoon}
          startDate={startDate}
          onClose={() => setShowVideoExportModal(false)}
        />
      )}

      {showTyphoonReportModal && (
        <TyphoonReportModal
          typhoon={typhoon}
          startDate={startDate}
          onClose={() => setShowTyphoonReportModal(false)}
        />
      )}
    </div>
  );
}
