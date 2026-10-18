import { X, Wind, Compass, Droplet, Users, AlertTriangle, CloudRain, FileSpreadsheet, Waves, ChevronDown, Anchor, Radio, MapPin, CircleAlert, Pencil, Check } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from "recharts";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Typhoon } from "../types";
import StationReportModal from "./StationReportModal";
import StationEmergencyDetail from "./StationEmergencyDetail";
import { downsampleStationChartData } from "./StationChartSampling";
import { stationCityDisplayName, stationCityName } from "../utils/CityNames";
import { getTyphoonDisplayName } from "../utils/TyphoonDisplayName";
import { calculateStationReadings, calculateStationStormSurge, fetchOsmStationAdministrativeArea, type StationAdministrativeArea } from "../simulation/Engine";

interface StationHistoryProps {
  station: { id: string; name: string; lat: number; lon: number; temporary?: boolean };
  typhoons: Typhoon[];
  startDate?: Date;
  onClose: () => void;
  temporaryOcean?: boolean;
  onTemporaryStationUpdate?: (name: string) => void;
  onSnapTemporaryStationToNearestLand?: () => Promise<void>;
}

// Simple Beaufort scale helper
function getBeaufortLabel(windMps: number): string {
  if (windMps < 0.3) return "0级 无风";
  if (windMps < 1.6) return "1级 软风";
  if (windMps < 3.4) return "2级 轻风";
  if (windMps < 5.5) return "3级 微风";
  if (windMps < 8.0) return "4级 和风";
  if (windMps < 10.8) return "5级 清风";
  if (windMps < 13.9) return "6级 强风";
  if (windMps < 17.2) return "7级 疾风";
  if (windMps < 20.8) return "8级 大风";
  if (windMps < 24.5) return "9级 烈风";
  if (windMps < 28.5) return "10级 狂风";
  if (windMps < 32.7) return "11级 暴风";
  if (windMps < 37.0) return "12级 台风";
  if (windMps < 41.5) return "13级 强台风";
  if (windMps < 46.2) return "14级 强台风";
  if (windMps < 51.0) return "15级 强台风";
  if (windMps < 56.1) return "16级 超强台风";
  return "17级及以上 超强台风";
}

