/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  X, Settings, Wind, Compass, Shield, Map, Download, Scroll, HelpCircle,
  Play, Pause, Globe, Volume2, Waves, Zap, RefreshCw, Layers, Save, FolderOpen, Info, Palette, UserRound, BookOpen, Plus, Trash2, GripVertical
} from "lucide-react";
import PresetManager from "./PresetManager";
import AetherInputDialog from "./AetherInputDialog";
import { TyphoonCategory } from "../types";
import type { Typhoon, SimulationConfig, ActiveLayers, EventLog } from "../types";
import { getAgencyIntensity, getCategoryColor } from "../simulation/Engine";
import { playSndSliderTick, playSndClick } from "../utils/audio";
import { isCmaTyphoonProductTime } from "../simulation/CmaOperationalClock";
import { getTyphoonDisplayName, getTyphoonOfficialNumber, getTyphoonYearCode, normalizeTyphoonSequenceNumber } from "../utils/TyphoonDisplayName";
import { DEFAULT_ATMOSPHERIC_PRESET, DEFAULT_CONFIG, DEFAULT_LAYERS } from "../config/DefaultSettings";
import { TYPHOON_NAMING_TABLE, getTyphoonNamingEntry } from "../data/typhoonNamingTable";

const OFFLINE_BASEMAP_OPTIONS: Array<{ id: ActiveLayers["baseMap"]; label: string }> = [
  { id: "jma", label: "JMA 风格 · 本地矢量" },
  { id: "blackGray", label: "黑灰 · 本地矢量" },
  { id: "himawari", label: "向日葵9号 · 本地矢量" },
  { id: "stormTerrain", label: "业务地形 · 深海/绿陆/高地" }
];

const ONLINE_BASEMAP_OPTIONS: Array<{ id: ActiveLayers["baseMap"]; label: string }> = [
  { id: "dark", label: "深色控制台 · OSM Night" },
  { id: "satellite", label: "高精真彩卫星" },
  { id: "terrain", label: "海底与地形" },
  { id: "light", label: "简洁行政纸张" },
  { id: "googleSatellite", label: "谷歌地球卫星" },
  { id: "googleStreet", label: "谷歌地图街道" },
  { id: "blueMarble", label: "Blue Marble 2002" },
  { id: "bingSatellite", label: "Bing 卫星图" },
  { id: "none", label: "空白无地图" }
];

// Only curated, real settings are exposed here; shortcuts edit the exact original config keys.
const CUSTOM_CHOICES: Array<{ id: string; label: string; source: string; key: string; type: "toggle" | "range" | "select"; min?:number; max?:number; step?:number; options?: string[]; layer?:boolean }> = [
 {id:"speed-growth",label:"增强速度",source:"台风",key:"intensificationRate",type:"range",min:0,max:3,step:.05},
 {id:"auto-peak",label:"自动目标巅峰",source:"台风",key:"autoAdjustIntensity",type:"toggle"},
 {id:"rapid",label:"自然爆发增强",source:"台风",key:"rapidIntensifyEnabled",type:"toggle"},
 {id:"land-decay",label:"登陆减弱",source:"台风",key:"landDecayEnabled",type:"toggle"},
 {id:"shear",label:"风切变倍率",source:"大气",key:"shearScale",type:"range",min:0,max:3,step:.05},
 {id:"dry",label:"干空气强度",source:"大气",key:"dryAirStrength",type:"range",min:0,max:2,step:.05},
 {id:"joystick",label:"控制方式",source:"常用",key:"controlMode",type:"select",options:["joystick","draw"]},
 {id:"agency",label:"强度机构",source:"显示",key:"intensityAgency",type:"select",options:["CMA","JMA","JTWC"]},
 {id:"winds",label:"风圈图层",source:"地图",key:"windRadii",type:"toggle",layer:true},
 {id:"sound",label:"模拟器声音",source:"常用",key:"soundEnabled",type:"toggle"},
 {id:"volume",label:"模拟器音量",source:"常用",key:"soundVolume",type:"range",min:0,max:1,step:.01}
];
const DRAWER_TABS = [
 {id:"simulation",label:"常用",icon:Play},{id:"typhoon",label:"台风",icon:Wind},
 {id:"environment",label:"大气",icon:Compass},{id:"ocean",label:"海洋",icon:Waves},
 {id:"layers",label:"地图",icon:Layers},{id:"style",label:"风格",icon:Palette},
 {id:"info",label:"显示",icon:Info},{id:"custom",label:"自定义",icon:Plus},
 {id:"usage",label:"使用",icon:HelpCircle},{id:"news",label:"日志",icon:Globe},
 {id:"export",label:"存档 / 导出",icon:Download}
];
const safeStoredArray = (key:string, fallback:string[]) => {try {const raw=JSON.parse(localStorage.getItem(key)||"null");return Array.isArray(raw)?raw.filter(x=>typeof x==="string"):fallback;} catch{return fallback;}};

interface DrawerProps {
  isOpen: boolean;
  /** Distinct id while a second (sandbox) settings drawer is mounted. */
  drawerId?: string;
  /** Sandbox retains the same simulation pages but cannot export the parent's archive. */
  sandboxMode?: boolean;
  requestedTab?: string | null;
  onClose: () => void;
  typhoons: Typhoon[];
  startDate: Date;
  config: SimulationConfig;
  desktopDevice?: boolean;
  mobileMode?: boolean;
  onConfigChange: (newConfig: Partial<SimulationConfig>) => void;
  onUpdateTyphoonIdentity: (index: number, patch: { name?: string; officialNumber?: string }) => void;
  layers: ActiveLayers;
  onLayersChange: (newLayers: Partial<ActiveLayers>) => void;
  onDeployTyphoon: (mode: "main" | "genesis" | "home" | "none") => void;
  onGenerateEnvironment: () => void;
  onResetSimulation: () => void;
  onClearTrack: () => void;
  onExportSimulationArchive: (mode?: "readable" | "compressed") => Promise<void>;
  onImportSimulationArchive: (file: File) => Promise<boolean>;
  eventLogs: EventLog[];
  onClearLogs: () => void;
  onSeekHour: (hour: number) => void;
  genesisPos: { lat: number; lon: number };
  isForecastRouteDrawing: boolean;
  forecastRoutePointCount: number;
  onStartForecastRoute: () => void;
  onFinishForecastRoute: () => void;
  onCancelForecastRoute: () => void;
  onClearForecastRoute: () => void;
  /** Clear only previously approved pre-simulation guidance, effective from now. */
  onClearPreSimulationReference?: () => void;
  onApplyCurrentSimulationToForecast?: () => void;
  hasPreSimulationReference?: boolean;
}