export default function StationHistory({
  station, typhoons, startDate, onClose, temporaryOcean = false,
  onTemporaryStationUpdate, onSnapTemporaryStationToNearestLand
}: StationHistoryProps) {
  const stationNameStorageKey = `typhoon_station_custom_name_${station.id}`;
  const stationTitleStorageKey = `typhoon_station_custom_title_${station.id}`;
  const [showReportModal, setShowReportModal] = useState(false);
  const [showEmergencyDetail, setShowEmergencyDetail] = useState(false);
  const [showTempNameMenu, setShowTempNameMenu] = useState(false);
  const [snappingName, setSnappingName] = useState(false);
  const [adminArea, setAdminArea] = useState<StationAdministrativeArea | null>(null);
  const [customStationName, setCustomStationName] = useState(() => {
    try { return stationCityName(localStorage.getItem(stationNameStorageKey) || station.name, station.lat, station.lon); }
    catch { return stationCityName(station.name, station.lat, station.lon); }
  });
  // The editable display title is separate from the canonical station key used by the model.
  // It deliberately stores the complete text, including an optional “气象站/站点” suffix.
  const [customStationTitle, setCustomStationTitle] = useState(() => {
    try { return (localStorage.getItem(stationTitleStorageKey) || '').trim(); } catch { return ''; }
  });
  const [editingStationTitle, setEditingStationTitle] = useState(false);
  const [stationTitleDraft, setStationTitleDraft] = useState('');

  useEffect(() => {
    let savedName = '';
    let savedTitle = '';
    try {
      savedName = localStorage.getItem(stationNameStorageKey) || '';
      savedTitle = (localStorage.getItem(stationTitleStorageKey) || '').trim();
    } catch { /* Local naming remains usable for this open session if storage is blocked. */ }
    const next = stationCityName(savedName || station.name, station.lat, station.lon);
    setCustomStationName(next);
    setCustomStationTitle(savedTitle);
    setStationTitleDraft(savedTitle);
    setEditingStationTitle(false);
  }, [station.id, station.name, station.lat, station.lon, stationNameStorageKey, stationTitleStorageKey]);

  useEffect(() => {
    let cancelled = false;
    if (temporaryOcean) {
      setAdminArea(null);
      return () => { cancelled = true; };
    }
    fetchOsmStationAdministrativeArea(station.lat, station.lon)
      .then((area) => { if (!cancelled) setAdminArea(area); })
      .catch(() => { if (!cancelled) setAdminArea(null); });
    return () => { cancelled = true; };
  }, [station.id, station.lat, station.lon, temporaryOcean]);

  const ty = typhoons[0];
  const currentHour = ty?.simHour ?? 0;

  // Stage expensive legacy-station reconstructions after the overlay has painted. Current-version
  // snapshots normally have usable stationReadings, so opening must not synchronously evaluate
  // hundreds of full precipitation/terrain integrations inside React render/useMemo.
  const stationCacheKey = `${station.id}|${station.name}|${station.lat}|${station.lon}|${station.temporary}`;
  const readingCacheRef = useRef<{ key: string; rows: Map<number, { state: unknown; reading: any }> }>({
    key: "", rows: new Map()
  });
  const [diagnosticState, setDiagnosticState] = useState<{ key: string; map: Map<number, any> }>({
    key: "", map: new Map()
  });
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cache = readingCacheRef.current.key === stationCacheKey
      ? readingCacheRef.current.rows : new Map<number, { state: unknown; reading: any }>();
    readingCacheRef.current = { key: stationCacheKey, rows: cache };
    const states = (ty?.history || []).filter(h => h.simHour <= currentHour + 1e-6);
    // A branched timeline may contain the same hour with different physical state; drop any
    // removed/changed source object and rebuild subsequent accumulation from that point onward.
    const valid = new Set(states.map(h => h.simHour));
    for (const hour of cache.keys()) if (!valid.has(hour)) cache.delete(hour);
    let index = 0;
    let previous: any[] | undefined;
    let invalidated = false;
    const work = () => {
      const started = performance.now();
      let processed = 0;
      while (!cancelled && index < states.length && processed < 20 && performance.now() - started < 7) {
        const h = states[index++];
        const existing = cache.get(h.simHour);
        if (!invalidated && existing?.state === h) {
          previous = [existing.reading];
          continue;
        }
        invalidated = true;
        // A temporary station is coordinate-defined, not name-defined. OSM naming can resolve it
        // to the same city name as a built-in station several kilometres away; reusing that built-in
        // history row would move the diagnostic virtually and can erase the eye-passage V minimum.
        const stored = station.temporary ? undefined : h.stationReadings?.find((r: any) => r.name === station.name);
        try {
          const row = stored?.diagnosticVersion === "round124-eye-v2" ? { ...stored }
            : calculateStationReadings(
                h.lat, h.lon, h.vmax, h.pmin, h.rmw || 35, h.r7, h.r10, h.r12, previous, 0,
                h.eyeRadiusKm, h.eyeClearance, { ...h, simHour: h.simHour, config: (h as any).configSnapshot } as any,
                [{ name: station.name, lat: station.lat, lon: station.lon, threshold: 0 }]
              )[0];
          if (row) {
            if (stored && Number.isFinite(Number(stored.casualties))) row.casualties = stored.casualties;
            cache.set(h.simHour, { state: h, reading: row });
            previous = [row];
          }
        } catch { /* A corrupt legacy snapshot should never block the station page. */ }
        processed++;
      }
      if (cancelled) return;
      if (index >= states.length || index % 80 === 0) {
        setDiagnosticState({ key: stationCacheKey,
          map: new Map([...cache].map(([hour, entry]) => [hour, entry.reading])) });
      }
      if (index < states.length) timer = setTimeout(work, 0);
    };
    timer = setTimeout(work, 0);
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); };
  }, [ty?.history, currentHour, stationCacheKey]);
  const diagnosticReadingByHour = diagnosticState.key === stationCacheKey
    ? diagnosticState.map : new Map<number, any>();

  if (!ty) return null;

  // Find the history entry at the currentHour (or fallback to latest)
  const activeState = ty.history.find(h => h.simHour === currentHour) || ty.history[ty.history.length - 1];

  const storedReading = diagnosticReadingByHour.get(activeState?.simHour ?? currentHour)
    || (!station.temporary ? activeState?.stationReadings?.find(r => r.name === station.name) : undefined)
    || (!station.temporary ? ty?.stationReadings?.find(r => r.name === station.name) : undefined);
  // Legacy data loads in small background chunks; prefer stored current readings immediately.
  const reading = storedReading;

  // Read metrics directly
  const windSpeed = reading ? reading.windSpeed : 0;
  const pressure = reading ? reading.pressure : 1013;
  const casualties = reading ? reading.casualties : 0;
  const precipitation = reading ? reading.precipitation : 0;
  const maxWindSpeed = reading ? reading.maxWindSpeed : 0;
  const accumPrecip = reading ? reading.accumPrecip : 0;
  const storedCurrentSurge = Number(reading?.stormSurge || 0);
  const diagnosedCurrentSurge = reading && activeState && !Number.isFinite(Number(reading.stormSurge))
    ? calculateStationStormSurge(
        station, activeState.lat, activeState.lon, activeState.pmin, activeState.rmw || 35, activeState.r7,
        Number(reading.windSpeed || 0), Number(reading.pressure || 1013), activeState as any
      )
    : 0;
  const stormSurge = Math.max(storedCurrentSurge, diagnosedCurrentSurge);
  const maxStormSurge = Math.max(Number(reading?.maxStormSurge || 0), stormSurge);
  const displayCityName = station.temporary && (customStationName === "洋面站点" || customStationName === "浮标")
    ? customStationName
    : stationCityDisplayName(customStationName, station.lat, station.lon);
  const defaultStationTitle = station.temporary && (displayCityName === "洋面站点" || displayCityName === "浮标")
    ? displayCityName
    : `${displayCityName}气象站`;
  const stationTitle = customStationTitle || defaultStationTitle;
  const displayStation = { ...station, name: displayCityName, displayTitle: stationTitle, sourceName: station.name };
  const saveStationTitle = () => {
    const next = stationTitleDraft.trim();
    if (!next) return;
    setCustomStationTitle(next);
    setEditingStationTitle(false);
    try { localStorage.setItem(stationTitleStorageKey, next); } catch { /* In-session title still applies. */ }
    window.dispatchEvent(new CustomEvent('aether:station-name-changed', { detail: { id: station.id, title: next } }));
  };
  const selectTemporaryTitle = (next: '洋面站点' | '浮标') => {
    setCustomStationName(next);
    setCustomStationTitle('');
    setEditingStationTitle(false);
    try {
      localStorage.setItem(stationNameStorageKey, next);
      localStorage.removeItem(stationTitleStorageKey);
    } catch { /* The current view still updates without persistence. */ }
    window.dispatchEvent(new CustomEvent('aether:station-name-changed', { detail: { id: station.id, title: next } }));
    onTemporaryStationUpdate?.(next);
    setShowTempNameMenu(false);
  };

  // Generate historical data from 0 up to currentHour for the charts
  const historyData = ty.history
    .filter(h => h.simHour <= currentHour)
    .map(h => {
      const r = diagnosticReadingByHour.get(h.simHour) || (!station.temporary ? h.stationReadings?.find(s => s.name === station.name) : undefined);
      if (r) {
        return {
          time: h.simHour,
          wind: r.windSpeed,
          pressure: r.pressure,
          precipitation: r.precipitation,
          stormSurge: Number(r.stormSurge || 0),
          casualties: r.casualties
        };
      } else {
        // Analytical fallback
        const dLatKm = (station.lat - h.lat) * 111.12;
        const dLonKm = (station.lon - h.lon) * 111.12 * Math.cos(h.lat * Math.PI / 180);
        const dist = Math.sqrt(dLatKm * dLatKm + dLonKm * dLonKm);
        const rmw = h.rmw || 35;
        let w = 0;
        let p = 1013;
        if (dist <= rmw) {
          w = h.vmax * (dist / rmw);
          p = h.pmin + (1013 - h.pmin) * Math.pow(dist / rmw, 2) * 0.5;
        } else {
          const envelope = Math.exp(-(dist - rmw) / (h.vmax * 5.0 + 70));
          w = h.vmax * envelope;
          p = 1013 - (1013 - h.pmin) * envelope;
        }
        return {
          time: h.simHour,
          wind: Number(w.toFixed(1)),
          pressure: Number(p.toFixed(1)),
          precipitation: 0,
          stormSurge: 0, // Correct historical diagnostics arrive asynchronously above.
          casualties: 0
        };
      }
    });
  // Render an extrema-preserving subset only in Recharts. Reports receive all points.
  const chartData = downsampleStationChartData(historyData);

  // MapView intentionally uses CSS paint containment for map-render performance. A fixed-position
  // station workspace rendered inside that contained subtree cannot escape its stacking context,
  // so the global map chrome/transport/joystick may paint above it. Portal the whole station
  // workspace to document.body so its z-index is compared in the root stacking context instead.
  return createPortal((
    <div className="aether-glass-overlay fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="aether-glass-panel station-history-workstation w-full h-full max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="station-history-header flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                {editingStationTitle ? (
                  <div className="flex items-center gap-1 min-w-0" role="group" aria-label="编辑气象站名称">
                    <input
                      autoFocus
                      value={stationTitleDraft}
                      onChange={(event) => setStationTitleDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); saveStationTitle(); }
                        if (event.key === 'Escape') { setEditingStationTitle(false); setStationTitleDraft(stationTitle); }
                      }}
                      aria-label="气象站完整显示名称"
                      title="可以一起修改“气象站”或“站点”等后缀"
                      className="min-w-0 w-56 max-w-[55vw] rounded-md border border-sky-400/70 bg-slate-950/90 px-2 py-1 text-base font-semibold text-white outline-none focus:border-sky-300 focus:ring-1 focus:ring-sky-400"
                    />
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={saveStationTitle}
                      className="shrink-0 rounded-md p-1 text-emerald-300 hover:bg-emerald-500/10" aria-label="保存站点名称" title="保存"><Check size={16}/></button>
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setEditingStationTitle(false); setStationTitleDraft(stationTitle); }}
                      className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-700/50" aria-label="取消修改站点名称" title="取消"><X size={15}/></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { setStationTitleDraft(stationTitle); setEditingStationTitle(true); }}
                    className="group flex min-w-0 items-center gap-1.5 text-left text-xl font-bold tracking-tight text-white hover:text-sky-200"
                    title="点击修改站点名称；可一起修改“气象站/站点”等后缀" aria-label={`修改站点名称：${stationTitle}`}>
                    <span className="truncate">{stationTitle}</span><Pencil size={14} className="shrink-0 text-slate-400 opacity-70 group-hover:text-sky-300 group-hover:opacity-100"/>
                  </button>
                )}
                {station.temporary && temporaryOcean && !editingStationTitle && (
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setShowTempNameMenu(v => !v)} className="p-1 text-slate-400 hover:text-sky-300" title="临时站点快捷命名">
                    <ChevronDown size={16} />
                  </button>
                )}
              </div>
              <p className="text-[10px] text-sky-300/80 mt-1">
                观测对象：{getTyphoonDisplayName(ty, currentHour, startDate)}
              </p>
              {station.temporary && temporaryOcean && showTempNameMenu && (
                <div className="absolute left-0 top-full mt-2 z-30 w-56 overflow-hidden rounded-lg border border-slate-700 bg-[#0b1320] shadow-2xl">
                  <button onClick={() => selectTemporaryTitle("洋面站点")} className="w-full px-3 py-2.5 flex items-center gap-2 text-sm text-slate-200 hover:bg-slate-800 text-left">
                    <Anchor size={15} className="text-sky-300" /> 洋面站点
                  </button>
                  <button onClick={() => selectTemporaryTitle("浮标")} className="w-full px-3 py-2.5 flex items-center gap-2 text-sm text-slate-200 hover:bg-slate-800 text-left">
                    <Radio size={15} className="text-slate-300" /> 浮标
                  </button>
                  <button
                    disabled={snappingName}
                    onClick={async () => {
                      if (!onSnapTemporaryStationToNearestLand) return;
                      setSnappingName(true);
                      try { await onSnapTemporaryStationToNearestLand(); } finally { setSnappingName(false); setShowTempNameMenu(false); }
                    }}
                    className="w-full px-3 py-2.5 flex items-center gap-2 text-sm text-slate-200 hover:bg-slate-800 text-left disabled:opacity-50"
                  >
                    <MapPin size={15} className="text-emerald-300" /> {snappingName ? "查找最近陆地…" : "吸附最近陆地"}
                  </button>
                </div>
              )}
            </div>
            <span className="text-xs text-slate-500 font-mono hidden sm:inline shrink-0">
              ({station.lat.toFixed(2)}°N, {station.lon.toFixed(2)}°E)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEmergencyDetail(true)}
              className="px-2.5 py-1.5 text-amber-300 hover:text-amber-100 hover:bg-amber-500/10 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
              title="城市气象与应急详情"
              aria-label="详情"
            >
              <CircleAlert size={18} />
              <span>详情</span>
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content Container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Quick-Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            
            {/* Wind Speed Card */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-blue-500/10 border border-cyan-500/20 text-blue-400 rounded-lg">
                <Wind className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-slate-400">实时风速 / 级</div>
                <div className="text-lg font-bold text-white tracking-tight">
                  {windSpeed.toFixed(1)} <span className="text-xs font-normal text-slate-500">m/s</span>
                </div>
                <div className="text-[10px] text-blue-400/80 font-medium">{getBeaufortLabel(windSpeed)}</div>
              </div>
            </div>

            {/* Pressure Card */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-slate-300/10 border border-purple-500/20 text-slate-300 rounded-lg">
                <Compass className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-slate-400">实时气压</div>
                <div className="text-lg font-bold text-white tracking-tight">
                  {pressure.toFixed(1)} <span className="text-xs font-normal text-slate-500">hPa</span>
                </div>
                <div className="text-[10px] text-slate-300/80 font-medium">中心外围气压压降</div>
              </div>
            </div>

            {/* Precipitation Rate Card */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg">
                <CloudRain className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-slate-400">当前降水量 (小时)</div>
                <div className="text-lg font-bold text-white tracking-tight">
                  {precipitation.toFixed(1)} <span className="text-xs font-normal text-slate-500">mm/h</span>
                </div>
                <div className="text-[10px] text-blue-400/80 font-medium">
                  {precipitation > 50 ? "特大暴雨" : precipitation > 30 ? "大暴雨" : precipitation > 10 ? "暴雨" : "小到中雨"}
                </div>
              </div>
            </div>

            {/* Accumulated Precipitation Card */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 text-slate-300 rounded-lg">
                <Droplet className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-slate-400">累计总降水量</div>
                <div className="text-lg font-bold text-white tracking-tight">
                  {accumPrecip.toFixed(1)} <span className="text-xs font-normal text-slate-500">mm</span>
                </div>
                <div className="text-[10px] text-slate-300/80 font-medium">本次过程站网累积</div>
              </div>
            </div>

            {/* Max Wind Speed Card */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-orange-400 rounded-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-slate-400">历史最高风速</div>
                <div className="text-lg font-bold text-white tracking-tight">
                  {maxWindSpeed.toFixed(1)} <span className="text-xs font-normal text-slate-500">m/s</span>
                </div>
                <div className="text-[10px] text-orange-400/80 font-medium">最大风速</div>
              </div>
            </div>

            {/* Current Storm Surge Card */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 text-sky-300 rounded-lg">
                <Waves className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-slate-400">当前风暴增水</div>
                <div className="text-lg font-bold text-white tracking-tight">
                  {stormSurge.toFixed(2)} <span className="text-xs font-normal text-slate-500">m</span>
                </div>
                <div className="text-[10px] text-sky-300/80 font-medium">相对无风暴水位，不含天文潮</div>
              </div>
            </div>

            {/* Maximum Storm Surge Card */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 rounded-lg">
                <Waves className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-slate-400">最大风暴潮高度</div>
                <div className="text-lg font-bold text-white tracking-tight">
                  {maxStormSurge.toFixed(2)} <span className="text-xs font-normal text-slate-500">m</span>
                </div>
                <div className="text-[10px] text-cyan-300/80 font-medium">风暴增水，不含天文潮</div>
              </div>
            </div>

            {/* Casualties Card */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-4 flex items-center gap-3.5">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-slate-400">区域伤亡估算</div>
                <div className="text-lg font-bold text-white tracking-tight">
                  {casualties} <span className="text-xs font-normal text-slate-500">人</span>
                </div>
                <div className="text-[10px] text-rose-400/80 font-medium">基于灾损与人口密度</div>
              </div>
            </div>

          </div>

          {/* Charts Row */}
          <div className="station-history-charts grid grid-cols-1 xl:grid-cols-2 gap-6">
            
            {/* Wind Curve */}
            <div className="bg-slate-950/20 border border-slate-800/80 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-500" />
                  实时风速演变曲线
                </span>
                <span className="text-[10px] text-slate-400 font-normal">
                  <span className="text-blue-400">■ 风速(m/s)</span>
                </span>
              </h3>
              <div className="station-chart-frame h-72 w-full rounded-xl p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke="#475569" 
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickFormatter={(val) => `${val}h`}
                    />
                    <YAxis 
                      stroke="#06b6d4" 
                      tick={{ fill: '#06b6d4', fontSize: 11 }} 
                      domain={[0, 'auto']}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', fontSize: 12 }}
                      labelFormatter={(val) => `第 ${val} 小时`}
                    />
                    <Line type="monotone" dataKey="wind" name="实时风速 (m/s)" stroke="#06b6d4" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Pressure Curve */}
            <div className="bg-slate-950/20 border border-slate-800/80 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-slate-300" />
                气压压降演变曲线 (hPa)
              </h3>
              <div className="station-chart-frame h-72 w-full rounded-xl p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke="#475569" 
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickFormatter={(val) => `${val}h`}
                    />
                    <YAxis 
                      stroke="#475569" 
                      domain={['auto', 'auto']}
                      tick={{ fill: '#64748b', fontSize: 11 }} 
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', fontSize: 12 }}
                      labelFormatter={(val) => `第 ${val} 小时`}
                    />
                    <Line type="monotone" dataKey="pressure" name="测站气压" stroke="#e5e7eb" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Precipitation Curve */}
            <div className="bg-slate-950/20 border border-slate-800/80 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                小时降雨演变曲线 (mm/h)
              </h3>
              <div className="station-chart-frame h-72 w-full rounded-xl p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke="#475569" 
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickFormatter={(val) => `${val}h`}
                    />
                    <YAxis 
                      stroke="#475569" 
                      tick={{ fill: '#64748b', fontSize: 11 }} 
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', fontSize: 12 }}
                      labelFormatter={(val) => `第 ${val} 小时`}
                    />
                    <Line type="monotone" dataKey="precipitation" name="小时降水" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Storm Surge Curve */}
            <div className="bg-slate-950/20 border border-slate-800/80 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-sky-400" />
                风暴增水演变曲线 (m)
              </h3>
              <div className="station-chart-frame h-72 w-full rounded-xl p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="time" stroke="#475569" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(val) => `${val}h`} />
                    <YAxis stroke="#38bdf8" tick={{ fill: '#38bdf8', fontSize: 11 }} domain={[0, 'auto']} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', fontSize: 12 }} labelFormatter={(val) => `第 ${val} 小时`} />
                    <Line type="monotone" dataKey="stormSurge" name="风暴增水 (m)" stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>

          <div className="pt-4 border-t border-slate-800/40 mt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-500">仅显示受台风影响的数据 | 城市级模拟气象站</div>
            <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => setShowReportModal(true)}
                className="w-full sm:w-auto px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-[#1E9CFF]/20 transition-all cursor-pointer"
              >
                <FileSpreadsheet size={16} />
                制作站点气象报告图
              </button>
            </div>
          </div>

        </div>
      </div>

      {showReportModal && (
        <StationReportModal
          station={displayStation}
          typhoons={typhoons}
          startDate={startDate}
          onClose={() => setShowReportModal(false)}
        />
      )}
      {showEmergencyDetail && (
        <StationEmergencyDetail
          station={displayStation}
          typhoon={ty}
          reading={reading}
          historyData={historyData}
          startDate={startDate}
          adminArea={adminArea || undefined}
          onClose={() => setShowEmergencyDetail(false)}
        />
      )}

    </div>
  ), document.body);
}