function ControlDrawer({
  isOpen,
  drawerId = "control-drawer-sidebar",
  sandboxMode = false,
  requestedTab = null,
  onClose,
  typhoons,
  startDate,
  config,
  desktopDevice = false,
  mobileMode = false,
  onConfigChange: parentOnConfigChange,
  onUpdateTyphoonIdentity,
  layers,
  onLayersChange,
  onDeployTyphoon,
  onGenerateEnvironment,
  onResetSimulation,
  onClearTrack,
  onExportSimulationArchive,
  onImportSimulationArchive,
  eventLogs,
  onClearLogs,
  onSeekHour,
  genesisPos,
  isForecastRouteDrawing,
  forecastRoutePointCount,
  onStartForecastRoute,
  onFinishForecastRoute,
  onCancelForecastRoute,
  onClearForecastRoute,
  onClearPreSimulationReference,
  onApplyCurrentSimulationToForecast,
  hasPreSimulationReference=false
}: DrawerProps) {
  const archiveFileInputRef = useRef<HTMLInputElement>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveStatus, setArchiveStatus] = useState("");
  const handleArchiveExport = async (mode: "readable" | "compressed" = "readable") => {
    if (archiveBusy) return;
    setArchiveBusy(true);
    setArchiveStatus("正在打包完整模拟历史…");
    try {
      await onExportSimulationArchive(mode);
      setArchiveStatus("已生成存档文件，请在浏览器下载列表中查看。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setArchiveStatus(`保存失败：${message}`);
    } finally { setArchiveBusy(false); }
  };
  const handleArchiveFile = async (file?: File) => {
    if (!file || archiveBusy) return;
    setArchiveBusy(true);
    setArchiveStatus("正在读取、解压并验证存档…");
    try {
      const loaded = await onImportSimulationArchive(file);
      setArchiveStatus(loaded ? "存档读取成功。" : "已取消读取，原模拟没有变化。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setArchiveStatus(`读取失败：${message}（原模拟没有变化）`);
    } finally { setArchiveBusy(false); }
  };
  const [tabOrder, setTabOrder] = useState<string[]>(() => safeStoredArray("aether_drawer_tab_order_v1",DRAWER_TABS.map(t=>t.id)));
  const [customIds, setCustomIds] = useState<string[]>(() => safeStoredArray("aether_custom_options_v1",[]));
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const hasConfirmedDrawnForecastRoute = (config.drawnTrackRoute?.length || 0) >= 2;
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const drawerSheetDragRef = useRef<{ pointerId: number; startY: number; lastY: number } | null>(null);
  const tabSortRef = useRef<{id:string;startX:number;startY:number;ready:boolean;touch:boolean;timer:ReturnType<typeof setTimeout>|null;lastTarget:string}|null>(null);
  const suppressTabClickUntil = useRef(0);
  useEffect(()=>{try {localStorage.setItem("aether_drawer_tab_order_v1",JSON.stringify(tabOrder));}catch{}},[tabOrder]);
  useEffect(()=>{try {localStorage.setItem("aether_custom_options_v1",JSON.stringify(customIds));}catch{}},[customIds]);
  const visibleTabs = DRAWER_TABS.map(t=>sandboxMode && t.id==='export'
    ? {...t,label:'分支存档'} : t).sort((a,b) => {
    const ai=tabOrder.indexOf(a.id),bi=tabOrder.indexOf(b.id);
    return (ai<0?999:ai)-(bi<0?999:bi);
  });
  const visibleCustomChoices = mobileMode ? CUSTOM_CHOICES.filter((item) => item.id !== "joystick") : CUSTOM_CHOICES;
  const releaseTabSort = () => {if(tabSortRef.current?.timer)clearTimeout(tabSortRef.current.timer);tabSortRef.current=null;};
  useEffect(()=>()=>{if(tabSortRef.current?.timer)clearTimeout(tabSortRef.current.timer);},[]);
  // React wheel events may be registered as passive by the browser; native non-passive handling
  // reliably redirects vertical mouse-wheel motion to the horizontal category selector.
  useEffect(() => {
    if (!isOpen) return;
    const tabs = document.getElementById("control-drawer-tabs");
    if (!tabs) return;
    const wheel = (event: WheelEvent) => {
      if (tabs.scrollWidth <= tabs.clientWidth + 1) return;
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!delta) return;
      event.preventDefault();
      tabs.scrollLeft += delta;
    };
    tabs.addEventListener("wheel", wheel, { passive: false });
    return () => tabs.removeEventListener("wheel", wheel);
  }, [isOpen]);
  const onTabPointerDown = (e: PointerEvent<HTMLButtonElement>,id:string) => {
    if(e.pointerType==="mouse" && e.button!==0)return;
    releaseTabSort();
    const item={id,startX:e.clientX,startY:e.clientY,ready:false,touch:e.pointerType!=="mouse",timer:null as ReturnType<typeof setTimeout>|null,lastTarget:id};
    tabSortRef.current=item;
    if(item.touch)item.timer=setTimeout(()=>{
      if(tabSortRef.current===item){
        item.ready=true;
        navigator.vibrate?.(10);
      }
    },420);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onTabPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const drag=tabSortRef.current;if(!drag)return;
    const distance=Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY);
    if(!drag.ready && !drag.touch && distance>8)drag.ready=true;
    if(!drag.ready)return;
    e.preventDefault();
    const tabs=document.getElementById("control-drawer-tabs");
    if(tabs){
      const rect=tabs.getBoundingClientRect();
      if(e.clientX<rect.left+42)tabs.scrollLeft-=12;
      else if(e.clientX>rect.right-42)tabs.scrollLeft+=12;
    }
    const target=(document.elementFromPoint(e.clientX,e.clientY) as HTMLElement|null)?.closest('[data-aether-tab-id]')?.getAttribute('data-aether-tab-id');
    if(!target || target===drag.id || target===drag.lastTarget)return;
    drag.lastTarget=target;
    setTabOrder(prev => {
      const list=DRAWER_TABS.map(t=>t.id).sort((a,b)=>(prev.indexOf(a)<0?999:prev.indexOf(a))-(prev.indexOf(b)<0?999:prev.indexOf(b)));
      const from=list.indexOf(drag.id),to=list.indexOf(target);
      if(from<0||to<0||from===to)return prev;
      list.splice(from,1);list.splice(to,0,drag.id);return list;
    });
  };
  const onTabPointerUp = () => {if(tabSortRef.current?.ready)suppressTabClickUntil.current=performance.now()+350;releaseTabSort();};
  const onDrawerSheetPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    drawerSheetDragRef.current = { pointerId: e.pointerId, startY: e.clientY, lastY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (drawerPanelRef.current) drawerPanelRef.current.style.transition = "none";
  };
  const onDrawerSheetPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = drawerSheetDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    drag.lastY = e.clientY;
    const dy = Math.max(0, e.clientY - drag.startY);
    if (dy > 4 && drawerPanelRef.current) drawerPanelRef.current.style.setProperty("--drawer-drag-y", `${Math.min(180, dy)}px`);
  };
  const finishDrawerSheetDrag = (e?: PointerEvent<HTMLDivElement>) => {
    const drag = drawerSheetDragRef.current;
    if (!drag) return;
    const dy = Math.max(0, drag.lastY - drag.startY);
    drawerSheetDragRef.current = null;
    const panel = drawerPanelRef.current;
    if (panel) {
      panel.style.transition = "";
      panel.style.removeProperty("--drawer-drag-y");
    }
    if (dy >= 92) onClose();
    if (e && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const [activeTab, setActiveTab] = useState<string>("simulation");
  useEffect(() => {
    if (isOpen && requestedTab && DRAWER_TABS.some(tab => tab.id === requestedTab)) setActiveTab(requestedTab);
  }, [isOpen, requestedTab]);
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`tab-select-${activeTab}`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      if (mobileMode) document.getElementById("control-drawer-content")?.scrollTo({ top: 0, behavior: "auto" });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTab, isOpen, mobileMode]);
  const [activeTooltip, setActiveTooltip] = useState<{ title: string; content: string } | null>(null);
  const [inputDialog, setInputDialog] = useState<null |
    { kind: "rename"; title: string; initialValue: string; english: string } |
    { kind: "intensity"; title: string; initialValue: string }
  >(null);
  const [showAuthorContact, setShowAuthorContact] = useState(false);

  const displaySimHour = typhoons.length ? Number(typhoons[0]?.simHour ?? typhoons[0]?.history?.[typhoons[0].history.length - 1]?.simHour ?? 0) : 0;

  const onConfigChange = (newConfig: Partial<SimulationConfig>) => {
    // Play a lovely satisfying slider tick sound if any slider values are changed!
    const sliderKeys = [
      "sst", "sstAnomaly", "shear", "rh700", "ohc", "soundVolume",
      "subtropicalHighStrength", "subtropicalHighLat", "subtropicalHighLon", "subtropicalHighWestExtent", "dryAirStrength",
      "westerliesStrength", "westerliesLat", "westerliesTroughLon", "westerliesTroughDepth",
      "betaDriftScale", "monsoonTroughStrength", "joystickStrength", "joystickSensitivity",
      "landfallDecayAdjustment", "landProximityDecayAdjustment", "cityDensity", "capsuleSize"
    ];
    const hasSliderKey = Object.keys(newConfig).some(k => sliderKeys.includes(k));
    if (hasSliderKey) {
      playSndSliderTick(config.soundVolume, config.soundEnabled);
    }
    parentOnConfigChange(newConfig);
  };

  // Parameter explanations tooltips
  const showTooltip = (title: string, content: string) => {
    setActiveTooltip({ title, content });
  };

  const getCmaOperationalNodes = (mainTy: Typhoon) => {
    const history = mainTy.history || [];
    return history.filter((h, i) =>
      i === 0 || i === history.length - 1 || isCmaTyphoonProductTime(startDate, h.simHour)
    );
  };

  // Format GeoJSON for exporting
  const exportGeoJSON = () => {
    const mainTy = typhoons[0];
    if (!mainTy) return;

    const features = [];

    // LineString trajectory
    const coordinates = mainTy.history.map(h => [h.lon, h.lat]);
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates
      },
      properties: {
        name: `${mainTy.name} 移动轨迹`,
        simSeed: config.seed
      }
    });

    // Analysis points use the same CMA/NMC Beijing product clock as map/video/forecast graphics.
    getCmaOperationalNodes(mainTy).forEach((h) => {
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [h.lon, h.lat]
        },
        properties: {
          simHour: h.simHour,
          category: h.category,
          vmax_ms: h.vmax,
          pmin_hpa: h.pmin,
          direction: h.direction,
          speed_kmh: h.speed
        }
      });
    });

    const geojson = {
      type: "FeatureCollection",
      features
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Typhoon_${mainTy.name}_simulation.geojson`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Format CSV for exporting
  const exportCSV = () => {
    const mainTy = typhoons[0];
    if (!mainTy) return;

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "simHour,lat,lon,vmax_ms,pmin_hpa,category,direction_deg,speed_kmh,rmw_km,r7_ne,r7_se,r7_sw,r7_nw\n";

    getCmaOperationalNodes(mainTy).forEach((h) => {
      csvContent += `${h.simHour},${h.lat.toFixed(4)},${h.lon.toFixed(4)},${h.vmax},${h.pmin},${h.category},${h.direction},${h.speed},${h.rmw},${h.r7.ne},${h.r7.se},${h.r7.sw},${h.r7.nw}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.href = encodedUri;
    link.download = `Typhoon_${mainTy.name}_nodes.csv`;
    link.click();
  };

  // Copy current JSON config
  const copyCurrentConfig = () => {
    const configStr = JSON.stringify({ config, activeLayers: layers }, null, 2);
    navigator.clipboard.writeText(configStr);
  };

  // Sound play mockup for interaction testing
  const testClick = () => {
    playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
  };

  return (
    <>
      <div
        className={`control-drawer-mobile-scrim ${mobileMode ? "aether-mobile-drawer-scrim" : ""} ${isOpen ? "is-open" : ""}`}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={drawerPanelRef}
        id={drawerId}
        className={`${mobileMode ? "aether-mobile-drawer" : "control-drawer fixed top-0 right-0 bottom-0 z-[1500] w-[92%] sm:w-[380px] md:w-[440px] bg-[#18181b]/98 border-l border-zinc-800 shadow-2xl backdrop-blur-md text-white flex flex-col transition-transform duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]"} ${
          isOpen ? "translate-x-0 is-open" : "translate-x-full"
        }`}
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)"
        }}
      >
      {!mobileMode && <div
        className="control-drawer-mobile-handle"
        onPointerDown={onDrawerSheetPointerDown}
        onPointerMove={onDrawerSheetPointerMove}
        onPointerUp={finishDrawerSheetDrag}
        onPointerCancel={finishDrawerSheetDrag}
        aria-hidden="true"
      ><span /></div>}
      {/* Drawer Header */}
      <div className={`${mobileMode ? "aether-mobile-drawer-header" : "control-drawer-header flex items-center justify-between border-b border-slate-800 p-4"}`}>
        <div className="flex items-center space-x-2">
          <Settings className="w-4.5 h-4.5 text-slate-300" />
          <div><h2 className="text-sm font-semibold tracking-[0.08em] font-sans">{mobileMode ? "设置与工具" : "模拟控制台"}</h2><p className="text-[9px] text-slate-500 mt-0.5">{mobileMode ? "WMC MOBILE CONTROL" : "TROPICAL CYCLONE WORKSTATION"}</p></div>
        </div>
        <button
          id="btn-close-drawer"
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Accordion Tabs selectors */}
      <div id="control-drawer-tabs" className={mobileMode ? "aether-mobile-drawer-tabs" : "flex shrink-0 bg-zinc-950/60 border-b border-zinc-800 overflow-x-auto overscroll-x-contain scrollbar-thin text-xs text-zinc-400"}>
        {visibleTabs.map(tab => {const Icon=tab.icon;return <button
          key={tab.id} data-aether-tab-id={tab.id} id={`tab-select-${tab.id}`}
          onPointerDown={e=>onTabPointerDown(e,tab.id)} onPointerMove={onTabPointerMove}
          onPointerUp={onTabPointerUp} onPointerCancel={releaseTabSort}
          onClick={() => {if(performance.now()<suppressTabClickUntil.current)return;setActiveTab(tab.id);testClick();}}
          style={{touchAction:"pan-x"}}
          title="鼠标左键拖动／手机长按拖动可调整顺序"
          className={`${mobileMode ? "aether-mobile-drawer-tab" : "flex-none w-[65px] py-2.5 flex flex-col items-center justify-center gap-1 transition select-none border-b-2 cursor-grab active:cursor-grabbing"} ${activeTab===tab.id ? "active border-zinc-100 text-white font-semibold bg-zinc-800/65" : "border-transparent hover:text-zinc-100 hover:bg-zinc-800/35"}`}>
          <Icon className="w-4 h-4 shrink-0"/><span>{tab.label}</span>
        </button>})}
      </div>

      {/* Active Tab Panel Content (Scrollable) */}
      <div id="control-drawer-content" className={mobileMode ? "aether-mobile-drawer-content" : "flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin"}>
        {/* --- A. SIMULATION CONTROLS --- */}
        {activeTab === "simulation" && (
          <div className="space-y-4" id="panel-simulation">
            {!mobileMode ? <div className="rounded-xl border border-white/12 bg-white/[0.045] p-3 backdrop-blur-md">
              <div className="text-[11px] font-bold text-zinc-200">电脑 / 手柄快捷操作</div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[9px] leading-relaxed text-slate-400">
                <span><b className="text-slate-200">← → / 左摇杆</b> 前后1小时／摇杆转向</span><span><b className="text-slate-200">Space / A</b> 开始·暂停</span>
                <span><b className="text-slate-200">[ ] / LB RB</b> 前后时次</span><span><b className="text-slate-200">P / X</b> WMC 产品</span>
                <span><b className="text-slate-200">O / B</b> 台风状态·影响</span><span><b className="text-slate-200">G / Y</b> 设置</span>
                <span><b className="text-slate-200">T / Start</b> 详细时间轴</span><span><b className="text-slate-200">鼠标滚轮</b> 地图缩放</span>
                <span><b className="text-slate-200">鼠标中键双击</b> 放置台风</span><span><b className="text-slate-200">Shift+数字1～0</b> 影响快捷键</span>
              </div>
            </div> : <div className="aether-mobile-touch-help rounded-xl border border-slate-800 bg-slate-900/35 p-3">
              <div className="text-[11px] font-bold text-slate-200">手机触控</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] leading-relaxed text-slate-500">
                <span><b className="text-slate-300">地图</b><br/>单指拖动 · 双指缩放</span>
                <span><b className="text-slate-300">生成</b><br/>三连击地图后确认</span>
                <span><b className="text-slate-300">时间</b><br/>底部 ↑ 展开详细时间轴</span>
                <span><b className="text-slate-300">栏目</b><br/>长按上方栏目后拖动排序</span>
              </div>
            </div>}
            <div className="bg-white/[0.035] p-3 rounded-xl border border-white/10 space-y-2.5 backdrop-blur-md">
              <div className="flex items-start justify-between gap-3"><div><h3 className="text-xs font-bold text-zinc-200 tracking-wider">所在地模拟公告</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-500">选择一个地图位置后，主界面左侧只显示轻量风压雨影响公告；不会加载任何实时云图。</p></div><Map className="w-4 h-4 text-zinc-300 shrink-0"/></div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/55 px-3 py-2 text-[10px] text-slate-400 font-mono">{Number.isFinite(config.localAdvisoryLat) && Number.isFinite(config.localAdvisoryLon) ? `${config.localAdvisoryLabel || `${Number(config.localAdvisoryLat).toFixed(2)}°, ${Number(config.localAdvisoryLon).toFixed(2)}°`}` : "未设置所在地"}</div>
              <button type="button" onClick={() => { onDeployTyphoon("home"); onClose(); }} className="w-full rounded-lg border border-white/20 bg-white/[0.07] px-3 py-2 text-[10px] font-bold text-zinc-100 hover:bg-white/[0.11] shadow-[0_0_14px_rgba(255,255,255,.05)]">选择所在地 · 然后在地图单击</button>
            </div>

            <div className="bg-white/[0.035] p-3 rounded-xl border border-white/10 space-y-3 backdrop-blur-md">
              <div>
                <h3 className="text-xs font-bold text-zinc-200 tracking-wider">风季工作流 · 常用</h3>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">默认连续风季：前一台风结束后电脑双击中键／触屏三连击生成下一台风，风季时间、历史路径、站点资料均继续累计。</p>
              </div>
              <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/45 px-3 py-2 cursor-pointer">
                <span><b className="block text-[11px] text-slate-200">连续风季模式</b><span className="text-[9px] text-slate-500">关闭后恢复单台风终止流程</span></span>
                <input type="checkbox" checked={config.seasonModeEnabled !== false} onChange={(e) => onConfigChange({ seasonModeEnabled: e.target.checked })} className="w-4 h-4 accent-zinc-300" />
              </label>

              <div className="rounded-lg border border-slate-800 bg-slate-950/45 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div><div className="text-[11px] font-bold text-slate-300">台风命名表</div><div className="text-[9px] text-slate-500">单击设为下一名称 · 双击修改</div></div>
                  <button
                    onClick={() => onConfigChange({ typhoonNamingStartIndex: 0, typhoonNamingCursor: 0, typhoonNamingOverrides: {} })}
                    className="px-2 py-1 rounded-md border border-slate-700 bg-slate-900 text-[9px] text-slate-300 hover:text-white"
                  >一键复位</button>
                </div>
                <div className="max-h-44 overflow-y-auto grid grid-cols-4 gap-1 pr-1">
                  {TYPHOON_NAMING_TABLE.map((entry, index) => {
                    const effective = getTyphoonNamingEntry(index, config.typhoonNamingOverrides);
                    const selected = (config.typhoonNamingCursor ?? config.typhoonNamingStartIndex ?? 0) === index;
                    return <button
                      key={`${entry.english}-${index}`}
                      title={`${index + 1}. ${effective.chinese} / ${entry.english}；单击设为下一名称，双击修改中文名`}
                      onClick={() => onConfigChange({ typhoonNamingStartIndex: index, typhoonNamingCursor: index })}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        setInputDialog({ kind: "rename", title: `修改 ${entry.english} 的中文名称`, initialValue: effective.chinese, english: entry.english });
                      }}
                      className={`px-1.5 py-1.5 rounded-md border text-[10px] truncate transition ${selected ? "border-white/60 bg-white/10 text-white font-bold shadow-[0_0_14px_rgba(255,255,255,.12)]" : "border-slate-800 bg-slate-900/70 text-slate-400 hover:text-slate-200"}`}
                    >{effective.chinese}</button>;
                  })}
                </div>
                <div className="flex justify-between text-[9px] text-slate-500">
                  <span>下一名称：{getTyphoonNamingEntry(config.typhoonNamingCursor ?? config.typhoonNamingStartIndex ?? 0, config.typhoonNamingOverrides).chinese}</span>
                  <span>{(config.typhoonNamingCursor ?? 0) + 1}/{TYPHOON_NAMING_TABLE.length}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 px-1 pt-0.5"><span className="h-px flex-1 bg-slate-800"/><span className="text-[9px] font-bold tracking-[0.16em] text-zinc-500">日常操作</span><span className="h-px flex-1 bg-slate-800"/></div>
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3">
              <div>
                <h3 className="text-xs font-bold text-zinc-200 tracking-wider">强度计算方法</h3>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  物理核心仍以 CMA 2 分钟平均风为统一基准；这里切换的是机构评估口径、单位与分类显示，不改变路径和环境场。
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["CMA", "JMA", "JTWC"] as const).map((agency) => (
                  <button
                    key={agency}
                    onClick={() => onConfigChange({ intensityAgency: agency })}
                    className={`rounded-lg border px-2 py-2 text-[11px] font-bold transition ${
                      (config.intensityAgency || "CMA") === agency
                        ? "border-white/60 bg-white/10 text-white"
                        : "border-slate-700 bg-slate-950/55 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {agency}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["public", "公开档位"],
                  ["continuous", "无级档位"]
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => onConfigChange({ intensityReportingMode: mode })}
                    className={`rounded-lg border px-2 py-2 text-[10px] font-semibold transition ${
                      (config.intensityReportingMode || "public") === mode
                        ? "border-white/60 bg-white/10 text-white shadow-[0_0_14px_rgba(255,255,255,.12)]"
                        : "border-slate-700 bg-slate-950/55 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[9px] leading-relaxed text-slate-500">公开档位按机构发布习惯离散化；无级档位保留连续计算值，适合分析和复盘。</p>
              {typhoons[0] && (() => {
                const agency = config.intensityAgency || "CMA";
                const assessed = getAgencyIntensity(typhoons[0].vmax, agency, config.intensityReportingMode || "public");
                return (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/55 px-3 py-2.5">
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>{assessed.averagingPeriod}平均最大风</span>
                      <span className="font-mono">倍率 {assessed.multiplier.toFixed(3)}</span>
                    </div>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <span className="font-mono text-base font-bold text-slate-100">
                        {assessed.value}{assessed.unit === "kt" ? " kt" : " m/s"}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-300">{assessed.category}</span>
                    </div>
                  </div>
                );
              })()}
              <p className="text-[9px] leading-relaxed text-slate-500">
                JMA 使用 10 分钟平均风并以 kt 显示；JTWC 使用 1 分钟平均风并按模拟器机构分析校准，在同一 CMA 基准风速换算为 kt 后通常再高约 15%–20%。
              </p>
            </div>

            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold text-zinc-200 tracking-wider">预报路径总框架</h3>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">用关键点定义本次模拟的总体移动方向。关键点间距现在会作为“相对快慢”参考：相对本路线典型点距更大的路段倾向更快、更密的路段倾向更慢；不会把每段点距固定解释成若干小时，绝对移速仍由环境引导气流决定。</p>
                </div>
                <label className="flex items-center gap-2 text-[10px] text-slate-400 shrink-0 cursor-pointer">
                  <span>{config.manualForecastRouteEnabled ? "启用" : "关闭"}</span>
                  <input
                    type="checkbox"
                    checked={!!config.manualForecastRouteEnabled}
                    onChange={(e) => {
                      if (e.target.checked && !(config.manualForecastRoute?.length && config.manualForecastRoute.length >= 2)) {
                        onStartForecastRoute();
                      } else {
                        onConfigChange({ manualForecastRouteEnabled: e.target.checked });
                      }
                    }}
                    className="w-4 h-4 accent-zinc-300"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/45 px-3 py-2 text-[10px] text-slate-400 flex items-center justify-between">
                <span>{isForecastRouteDrawing ? `绘制中 · ${Math.max(0, forecastRoutePointCount - 1)} 个方向点` : (config.manualForecastRoute?.length || 0) >= 2 ? `已保存 ${config.manualForecastRoute!.length} 个关键点` : "尚未绘制框架"}</span>
                <span className={config.manualForecastRouteEnabled ? "text-emerald-400" : "text-slate-600"}>{config.manualForecastRouteEnabled ? "GUIDED" : "PHYSICS"}</span>
              </div>

              {!isForecastRouteDrawing ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={onStartForecastRoute} className="py-2 rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 text-xs font-semibold cursor-pointer">
                    {(config.manualForecastRoute?.length || 0) >= 2 ? "重新绘制" : "开始绘制"}
                  </button>
                  <button onClick={onClearForecastRoute} disabled={!(config.manualForecastRoute?.length)} className="py-2 rounded-lg border border-slate-800 bg-slate-950/60 text-xs font-medium text-slate-400 hover:text-slate-200 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer">清除框架</button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={onFinishForecastRoute} className="py-2 rounded-lg bg-slate-100 text-slate-950 text-xs font-bold hover:bg-white cursor-pointer">完成并应用</button>
                  <button onClick={onCancelForecastRoute} className="py-2 rounded-lg border border-slate-700 bg-slate-900 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer">取消绘制</button>
                </div>
              )}
              {!sandboxMode && <button type="button"
                onClick={onApplyCurrentSimulationToForecast}
                className="w-full rounded-lg border border-emerald-700/50 bg-slate-950/60 py-2 text-xs text-emerald-200"
                title="将当前已经完成的主模拟历史作为预报参考，保留主模拟数据不变">
                将当前模拟数据应用到预报
              </button>}
              {!sandboxMode && <button type="button"
                onClick={onClearPreSimulationReference}
                disabled={!hasPreSimulationReference}
                className="w-full rounded-lg border border-sky-700/50 bg-slate-950/60 py-2 text-xs text-sky-200 disabled:opacity-35 disabled:cursor-not-allowed"
                title="只取消当前时刻及之后的预模拟参考，保留此前历史">
                清空预模拟预报参考
              </button>}
              <p className="text-[9px] leading-relaxed text-slate-500">手绘大体路径现在采用更高的确定性参考权重：短中期会更紧地贴合所画框架，同时仍保留少量环境场摆动，不会机械逐点描线。急转弯会适度减速、稀疏/密集打点继续提供相对快慢参考；集系离散度仍完全由各模式/成员自己的扰动机制决定，不会因为主路径权重提高而被压窄。只有中心严重偏离框架时，引导权重才会逐步退出。</p>
            </div>

            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold text-zinc-200 tracking-wider">摇杆释放行为</h3>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">关闭时松手后把手与最后一次手动移动矢量都保持；开启后把手平滑回中，并把已进入手动操控的台风移动矢量明确归零（0 km/h），不会恢复切换前的旧速度。</p>
                </div>
                <label className="flex items-center gap-2 text-[10px] text-slate-400 shrink-0 cursor-pointer">
                  <span>{config.joystickReturnToCenter ? "回中" : "保持"}</span>
                  <input
                    id="toggle-joystick-return-center"
                    type="checkbox"
                    checked={!!config.joystickReturnToCenter}
                    onChange={(e) => onConfigChange({ joystickReturnToCenter: e.target.checked })}
                    className="w-4 h-4 accent-zinc-300"
                  />
                </label>
              </div>
            </div>

            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3.5">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider mb-1">声效 & 视觉</h3>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">声学音效系统</span>
                <input
                  id="toggle-sound-effect"
                  type="checkbox"
                  checked={config.soundEnabled}
                  onChange={(e) => onConfigChange({ soundEnabled: e.target.checked })}
                  className="w-4 h-4 text-slate-100 accent-slate-100"
                />
              </div>

              {config.soundEnabled && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>音效声量</span>
                    <span className="font-mono">{Math.round(config.soundVolume * 100)}%</span>
                  </div>
                  <input
                    id="slider-sound-volume"
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={config.soundVolume}
                    onChange={(e) => onConfigChange({ soundVolume: Number(e.target.value) })}
                    className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                  />
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">自动跟随主台风中心</span>
                <input
                  id="toggle-follow-typhoon"
                  type="checkbox"
                  checked={config.followMainTyphoon}
                  onChange={(e) => onConfigChange({ followMainTyphoon: e.target.checked })}
                  className="w-4 h-4 text-slate-100 accent-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 px-1 pt-1"><span className="h-px flex-1 bg-slate-800"/><span className="text-[9px] font-bold tracking-[0.16em] text-slate-600">高级与低频</span><span className="h-px flex-1 bg-slate-800"/></div>
            <div className="text-[9px] font-bold tracking-[0.16em] text-slate-600 px-1">高级预设 · 可选</div>
            <PresetManager 
              category="global"
              currentConfig={config}
              onApply={onConfigChange}
              onApplyLayers={onLayersChange}
              keysToSave={Object.keys(config) as any}
              defaultPresets={[
                { name: "全局默认 (Global Default)", config: DEFAULT_CONFIG, layers: DEFAULT_LAYERS },
                { name: "硬核真实 (Hardcore Realism)", config: { landDecayEnabled: true, terrainDecayEnabled: true, rapidIntensifyEnabled: true, ewrcTrigger: "auto", maxIntensityLimitEnabled: true, maxIntensityLimit: 75, intensificationRate: 1.0 } },
                { name: "娱乐爽局 (Arcade Power)", config: { landDecayEnabled: false, terrainDecayEnabled: false, rapidIntensifyEnabled: true, intensificationRate: 2.0, maxIntensityLimitEnabled: false, ewrcTrigger: "off" } },
                { name: "超高海温 (Hyper Warm Sea)", config: { sstAnomaly: 2.0, warmPoolEnabled: true, ohcScale: 1.8 } },
                { name: "强引导环境 (Strong Steering)", config: { subtropicalHighStrength: 1.5, westerliesStrength: 1.5, shearScale: 1.2 } }
              ]}
            />
            
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-2">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider mb-1">物理模拟可重复种子</h3>
              <div className="flex gap-2">
                <input
                  id="input-sim-seed"
                  type="text"
                  value={config.seed}
                  onChange={(e) => onConfigChange({ seed: e.target.value })}
                  placeholder="随机物理种子"
                  className="flex-1 bg-slate-950 text-slate-100 border border-slate-800 rounded-lg px-2.5 py-1 text-xs font-mono focus:border-white/60 focus:outline-none"
                />
                <button
                  id="btn-seed-apply"
                  onClick={onGenerateEnvironment}
                  className="px-3 py-1 bg-zinc-100 hover:bg-white active:bg-zinc-100 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  应用
                </button>
              </div>
              <p className="text-[10px] text-slate-500 leading-normal">输入相同种子，大尺度的空气流场、海洋海温、以及台风的历史轨迹节点将完全一致。</p>
            </div>
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider mb-1">维护与重置（低频）</h3>
              
              <div className="flex gap-2.5">
                <button
                  id="drawer-btn-reset"
                  onClick={onResetSimulation}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-xs font-semibold cursor-pointer"
                >
                  重置模拟
                </button>
                <button
                  id="drawer-btn-clear-track"
                  onClick={onClearTrack}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-xs font-semibold text-red-400 cursor-pointer"
                >
                  清空已存轨迹
                </button>
              </div>

              <button
                id="drawer-btn-regen-env"
                onClick={onGenerateEnvironment}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>重新生成气象背景场</span>
              </button>
            </div>

          </div>
        )}

        {/* --- B. TYPHOON ATTRIBUTES --- */}
        {activeTab === "typhoon" && (
          <div className="space-y-4" id="panel-typhoon">
            {/* Main Typhoon Card renaming */}
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3.5">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider">台风基础信息 · 常用</h3>
              
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">自定义台风命名</label>
                <input
                  id="input-typhoon-name"
                  type="text"
                  value={typhoons[0]?.name || ""}
                  onChange={(e) => onUpdateTyphoonIdentity(0, { name: e.target.value })}
                  className="w-full bg-slate-950 text-slate-100 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:border-white/60 focus:outline-none"
                />
              </div>

              {typhoons[0] && (() => {
                const yearCode = getTyphoonYearCode(typhoons[0], startDate);
                const sequence = normalizeTyphoonSequenceNumber(typhoons[0].officialNumber, typhoons[0].seasonOrdinal || 1);
                return (
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">台风编号 · 年份随模拟时间自动生成</label>
                    <div className="flex items-center gap-2">
                      <div className="shrink-0 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-mono font-bold text-zinc-200">{yearCode}</div>
                      <input
                        id="input-typhoon-number"
                        type="number"
                        min={1}
                        max={99}
                        value={sequence}
                        onChange={(e) => {
                          const nextSequence = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                          onUpdateTyphoonIdentity(0, { officialNumber: `${yearCode}${String(nextSequence).padStart(2, "0")}` });
                        }}
                        className="min-w-0 flex-1 bg-slate-950 text-slate-100 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono font-medium focus:border-white/60 focus:outline-none"
                      />
                      <div className="shrink-0 text-[10px] font-mono text-slate-500">完整编号 {getTyphoonOfficialNumber(typhoons[0], startDate)}</div>
                    </div>
                    <p className="text-[9px] leading-relaxed text-slate-500">例如序号 12 在模拟年份 2026 自动显示为 2612；跨年或读取旧存档时年份前缀同样按该台风模拟生成时间重算。</p>
                  </div>
                );
              })()}

              <div className="space-y-2">
                <div className="text-[10px] text-slate-400 font-mono text-center bg-slate-950/40 py-1 rounded border border-slate-900">
                  当前生成源地: <b>{genesisPos.lat.toFixed(2)}°N, {genesisPos.lon.toFixed(2)}°E</b>
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">电脑双击中键直接放置台风；触屏三连击后使用 ✓ / × 确认。</p>
                <button
                  id="btn-reset-main-pos"
                  onClick={onResetSimulation}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold rounded-xl transition cursor-pointer"
                >
                  重置回生成源地
                </button>
              </div>
            </div>

            {desktopDevice && <div className="rounded-xl border border-white/20 bg-white/5 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-bold text-zinc-200">操作方式 · 电脑端</h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["joystick", "draw"] as const).map(mode => <button key={mode} type="button"
                  aria-pressed={(config.controlMode || "joystick") === mode}
                  onClick={() => onConfigChange({ controlMode: mode, joystickDx: 0, joystickDy: 0, joystickDragging: false })}
                  className={`rounded-xl border px-3 py-3 text-xs font-semibold ${(config.controlMode || "joystick") === mode ? "border-white/60 bg-white/10 text-white shadow-[0_0_14px_rgba(255,255,255,.12),inset_0_1px_0_rgba(255,255,255,0.08)]" : "border-white/15 bg-black/20 text-slate-400"}`}>
                  {mode === "joystick" ? "摇杆 / 手柄" : "画点模拟"}</button>)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                <div className="rounded-lg border border-white/10 bg-black/15 px-2.5 py-2 leading-relaxed">摇杆：适合持续微调路径趋势，保留原有移动逻辑。</div>
                <div className="rounded-lg border border-white/10 bg-black/15 px-2.5 py-2 leading-relaxed">画点：生成台风后直接在地图绘制折线路径；完成后可选择同步到大体预报。</div>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-400">画点模式下可继续补点、清空路径，并通过滚轮或 ↑ ↓ 调整实时路径移速；该模式会禁用方向键和手柄操纵。</p>
            </div>}

            {/* Manual Steering parameters */}
            {config.controlMode !== "draw" && <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3.5">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider flex items-center justify-between">
                <span>虚拟摇杆微调设置</span>
                <HelpCircle className="w-4 h-4 text-slate-500 cursor-pointer hover:text-slate-300" onClick={() => showTooltip("摇杆引导", "左下角的虚拟摇杆并非强制瞬移台风中心，而是产生手动移动矢量来控制路径趋势。默认松手后保留摇杆位置与最后的手动移速；可在“模拟”栏目开启自动回中，已进入手动操控的台风回中后移动矢量归零为0 km/h。")} />
              </h3>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>手动引导推力强度</span>
                  <span className="font-mono">{config.joystickStrength}级</span>
                </div>
                <input
                  id="slider-joy-strength"
                  type="range"
                  min={0.1}
                  max={2.0}
                  step={0.1}
                  value={config.joystickStrength}
                  onChange={(e) => onConfigChange({ joystickStrength: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>摇杆位移灵敏度</span>
                  <span className="font-mono">{Math.round(config.joystickSensitivity * 100)}%</span>
                </div>
                <input
                  id="slider-joy-sensitivity"
                  type="range"
                  min={0.2}
                  max={1.8}
                  step={0.1}
                  value={config.joystickSensitivity}
                  onChange={(e) => onConfigChange({ joystickSensitivity: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
              </div>
            </div>}

            {/* Land Decay Parameters Fine-tuning */}
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3.5">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider">
                陆地物理摩擦与衰减微调
              </h3>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>登陆后中心强度减弱速率</span>
                  <span className="font-mono text-zinc-200">{config.landfallDecayAdjustment >= 0 ? "+" : ""}{Math.round(config.landfallDecayAdjustment * 100)}%</span>
                </div>
                <input
                  id="slider-landfall-decay"
                  type="range"
                  min={-1.0}
                  max={1.0}
                  step={0.1}
                  value={config.landfallDecayAdjustment ?? 0.0}
                  onChange={(e) => onConfigChange({ landfallDecayAdjustment: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
                <p className="text-[9px] text-slate-500 leading-snug">以调弱后的新算法为基准(0%)。调节台风中心登陆陆地后的整体减弱幅度和衰变速度。</p>
              </div>

              <div className="space-y-1 border-t border-slate-800/40 pt-2.5">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>外围大风圈贴地粗糙摩擦</span>
                  <span className="font-mono text-zinc-200">{config.landProximityDecayAdjustment >= 0 ? "+" : ""}{Math.round(config.landProximityDecayAdjustment * 100)}%</span>
                </div>
                <input
                  id="slider-proximity-decay"
                  type="range"
                  min={-1.0}
                  max={1.0}
                  step={0.1}
                  value={config.landProximityDecayAdjustment ?? 0.0}
                  onChange={(e) => onConfigChange({ landProximityDecayAdjustment: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
                <p className="text-[9px] text-slate-500 leading-snug">以调弱后的新算法为基准(0%)。控制外围七级/十级大风圈扫过陆地时的摩擦能量损耗速度。</p>
              </div>

              {/* Landfall TD Dissipation Mode Setting */}
              <div className="space-y-2 border-t border-slate-800/40 pt-2.5">
                <span className="text-[11px] font-semibold text-slate-300 block">登陆减弱为热带低压停编设置</span>
                <div className="space-y-1.5 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="radio"
                      name="landTdDissipateMode"
                      value="6h"
                      checked={(config.landTdDissipateMode || "6h") === "6h"}
                      onChange={() => onConfigChange({ landTdDissipateMode: "6h" })}
                      className="accent-zinc-300 w-3.5 h-3.5"
                    />
                    <span>登陆后减弱为热带低压 6 小时后停编</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="radio"
                      name="landTdDissipateMode"
                      value="never"
                      checked={config.landTdDissipateMode === "never"}
                      onChange={() => onConfigChange({ landTdDissipateMode: "never" })}
                      className="accent-zinc-300 w-3.5 h-3.5"
                    />
                    <span>登陆后变为热带低压不停编（只手动停编）</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-800/40 pt-2.5">
                <span className="text-[11px] font-semibold text-slate-300 block">未登陆 / 海上自动停编设置</span>
                <div className="space-y-1.5 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                    <input type="radio" name="nonLandDissipateMode" checked={(config.nonLandDissipateMode || "normal") === "normal"} onChange={() => onConfigChange({ nonLandDissipateMode: "normal" })} className="accent-zinc-300 w-3.5 h-3.5" />
                    <span>正常自动停编（海上低于阈值 / 越界等）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                    <input type="radio" name="nonLandDissipateMode" checked={config.nonLandDissipateMode === "manual"} onChange={() => onConfigChange({ nonLandDissipateMode: "manual" })} className="accent-zinc-300 w-3.5 h-3.5" />
                    <span>不自动停编（仅手动停编）</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Environment Physics Limiters */}
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3.5">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider">
                物理反馈与强度上限
              </h3>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>台风发展增强速度</span>
                  <span className="font-mono text-zinc-200">{Math.round((config.intensificationRate ?? 1.0) * 100)}%</span>
                </div>
                <input
                  id="slider-intensification-rate"
                  type="range"
                  min={0.0}
                  max={2.0}
                  step={0.1}
                  value={config.intensificationRate ?? 1.0}
                  onChange={(e) => onConfigChange({ intensificationRate: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
                <p className="text-[9px] text-slate-500 leading-snug">全局调控常规海上发展与自然爆发增强的响应速度；0% 基本抑制自然正向增强（右上角手动“爆发增强”仍作为独立强制干预），高档位仍受海温、海洋热含量、湿度和风切变的物理上限约束。</p>
              </div>

              <div className="space-y-1 border-t border-slate-800/40 pt-2.5">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>冷水上翻自毁减弱速率</span>
                  <span className="font-mono text-zinc-200">{config.upwellingFactor && config.upwellingFactor >= 0 ? "+" : ""}{Math.round(config.upwellingFactor || 0)}%</span>
                </div>
                <input
                  id="slider-upwelling-factor"
                  type="range"
                  min={-100}
                  max={100}
                  step={5}
                  value={config.upwellingFactor || 0}
                  onChange={(e) => onConfigChange({ upwellingFactor: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
                <p className="text-[9px] text-slate-500 leading-snug">以1/3的减弱算法为基准(0%)。调节台风移动缓慢或打转时抽吸深层冷水导致的衰弱速度。</p>
              </div>

              <div className="space-y-2 border-t border-slate-800/40 pt-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">启用目标强度控制</span>
                  <input
                    id="toggle-intensity-limit"
                    type="checkbox"
                    checked={config.maxIntensityLimitEnabled || false}
                    onChange={(e) => onConfigChange({ maxIntensityLimitEnabled: e.target.checked })}
                    className="w-4 h-4 text-slate-100 accent-slate-100"
                  />
                </div>
                {config.maxIntensityLimitEnabled && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span>{config.autoAdjustIntensity ? "目标巅峰强度" : "目标强度"}</span>
                      <label className="ml-auto flex items-center gap-1 text-[9px] cursor-pointer select-none" title="勾选后滑块设定全程目标巅峰，实际目标由环境和眼墙置换生命周期自动调整">
                        <input
                          type="checkbox"
                          checked={!!config.autoAdjustIntensity}
                          onChange={(e) => onConfigChange({ autoAdjustIntensity: e.target.checked, maxIntensityLimitEnabled: true })}
                          className="w-3.5 h-3.5 accent-zinc-300"
                        />
                        自动调整强度
                      </label>
                      <button
                        type="button"
                        className="font-mono text-zinc-200 underline decoration-dotted underline-offset-2"
                        title={config.autoAdjustIntensity ? "点击手动输入目标巅峰强度（实际不保证达到）" : "点击手动输入目标强度（115 m/s 起进入游乐场模式）"}
                        onClick={() => setInputDialog({
                          kind: "intensity",
                          title: config.autoAdjustIntensity ? "手动输入目标巅峰强度" : "手动输入目标强度",
                          initialValue: String(config.maxIntensityLimit || 70)
                        })}
                      >{config.maxIntensityLimit || 70} m/s</button>
                    </div>
                    <input
                      id="slider-intensity-limit"
                      type="range"
                      min={5}
                      max={150}
                      step={1}
                      value={Math.min(150, Math.max(5, config.maxIntensityLimit || 70))}
                      onChange={(e) => onConfigChange({ maxIntensityLimit: Number(e.target.value) })}
                      className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                    />
                    {(config.maxIntensityLimit || 0) >= 115 && (
                      <div className="rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-[9px] font-bold text-fuchsia-300">🎡 游乐场模式：海上默认自动 ERI · 增强 ×8 · 海温 +5℃ · 无背景风切/EWRC · 手动干空气/风切可中断 · 登陆正常减弱 · 风圈/强度无上限</div>
                    )}
                    <p className="text-[9px] text-slate-500 leading-snug">{config.autoAdjustIntensity ? "自动调整开启：滑块代表全程目标巅峰，环境和结构决定实际每小时目标；不保证达到。首次成功EWRC后的再增强通常获得较大的巅峰机会，后续周期默认逐渐趋于持平/略弱。" : "自动调整关闭：滑块维持原来的当前目标强度控制。"} 滑块范围5–150 m/s；115 m/s起仍进入游乐场模式。</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- C. ATMOSPHERIC SYSTEMS --- */}
        {activeTab === "environment" && (
          <div className="space-y-4" id="panel-atmosphere">



            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-2">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider mb-2">气候预设 (Atmospheric Presets)</h3>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { name: "1月", cfg: { shearPreset: "january", subtropicalHighStrength: 0.8, subtropicalHighLat: 15, subtropicalHighWestExtent: 140, westerliesLat: 25, westerliesStrength: 1.5, shearScale: 1.1, dryAirStrength: 1.0 } },
                  { name: "2月", cfg: { shearPreset: "february", subtropicalHighStrength: 0.8, subtropicalHighLat: 15, subtropicalHighWestExtent: 142, westerliesLat: 26, westerliesStrength: 1.4, shearScale: 1.1, dryAirStrength: 1.0 } },
                  { name: "3月", cfg: { shearPreset: "march", subtropicalHighStrength: 0.9, subtropicalHighLat: 16, subtropicalHighWestExtent: 135, westerliesLat: 28, westerliesStrength: 1.3, shearScale: 1.0, dryAirStrength: 0.8 } },
                  { name: "4月", cfg: { shearPreset: "april", subtropicalHighStrength: 1.0, subtropicalHighLat: 18, subtropicalHighWestExtent: 130, westerliesLat: 30, westerliesStrength: 1.2, shearScale: 0.9, dryAirStrength: 0.6 } },
                  { name: "5月", cfg: { shearPreset: "may", subtropicalHighStrength: 1.1, subtropicalHighLat: 22, subtropicalHighWestExtent: 125, westerliesLat: 35, westerliesStrength: 1.0, shearScale: 0.8, dryAirStrength: 0.4 } },
                  { name: "6月", cfg: { shearPreset: "june", subtropicalHighStrength: 1.2, subtropicalHighLat: 26, subtropicalHighWestExtent: 118, westerliesLat: 39, westerliesStrength: 0.9, shearScale: 0.8, dryAirStrength: 0.3 } },
                  { name: "7月", cfg: { shearPreset: "july", subtropicalHighStrength: 1.3, subtropicalHighLat: 34, subtropicalHighWestExtent: 115, westerliesLat: 45, westerliesStrength: 0.8, shearScale: 0.8, dryAirStrength: 0.2 } },
                  { name: "8月", cfg: { shearPreset: "august", subtropicalHighStrength: 1.4, subtropicalHighLat: 36, subtropicalHighWestExtent: 110, westerliesLat: 47, westerliesStrength: 0.7, shearScale: 0.8, dryAirStrength: 0.1 } },
                  { name: "9月", cfg: { shearPreset: "september", subtropicalHighStrength: 1.2, subtropicalHighLat: 31, subtropicalHighWestExtent: 120, westerliesLat: 37, westerliesStrength: 0.9, shearScale: 0.8, dryAirStrength: 0.2 } },
                  { name: "10月", cfg: { shearPreset: "october", subtropicalHighStrength: 1.1, subtropicalHighLat: 25, subtropicalHighWestExtent: 125, westerliesLat: 35, westerliesStrength: 1.1, shearScale: 0.9, dryAirStrength: 0.5 } },
                  { name: "11月", cfg: { shearPreset: "november", subtropicalHighStrength: 0.9, subtropicalHighLat: 18, subtropicalHighWestExtent: 135, westerliesLat: 28, westerliesStrength: 1.3, shearScale: 1.0, dryAirStrength: 0.8 } },
                  { name: "12月", cfg: { shearPreset: "december", subtropicalHighStrength: 0.8, subtropicalHighLat: 16, subtropicalHighWestExtent: 140, westerliesLat: 26, westerliesStrength: 1.4, shearScale: 1.1, dryAirStrength: 1.0 } },
                  { name: "无", cfg: { shearPreset: "global_low", subtropicalHighStrength: 0, westerliesStrength: 0, shearScale: 0.5, dryAirStrength: 0 } }
                ].map(p => {
                  const selected = Object.entries(p.cfg).every(([key, value]) => (config as any)[key] === value);
                  return (
                    <button
                      key={p.name}
                      className={`px-1.5 py-1 rounded text-[10px] transition-all border ${selected ? "bg-white/10 border-white/60 text-white ring-1 ring-white/15 shadow-[0_0_14px_rgba(255,255,255,.12)]" : "bg-slate-800 hover:bg-slate-700 border-slate-700/50 text-slate-300"}`}
                      onClick={() => onConfigChange(p.cfg)}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-2">
                <span className="text-[10px] text-slate-400 mt-1">追加模式:</span>
                {[
                  { name: "良好", mod: { shear: Math.max(0, (config.shear || 8) - 5), dryAirStrength: Math.max(0, (config.dryAirStrength || 0) - 0.5) } },
                  { name: "默认", mod: DEFAULT_ATMOSPHERIC_PRESET },
                  { name: "恶劣", mod: { shear: (config.shear || 8) + 8, dryAirStrength: (config.dryAirStrength || 0) + 0.8 } }
                ].map(m => (
                  <button key={m.name} className="px-2 py-1 bg-slate-800/80 hover:bg-slate-700 rounded text-[10px] text-teal-400 transition-colors" onClick={() => onConfigChange(m.mod)}>
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
            {/* Subtropical High config */}
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3.5">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold text-zinc-200 tracking-wider flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-zinc-200" />
                  <span>副热带高压系统</span>
                </h3>
                <input
                  id="toggle-subhigh"
                  type="checkbox"
                  checked={config.subtropicalHighEnabled}
                  onChange={(e) => onConfigChange({ subtropicalHighEnabled: e.target.checked })}
                  className="w-4 h-4 text-slate-100 accent-slate-100"
                />
              </div>

              {config.subtropicalHighEnabled && (
                <div className="space-y-3 pt-2 border-t border-slate-900">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        副高环流强度
                        <HelpCircle className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 cursor-pointer" onClick={() => showTooltip("副热带高压", "副高是西北太平洋台风最核心的引导气流源。强度越强，其南侧的偏东风分量越大，台风总体在低纬度向西偏西方向急速移动。")} />
                      </span>
                      <span className="font-mono text-zinc-200">{Math.round(config.subtropicalHighStrength * 100)}%</span>
                    </div>
                    <input
                      id="slider-subhigh-strength"
                      type="range"
                      min={0.0}
                      max={2.0}
                      step={0.1}
                      value={config.subtropicalHighStrength}
                      onChange={(e) => onConfigChange({ subtropicalHighStrength: Number(e.target.value) })}
                      className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>副高脊线平均纬度</span>
                      <span className="font-mono text-zinc-200">{config.subtropicalHighLat}°N</span>
                    </div>
                    <input
                      id="slider-subhigh-lat"
                      type="range"
                      min={18}
                      max={45}
                      step={0.5}
                      value={config.subtropicalHighLat}
                      onChange={(e) => onConfigChange({ subtropicalHighLat: Number(e.target.value) })}
                      className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>副高西伸脊点经度</span>
                      <span className="font-mono text-zinc-200">{config.subtropicalHighWestExtent}°E</span>
                    </div>
                    <input
                      id="slider-subhigh-west"
                      type="range"
                      min={105}
                      max={142}
                      step={1.0}
                      value={config.subtropicalHighWestExtent}
                      onChange={(e) => onConfigChange({ subtropicalHighWestExtent: Number(e.target.value) })}
                      className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                    />
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>副高南北跨度 (N-S Extent)</span>
                      <span className="font-mono text-zinc-200">{((config.subtropicalHighNSSize !== undefined ? config.subtropicalHighNSSize : 1.0) * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      id="slider-subhigh-ns"
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.1}
                      value={config.subtropicalHighNSSize !== undefined ? config.subtropicalHighNSSize : 1.0}
                      onChange={(e) => onConfigChange({ subtropicalHighNSSize: Number(e.target.value) })}
                      className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        副高东西跨度 (E-W Extent)
                        <HelpCircle className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 cursor-pointer" onClick={() => showTooltip("副高东西跨度", "独立调整副热带高压在东西方向的尺度。它不会直接改动西伸脊点的位置，而是改变5880位势高度区、环流影响半径和核心屏障在经向以外的横向宽度；数值越大，副高对更宽经度范围内的台风引导越持续。")} />
                      </span>
                      <span className="font-mono text-zinc-200">{((config.subtropicalHighEWSize !== undefined ? config.subtropicalHighEWSize : 1.0) * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      id="slider-subhigh-ew"
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.1}
                      value={config.subtropicalHighEWSize !== undefined ? config.subtropicalHighEWSize : 1.0}
                      onChange={(e) => onConfigChange({ subtropicalHighEWSize: Number(e.target.value) })}
                      className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Westerlies config */}
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3.5">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold text-zinc-200 tracking-wider flex items-center gap-1.5">
                  <Wind className="w-4 h-4 text-zinc-200" />
                  <span>中纬度西风带与急流</span>
                </h3>
                <input
                  id="toggle-westerlies"
                  type="checkbox"
                  checked={config.westerliesEnabled}
                  onChange={(e) => onConfigChange({ westerliesEnabled: e.target.checked })}
                  className="w-4 h-4 text-slate-100 accent-slate-100"
                />
              </div>

              {config.westerliesEnabled && (
                <div className="space-y-3 pt-2 border-t border-slate-900">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        西风带引导流强度
                        <HelpCircle className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 cursor-pointer" onClick={() => showTooltip("中纬度西风带", "中高纬度的极地急流和深槽会产生强大的偏西引导风速。一旦台风越过副高脊线，被吸入西风槽前，它会猛烈转向东北方向加速移动，最终完成温带气旋变性。")} />
                      </span>
                      <span className="font-mono text-zinc-200">{Math.round(config.westerliesStrength * 100)}%</span>
                    </div>
                    <input
                      id="slider-westerlies-strength"
                      type="range"
                      min={0.0}
                      max={2.0}
                      step={0.1}
                      value={config.westerliesStrength}
                      onChange={(e) => onConfigChange({ westerliesStrength: Number(e.target.value) })}
                      className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>西风急流轴纬度位置</span>
                      <span className="font-mono text-zinc-200">{config.westerliesLat}°N</span>
                    </div>
                    <input
                      id="slider-westerlies-lat"
                      type="range"
                      min={26}
                      max={45}
                      step={0.5}
                      value={config.westerliesLat}
                      onChange={(e) => onConfigChange({ westerliesLat: Number(e.target.value) })}
                      className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>西风槽槽前经度</span>
                      <span className="font-mono text-zinc-200">{config.westerliesTroughLon}°E</span>
                    </div>
                    <input
                      id="slider-westerlies-trough-lon"
                      type="range"
                      min={112}
                      max={145}
                      step={1.0}
                      value={config.westerliesTroughLon}
                      onChange={(e) => onConfigChange({ westerliesTroughLon: Number(e.target.value) })}
                      className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Environmental Limiters (Shear & Humidity) */}
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3.5">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider">大气垂直物理切变</h3>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>月份气候场预设</span>
                </div>
                <select
                  value={config.shearPreset || 'global_low'}
                  onChange={(e) => onConfigChange({ shearPreset: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700/50 rounded text-slate-300 text-xs py-1 px-2 focus:outline-none focus:border-white/60"
                >
                  <option value="global_low">全局低风切 (Global Low)</option>
                  <option value="january">1月 (January)</option>
                  <option value="february">2月 (February)</option>
                  <option value="march">3月 (March)</option>
                  <option value="april">4月 (April)</option>
                  <option value="may">5月 (May)</option>
                  <option value="june">6月 (June)</option>
                  <option value="july">7月 (July)</option>
                  <option value="august">8月 (August)</option>
                  <option value="september">9月 (September)</option>
                  <option value="october">10月 (October)</option>
                  <option value="november">11月 (November)</option>
                  <option value="december">12月 (December)</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    垂直风切变倍率 (Shear)
                    <HelpCircle className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 cursor-pointer" onClick={() => showTooltip("垂直风切变", "高低空风向和风速的差。切变极低时，台风高低空暖心易于重合，爆发性增强；切变极高时（如靠近西风带），台风结构被拦腰斩断，对流歪斜，导致快速衰退。")} />
                  </span>
                  <span className="font-mono text-zinc-200">{Math.round(config.shearScale * 100)}%</span>
                </div>
                <input
                  id="slider-shear-scale"
                  type="range"
                  min={0.2}
                  max={2.0}
                  step={0.1}
                  value={config.shearScale}
                  onChange={(e) => onConfigChange({ shearScale: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>中层700hPa湿度倍率</span>
                  <span className="font-mono text-zinc-200">{Math.round(config.humidityScale * 100)}%</span>
                </div>
                <input
                  id="slider-humidity-scale"
                  type="range"
                  min={0.3}
                  max={1.5}
                  step={0.1}
                  value={config.humidityScale}
                  onChange={(e) => onConfigChange({ humidityScale: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">干空气主动侵入机制</span>
                <input
                  id="toggle-dry-air"
                  type="checkbox"
                  checked={config.dryAirEnabled}
                  onChange={(e) => onConfigChange({ dryAirEnabled: e.target.checked })}
                  className="w-4 h-4 text-slate-100 accent-slate-100"
                />
              </div>

            </div>
          </div>
        )}

        {/* --- D. OCEANIC SYSTEMS --- */}
        {activeTab === "ocean" && (
          <div className="space-y-4" id="panel-ocean">



            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-2">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider mb-2">海洋预设 (Oceanic Presets)</h3>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { name: "1月", cfg: { sstBase: 27.8, sstPivotLat: 18, sstAnomaly: -1.2, sstNorthSouthGradient: 1.8 } },
                  { name: "2月", cfg: { sstBase: 27.5, sstPivotLat: 16, sstAnomaly: -1.5, sstNorthSouthGradient: 1.9 } },
                  { name: "3月", cfg: { sstBase: 28.1, sstPivotLat: 19, sstAnomaly: -1.0, sstNorthSouthGradient: 1.6 } },
                  { name: "4月", cfg: { sstBase: 28.6, sstPivotLat: 22, sstAnomaly: -0.5, sstNorthSouthGradient: 1.3 } },
                  { name: "5月", cfg: { sstBase: 29.1, sstPivotLat: 25, sstAnomaly: 0.2, sstNorthSouthGradient: 1.1 } },
                  { name: "6月", cfg: { sstBase: 29.5, sstPivotLat: 27, sstAnomaly: 0.8, sstNorthSouthGradient: 0.9 } },
                  { name: "7月", cfg: { sstBase: 29.8, sstPivotLat: 29, sstAnomaly: 1.2, sstNorthSouthGradient: 0.8 } },
                  { name: "8月", cfg: { sstBase: 30.0, sstPivotLat: 31, sstAnomaly: 1.5, sstNorthSouthGradient: 0.7 } },
                  { name: "9月", cfg: { sstBase: 29.7, sstPivotLat: 29.3, sstAnomaly: 1.3, sstNorthSouthGradient: 0.8 } },
                  { name: "10月", cfg: { sstBase: 29.3, sstPivotLat: 26, sstAnomaly: 0.8, sstNorthSouthGradient: 1.0 } },
                  { name: "11月", cfg: { sstBase: 28.5, sstPivotLat: 22, sstAnomaly: 0.0, sstNorthSouthGradient: 1.4 } },
                  { name: "12月", cfg: { sstBase: 28.0, sstPivotLat: 20, sstAnomaly: -0.8, sstNorthSouthGradient: 1.6 } },
                  { name: "拉尼娜", cfg: { sstAnomaly: 0.8, warmPoolEnabled: true, ohcScale: 1.4 } },
                  { name: "厄尔尼诺", cfg: { sstAnomaly: -0.5, warmPoolEnabled: false, ohcScale: 0.8 } }
                ].map(p => {
                  const selected = Object.entries(p.cfg).every(([key, value]) => (config as any)[key] === value);
                  return (
                    <button
                      key={p.name}
                      className={`px-1.5 py-1 rounded text-[10px] transition-all border ${selected ? "bg-white/10 border-white/60 text-white ring-1 ring-white/15 shadow-[0_0_14px_rgba(255,255,255,.12)]" : "bg-slate-800 hover:bg-slate-700 border-slate-700/50 text-slate-300"}`}
                      onClick={() => onConfigChange(p.cfg)}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3.5">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider">海表热容量与异常场</h3>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    海表温度整体偏差 (SST)
                    <HelpCircle className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 cursor-pointer" onClick={() => showTooltip("海表温度", "海温是热带气旋的燃料箱。SST高于26.5℃是产生台风的前提，SST > 28.5℃配合极低的垂直切变极易促发巨型台风诞生。")} />
                  </span>
                  <span className="font-mono text-zinc-200">{config.sstAnomaly >= 0 ? "+" : ""}{config.sstAnomaly.toFixed(1)} ℃</span>
                </div>
                <input
                  id="slider-sst-anomaly"
                  type="range"
                  min={-3.0}
                  max={3.0}
                  step={0.1}
                  value={config.sstAnomaly}
                  onChange={(e) => onConfigChange({ sstAnomaly: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    海温南北衰减梯度 (SST Gradient)
                    <HelpCircle className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 cursor-pointer" onClick={() => showTooltip("南北梯度", "控制北向海温衰减的剧烈程度。0% 为不衰减（南北海温一致），100% 为标准衰减。")} />
                  </span>
                  <span className="font-mono text-zinc-200">{((config.sstNorthSouthGradient !== undefined ? config.sstNorthSouthGradient : 1.0) * 100).toFixed(0)}%</span>
                </div>
                <input
                  id="slider-sst-gradient"
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.01}
                  value={config.sstNorthSouthGradient !== undefined ? config.sstNorthSouthGradient : 1.0}
                  onChange={(e) => onConfigChange({ sstNorthSouthGradient: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>海洋热含量倍率 (OHC)</span>
                  <span className="font-mono text-zinc-200">{Math.round(config.ohcScale * 100)}%</span>
                </div>
                <input
                  id="slider-ohc-scale"
                  type="range"
                  min={0.0}
                  max={2.0}
                  step={0.1}
                  value={config.ohcScale}
                  onChange={(e) => onConfigChange({ ohcScale: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
              </div>
            </div>

            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider">洋流与热力异常区</h3>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">菲律宾以东“暖池”增强</span>
                <input
                  id="toggle-warmpool"
                  type="checkbox"
                  checked={config.warmPoolEnabled}
                  onChange={(e) => onConfigChange({ warmPoolEnabled: e.target.checked })}
                  className="w-4 h-4 text-slate-100 accent-slate-100"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">台湾东南部“冷涡”负异常</span>
                <input
                  id="toggle-coldeddy"
                  type="checkbox"
                  checked={config.coldEddyEnabled}
                  onChange={(e) => onConfigChange({ coldEddyEnabled: e.target.checked })}
                  className="w-4 h-4 text-slate-100 accent-slate-100"
                />
              </div>
              
              <div className="space-y-1 border-t border-slate-800/40 pt-2.5">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>强海气耦合系数 (Coupling)</span>
                  <span className="font-mono text-zinc-200">{Math.round(config.airSeaCoupling * 100)}%</span>
                </div>
                <input
                  id="slider-air-sea-coupling"
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={config.airSeaCoupling}
                  onChange={(e) => onConfigChange({ airSeaCoupling: Number(e.target.value) })}
                  className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                />
              </div>
            </div>
          </div>
        )}

        {/* --- E. GIS LAYERS --- */}
        {activeTab === "layers" && (
          <div className="space-y-4" id="panel-layers">
            {/* Basemap radios */}
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-2.5">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider flex items-center gap-1">
                <Map className="w-4 h-4 text-zinc-200" />
                <span>电子底图源选择 (单选)</span>
              </h3>
              {[
                { title: "离线底图", hint: "使用内置 Natural Earth 矢量海岸线，不请求网络瓦片", items: OFFLINE_BASEMAP_OPTIONS },
                { title: "联网底图", hint: "需要网络瓦片服务；空白无地图不会发起瓦片请求", items: ONLINE_BASEMAP_OPTIONS }
              ].map((section) => (
                <div key={section.title} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 px-0.5">
                    <span className="text-[11px] font-bold text-slate-300">{section.title}</span>
                    <span className="text-[9px] text-slate-500 text-right">{section.hint}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {section.items.map((base) => (
                      <label
                        key={base.id}
                        id={`label-base-${base.id}`}
                        className={`flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition ${
                          layers.baseMap === base.id
                            ? "bg-white/10 border-white/60 text-zinc-200"
                            : "bg-slate-950/40 border-slate-800 text-slate-300 hover:text-white"
                        }`}
                      >
                        <input
                          type="radio"
                          name="basemap-group"
                          checked={layers.baseMap === base.id}
                          onChange={() => onLayersChange({ baseMap: base.id })}
                          className="hidden"
                        />
                        <span>{base.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3">
              <div><h3 className="text-xs font-bold text-zinc-200 tracking-wider">历史台风路径</h3><p className="mt-1 text-[9px] text-slate-500">仅影响已结束台风；当前台风路径不受此项影响。历史数据始终保留。</p></div>
              <div className="grid grid-cols-3 gap-1.5">
                {([['visible','显示'],['translucent','半透明'],['hidden','隐藏']] as const).map(([mode,label]) => <button key={mode} onClick={() => onConfigChange({ historicalTrackDisplay: mode })} className={`rounded-lg border px-2 py-2 text-[10px] font-semibold ${ (config.historicalTrackDisplay || 'visible') === mode ? 'border-white/60 bg-white/10 text-white shadow-[0_0_14px_rgba(255,255,255,.12)]' : 'border-slate-700 bg-slate-950/55 text-slate-400'}`}>{label}</button>)}
              </div>
              <label className="flex items-center justify-between text-[11px] text-slate-300 cursor-pointer"><span>显示历史路径打点</span><input type="checkbox" checked={config.historicalTrackDots !== false} onChange={(e) => onConfigChange({ historicalTrackDots: e.target.checked })} className="w-4 h-4 accent-zinc-300" /></label>
            </div>

            {/* Overlay Layers, Save, FolderOpen lists */}
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider">常用叠加层</h3>

              <div className="space-y-2.5 text-xs">
                {[
                  { key: "track", label: "台风路径与强度打点" },
                  { key: "windRadii", label: "七/十/十二级非对称风圈" },
                  { key: "forecast", label: "120h台风预报路径" },
                  { key: "forecastCone", label: "120h预报不确定性锥" },
                  { key: "drawnForecastRoute", label: "手绘大体预报路径", disabled: !hasConfirmedDrawnForecastRoute },
                  { key: "hurricaneTrackerModels", label: "WMC 多模式中心路径" },
                  { key: "weatherStations", label: "气象站点监控" },
                  { key: "sst", label: "SST 海表温度" },
                  { key: "ohc", label: "OHC 海洋热容量" },
                  { key: "strongDryAir", label: "强干空气侵入区" },
                  { key: "strongWindShear", label: "强垂直风切变区" },
                  { key: "subHigh", label: "5880 gpm 副热带高压山脊圈" },
                  { key: "westerlies", label: "西风槽与急流方向轴线" },
                  { key: "coastline", label: "高分辨率防灾海岸线掩膜" },
                  { key: "border", label: "省界与国界边缘线" },
                  { key: "cursor", label: "页面中央十字测量光标" }
                ].map((ov) => (
                  <label
                    key={ov.key}
                    id={`label-layer-${ov.key}`}
                    className={`flex items-center justify-between py-1 ${ov.disabled ? "cursor-not-allowed text-slate-600" : "cursor-pointer text-slate-300 hover:text-white"}`}
                    title={ov.disabled ? "请先绘制并确认手绘大体预报路径" : undefined}
                  >
                    <span>{ov.label}</span>
                    <input
                      id={`checkbox-layer-${ov.key}`}
                      type="checkbox"
                      checked={(layers as any)[ov.key]}
                      disabled={!!ov.disabled}
                      onChange={(e) => { if (!ov.disabled) onLayersChange({ [ov.key]: e.target.checked }); }}
                      className="w-4 h-4 text-slate-100 accent-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                    />
                  </label>
                ))}
              </div>

            </div>



            {/* Dynamic sampled-layer spacing. SST/OHC use cached image overlays. */}
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-200 tracking-wider">动态天气采样间距</h3>
                <span className="text-[10px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-slate-300 font-mono">
                  {layers.rasterResolution || 6} 像素
                </span>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">仅影响风切、干空气等动态采样层；模拟运行时不提供任何云图图层，卫星云图仅在 WMC 气象产品中心按需生成。海温/热含量使用缓存贴图。</p>
              <div className="space-y-1">
                <input
                  id="slider-raster-resolution"
                  type="range"
                  min="2"
                  max="32"
                  step="1"
                  value={layers.rasterResolution || 6}
                  onChange={(e) => {
                    onLayersChange({ rasterResolution: parseInt(e.target.value) });
                  }}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-zinc-300"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-sans">
                  <span>极清 (2px)</span>
                  <span className="text-slate-400 font-semibold">
                    {(layers.rasterResolution || 6) <= 4
                      ? "极致画质 (可能影响帧率)"
                      : (layers.rasterResolution || 6) <= 8
                      ? "均衡性能"
                      : "流畅运行"}
                  </span>
                  <span>标清 (32px)</span>
                </div>
              </div>
            </div>
          </div>
        )}


        {/* --- STYLE SYSTEM: CMA / JMA --- */}
        {activeTab === "style" && (
          <div className="space-y-4 fade-in" id="panel-style">
            <div className="bg-slate-900/40 p-3 rounded-xl border border-slate-800/50 space-y-3">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-zinc-200" />
                <div>
                  <h3 className="text-xs font-bold text-zinc-200">机构视觉风格</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">可全局切换，也可逐元素混搭。CMA 保持现有样式；JMA 采用 Best Track 动画视觉。</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["CMA", "JMA"] as const).map(style => (
                  <button
                    key={style}
                    onClick={() => {
                      onConfigChange({ agencyStyle: style, trackStyle: style, trackDotStyle: style, windRadiiStyle: style, centerStyle: style, mechanismStyle: style });
                      if (style === "JMA") onLayersChange({ baseMap: "jma" });
                      else if (layers.baseMap === "jma") onLayersChange({ baseMap: "dark" });
                    }}
                    className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${(config.agencyStyle || "CMA") === style ? "border-white/60 bg-white/10 text-zinc-200" : "border-slate-700 bg-slate-950/50 text-slate-300 hover:text-white"}`}
                  >
                    {style} 全局
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3">
              <h3 className="text-xs font-bold text-slate-200">元素独立风格</h3>
              {([
                ["trackStyle", "路径线"],
                ["trackDotStyle", "路径打点"],
                ["windRadiiStyle", "风圈"],
                ["centerStyle", "中心符号"],
                ["mechanismStyle", "机制 / 信息元素"]
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <div className="text-[11px] text-slate-300">{label}</div>
                  <div className="flex rounded-lg overflow-hidden border border-slate-700">
                    {(["CMA", "JMA"] as const).map(style => (
                      <button
                        key={style}
                        onClick={() => onConfigChange({ [key]: style } as Partial<SimulationConfig>)}
                        className={`px-3 py-1.5 text-[10px] font-bold ${(config[key] || config.agencyStyle || "CMA") === style ? "bg-zinc-100 text-white" : "bg-slate-950/60 text-slate-400"}`}
                      >{style}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] leading-relaxed text-slate-400">
              <span className="font-semibold text-amber-300">JMA / Best Track 视觉：</span>
              白色轨迹；00 UTC 大圆点、12 UTC 中圆点、其余时次小圆点；黄色外风圈与红橙色内风圈；中心为白色叉号。
              JMA 视觉保留白色路径、正圆偏心风圈与中心叉等表现；底图不再绑定专用 Best Track 图源，可由用户从现有通用底图中自由选择。
            </div>
          </div>
        )}

        {/* --- F. INTEGRATED INFORMATION PANEL --- */}
        {activeTab === "custom" && <div id="panel-custom" className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-bold">自定义快捷控制</h3><button type="button" onClick={()=>setCustomPickerOpen(true)} className="flex gap-1 items-center rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-xs"><Plus className="w-4 h-4"/>添加</button></div>
          {!customIds.length && <p className="text-xs text-zinc-400">点击添加，从其他子栏目选择常用设置。设置直接修改原配置，排列将保存在当前浏览器。</p>}
          {customIds.map(id => {
            const item=visibleCustomChoices.find(x=>x.id===id);if(!item)return null;
            const value=item.layer?(layers as any)[item.key]:(config as any)[item.key];
            const change=(newValue:any)=>item.layer?onLayersChange({[item.key]:newValue} as Partial<ActiveLayers>):onConfigChange({[item.key]:newValue} as Partial<SimulationConfig>);
            return <section key={id} className="rounded-xl bg-zinc-800/45 border border-zinc-700/65 px-3 py-3 space-y-2">
              <div className="flex justify-between items-center"><div><b className="text-xs">{item.label}</b><span className="text-[10px] text-zinc-500 ml-2">{item.source}</span></div><button type="button" title="移除此快捷项" onClick={()=>setCustomIds(prev=>prev.filter(x=>x!==id))}><Trash2 className="w-3.5 h-3.5 text-zinc-400"/></button></div>
              {item.type==="toggle" && <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={!!value} onChange={e=>change(e.target.checked)}/>{value?"开启":"关闭"}</label>}
              {item.type==="range" && <div className="flex items-center gap-2"><input type="range" min={item.min} max={item.max} step={item.step} value={Number(value??0)} onChange={e=>change(Number(e.target.value))} className="flex-1 min-w-0 accent-zinc-300"/><span className="text-xs font-mono w-10 text-right">{Number(value??0).toFixed(2)}</span></div>}
              {item.type==="select" && <select value={String(value??item.options?.[0])} onChange={e=>change(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-xs">{item.options?.map(v=><option key={v} value={v}>{v==="joystick"?"摇杆":v==="draw"?"画点":v}</option>)}</select>}
            </section>;
          })}
          {customPickerOpen && <div role="dialog" aria-label="添加自定义控制" className="absolute inset-0 z-[2100] bg-black/75 flex items-center justify-center p-4">
            <div className="w-full max-w-sm max-h-[82vh] overflow-y-auto bg-zinc-900 rounded-xl border border-zinc-600 p-4 space-y-3">
              <div className="flex justify-between items-center"><h4 className="font-semibold text-sm">从其他子栏目添加</h4><button onClick={()=>setCustomPickerOpen(false)} aria-label="关闭"><X className="w-4 h-4"/></button></div>
              {visibleCustomChoices.map(item=><label key={item.id} className="flex items-center gap-3 border border-white/10 p-2 rounded-lg text-xs cursor-pointer"><input type="checkbox" checked={customIds.includes(item.id)} onChange={e=>setCustomIds(prev=>e.target.checked?[...new Set([...prev,item.id])]:prev.filter(x=>x!==item.id))}/><span className="flex-1">{item.label}</span><span className="text-zinc-500">{item.source}</span></label>)}
              <button onClick={()=>setCustomPickerOpen(false)} className="w-full rounded-lg bg-zinc-200 text-zinc-900 py-2 text-sm font-bold">完成</button>
            </div></div>}
        </div>}

        {activeTab === "info" && (
          <div className="space-y-4 fade-in" id="panel-info">
            {/* 拟物解压音效设置 */}
            <div className="space-y-2">
              <h2 className="text-[11px] font-bold text-zinc-200 tracking-wider uppercase">拟物解压音效设置</h2>
              <div className="bg-slate-900 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300">开启点击解压音效</span>
                  <input
                    type="checkbox"
                    checked={config.soundEnabled}
                    onChange={(e) => onConfigChange({ soundEnabled: e.target.checked })}
                    className="w-4 h-4 text-slate-100 accent-slate-100"
                  />
                </div>

                {config.soundEnabled && (
                  <>
                    <div className="space-y-1.5 pt-1 border-t border-slate-800">
                      <span className="text-[11px] text-slate-400 block">选择音效反馈类型</span>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          data-aether-sound-preview="true"
                          onClick={() => {
                            onConfigChange({ soundMode: "mahjong" });
                            playSndClick(config.soundVolume, true, "mahjong");
                          }}
                          className={`py-1.5 px-2 rounded text-[11px] font-semibold border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                            config.soundMode === "mahjong"
                              ? "bg-white/10 border-white/65 text-white shadow-[0_0_16px_rgba(255,255,255,.18)]"
                              : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                          }`}
                        >
                          🀄 麻将音 (实录双触发)
                        </button>
                        <button
                          type="button"
                          data-aether-sound-preview="true"
                          onClick={() => {
                            onConfigChange({ soundMode: "mouse" });
                            playSndClick(config.soundVolume, true, "mouse");
                          }}
                          className={`py-1.5 px-2 rounded text-[11px] font-semibold border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                            config.soundMode !== "mahjong"
                              ? "bg-white/10 border-white/65 text-white shadow-[0_0_16px_rgba(255,255,255,.18)]"
                              : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                          }`}
                        >
                          🖱️ 鼠标音 (实录双触发)
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>音效声量</span>
                        <span className="font-mono">{Math.round(config.soundVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.1}
                        value={config.soundVolume}
                        onChange={(e) => onConfigChange({ soundVolume: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 页面显示设置 */}
            <div className="space-y-4">
              <h2 className="text-[11px] font-bold text-zinc-200 tracking-wider uppercase">页面显示设置</h2>
              <div className="bg-slate-900 rounded-lg p-3 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300">气象站点显隐</span>
                  <input type="checkbox" checked={layers.weatherStations || false} onChange={(e) => onLayersChange({ weatherStations: e.target.checked })} className="w-4 h-4 text-slate-100 accent-slate-100" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300">气象站点城市名称</span>
                  <input type="checkbox" checked={config.stationLabels || false} onChange={(e) => onConfigChange({ stationLabels: e.target.checked })} className="w-4 h-4 text-slate-100 accent-slate-100" />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>城市密度</span>
                    <span>{config.cityDensity !== undefined ? config.cityDensity : 50}%</span>
                  </div>
                  <input type="range" min="5" max="100" step="5" value={config.cityDensity !== undefined ? config.cityDensity : 50} onChange={(e) => onConfigChange({ cityDensity: Number(e.target.value) })} className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300" />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>胶囊尺寸</span>
                    <span>{config.capsuleSize !== undefined ? config.capsuleSize : 100}%</span>
                  </div>
                  <input type="range" min="50" max="200" step="10" value={config.capsuleSize !== undefined ? config.capsuleSize : 100} onChange={(e) => onConfigChange({ capsuleSize: Number(e.target.value) })} className="w-full h-1 bg-slate-950 rounded-lg appearance-none accent-zinc-300" />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300">顶部信息栏</span>
                  <input type="checkbox" checked={config.showTopBar !== false} onChange={(e) => onConfigChange({ showTopBar: e.target.checked })} className="w-4 h-4 text-slate-100 accent-slate-100" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-[11px] text-slate-300 block">移动端界面模式</span>
                      <span className="text-[9px] text-slate-500 block mt-0.5">自动识别手机/触摸设备；若浏览器识别失败，可在此强制切换，桌面工作站功能不受影响。</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ["auto", "自动"],
                      ["legacy", "手机工作站"],
                      ["desktop", "桌面工作站"]
                    ] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onConfigChange({ mobileUiMode: mode })}
                        className={`rounded-lg border px-2 py-2 text-[10px] font-semibold transition ${ (config.mobileUiMode || "auto") === mode ? "border-white/60 bg-white/10 text-white shadow-[0_0_14px_rgba(255,255,255,.12)]" : "border-slate-700 bg-slate-950/55 text-slate-400 hover:text-slate-200" }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300">光标参数面板</span>
                  <input type="checkbox" checked={layers.cursor !== false} onChange={(e) => onLayersChange({ cursor: e.target.checked })} className="w-4 h-4 text-slate-100 accent-slate-100" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300">独立台风中心点</span>
                  <input type="checkbox" checked={layers.showCenterPoint !== false} onChange={(e) => onLayersChange({ showCenterPoint: e.target.checked })} className="w-4 h-4 text-slate-100 accent-slate-100" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300">路径点</span>
                  <input type="checkbox" checked={layers.track !== false} onChange={(e) => onLayersChange({ track: e.target.checked })} className="w-4 h-4 text-slate-100 accent-slate-100" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300">风圈</span>
                  <input type="checkbox" checked={layers.windRadii !== false} onChange={(e) => onLayersChange({ windRadii: e.target.checked })} className="w-4 h-4 text-slate-100 accent-slate-100" />
                </div>
              </div>
              
              <div className="bg-slate-900 rounded-lg p-3 space-y-3 mt-4">
                <h3 className="text-[11px] font-semibold text-slate-300">图例颜色自定义</h3>
                {[
                  { cat: TyphoonCategory.TD, label: "热带低压 TD", default: "#F9D332" },
                  { cat: TyphoonCategory.TS, label: "热带风暴 TS", default: "#2056C6" },
                  { cat: TyphoonCategory.STS, label: "强热带风暴 STS", default: "#1F8838" },
                  { cat: TyphoonCategory.TY, label: "台风 TY", default: "#F07920" },
                  { cat: TyphoonCategory.STY, label: "强台风 STY", default: "#D829BC" },
                  { cat: TyphoonCategory.SuperTY, label: "超强台风 SuperTY", default: "#D62020" },
                  { cat: TyphoonCategory.ET, label: "温带气旋 ET", default: "#949297" },
                  { cat: TyphoonCategory.RL, label: "残留低压 RL", default: "#87939c" },
                ].map(item => (
                  <div key={item.cat} className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">{item.label}</span>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={config.categoryColors?.[item.cat] || item.default}
                        onChange={(e) => {
                          onConfigChange({
                            categoryColors: {
                              ...(config.categoryColors || {}),
                              [item.cat]: e.target.value
                            }
                          });
                        }}
                        className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
                      />
                      <input
                        type="text"
                        value={config.categoryColors?.[item.cat] || item.default}
                        onChange={(e) => {
                          onConfigChange({
                            categoryColors: {
                              ...(config.categoryColors || {}),
                              [item.cat]: e.target.value
                            }
                          });
                        }}
                        className="w-16 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-300 uppercase"
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-2">
                   <button onClick={() => onConfigChange({ categoryColors: {} })} className="w-full py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition cursor-pointer">恢复默认颜色</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "usage" && (
          <div className="space-y-4 fade-in" id="panel-usage">
            {!showAuthorContact ? (
              <>
                <div className="rounded-2xl border border-white/12 bg-white/[0.045] p-4 backdrop-blur-md">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl border border-white/15 bg-white/[0.06] flex items-center justify-center shrink-0"><BookOpen className="w-4.5 h-4.5 text-zinc-200" /></div>
                    <div><h2 className="text-sm font-bold text-white">WMC 使用指南</h2><p className="mt-1 text-[10px] leading-5 text-slate-500">按“在哪里打开 / 怎么操作”整理常用功能与快捷操作。</p></div>
                  </div>
                </div>

                {[
                  ["生成与控制台风", [
                    "生成台风：电脑双击鼠标中键；触屏三连击后点 ✓ 确认。",
                    "开始模拟：底部时间轴 ▶。未开始时可先拖左下角摇杆设定起步方向。",
                    "手动移动：左下角摇杆；强度/结构干预：右上角 ✨ 快捷工具。",
                    "停编：底部时间轴红色八边形终止键 → 选择“停编当前台风”。"
                  ]],
                  ["风季与报告", [
                    "连续风季：菜单 → 常用 → 连续风季模式。停编后电脑双击中键／触屏三连击生成下一台风。",
                    "结束风季：底部终止键 → “终止整个风季模拟”。",
                    "台风报告：单台模式结束后顶部“查看台风报告”；风季报告中点单个台风右侧详情进入完整台风报告。",
                    "风季报告：整季终止后，顶部原报告按钮位置会变为“查看风季报告”。"
                  ]],
                  ["气象站与行政区详情", [
                    "放置临时站：地图任意位置双击；点站点打开历史数据。",
                    "站点详情：站点页面右上角感叹号“详情”，查看实时气象、预警、机场交通、防灾、积水与新闻。",
                    "公告图：行政区详情页面最底部“制作公告图”，可选类型、比例、清晰度并导出 PNG。",
                    "固定站显隐/城市标签：菜单 → 显示；站点图层：菜单 → 地图。"
                  ]],
                  ["预报图与气象产品", [
                    "暂停模拟后，底部时间轴指南针按钮进入“气象图产品选择”。",
                    "可制作 NMC 风格预报图、WMC 多模式中心路径、CPS 气旋相空间、降水统计、站点排名等。",
                    "预报路径与环境：菜单 → 台风；大气和海洋环境分别位于“大气 / 海洋”栏目。",
                    "地图底图、海温/OHC贴图、风圈/路径等显示开关：菜单 → 地图。"
                  ]],
                  ["时间轴与历史回放", [
                    "拖动底部时间轴回放历史；历史回放时中心和风圈直接跳到真实历史快照，不做视觉插值。",
                    "左右单步键用于切换相邻时刻；模拟速度以 h/s 表示（模拟小时/真实秒）。",
                    "顶部三行信息可直接点击更换显示项，包括风速、气压、移动、ACE、海温、水汽等。"
                  ]],
                  ["导出与高级设置", [
                    "GeoJSON / CSV / 参数 JSON：菜单 → 导出。",
                    "机构风格、颜色与视觉选项：菜单 → 风格 / 显示。",
                    "事件与运行日志：菜单 → 日志。",
                    "忘记位置时可随时回到本“使用”栏目查看。"
                  ]]
                ].map(([title, items]) => (
                  <section key={title as string} className="rounded-xl border border-slate-800 bg-slate-900/45 p-3">
                    <h3 className="text-[11px] font-bold text-zinc-200">{title as string}</h3>
                    <div className="mt-2 space-y-2">{(items as string[]).map((item) => <div key={item} className="flex gap-2 text-[10px] leading-5 text-slate-400"><span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0"/><span>{item}</span></div>)}</div>
                  </section>
                ))}

                <button type="button" onClick={() => setShowAuthorContact(true)} className="w-full rounded-xl border border-white/12 bg-white/[0.045] p-3 flex items-center gap-3 text-left hover:bg-white/[0.08] transition cursor-pointer backdrop-blur-md">
                  <span className="w-9 h-9 rounded-xl border border-white/15 bg-white/[0.06] flex items-center justify-center"><UserRound className="w-4.5 h-4.5 text-zinc-200" /></span>
                  <span><b className="block text-xs text-zinc-100">联系作者</b><span className="text-[10px] text-slate-500">查看 Bilibili 晚风渡山月的 QQ 好友二维码截图</span></span>
                </button>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-bold text-white">联系作者</h2><p className="mt-1 text-[10px] text-slate-500">Bilibili 晚风渡山月 · QQ 好友信息</p></div><button type="button" onClick={() => setShowAuthorContact(false)} className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 text-xs text-slate-300 cursor-pointer">返回指南</button></div>
                <div className="rounded-2xl overflow-hidden border border-slate-800 bg-white">
                  <img src="/aether-author-qq.png" alt="作者 QQ 好友二维码截图" className="w-full h-auto object-contain" draggable={false} />
                </div>
                <p className="text-[10px] leading-5 text-slate-500">如需反馈问题或交流模拟器，可使用上图中的 QQ 信息联系作者。请勿在公开场合恶意传播或冒用作者身份。</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "news" && (
          <div className="space-y-4 fade-in">
            <h2 className="text-[13px] font-semibold text-slate-200">气象快报</h2>
            <div className="bg-slate-900 rounded-lg p-3 space-y-2 max-h-[300px] overflow-y-auto">
              {eventLogs.length === 0 && <div className="text-xs text-slate-500 text-center py-4">暂无快报</div>}
              {eventLogs.map((log) => {
                const activeTyphoon = typhoons[0];
                const officialName = (activeTyphoon?.name || "").trim();
                const displayName = activeTyphoon
                  ? getTyphoonDisplayName(activeTyphoon, log.simHour, startDate)
                  : "热带低压";
                const namedMessage = officialName
                  ? log.message.split(officialName).join(displayName)
                  : log.message;
                // Quick bulletins are intentionally text-only: strip emoji/pictographs and
                // presentation selectors while preserving meteorological wording and punctuation.
                const displayMessage = namedMessage
                  .replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D]/gu, "")
                  .replace(/[ \t]{2,}/g, " ")
                  .trim();
                return (
                  <div key={log.id} className="border-b border-slate-800 pb-2 mb-2 last:border-0">
                    <div className="text-[10px] text-slate-500 mb-1">模拟第 {log.simHour} 小时</div>
                    <div className="text-[11px] text-slate-300">{displayMessage}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "export" && (
          <div className="space-y-4" id="panel-export">
            <div className="rounded-xl border border-cyan-600/35 bg-cyan-950/20 p-3 space-y-3">
              <div>
                <h3 className="text-xs font-bold text-cyan-200">完整模拟存档（可编辑 JSON / 压缩备份）</h3>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">保存全部台风、逐时历史、气象站历史、物理配置、模拟时间、日志、图层和气象产品设置。可以在另一设备上继续读取。读取会覆盖当前模拟，建议先备份。</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" id="btn-save-simulation-archive" disabled={archiveBusy}
                  onClick={() => void handleArchiveExport("readable")}
                  className="flex items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-900/35 px-2 py-2.5 text-[11px] font-bold text-cyan-100 disabled:opacity-50">
                  <Save className="h-4 w-4" />保存 AI 可编辑 JSON
                </button>
                <button type="button" id="btn-open-simulation-archive" disabled={archiveBusy}
                  onClick={() => archiveFileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-800/70 px-2 py-2.5 text-[11px] font-bold text-slate-100 disabled:opacity-50">
                  <FolderOpen className="h-4 w-4" />读取存档文件
                </button>
              </div>
              <button type="button" disabled={archiveBusy} onClick={() => void handleArchiveExport("compressed")}
                className="w-full rounded-lg border border-slate-600/70 px-3 py-2 text-[10px] text-slate-300 disabled:opacity-50">
                另存为小体积压缩备份（.aether）
              </button>
              <input ref={archiveFileInputRef} type="file" accept=".aether,.aether.json,.json" className="hidden" aria-label="读取 WMC 模拟存档"
                onChange={e => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  void handleArchiveFile(file);
                }} />
              {archiveStatus && <p role="status" aria-live="polite" className="text-[10px] text-slate-300 break-words">{archiveStatus}</p>}
              <p className="text-[9px] text-slate-500">推荐 .aether.json：UTF-8、可直接阅读修改、附带 AI 编辑说明。旧版压缩 .aether 仍可读取。完整 JSON 较大，长风季适合使用压缩备份。</p>
            </div>
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-800/40 space-y-3">
              <h3 className="text-xs font-bold text-zinc-200 tracking-wider mb-1">地理与文本导出</h3>

              <button
                id="btn-export-geojson"
                onClick={exportGeoJSON}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition"
              >
                <Download className="w-4 h-4 text-zinc-200" />
                <span>导出 GeoJSON (全航线与风圈)</span>
              </button>

              <button
                id="btn-export-csv"
                onClick={exportCSV}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition"
              >
                <Download className="w-4 h-4 text-[#45D483]" />
                <span>导出 CMA 业务时次轨迹 CSV</span>
              </button>

              <button
                id="btn-export-json-config"
                onClick={copyCurrentConfig}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition"
              >
                <Settings className="w-4 h-4 text-orange-400" />
                <span>复制模拟器设置参数 JSON</span>
              </button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-900 text-[10px] text-slate-500 leading-normal space-y-1.5">
              <div><strong>支持气象GIS软件：</strong></div>
              <div>GeoJSON 格式能够完美导入 ArcGIS, QGIS, 以及 Leaflet/Openlayers 做二次开发和渲染。</div>
              <div>CSV 节点统一采用 CMA/NMC 北京时间 02/05/08/11/14/17/20/23 时次，并包含经纬度、最低气压、RMW 与风圈字段。</div>
            </div>
          </div>
        )}
      </div>

      {/* Embedded Parameters Explanations Alert Tooltip */}
      {activeTooltip && (
        <div className="absolute inset-0 z-[2000] bg-slate-950/90 flex items-center justify-center p-6 animate-fade-in">
          <div className="bg-[#08121f] border border-slate-700/60 rounded-2xl p-4 max-w-sm w-full shadow-2xl relative">
            <h4 className="text-zinc-200 font-bold text-sm mb-2 font-sans flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-zinc-200" />
              {activeTooltip.title}
            </h4>
            <p className="text-slate-300 text-xs leading-relaxed mb-4">{activeTooltip.content}</p>
            <button
              id="btn-close-tooltip"
              onClick={() => setActiveTooltip(null)}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-semibold cursor-pointer text-slate-200 transition"
            >
              我知道了
            </button>
          </div>
        </div>
      )}
      </div>
      <AetherInputDialog
        open={!!inputDialog}
        title={inputDialog?.title || "输入"}
        description={inputDialog?.kind === "intensity" ? "输入 m/s；115 m/s 起进入游乐场模式。" : "使用程序内置输入框修改名称。"}
        initialValue={inputDialog?.initialValue || ""}
        inputMode={inputDialog?.kind === "intensity" ? "decimal" : "text"}
        onClose={() => setInputDialog(null)}
        onSubmit={(raw) => {
          if (!inputDialog) return;
          if (inputDialog.kind === "rename") {
            const renamed = raw.trim();
            if (!renamed) return "名称不能为空。";
            onConfigChange({ typhoonNamingOverrides: { ...(config.typhoonNamingOverrides || {}), [inputDialog.english]: renamed } });
            return;
          }
          const value = Number(raw);
          if (!Number.isFinite(value) || value < 5) return "请输入不低于 5 m/s 的有效数值。";
          onConfigChange({ maxIntensityLimit: Math.round(value * 10) / 10, maxIntensityLimitEnabled: true });
        }}
      />
    </>
  );
}

// While closed, none of the drawer's visible content can change on screen. Keep the already-mounted
// off-canvas DOM (so its slide-in/out transition and local control state are preserved), but skip all
// React reconciliation caused by fast cyclone/map updates until the drawer is opened again.
export default memo(ControlDrawer, (prev, next) => !prev.isOpen && !next.isOpen);
