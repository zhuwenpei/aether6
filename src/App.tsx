import { synopticProductLayout, type SynopticProductStyle, type SynopticProductAspect } from "./utils/SynopticProductLayout";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from "react";
import { createPortal } from "react-dom";
import { Menu, Settings, Info, RefreshCw, Layers, Maximize, Minimize, Images, Sparkles, X, Wind, History, Check, Undo2, Trash2, Play } from "lucide-react";
import { TyphoonCategory } from "./types";
import type { Typhoon, SimulationConfig, ActiveLayers, EventLog, ToastMessage } from "./types";
import { TyphoonEngine, getSST, getOHC, getWindForceCategory, fetchOsmCityName, calculateLiveForecastTrackPath, reweightLiveWindRadiiForPreference } from "./simulation/Engine";
import { branchWithDrawnRoute, branchWithExistingDrawnRoute, drawnRouteDistanceKm, getDrawnBranchCenter } from "./simulation/DrawnTrackBranch";
import { resolveCirculationSizeTransition, restoreCirculationSizeConfigFromSnapshot } from "./simulation/CirculationSizeTransition";
import { convertToSimulationTyphoon } from "./data/historicalTyphoons";
import OrientationGuard from "./components/OrientationGuard";
import AetherLaunchSequence from "./components/AetherLaunchSequence";
import AetherTermsModal from "./components/AetherTermsModal";
import MapView from "./components/MapView";
import TyphoonReport from "./components/TyphoonReport";
import TyphoonReportModal from "./components/TyphoonReportModal";
import VideoExportModal from "./components/VideoExportModal";
import ForecastImageModal from "./components/ForecastImageModal";
import TyphoonNetworkSimulator from "./components/TyphoonNetworkSimulator";
import NetworkEntrySettings, {type NetworkChartSettings} from "./components/NetworkEntrySettings";
import SeasonReport from "./components/SeasonReport";
import VirtualJoystick from "./components/VirtualJoystick";
import ForecastPreSimulation from "./components/ForecastPreSimulation";
import {issuePreSimulationReference, buildPreSimulationReference, copyMainHistoryToForecast, type PreSimulationReference} from "./simulation/PreSimulationReference";
import ControlDrawer from "./components/ControlDrawer";
import Timeline from "./components/Timeline";
import Toast from "./components/Toast";
import GeoJsonStatusBadge from "./components/GeoJsonStatusBadge";
import AetherDesktopChrome from "./components/AetherDesktopChrome";
import AetherMobileChrome from "./components/AetherMobileChrome";
import AetherMobileTransport from "./components/AetherMobileTransport";
import AetherIntensityPanel from "./components/AetherIntensityPanel";
import AetherInputDialog from "./components/AetherInputDialog";
import RealisticParameterDialog from "./components/RealisticParameterDialog";
import {prepareRealisticParameters,undoRealisticParameters} from "./simulation/RealisticParameterApply";
import {trimRealisticParameterJournal} from "./simulation/RealisticParameterJournal";
import {getLandMetrics} from "./simulation/Engine";
import type {ParameterOffset} from "./simulation/RealisticParameterGeometry";
import { loadNaturalEarthData } from "./simulation/NaturalEarthLoader";
import {
  playSndClick,
  playSndMahjongPress,
  playSndMahjongRelease,
  playSndMousePress,
  playSndMouseRelease,
  getTactileReleaseMinDelayMs,
  playSndUpgrade,
  playSndRapid,
  playSndLand,
  playSndEWRC,
  playSndET,
  playSndDissipate,
  playSndSpawn,
  playSndSliderTick
} from "./utils/audio";

import { DEFAULT_CONFIG, DEFAULT_LAYERS } from "./config/DefaultSettings";
import { getTyphoonNamingEntry, TYPHOON_NAMING_TABLE } from "./data/typhoonNamingTable";
import { getTyphoonYearCode } from "./utils/TyphoonDisplayName";
import { syncTyphoonNameIntoSnapshots } from "./utils/TyphoonIdentity";
import { makeHourlyHistorySeed } from "./utils/HistorySnapshot";
import {
  captureProductPreferences, createSimulationArchiveBlob, isAllowedProductPreference,
  readSimulationArchiveFile, skipOversizedLocalRecovery
} from "./utils/SimulationArchive";
import type { SimulationArchiveData } from "./utils/SimulationArchive";

const AETHER_TERMS_STORAGE_KEY = "aether_terms_accepted_v1";

const LOCAL_RECOVERY_KEYS = [
  "typhoon_sim_state_typhoons", "typhoon_sim_state_logs",
  "typhoon_sim_state_current_hour", "typhoon_sim_state_max_hour",
  "typhoon_sim_state_mins", "typhoon_sim_state_config",
  "typhoon_sim_state_season_ended", "typhoon_sim_state_prng"
] as const;
const clearLocalRecovery = () => {
  for (const key of LOCAL_RECOVERY_KEYS) {
    try { localStorage.removeItem(key); } catch { /* storage may be unavailable */ }
  }
};


// Live deterministic guidance is a visual dependency, not a prerequisite for the 10-minute storm
// physics. Keep it completely dormant unless a layer that consumes forecast geometry is visible.
const needsLiveForecastGeometry = (layers: ActiveLayers): boolean =>
  !!(layers.forecast || layers.forecastCone || layers.hurricaneTrackerModels);

const snapshotConfigForHistory = (cfg: SimulationConfig): SimulationConfig => ({
  ...cfg,
  categoryColors: cfg.categoryColors ? { ...cfg.categoryColors } : cfg.categoryColors,
  manualForecastRoute: cfg.manualForecastRoute?.map((p) => ({ lat: p.lat, lon: p.lon })) || [],
  manualForecastIntensityCurve: cfg.manualForecastIntensityCurve?.map((p) => ({ leadHour: p.leadHour, vmax: p.vmax })) || [],
  // Forecast intensity is deferred until product generation, so historical issue snapshots must
  // retain the exact hand-drawn environmental forcing that existed at the issue time.
  manualDryAirRegions: cfg.manualDryAirRegions?.map((r) => ({ ...r, points: r.points.map((p) => ({ lat: p.lat, lon: p.lon })) })) || [],
  manualShearRegions: cfg.manualShearRegions?.map((r) => ({ ...r, points: r.points.map((p) => ({ lat: p.lat, lon: p.lon })) })) || [],
  drawnTrackRoute: cfg.drawnTrackRoute?.map((p) => ({ lat: p.lat, lon: p.lon })) || []
});

// Full-season autosaves used to JSON.stringify every archived hourly snapshot again on each save.
// History is append-only during ordinary playback, so cache the already serialized immutable prefix
// and stringify only newly appended states. The emitted JSON contains exactly the same information;
// branching/truncation or edited history automatically falls back to a full rebuild.
type PersistedHistoryCache = {
  historyRef: Typhoon["history"];
  length: number;
  json: string;
};
const persistedHistoryJsonCache = new Map<string, PersistedHistoryCache>();

const serializeHistoryForPersistence = (typhoon: Typhoon): string => {
  const history = typhoon.history || [];
  const cached = persistedHistoryJsonCache.get(typhoon.id);
  if (cached?.historyRef === history) return cached.json;

  let json: string;
  let canAppend = !!cached && history.length > cached.length;
  if (canAppend && cached) {
    // Reference-compare the complete old prefix. This is O(n) but extremely cheap versus serializing
    // n large station/config snapshots, and it guarantees a middle-history edit can never be lost.
    for (let i = 0; i < cached.length; i++) {
      if (history[i] !== cached.historyRef[i]) {
        canAppend = false;
        break;
      }
    }
  }
  if (canAppend && cached) {
    const appended = history.slice(cached.length).map((entry) => JSON.stringify(entry));
    json = appended.length
      ? `${cached.json.slice(0, -1)}${cached.length > 0 ? "," : ""}${appended.join(",")}]`
      : cached.json;
  } else {
    json = JSON.stringify(history);
  }

  persistedHistoryJsonCache.set(typhoon.id, {
    historyRef: history,
    length: history.length,
    json
  });
  return json;
};

const serializeTyphoonsForPersistence = (typhoons: Typhoon[]): string => {
  const activeIds = new Set<string>();
  const serialized = typhoons.map((typhoon) => {
    activeIds.add(typhoon.id);
    const historyJson = serializeHistoryForPersistence(typhoon);
    const { history: _history, ...withoutHistory } = typhoon;
    const base = JSON.stringify(withoutHistory);
    return base === "{}"
      ? `{"history":${historyJson}}`
      : `${base.slice(0, -1)},"history":${historyJson}}`;
  });
  persistedHistoryJsonCache.forEach((_, id) => {
    if (!activeIds.has(id)) persistedHistoryJsonCache.delete(id);
  });
  return `[${serialized.join(",")}]`;
};

// Histories are ordered by simulation hour. Timeline scrubbing used Array.find for every
// pointer event; binary lookup avoids repeatedly walking long histories in both directions.
const findHistoryStateAtHour = (history: Typhoon["history"] | undefined, hour: number) => {
  if (!history || history.length === 0) return undefined;
  let lo = 0;
  let hi = history.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = Number(history[mid].simHour);
    if (value === hour) return history[mid];
    if (value < hour) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
};

// Helper to handle cross-browser fullscreen requests
const requestFullScreen = (element: HTMLElement) => {
  try {
    if (element.requestFullscreen) {
      element.requestFullscreen().catch(() => {});
    } else if ((element as any).webkitRequestFullscreen) {
      (element as any).webkitRequestFullscreen();
    } else if ((element as any).mozRequestFullScreen) {
      (element as any).mozRequestFullScreen();
    } else if ((element as any).msRequestFullscreen) {
      (element as any).msRequestFullscreen();
    }
  } catch (err) {
    console.warn("Fullscreen request failed:", err);
  }
};

const exitFullScreen = () => {
  try {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    } else if ((document as any).mozCancelFullScreen) {
      (document as any).mozCancelFullScreen();
    } else if ((document as any).msExitFullscreen) {
      (document as any).msExitFullscreen();
    }
  } catch (err) {
    console.warn("Exit fullscreen failed:", err);
  }
};

const isFullScreen = () => {
  return !!(
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement ||
    (document as any).mozFullScreenElement ||
    (document as any).msFullscreenElement
  );
};

export default function App() {
  const preSimulationActiveRef=useRef(false);
  const engineRef = useRef<TyphoonEngine>(new TyphoonEngine(DEFAULT_CONFIG.seed));
  const importedPrngRestoreRef = useRef<number | null>(null);

  // Automatic fullscreen logic removed as per user request to use button instead.
  // We keep the touch-action fix for gestures.
  useEffect(() => {
    // Prevent default touch gestures (swipe to go back/forward)
    const preventGestures = (e: TouchEvent) => {
      // Leaflet handles its own touches, but we block others to prevent browser-level gestures
      if (e.touches.length > 1 && e.cancelable) {
        // Optional: e.preventDefault();
      }
    };

    const preventContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    
    // Some browsers use specific gestures for navigation
    document.addEventListener("touchstart", preventGestures, { passive: false });
    document.addEventListener("contextmenu", preventContextMenu);
    
    return () => {
      document.removeEventListener("touchstart", preventGestures);
      document.removeEventListener("contextmenu", preventContextMenu);
    };
  }, []);

  // State managers
  const [config, setConfig] = useState<SimulationConfig>(() => {
    const saved = localStorage.getItem("typhoon_sim_config");
    if (!saved) return DEFAULT_CONFIG;
    const parsed = JSON.parse(saved);
    // Migrate older saves: the former secondary-cyclone/Fujiwhara switch was
    // removed from the project, so do not carry the obsolete field forward.
    if (parsed && typeof parsed === "object") {
      delete parsed.fujiwharaEnabled;
      delete parsed.uiStyle;
      // 4.1.4: the experimental synoptic/ocean A/B controls were retired from the public build.
      // Keep the legacy serialized fields readable for migration, but never let an old save reactivate them.
      parsed.newEnvironmentPanelsEnabled = false;
      parsed.newEnvironmentPhysicsEnabled = false;
      parsed.manualDryAirRegions = [];
      parsed.manualShearRegions = [];
    }
    return { ...DEFAULT_CONFIG, ...parsed, newEnvironmentPanelsEnabled: false, newEnvironmentPhysicsEnabled: false };
  });

  const [layers, setLayers] = useState<ActiveLayers>(() => {
    const saved = localStorage.getItem("typhoon_sim_layers");
    if (!saved) return { ...DEFAULT_LAYERS };
    const parsed = JSON.parse(saved);
    if (parsed?.baseMap === "digitalTyphoon") parsed.baseMap = "blueMarble";
    if (parsed && !parsed.blueMarbleVersion) parsed.blueMarbleVersion = "2002";
    // Runtime cloud imagery is intentionally disabled. Satellite imagery is produced only
    // on demand from the AETHER meteorological-product centre.
    return { ...DEFAULT_LAYERS, ...parsed };
  });

  // M toggles the recovered Hurricane Tracker guidance trajectories. Runtime satellite/cloud
  // imagery is deliberately unavailable; high-resolution imagery is generated only as a product.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.code === 'KeyM' && !preSimulationActiveRef.current) {
        setLayers((prev) => ({ ...prev, hurricaneTrackerModels: !prev.hurricaneTrackerModels }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

   const [typhoons, setTyphoons] = useState<Typhoon[]>([]);
  const [currentHour, setCurrentHour] = useState(0);
  const [maxHour, setMaxHour] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(4.0); // legacy default: 4 simulated hours per real second
  const [forecastPeakSliderDraft, setForecastPeakSliderDraft] = useState<number | null>(null);
  const forecastPeakSliderDraftRef = useRef<number | null>(null);
  // When the user edits circulation size while the duration selector is still "immediate", keep
  // the pre-edit origin briefly. If they then choose 12/24/48/72 h, we can turn that edit into a
  // real timed transition instead of having already consumed the target as an instant jump.
  const pendingCirculationSizeOriginRef = useRef<{
    fromKm: number;
    targetKm: number;
    atHour: number;
    radiiById: Record<string, { r7: Typhoon["r7"]; r10: Typhoon["r10"]; r12: Typhoon["r12"] }>;
  } | null>(null);
  const [appInputDialog, setAppInputDialog] = useState<null | {
    kind: "forecastPeak" | "targetIntensity"; title: string; initialValue: string;
  }>(null);
  const [realisticDialogMode,setRealisticDialogMode]=useState<null|'apply'|'undo'>(null);
  const [realisticStrength,setRealisticStrength]=useState<ParameterOffset>('mid');
  const [realisticProgress,setRealisticProgress]=useState(0);
  const [realisticBusy,setRealisticBusy]=useState(false);
  const realisticAbortRef=useRef<AbortController|null>(null);
  const realisticApplicationCountRef=useRef(0);
  const [eventLogs, setEventLogs] = useState<EventLog[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOpenTab, setDrawerOpenTab] = useState<string | null>(null);
  const [placementMode, setPlacementMode] = useState<"main" | "genesis" | "home" | "none">("none");
  const [isForecastRouteDrawing, setIsForecastRouteDrawing] = useState(false);
  const [forecastRouteDraft, setForecastRouteDraft] = useState<Array<{ lat: number; lon: number }>>([]);
  const [preSimulationInput, setPreSimulationInput] = useState<null | {
    initial:Typhoon;issueHour:number;seed:string;randomState:number;config:SimulationConfig;
  }>(null);
  preSimulationActiveRef.current=!!preSimulationInput;
  const [drawRoutePhase, setDrawRoutePhase] = useState<"off" | "drawing" | "sync">("off");
  const [drawnTrackDraft, setDrawnTrackDraft] = useState<Array<{ lat: number; lon: number }>>([]);
  // Continuation preserves the exact arc-length cursor; resetting it teleports a running cyclone.
  const continuingDrawnTrackRef = useRef(false);
  const influenceSheetDragRef = useRef<{ pointerId: number; startY: number } | null>(null);
  const [genesisPos, setGenesisPos] = useState<{ lat: number; lon: number }>({ lat: 12.5, lon: 145.0 });
  const [showReport, setShowReport] = useState(false);
  const [summaryReportTyphoon, setSummaryReportTyphoon] = useState<Typhoon | null>(null);
  const [terminationDialogOpen, setTerminationDialogOpen] = useState(false);
  const [seasonReportOpen, setSeasonReportOpen] = useState(false);
  const [seasonEnded, setSeasonEnded] = useState(() => localStorage.getItem("typhoon_sim_state_season_ended") === "1");
  const [videoExportTyphoon, setVideoExportTyphoon] = useState<Typhoon | null>(null);
  const [reportModalTyphoon, setReportModalTyphoon] = useState<Typhoon | null>(null);
  const [forecastModalOpen, setForecastModalOpen] = useState(false);
  const [typhoonNetworkOpen,setTyphoonNetworkOpen] = useState(false);
  const [typhoonNetworkSetupOpen,setTyphoonNetworkSetupOpen] = useState(false);
  const [networkEntryOptions,setNetworkEntryOptions] = useState<{config:SimulationConfig;settings:NetworkChartSettings}|null>(null);
  // A wind-field crop is chosen on the live Leaflet map, not on a static preview.
  const [synopticSelecting, setSynopticSelecting] = useState(false);
  const synopticCropTargetRef = useRef<"forecast" | "record">("forecast");
  const synopticVideoReturnRef = useRef<Typhoon | null>(null);
  const [synopticCropLayout, setSynopticCropLayout] = useState(() => synopticProductLayout('default','default'));
  // The box freezes the SAME panel geometry the product will render.
  const synopticCropRatio = synopticCropLayout.mapAspect;
  const synopticCropWidth = `min(94vw, calc((100dvh - 220px) * ${synopticCropRatio.toFixed(8)}))`;

  const synopticSelectingRef = useRef(false);
  synopticSelectingRef.current = synopticSelecting;
  const [pickedSynopticBounds, setPickedSynopticBounds] = useState<{
    lonMin: number; lonMax: number; latMin: number; latMax: number;
  } | null>(null);
  const synopticMapRef = useRef<import("leaflet").Map | null>(null);
  // The covered live Leaflet map must be completely released while Forecast
  // runs. Preserve its camera so returning from Forecast does not jump to the
  // application's default northwest-Pacific view.
  const liveCameraBeforeForecastRef = useRef<{center:[number,number];zoom:number}|null>(null);
  const handleSynopticMapReady = useCallback((map: import("leaflet").Map | null) => { synopticMapRef.current = map; }, []);
  const startSynopticSelection = (videoSettings?: {style: SynopticProductStyle; aspect: SynopticProductAspect}) => {
    synopticCropTargetRef.current = videoSettings ? "record" : "forecast";
    if(videoSettings){
      synopticVideoReturnRef.current=videoExportTyphoon;
      setVideoExportTyphoon(null);
      localStorage.setItem('typhoon_video_content_type','synoptic_record');
    }
    const rawStyle=localStorage.getItem('forecast_synopticStylePreset');
    const rawAspect=localStorage.getItem('forecast_synopticAspectRatio');
    const style:SynopticProductStyle = videoSettings?.style ?? (rawStyle==='hmon' || rawStyle==='hwrf' ? rawStyle : 'default');
    const aspect:SynopticProductAspect = videoSettings?.aspect ?? (rawAspect==='3:4'||rawAspect==='4:3'||rawAspect==='9:16'||rawAspect==='16:9' ? rawAspect : 'default');
    setSynopticCropLayout(synopticProductLayout(style,aspect));
    // Discard an old temporary selection; cancel must restore the user's current
    // product settings rather than reapply an earlier picked box.
    setPickedSynopticBounds(null);
    setIsPlaying(false); isPlayingRef.current = false;
    setPlacementMode("none");
    setForecastModalOpen(false);
    setDrawerOpen(false);
    setSynopticSelecting(true);
  };
  const exitSynopticSelection = (apply: boolean) => {
    if (apply) {
      const map = synopticMapRef.current;
      const frame = document.getElementById("aether-synoptic-selection-frame");
      const viewport = map?.getContainer()?.getBoundingClientRect();
      const rect = frame?.getBoundingClientRect();
      if (!map || !rect || !viewport) {
        showToast("地图尚未准备好，无法保存选区。", "warning");
        return;
      }
      const nw = map.containerPointToLatLng([rect.left - viewport.left, rect.top - viewport.top]);
      const se = map.containerPointToLatLng([rect.right - viewport.left, rect.bottom - viewport.top]);
      const value = {
        lonMin: Math.min(nw.lng, se.lng), lonMax: Math.max(nw.lng, se.lng),
        latMin: Math.max(-80, Math.min(nw.lat, se.lat)), latMax: Math.min(80, Math.max(nw.lat, se.lat))
      };
      if (value.lonMax - value.lonMin < 0.01 || value.latMax - value.latMin < 0.01) {
        showToast("选区过小，请放大取景框内的地图范围。", "warning");
        return;
      }
      setPickedSynopticBounds(value);
      if(synopticCropTargetRef.current === 'record'){
        const key='typhoon_synoptic_record_video_v1';
        try {
          const settings=JSON.parse(localStorage.getItem(key)||'{}');
          localStorage.setItem(key,JSON.stringify({...settings,customBounds:value,fixedBoundsConfirmed:true,mapZoom:1}));
        } catch {
          localStorage.setItem(key,JSON.stringify({customBounds:value,fixedBoundsConfirmed:true,mapZoom:1}));
        }
      } else {
        localStorage.setItem("forecast_synopticDomainMode", "custom");
        localStorage.setItem("forecast_synopticCustomBounds", JSON.stringify(value));
      }
      showToast("已保存风场图手动选区。", "success");
    }
    setSynopticSelecting(false);
    if(synopticCropTargetRef.current === 'record'){
      if(synopticVideoReturnRef.current)setVideoExportTyphoon(synopticVideoReturnRef.current);
      synopticVideoReturnRef.current=null;
    }else setForecastModalOpen(true);
    synopticCropTargetRef.current='forecast';
  };

  const [timelineCollapsed, setTimelineCollapsed] = useState(true);
  // Desktop keyboard/gamepad bridge.  The polling listener is installed once and always calls
  // the newest actions through this ref, avoiding a new requestAnimationFrame loop every sim tick.
  const desktopActionsRef = useRef<{
    togglePlay: () => void;
    stepForward: () => void;
    stepBackward: () => void;
    seekNextPoint: () => void;
    seekPreviousPoint: () => void;
    seekHourDelta: (delta: number) => void;
    applyInfluence: (type: "ewrc" | "dry_air" | "shear" | "rapid_intensify", option: string) => void;
    openProducts: () => void;
    openSettings: () => void;
    openInfluence: () => void;
    toggleTimeline: () => void;
    joystick: (dx: number, dy: number, dragging?: boolean) => void;
  }>({
    togglePlay: () => {}, stepForward: () => {}, stepBackward: () => {},
    seekNextPoint: () => {}, seekPreviousPoint: () => {}, seekHourDelta: () => {}, applyInfluence: () => {}, openProducts: () => {},
    openSettings: () => {}, openInfluence: () => {}, toggleTimeline: () => {}, joystick: () => {}
  });
  const [initializationReady, setInitializationReady] = useState(false);
  // bfcache restores keep the mounted React tree; Chrome tab-discard restores create
  // a new document but must NOT replay the startup animation over the saved simulation.
  const [launchFinished, setLaunchFinished] = useState(() => {
    const resumedAfterDiscard = typeof document !== "undefined" &&
      (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true;
    const backForwardRestoration = typeof performance !== "undefined" &&
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "back_forward";
    // Browsers without document.wasDiscarded may silently rebuild a background tab.
    // A session-scoped pending-background flag distinguishes this from a normal
    // user-initiated reload while the application is in the foreground.
    let pendingBackgroundRestore = false;
    try { pendingBackgroundRestore = sessionStorage.getItem("aether_background_pending") === "1"; } catch {}
    return resumedAfterDiscard || backForwardRestoration || pendingBackgroundRestore;
  });
  // On every genuinely new application startup/reload display the author card once.
  const showLaunchAuthor = true;
  const [termsAccepted, setTermsAccepted] = useState(() => {
    try {
      return localStorage.getItem(AETHER_TERMS_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [detectedLegacyMobileUi, setDetectedLegacyMobileUi] = useState(false);
  const isDesktopDevice = !detectedLegacyMobileUi && (typeof window === "undefined" || !!window.matchMedia?.("(pointer: fine)")?.matches);

  const [isInfluenceModalOpen, setIsInfluenceModalOpen] = useState(false);
  const [activeInfluenceCategory, setActiveInfluenceCategory] = useState<"main" | "ewrc" | "dry_air" | "shear" | "cold_air" | "cold_water" | "rapid">("main");
  const [coldAirStrength, setColdAirStrength] = useState<1 | 2 | 3>(3);
  const [coldAirDelayHours, setColdAirDelayHours] = useState(12);
  const [coldWaterDurationHours, setColdWaterDurationHours] = useState(24);
  const [coldWaterTemperatureC, setColdWaterTemperatureC] = useState(24);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateMobileUiDetection = () => {
      const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
      const noHover = window.matchMedia?.("(hover: none)")?.matches ?? false;
      const compactSide = Math.min(window.innerWidth, window.innerHeight) <= 900;
      const uaDataMobile = Boolean((navigator as any).userAgentData?.mobile);
      const legacyUaMobile = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent || "");
      // Prefer actual mobile/touch-device signals over a narrow desktop window.  The manual setting
      // below remains authoritative for embedded browsers that do not expose reliable device hints.
      setDetectedLegacyMobileUi(uaDataMobile || legacyUaMobile || ((coarsePointer || noHover) && compactSide));
    };
    updateMobileUiDetection();
    window.addEventListener("resize", updateMobileUiDetection);
    return () => window.removeEventListener("resize", updateMobileUiDetection);
  }, []);

  const useLegacyMobileUi = useMemo(() => {
    const mode = config.mobileUiMode || "auto";
    if (mode === "legacy") return true;
    if (mode === "desktop") return false;
    return detectedLegacyMobileUi;
  }, [config.mobileUiMode, detectedLegacyMobileUi]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    // Round29 has a dedicated phone shell.  Do not enable the historical `legacy-mobile-ui`
    // compatibility skin: its desktop-derived width/position overrides are intentionally retired.
    document.body.classList.remove("legacy-mobile-ui");
    document.body.classList.toggle("aether-mobile-ui", useLegacyMobileUi);

    // Mobile browser chrome and the on-screen keyboard continuously change the *visual* viewport
    // without always updating 100vh. Export the real dimensions to CSS so every full-screen page,
    // bottom sheet and floating control remains reachable on iOS Safari/Android Chrome.
    const syncVisualViewport = () => {
      const vv = window.visualViewport;
      const width = vv?.width ?? window.innerWidth;
      const height = vv?.height ?? window.innerHeight;
      const top = vv?.offsetTop ?? 0;
      const left = vv?.offsetLeft ?? 0;
      const keyboard = Math.max(0, window.innerHeight - height - top);
      const viewportBottom = Math.max(0, window.innerHeight - height - top);
      const root = document.documentElement;
      root.style.setProperty("--aether-vvw", `${width}px`);
      root.style.setProperty("--aether-vvh", `${height}px`);
      root.style.setProperty("--aether-vv-top", `${top}px`);
      root.style.setProperty("--aether-vv-left", `${left}px`);
      root.style.setProperty("--aether-vv-bottom", `${viewportBottom}px`);
      root.style.setProperty("--aether-keyboard", `${keyboard}px`);
      // R220: orientation follows the layout viewport, not a keyboard-reduced visual viewport.
      // Keep portrait UI untouched; mobile landscape switches to a separate two-zone workstation.
      const landscape = window.matchMedia("(orientation: landscape)").matches &&
        window.innerWidth > window.innerHeight && keyboard <= 120;
      document.body.classList.toggle("aether-mobile-landscape", useLegacyMobileUi && landscape);
      document.body.classList.toggle("aether-keyboard-open", useLegacyMobileUi && keyboard > 120);
    };
    syncVisualViewport();
    window.addEventListener("resize", syncVisualViewport, { passive: true });
    window.visualViewport?.addEventListener("resize", syncVisualViewport, { passive: true });
    window.visualViewport?.addEventListener("scroll", syncVisualViewport, { passive: true });
    return () => {
      document.body.classList.remove("legacy-mobile-ui", "aether-mobile-ui", "aether-mobile-landscape", "aether-keyboard-open");
      window.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
    };
  }, [useLegacyMobileUi]);

  // Manual influences are intentionally cumulative. Each control owns its own toggle state,
  // so applying dry air must not silently erase a shear/EWRC choice made at the same simulation time.
  // The previous "single pending transaction" behaviour made several buttons appear broken while paused.


  // Remove only the structural scar that belongs to an EWRC failure.  Independent terrain,
  // dry-air and shear damage is deliberately preserved.  This helper is used both when the user
  // cancels a diagnosed failure and when they explicitly override that same episode to success.
  const clearEwrcFailureConsequences = (nextTy: Typhoon) => {
    const terrainDamageExists = !!nextTy.passedTaiwanCentral || !!nextTy.passedLuzonMountains || (nextTy.maxLandElevationPassed || 0) > 500;
    const shearDryDamageExists = !!nextTy.forcedDryAir || (nextTy.forcedShear !== undefined && nextTy.forcedShear > 15) || (nextTy.dryAirCoreExposure || 0) > 0.28;
    if (nextTy.damageOrigin === "ewrc_failure" || (nextTy.damageOrigin === "mixed" && !terrainDamageExists && !shearDryDamageExists)) {
      nextTy.damageOrigin = "none";
      nextTy.coreRebuildScar = 0;
      nextTy.isStructureDamaged = false;
      nextTy.isCoreDisrupted = false;
      nextTy.structuralDamagePenaltyFactor = 1;
      nextTy.structuralDamageHours = 0;
      nextTy.isEyeClogged = false;
      nextTy.eyeObstruction = Math.min(nextTy.eyeObstruction ?? 0.20, 0.20);
      nextTy.eyeAsymmetry = Math.min(nextTy.eyeAsymmetry ?? 0.20, 0.24);
      nextTy.eyewallIntegrity = Math.max(nextTy.eyewallIntegrity ?? 0.50, 0.50);
      delete nextTy.cloggedRecoveryHours;
      delete nextTy.cloggedRecoveryTotalHours;
    } else if (nextTy.damageOrigin === "mixed") {
      nextTy.damageOrigin = terrainDamageExists && shearDryDamageExists ? "mixed" : terrainDamageExists ? "terrain" : "shear_dry";
      nextTy.coreRebuildScar = Math.min(nextTy.coreRebuildScar ?? 0, terrainDamageExists ? 0.48 : 0.40);
      nextTy.structuralDamagePenaltyFactor = Math.max(nextTy.structuralDamagePenaltyFactor ?? 1, 0.72);
    }
  };

  const handleScheduleColdAir = (strength: 1 | 2 | 3, delayHours: number) => {
    if (!typhoonsRef.current.length) {
      showToast("当前没有活跃台风，无法施加冷空气影响", "warning");
      return;
    }
    const delay = Math.max(0, Math.min(96, Math.round(delayHours)));
    const arrivalHour = currentHour + delay;
    if (currentHour < maxHour) {
      setMaxHour(currentHour);
      totalSimMinutesRef.current = currentHour * 60;
      engineRef.current.syncPrngToHour(currentHour);
    }
    updateTyphoons(prev => prev.map((ty, idx) => idx !== 0 ? ty : {
      ...ty,
      forcedColdAirStrength: strength,
      forcedColdAirArrivalHour: arrivalHour,
      forcedColdAirScheduledHour: currentHour,
      coldAirExposureHours: 0,
      coldAirWarmCoreDamage: ty.coldAirWarmCoreDestroyed ? 1 : Math.max(0, Math.min(1, ty.coldAirWarmCoreDamage ?? 0)),
      history: currentHour < maxHour ? ty.history.filter(h => h.simHour <= currentHour) : ty.history
    }));
    const labels = ["", "弱", "中", "强"];
    showToast(`已安排${labels[strength]}冷空气：约 ${delay} 模拟小时后，冷空气强风前锋将抵达台风中心并同步开始影响强度。`, "info");
  };

  const handleCancelColdAir = () => {
    const warmCoreAlreadyDestroyed = !!typhoonsRef.current[0]?.coldAirWarmCoreDestroyed;
    updateTyphoons(prev => prev.map((ty, idx) => {
      if (idx !== 0) return ty;
      const next = { ...ty };
      delete next.forcedColdAirStrength;
      delete next.forcedColdAirArrivalHour;
      delete next.forcedColdAirScheduledHour;
      delete next.coldAirExposureHours;
      return next;
    }));
    showToast(warmCoreAlreadyDestroyed
      ? "已取消后续冷空气强迫；暖心已被摧毁，残留低压状态与禁止增强不可逆。"
      : "已取消冷空气事件。", warmCoreAlreadyDestroyed ? "warning" : "success");
  };

  const handleScheduleColdWater = (temperatureC: number, durationHours: number) => {
    if (!typhoonsRef.current.length) {
      showToast("当前没有活跃台风，无法设置冷水区", "warning");
      return;
    }
    const temperature = Math.max(0, Math.min(30, Math.round(Number(temperatureC) * 10) / 10));
    const duration = Math.max(0, Math.min(240, Math.round(Number(durationHours) * 2) / 2));
    const startHour = currentHour;
    const endHour = startHour + duration;
    if (currentHour < maxHour) {
      setMaxHour(currentHour);
      totalSimMinutesRef.current = currentHour * 60;
      engineRef.current.syncPrngToHour(currentHour);
    }
    updateTyphoons(prev => prev.map((ty, idx) => idx !== 0 ? ty : {
      ...ty,
      forcedColdWaterTemperatureC: temperature,
      forcedColdWaterStartHour: startHour,
      forcedColdWaterEndHour: endHour,
      forcedColdWaterDurationHours: duration,
      history: currentHour < maxHour ? ty.history.filter(h => h.simHour <= currentHour) : ty.history
    }));
    showToast(`已设置冷水区：${temperature.toFixed(1)}℃，持续 ${duration.toFixed(1)} 模拟小时。`, "info");
  };

  const handleCancelColdWater = () => {
    updateTyphoons(prev => prev.map((ty, idx) => {
      if (idx !== 0) return ty;
      const next = { ...ty };
      delete next.forcedColdWaterTemperatureC;
      delete next.forcedColdWaterStartHour;
      delete next.forcedColdWaterEndHour;
      delete next.forcedColdWaterDurationHours;
      return next;
    }));
    showToast("已取消冷水区事件。", "success");
  };

  const handleApplyInfluence = (type: "ewrc" | "dry_air" | "shear" | "rapid_intensify", option: string) => {
    updateTyphoons(prev => {
      if (prev.length === 0) return prev;
      
      // If applying influence while in the past, branch simulation cleanly
      let baseHour = currentHour;
      if (currentHour < maxHour) {
        setMaxHour(currentHour);
        totalSimMinutesRef.current = currentHour * 60;
        engineRef.current.syncPrngToHour(currentHour);
      }

      const updated = prev.map((ty, idx) => {
        if (idx === 0) { // apply to the active/first typhoon
          let nextTy = { ...ty };
          
          if (currentHour < maxHour) {
            const restoredState = ty.history.find((h) => h.simHour === currentHour);
            Object.assign(nextTy, {
              forcedEWRC: restoredState?.forcedEWRC,
              manualEwrcOutcomeOverride: restoredState?.manualEwrcOutcomeOverride,
              forcedDryAir: restoredState?.forcedDryAir,
              forcedColdAirStrength: restoredState?.forcedColdAirStrength,
              forcedColdAirArrivalHour: restoredState?.forcedColdAirArrivalHour,
              forcedColdAirScheduledHour: restoredState?.forcedColdAirScheduledHour,
              coldAirExposureHours: restoredState?.coldAirExposureHours,
              coldAirWarmCoreDamage: restoredState?.coldAirWarmCoreDamage,
              coldAirWarmCoreDestroyed: restoredState?.coldAirWarmCoreDestroyed,
              forcedColdWaterTemperatureC: restoredState?.forcedColdWaterTemperatureC,
              forcedColdWaterStartHour: restoredState?.forcedColdWaterStartHour,
              forcedColdWaterEndHour: restoredState?.forcedColdWaterEndHour,
              forcedColdWaterDurationHours: restoredState?.forcedColdWaterDurationHours,
              forcedShear: restoredState?.forcedShear,
              forcedRapidIntensification: restoredState?.forcedRapidIntensification,
              manualForcedDecay: restoredState?.manualForcedDecay,
              forcedDecayStartVmax: restoredState?.forcedDecayStartVmax,
              forcedDecayTargetVmax: restoredState?.forcedDecayTargetVmax,
              forcedDecayElapsedHours: restoredState?.forcedDecayElapsedHours,
              forcedDecayDuration: restoredState?.forcedDecayDuration,
              forcedDecayIsContinuous: restoredState?.forcedDecayIsContinuous,
              dryAirPenaltyHours: restoredState?.dryAirPenaltyHours,
              dryAirPenaltyTotalHours: restoredState?.dryAirPenaltyTotalHours,
              shearPenaltyHours: restoredState?.shearPenaltyHours,
              shearPenaltyTotalHours: restoredState?.shearPenaltyTotalHours,
              ewrcFailurePenaltyHours: restoredState?.ewrcFailurePenaltyHours,
              ewrcPenaltyTotalHours: restoredState?.ewrcPenaltyTotalHours,
              cloggedRecoveryHours: restoredState?.cloggedRecoveryHours,
              cloggedRecoveryTotalHours: restoredState?.cloggedRecoveryTotalHours,
              isEyeClogged: restoredState?.isEyeClogged || false,
              isStructureDamaged: restoredState?.isStructureDamaged || false,
              upwellingHours: restoredState?.upwellingHours || 0,
              consecutiveUpwellingHours: restoredState?.consecutiveUpwellingHours || 0,
              upwellingPersistentPenaltyHours: restoredState?.upwellingPersistentPenaltyHours || 0,
              structuralDamageHours: restoredState?.structuralDamageHours || 0,
              tdHours: restoredState?.tdHours || 0,
              landTdHours: restoredState?.landTdHours || 0,
              superTyLandHours: restoredState?.superTyLandHours || 0,
              landHours: restoredState?.landHours || 0,
              landContactHours: restoredState?.landContactHours || 0,
              r10LandContactHours: restoredState?.r10LandContactHours || 0,
              vmax6Hours: restoredState?.vmax6Hours || 0,
              etHours: restoredState?.etHours || 0,
              warmWaterHoursAfterSea: restoredState?.warmWaterHoursAfterSea || 0,
              ewrcCooldownHours: restoredState?.ewrcCooldownHours || 0,
              ewrcCount: restoredState?.ewrcCount || 0,
              ewrcState: restoredState?.ewrcState || "none",
              ewrcProgress: restoredState?.ewrcProgress || 0,
              ewrcIsFailure: restoredState?.ewrcIsFailure || false,
              ...(restoredState ? restoredState : {}),
              active: restoredState ? !restoredState.dissipated : ty.active,
              history: ty.history.filter((h) => h.simHour <= currentHour)
            });
          }


          if (type === "ewrc") {
            if (option === "auto") {
              const anyEwrcActive = nextTy.ewrcState === "forming" || nextTy.ewrcState === "max_decay" ||
                nextTy.ewrcState === "recovering_success" || nextTy.ewrcState === "recovering_failure" ||
                nextTy.ewrcState === "penalty_failure" || nextTy.forcedEWRC === "auto";
              if (anyEwrcActive && !nextTy.manualEwrcOutcomeOverride) {
                delete nextTy.forcedEWRC;
                nextTy.ewrcState = "none";
                nextTy.ewrcProgress = 0;
                nextTy.ewrcIsFailure = false;
                nextTy.ewrcFailureMode = "none";
                nextTy.ewrcFailurePenaltyHours = 0;
                nextTy.ewrcPenaltyTotalHours = 0;
                nextTy.ewrcCooldownHours = Math.max(nextTy.ewrcCooldownHours || 0, 48);
                clearEwrcFailureConsequences(nextTy);
                showToast("已停止本次自动眼墙置换。程序判定与该次置换产生的失败惩罚已取消。", "success");
              } else {
                // Start a normal replacement episode with no outcome lock. The engine performs the
                // environmental success/failure diagnosis; the user may still override it later.
                nextTy.forcedEWRC = "auto";
                delete nextTy.manualEwrcOutcomeOverride;
                nextTy.ewrcIsFailure = false;
                nextTy.ewrcState = "none";
                nextTy.ewrcCooldownHours = 0;
                nextTy.ewrcProgress = 0;
                nextTy.ewrcFailureMode = "none";
                nextTy.ewrcFailurePenaltyHours = 0;
                nextTy.ewrcPenaltyTotalHours = 0;
                delete nextTy.cloggedRecoveryHours;
                delete nextTy.cloggedRecoveryTotalHours;
                showToast("已启动正常眼墙置换：本轮成败由程序根据海温、风切、干空气、陆地接触和冷水尾流自动判定。之后可用“成功/失败”按钮人工覆盖结果。", "info");
              }
            } else {
            const requestedOutcome = option as "success" | "failure";
            const isCycleRunning = nextTy.ewrcState === "forming" || nextTy.ewrcState === "max_decay";
            const isFailureEpisode = nextTy.ewrcState === "penalty_failure" || nextTy.ewrcState === "recovering_failure" || !!nextTy.ewrcIsFailure;
            const isSuccessRecovery = nextTy.ewrcState === "recovering_success";
            const currentCycleOutcome: "success" | "failure" | undefined = nextTy.manualEwrcOutcomeOverride
              ?? (isFailureEpisode && !isCycleRunning ? "failure" : isSuccessRecovery ? "success" : undefined);
            const isCurrentlyActive = nextTy.forcedEWRC === requestedOutcome || currentCycleOutcome === requestedOutcome;

            if (isCurrentlyActive) {
              const cancellingFailure = requestedOutcome === "failure" && isFailureEpisode;
              delete nextTy.forcedEWRC;
              delete nextTy.manualEwrcOutcomeOverride;
              nextTy.ewrcState = "none";
              nextTy.ewrcProgress = 0;
              nextTy.ewrcFailurePenaltyHours = 0;
              nextTy.ewrcPenaltyTotalHours = 0;
              nextTy.ewrcIsFailure = false;
              nextTy.ewrcFailureMode = "none";
              // A manual cancellation is an explicit user decision. Keep the automatic trigger
              // suppressed through the same intensity episode instead of letting the next 10-min
              // model step immediately start another EWRC.
              nextTy.ewrcCooldownHours = Math.max(nextTy.ewrcCooldownHours || 0, 96);

              if (cancellingFailure) {
                clearEwrcFailureConsequences(nextTy);
                showToast("已取消置换失败状态；由该次置换失败产生的中心结构损坏惩罚已同步撤销，真实地形/干空气/风切损伤仍保留。", "success");
              } else {
                // Cancelling a normal/successful in-progress replacement still requires an inertial
                // reorganization period because two eyewall circulations were physically present.
                const recoveryHours = Math.min(42, 18 + nextTy.vmax * 0.28);
                nextTy.cloggedRecoveryTotalHours = recoveryHours;
                nextTy.cloggedRecoveryHours = 0.0;
                showToast(`已中止眼墙置换干预，核心进入约 ${Math.round(recoveryHours)} 小时的渐进重组期。`, "success");
              }
            } else if (isCycleRunning) {
              // User choice is an episode-level outcome lock.  Automatic land/shear/SST/cold-wake
              // diagnostics may continue to affect intensity, but they cannot reverse this explicit
              // success/failure decision before the current replacement episode ends.
              nextTy.manualEwrcOutcomeOverride = requestedOutcome;
              nextTy.ewrcIsFailure = requestedOutcome === "failure";
              if (requestedOutcome === "success") {
                nextTy.ewrcFailurePenaltyHours = 0;
                nextTy.ewrcPenaltyTotalHours = 0;
                nextTy.ewrcFailureMode = "none";
              }
              delete nextTy.forcedEWRC;
              showToast(`已锁定当前眼墙置换结果为：${requestedOutcome === "success" ? "成功接替" : "置换失败"}。在本轮置换结束前，程序自动判定不会覆盖该结果。`, requestedOutcome === "success" ? "success" : "warning");
            } else if (isFailureEpisode || isSuccessRecovery) {
              // Re-write the outcome of the current diagnosed episode rather than starting a new
              // replacement cycle.  This is the key precedence rule: the user's physical-state
              // decision wins over a model result that was diagnosed earlier at the same stage.
              nextTy.manualEwrcOutcomeOverride = requestedOutcome;
              delete nextTy.forcedEWRC;
              nextTy.ewrcProgress = 0;
              nextTy.ewrcCooldownHours = 0;

              if (requestedOutcome === "success") {
                const wasFailure = isFailureEpisode;
                clearEwrcFailureConsequences(nextTy);
                nextTy.ewrcIsFailure = false;
                nextTy.ewrcFailureMode = "none";
                nextTy.ewrcFailurePenaltyHours = 0;
                nextTy.ewrcPenaltyTotalHours = 0;
                nextTy.ewrcState = "recovering_success";
                nextTy.ewrcRecoveryDuration = Math.max(8, Math.min(24, nextTy.ewrcRecoveryDuration ?? 12));
                // Do not fabricate a large intensity jump.  A modest positive recovery tendency is
                // enough to represent successful takeover; hostile real environment terms can still
                // offset it in the integrator.
                nextTy.ewrcExtraAdjust = Math.max(nextTy.ewrcExtraAdjust ?? 0, 0.10);
                if (wasFailure) nextTy.successfulEwrcCount = (nextTy.successfulEwrcCount || 0) + 1;
                showToast("已将当前置换结果人工改判为成功：失败惩罚和仅由失败造成的结构疤痕已撤销，随后按成功置换恢复阶段继续积分。程序不会在本轮中重新改判为失败。", "success");
              } else {
                nextTy.ewrcIsFailure = true;
                nextTy.ewrcState = "penalty_failure";
                nextTy.ewrcFailureMode = nextTy.ewrcFailureMode && nextTy.ewrcFailureMode !== "none" ? nextTy.ewrcFailureMode : "double_eyewall_decay";
                nextTy.ewrcPenaltyTotalHours = Math.max(12, nextTy.ewrcPenaltyTotalHours || Math.min(30, 14 + nextTy.vmax * 0.16));
                nextTy.ewrcFailurePenaltyHours = 0;
                nextTy.isStructureDamaged = true;
                nextTy.coreRebuildScar = Math.max(nextTy.coreRebuildScar ?? 0, 0.54);
                nextTy.damageOrigin = nextTy.damageOrigin === "none" || nextTy.damageOrigin === "ewrc_failure" ? "ewrc_failure" : "mixed";
                showToast("已将当前置换结果人工改判为失败：立即进入置换失败的渐进结构惩罚阶段，本轮程序不会再自动改回成功。", "warning");
              }
            } else {
              // No EWRC episode is active: schedule a new cycle and lock its eventual outcome.
              nextTy.forcedEWRC = requestedOutcome;
              nextTy.manualEwrcOutcomeOverride = requestedOutcome;
              nextTy.ewrcIsFailure = requestedOutcome === "failure";
              nextTy.ewrcState = "none";
              nextTy.ewrcCooldownHours = 0;
              nextTy.ewrcProgress = 0;
              nextTy.ewrcFailurePenaltyHours = 0;
              nextTy.ewrcPenaltyTotalHours = 0;
              delete nextTy.cloggedRecoveryHours;
              delete nextTy.cloggedRecoveryTotalHours;
              showToast(`已设定眼墙置换结果：${requestedOutcome === "success" ? "成功接替" : "置换失败"}；该人工结果在本轮置换中具有最高优先级，强度变化仍按完整周期渐进演变。`, requestedOutcome === "success" ? "success" : "warning");
            }
            }
          } else if (type === "dry_air") {
            if (nextTy.forcedDryAir === option) {
              const wasCore = nextTy.forcedDryAir === "core";
              delete nextTy.forcedDryAir;
              delete nextTy.dryAirPenaltyHours;
              delete nextTy.dryAirPenaltyTotalHours;
              const recoveryHours = wasCore
                ? Math.min(42, 18 + nextTy.vmax * 0.28)
                : Math.min(24, 9 + nextTy.vmax * 0.12);
              nextTy.cloggedRecoveryTotalHours = recoveryHours;
              nextTy.cloggedRecoveryHours = 0.0;
              showToast(`已停止干空气注入，残余干空气与结构损伤将在约 ${Math.round(recoveryHours)} 小时内渐进恢复。`, "success");
            } else {
              nextTy.forcedDryAir = option as "core" | "periphery";
              nextTy.dryAirPenaltyHours = undefined; // Force recalculation in engine
              nextTy.dryAirPenaltyTotalHours = undefined;
              delete nextTy.cloggedRecoveryHours;
              delete nextTy.cloggedRecoveryTotalHours;
              // Dry air terminates RI/ERI through the engine's gradual rollover instead of an instant cut.
              if (nextTy.rapidIntensifying || nextTy.forcedRapidIntensification) {
                nextTy.rapidEpisodeAbortRequested = true;
              }
              showToast(`已施加干空气影响：${option === "core" ? "干空气侵入核心" : "外围卷入干空气"}！自动 RI/ERI 将按环境恶化过程退出。`, "warning");
            }
          } else if (type === "shear") {
            const val = parseFloat(option);
            if (nextTy.forcedShear === val) {
              delete nextTy.forcedShear;
              delete nextTy.shearPenaltyHours;
              delete nextTy.shearPenaltyTotalHours;
              const severity = Math.max(0, Math.min(1, (val - 15) / 25));
              const recoveryHours = Math.min(40, 14 + severity * 14 + nextTy.vmax * 0.16);
              nextTy.cloggedRecoveryTotalHours = recoveryHours;
              nextTy.cloggedRecoveryHours = 0.0;
              showToast(`已停止强风切变干预，涡旋将在约 ${Math.round(recoveryHours)} 小时内逐步重新对齐。`, "success");
            } else {
              nextTy.forcedShear = val;
              nextTy.shearPenaltyHours = undefined; // Force recalculation in engine
              nextTy.shearPenaltyTotalHours = undefined;
              delete nextTy.cloggedRecoveryHours;
              delete nextTy.cloggedRecoveryTotalHours;
              // Wind shear terminates RI/ERI through a severity-dependent smooth rollover.
              if (nextTy.rapidIntensifying || nextTy.forcedRapidIntensification) {
                nextTy.rapidEpisodeAbortRequested = true;
              }
              showToast(`已施加垂直风切变影响：${val} kt！自动 RI/ERI 将按风切强度平滑退出。`, "warning");
            }
          } else if (type === "rapid_intensify") {
            const mode = option === "uri" ? "uri" : option === "eri" ? "eri" : "ri";
            const etBurstBlocked = !!nextTy.coldAirWarmCoreDestroyed;
            if (etBurstBlocked) {
              nextTy.rapidIntensifying = false;
              delete nextTy.forcedRapidIntensification;
              delete nextTy.forcedRapidIntensificationMode;
              delete nextTy.rapidIntensificationMode;
              nextTy.rapidEpisodeAbortRequested = true;
              showToast("强冷空气已彻底摧毁暖心，闭合台风涡旋已崩解为残留低压云团，禁止任何重新增强。", "warning");
              return nextTy;
            }
            const sameModeActive = (nextTy.rapidIntensifying || nextTy.forcedRapidIntensification) &&
              (nextTy.forcedRapidIntensificationMode || nextTy.rapidIntensificationMode || "ri") === mode;

            if (sameModeActive) {
              // Manual stop is also gradual: the RI contribution rolls back to the
              // environment-controlled tendency instead of disappearing in one step.
              // If this episode came from playground auto-ERI, pause automatic retriggering;
              // otherwise the next physics step would simply switch ERI back on.
              nextTy.rapidEpisodeAbortRequested = true;
              if (nextTy.playgroundAutoERI) {
                nextTy.playgroundAutoERIPaused = true;
                nextTy.playgroundAutoERI = false;
              }
              // Convert the current episode back to a non-forced episode while it ramps out.
              // This prevents the manual-forcing initializer from clearing the abort request.
              delete nextTy.forcedRapidIntensification;
              delete nextTy.forcedRapidIntensificationMode;
              nextTy.rapidTriggerCooldownHours = Math.max(nextTy.rapidTriggerCooldownHours || 0, 30);
              if (nextTy.penaltyRecoveryActive) {
                nextTy.penaltyRecoveryActive = false;
                nextTy.penaltyRecoveryElapsedHours = 0;
                nextTy.penaltyRecoveryTotalHours = 0;
                nextTy.penaltyRecoveryDryAir = false;
                nextTy.penaltyRecoveryShear = false;
                nextTy.penaltyRecoveryTerrain = false;
                nextTy.penaltyRecoveryStage = undefined;
              }
              showToast(`已请求结束${mode === "uri" ? "超高速爆发 URI" : mode === "eri" ? "极端快速增强 ERI" : "快速增强 RI"}，增强率将平滑回落；自动再次触发已暂时阻断。`, "info");
            } else {
              // Do not erase environmental states. The menu already prevents starting in an
              // actively hostile setup, and any deterioration after onset will terminate the
              // episode through the engine's gradual abort mechanism.
              nextTy.playgroundAutoERIPaused = false;
              nextTy.forcedRapidIntensification = true;
              nextTy.forcedRapidIntensificationMode = mode;
              nextTy.rapidIntensificationMode = mode;
              nextTy.rapidIntensifying = true;
              nextTy.rapidEpisodeElapsedHours = 0;
              nextTy.rapidEpisodeDurationHours = undefined; // engine samples realistic duration/rate envelope
              nextTy.rapidEpisodeTarget24h = undefined;
              nextTy.rapidEpisodeStartRate = undefined;
              nextTy.rapidEpisodeLastRate = undefined;
              nextTy.rapidEpisodeExitHours = 0;
              nextTy.rapidEpisodeExitDuration = undefined;
              nextTy.rapidEpisodeAbortRequested = false;
              delete nextTy.cloggedRecoveryHours;
              delete nextTy.cloggedRecoveryTotalHours;

              const terrainHollowSeverity = Math.max(0, Math.min(1, nextTy.terrainHollowCoreMemory ?? 0));
              const damagedCore = !!nextTy.isStructureDamaged || !!nextTy.isCoreDisrupted ||
                (nextTy.coreRebuildScar || 0) >= 0.30 || terrainHollowSeverity >= 0.12;
              if (damagedCore) {
                const severity = Math.max(0, Math.min(1, Math.max(
                  nextTy.isCoreDisrupted ? 0.85 : 0,
                  1 - (nextTy.structuralDamagePenaltyFactor ?? 1),
                  nextTy.coreRebuildScar ?? 0,
                  terrainHollowSeverity
                )));
                nextTy.penaltyRecoveryActive = true;
                nextTy.penaltyRecoveryElapsedHours = 0;
                nextTy.penaltyRecoveryTotalHours = 7.5 + 4.5 * severity;
                nextTy.penaltyRecoveryTerrain = nextTy.damageOrigin === "terrain" || nextTy.damageOrigin === "mixed";
                nextTy.penaltyRecoveryDryAir = nextTy.damageOrigin === "shear_dry" || nextTy.damageOrigin === "mixed";
                nextTy.penaltyRecoveryShear = nextTy.damageOrigin === "shear_dry" || nextTy.damageOrigin === "mixed";
                nextTy.penaltyRecoveryStage = "purging";
                nextTy.convectiveBurstIndex = Math.max(nextTy.convectiveBurstIndex ?? 0, 0.82);
                nextTy.deepConvectiveCoverage = Math.max(nextTy.deepConvectiveCoverage ?? 0, 0.72);
                showToast(`中心重构爆发已启动：先触发强深对流重新包裹中心，随后约 ${nextTy.penaltyRecoveryTotalHours.toFixed(1)} 小时内重新闭合眼墙并开眼。`, "success");
              }
              if (!damagedCore) {
                showToast(mode === "uri"
                  ? "已开启超高速爆发 URI：前2小时平滑升至 2.28–2.37 m/s/h，持续25小时，结束后2小时平滑恢复。"
                  : mode === "eri"
                  ? "已开启极端快速增强 ERI：典型约 24–30 m/s / 24h，持续约 10–20h。"
                  : "已开启快速增强 RI：典型约 15–22 m/s / 24h，通常持续约 12–24h。", "success");
              }
            }
          }
          return nextTy;
        }
        return ty;
      });
      return updated;
    });
  };

  const handleCancelAllPenalties = () => {
    updateTyphoons((prev) => {
      if (prev.length === 0) {
        showToast("当前没有活跃台风，无法取消惩罚", "warning");
        return prev;
      }

      if (currentHour < maxHour) {
        setMaxHour(currentHour);
        totalSimMinutesRef.current = currentHour * 60;
        engineRef.current.syncPrngToHour(currentHour);
      }

      return prev.map((ty, idx) => {
        if (idx !== 0 || !ty.active || ty.dissipated) return ty;
        const restoredState = currentHour < maxHour ? ty.history.find((h) => h.simHour === currentHour) : undefined;
        let nextTy: Typhoon = {
          ...ty,
          ...(restoredState || {}),
          active: restoredState ? !restoredState.dissipated : ty.active,
          history: currentHour < maxHour ? ty.history.filter((h) => h.simHour <= currentHour) : ty.history,
        };

        // “取消所有惩罚” resets reversible intervention / penalty memory. An already destroyed warm core
        // is a physical phase-state latch and is deliberately NOT restored by this convenience action.
        delete nextTy.forcedDryAir;
        delete nextTy.forcedShear;
        delete nextTy.forcedColdAirStrength;
        delete nextTy.forcedColdAirArrivalHour;
        delete nextTy.forcedColdAirScheduledHour;
        delete nextTy.coldAirExposureHours;
        delete nextTy.forcedColdWaterTemperatureC;
        delete nextTy.forcedColdWaterStartHour;
        delete nextTy.forcedColdWaterEndHour;
        delete nextTy.forcedColdWaterDurationHours;
        delete nextTy.forcedEWRC;
        delete nextTy.manualEwrcOutcomeOverride;
        delete nextTy.dryAirPenaltyHours;
        delete nextTy.dryAirPenaltyTotalHours;
        delete nextTy.shearPenaltyHours;
        delete nextTy.shearPenaltyTotalHours;
        delete nextTy.cloggedRecoveryHours;
        delete nextTy.cloggedRecoveryTotalHours;
        nextTy.ewrcIsFailure = false;
        nextTy.ewrcFailurePenaltyHours = 0;
        nextTy.ewrcPenaltyTotalHours = 0;
        nextTy.ewrcFailureMode = "none";
        if (["penalty_failure", "recovering_failure"].includes(nextTy.ewrcState || "none")) {
          nextTy.ewrcState = "none";
          nextTy.ewrcProgress = 0;
        }
        const persistentTerrainHollow = Math.max(0, Math.min(1, nextTy.terrainHollowCoreMemory ?? 0));
        nextTy.passedTaiwanCentral = persistentTerrainHollow >= 0.12 ? nextTy.passedTaiwanCentral : false;
        nextTy.passedLuzonMountains = persistentTerrainHollow >= 0.12 ? nextTy.passedLuzonMountains : false;
        nextTy.maxLandElevationPassed = persistentTerrainHollow >= 0.12 ? nextTy.maxLandElevationPassed : 0;
        nextTy.structuralDamageHours = persistentTerrainHollow >= 0.12 ? nextTy.structuralDamageHours : 0;
        nextTy.structuralDamagePenaltyFactor = 1;
        nextTy.isStructureDamaged = persistentTerrainHollow >= 0.12;
        nextTy.isCoreDisrupted = persistentTerrainHollow >= 0.34;
        nextTy.damageOrigin = persistentTerrainHollow >= 0.12 ? "terrain" : "none";
        nextTy.coreRebuildScar = persistentTerrainHollow >= 0.12
          ? Math.max(nextTy.coreRebuildScar ?? 0, 0.16 + 0.24 * persistentTerrainHollow)
          : 0;
        nextTy.terrainDamageMorphology = persistentTerrainHollow >= 0.12 ? "hollow_bands" : undefined;
        nextTy.isEyeClogged = false;
        if (persistentTerrainHollow >= 0.12) {
          // Cancelling an artificial penalty must not visually recreate a closed eyewall for one
          // frame before the physics step catches up. Preserve a ragged/broken architecture.
          nextTy.eyeObstruction = Math.max(nextTy.eyeObstruction ?? 0.24, 0.18);
          nextTy.eyeAsymmetry = Math.max(nextTy.eyeAsymmetry ?? 0.42, 0.42 + 0.24 * persistentTerrainHollow);
          nextTy.eyewallIntegrity = Math.min(nextTy.eyewallIntegrity ?? 0.30, 0.38);
          nextTy.eyePhase = "ragged";
          nextTy.eyeType = "broken";
          nextTy.structureMode = "terrain_hollow_bands";
        } else {
          nextTy.eyeObstruction = Math.min(nextTy.eyeObstruction ?? 0, 0.18);
          nextTy.eyeAsymmetry = Math.min(nextTy.eyeAsymmetry ?? 0, 0.20);
          nextTy.eyewallIntegrity = Math.max(nextTy.eyewallIntegrity ?? 0.45, 0.45);
        }
        nextTy.dryAirIntrusion = 0;
        nextTy.dryAirCoreExposure = 0;
        nextTy.dryAirVentilationIndex = 0;
        nextTy.dryAirCoreConnection = 0;
        nextTy.dryAirReMoistening = 0;
        nextTy.dryAirConvectiveArcBearingDeg = undefined;
        nextTy.eyewallColdPoolMemory = 0;
        nextTy.moistCoreProtection = Math.max(nextTy.moistCoreProtection ?? 0.55, 0.72);
        nextTy.dryErosionHours = 0;
        nextTy.dryRecoveryHours = 0;
        nextTy.drySlotBearingDeg = undefined;
        nextTy.rebuiltCoreDiameterKm = 0;
        nextTy.convectiveSuppression = 0;
        nextTy.postDryAirBurstSuppressionHours = 0;
        nextTy.structuralDisorganization = persistentTerrainHollow >= 0.12
          ? Math.max(nextTy.structuralDisorganization ?? 0, 0.46 + 0.34 * persistentTerrainHollow)
          : (nextTy.landed ? Math.min(nextTy.structuralDisorganization ?? 0, 0.18) : 0);
        nextTy.penaltyRecoveryActive = false;
        nextTy.penaltyRecoveryElapsedHours = 0;
        nextTy.penaltyRecoveryTotalHours = 0;
        nextTy.penaltyRecoveryDryAir = false;
        nextTy.penaltyRecoveryShear = false;
        nextTy.penaltyRecoveryTerrain = false;
        nextTy.penaltyRecoveryStage = undefined;
        showToast(persistentTerrainHollow >= 0.12
          ? "已取消人为惩罚；高山穿越造成的中心空洞损伤属于真实结构破坏并已保留，需要点击爆发增强才能重构核心。"
          : "已取消全部人为惩罚及可恢复结构损伤记忆；后续只会按当前真实环境重新产生新的影响。", "success");
        return nextTy;
      });
    });
  };

  const [startDate, setStartDate] = useState<Date>(() => {
    const saved = localStorage.getItem("typhoon_sim_start_date");
    const d = saved ? new Date(saved) : new Date("2027-06-30T20:00:00");
    // The simulator integrates in 10-minute steps but operational analysis products are clock-hour
    // anchored. Normalize legacy/custom start timestamps to an exact hour so the CMA/NMC
    // 02/05/08/11/14/17/20/23 Beijing cycle is reachable and identical in every renderer/export.
    d.setMinutes(0, 0, 0);
    return d;
  });

  const handleStartDateChange = (selectedCurrentStateDate: Date) => {
    // The clock editor edits the timestamp of the CURRENT simulation state, not genesis.
    // Keep all elapsed-hour physics/history unchanged and translate the absolute time origin.
    const selected = new Date(selectedCurrentStateDate);
    selected.setMinutes(0, 0, 0);
    const elapsedHour = Number(currentHourRef.current || 0);
    const normalizedDate = new Date(selected.getTime() - elapsedHour * 3600000);
    normalizedDate.setMinutes(0, 0, 0);
    setStartDate(normalizedDate);
    localStorage.setItem("typhoon_sim_start_date", normalizedDate.toISOString());
    showToast(`当前模拟状态时间已调整为: ${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')} ${String(selected.getHours()).padStart(2, '0')}:00`, "success");
  };

  // Ref trackers for the continuous simulation minute accumulator
  const simMinutesBufferRef = useRef(0);
  const lastTimeRef = useRef<number>(0);
  const totalSimMinutesRef = useRef<number>(0);
  const animationFrameIdRef = useRef<number | null>(null);
  const physicsTaskTimerRef = useRef<number | null>(null);
  const physicsWakeTimerRef = useRef<number | null>(null);
  const lastPhysicsDispatchAtRef = useRef<number>(0);
  const lastUiCommitTimeRef = useRef<number>(0);
  const pendingFrameLogsRef = useRef<EventLog[]>([]);
  const physicsFrameConfigCacheRef = useRef<{ base: SimulationConfig | null; speed: number; value: SimulationConfig | null }>({
    base: null, speed: Number.NaN, value: null
  });

   // Keep state synced to refs to avoid tearing down requestAnimationFrame on every state update
  // Once a portable import exceeds safe synchronous localStorage limits, or a
  // quota write fails, stop retrying full-season serialization every few seconds.
  // JSON/.aether export is independent of this recovery convenience cache.
  const localRecoveryDisabledRef = useRef(false);
  const typhoonsRef = useRef(typhoons);
  const configRef = useRef(config);
  const layersRef = useRef(layers);
  const eventLogsRef = useRef(eventLogs);
  const currentHourRef = useRef(currentHour);
  const maxHourRef = useRef(maxHour);
  // Invalidates already queued rAF / timer callbacks on an immediate pause.
  const physicsRunGenerationRef=useRef(0);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  useEffect(() => {
    if (!useLegacyMobileUi || configRef.current.controlMode !== "draw") return;
    // Phone UI intentionally exposes only the regular touch/joystick workflow. Preserve any
    // previously drawn desktop route in storage/config, but never leave mobile simulation stuck
    // in draw-control mode with no matching controls on screen.
    setDrawRoutePhase("off");
    setDrawnTrackDraft([]);
    const next = {
      ...configRef.current,
      controlMode: "joystick" as const,
      joystickDragging: false,
      joystickDx: 0,
      joystickDy: 0
    };
    configRef.current = next;
    setConfig(next);
  }, [useLegacyMobileUi, config.controlMode]);
  // Draw-mode captures ↑/↓ for speed. ←/→ are always historical-step shortcuts and must
  // reach the desktop listener instead of being swallowed by this capture listener.
  useEffect(() => {
    let lastWheelAt = 0;
    const updateSpeed = (direction: number) => {
      const next = Math.max(0, Math.min(150, Math.round((configRef.current.drawnTrackSpeedKmh ?? 20) + direction * 2)));
      if (next === configRef.current.drawnTrackSpeedKmh) return;
      const nextConfig = { ...configRef.current, drawnTrackSpeedKmh: next };
      configRef.current = nextConfig;
      setConfig(nextConfig);
    };
    const onKeyboard = (event: KeyboardEvent) => {
      if (configRef.current.controlMode !== "draw" || !["ArrowUp", "ArrowDown"].includes(event.code)) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.type === "keydown" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.code === "ArrowUp") updateSpeed(1);
        if (event.code === "ArrowDown") updateSpeed(-1);
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (configRef.current.controlMode !== "draw" || !isPlayingRef.current ||
          !typhoonsRef.current.some((ty) => ty.active && !ty.dissipated) ||
          !(event.target as Element)?.closest?.(".leaflet-container")) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (performance.now() - lastWheelAt < 65) return;
      lastWheelAt = performance.now();
      updateSpeed(event.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener("keydown", onKeyboard, true);
    window.addEventListener("keyup", onKeyboard, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyboard, true);
      window.removeEventListener("keyup", onKeyboard, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, []);

   useEffect(() => {
    typhoonsRef.current = typhoons;
  }, [typhoons]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    eventLogsRef.current = eventLogs;
  }, [eventLogs]);

  useEffect(() => {
    currentHourRef.current = currentHour;
  }, [currentHour]);

  useEffect(() => {
    maxHourRef.current = maxHour;
  }, [maxHour]);

  // Global decompression tactile click sound. The listeners are installed once and read the newest
  // sound settings through configRef, so rapid simulation/config commits no longer tear down and
  // recreate four capture-phase listeners. A fast tap also cannot collapse press/release into one
  // transient: release is delayed just enough to respect each recorded sound's minimum separation.
  useEffect(() => {
    type ActiveSoundPointer = { mode: "mahjong" | "mouse"; pressedAt: number; volume: number };
    const activeSoundPointers = new Map<number, ActiveSoundPointer>();
    const pendingReleaseTimers = new Set<number>();
    const isSoundTarget = (target: HTMLElement | null) => !!(
      target &&
      (target.closest("button") ||
        target.closest("a") ||
        target.closest("input") ||
        target.closest("select") ||
        target.closest("[role='button']") ||
        target.closest(".cursor-pointer"))
    );
    const isPreviewTarget = (target: HTMLElement | null) =>
      !!target?.closest("[data-aether-sound-preview='true']");
    const playRelease = (entry: ActiveSoundPointer) => {
      if (entry.mode === "mahjong") playSndMahjongRelease(entry.volume, true);
      else playSndMouseRelease(entry.volume, true);
    };

    const handlePointerDown = (e: PointerEvent) => {
      const soundConfig = configRef.current;
      if (!soundConfig.soundEnabled) return;
      const target = e.target as HTMLElement | null;
      if (isPreviewTarget(target) || !isSoundTarget(target)) return;
      const mode: "mahjong" | "mouse" = (soundConfig.soundMode || "mouse") === "mahjong" ? "mahjong" : "mouse";
      const volume = soundConfig.soundVolume;
      activeSoundPointers.set(e.pointerId, { mode, pressedAt: performance.now(), volume });
      if (mode === "mahjong") playSndMahjongPress(volume, true);
      else playSndMousePress(volume, true);
    };
    const handlePointerUp = (e: PointerEvent) => {
      const entry = activeSoundPointers.get(e.pointerId);
      if (!entry) return;
      activeSoundPointers.delete(e.pointerId);
      if (!configRef.current.soundEnabled) return;
      const elapsed = performance.now() - entry.pressedAt;
      const waitMs = Math.max(0, getTactileReleaseMinDelayMs(entry.mode) - elapsed);
      if (waitMs <= 1) {
        playRelease(entry);
        return;
      }
      const timer = window.setTimeout(() => {
        pendingReleaseTimers.delete(timer);
        playRelease(entry);
      }, waitMs);
      pendingReleaseTimers.add(timer);
    };
    const handlePointerCancel = (e: PointerEvent) => {
      activeSoundPointers.delete(e.pointerId);
    };
    const handleGlobalClick = (e: MouseEvent) => {
      const soundConfig = configRef.current;
      if (!soundConfig.soundEnabled) return;
      const target = e.target as HTMLElement | null;
      if (isPreviewTarget(target) || !isSoundTarget(target)) return;
      // Pointer-originated clicks are suppressed inside playSndClick by the recent pointer stamp;
      // keyboard-generated clicks still receive the compact press/release compatibility pair.
      playSndClick(soundConfig.soundVolume, true, soundConfig.soundMode || "mouse");
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("click", handleGlobalClick, true);
    return () => {
      pendingReleaseTimers.forEach((timer) => window.clearTimeout(timer));
      pendingReleaseTimers.clear();
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("click", handleGlobalClick, true);
    };
  }, []);

   const updateTyphoons = (newTy: Typhoon[] | ((prev: Typhoon[]) => Typhoon[])) => {
    if (typeof newTy === "function") {
      setTyphoons((prev) => {
        const res = newTy(prev);
        typhoonsRef.current = res;
        return res;
      });
    } else {
      typhoonsRef.current = newTy;
      setTyphoons(newTy);
    }
  };

  const buildLiveForecastIfNeeded = (typhoon: Typhoon, forecastConfig: SimulationConfig, hours = 120) =>
    needsLiveForecastGeometry(layersRef.current)
      ? calculateLiveForecastTrackPath(typhoon, forecastConfig, hours)
      : [];

  // Turning forecast-derived overlays on computes one coarse path immediately. Turning the last
  // such overlay off drops the live path immediately so the next physics steps cannot accidentally
  // keep using or archiving stale guidance. Historical snapshots already written remain immutable.
  const previousForecastDemandRef = useRef(needsLiveForecastGeometry(layers));
  useEffect(() => {
    const demanded = needsLiveForecastGeometry(layers);
    const previous = previousForecastDemandRef.current;
    previousForecastDemandRef.current = demanded;
    layersRef.current = layers;
    if (demanded === previous) return;
    updateTyphoons((prev) => prev.map((ty) => {
      if (!ty.active || ty.dissipated) return ty;
      return {
        ...ty,
        forecastPath: demanded ? calculateLiveForecastTrackPath(ty, configRef.current, 120) : []
      };
    }));
  }, [layers.forecast, layers.forecastCone, layers.hurricaneTrackerModels]);

  // Load state from localStorage on startup!
  const loadSavedSimulationState = () => {
    try {
      const savedTyphoons = localStorage.getItem("typhoon_sim_state_typhoons");
      const savedLogs = localStorage.getItem("typhoon_sim_state_logs");
      const savedHour = localStorage.getItem("typhoon_sim_state_current_hour");
      const savedMaxHour = localStorage.getItem("typhoon_sim_state_max_hour");
      const savedMins = localStorage.getItem("typhoon_sim_state_mins");
      const savedStateConfig = localStorage.getItem("typhoon_sim_state_config");
      const savedPrngState = localStorage.getItem("typhoon_sim_state_prng");
      const savedSeasonEnded = localStorage.getItem("typhoon_sim_state_season_ended");
      
      if (savedTyphoons) {
        const parsedTyphoons = JSON.parse(savedTyphoons);
        if (Array.isArray(parsedTyphoons) && parsedTyphoons.length > 0) {
          const parsedSavedHour = savedHour !== null ? Number.parseFloat(savedHour) : Number.NaN;
          const parsedFallbackHour = Number(parsedTyphoons[0]?.simHour ?? 0);
          const restoredHour = Number.isFinite(parsedSavedHour)
            ? parsedSavedHour
            : (Number.isFinite(parsedFallbackHour) ? parsedFallbackHour : 0);
          // timelineHidden is a transient playback/UI flag. Persisting it while the user is
          // scrubbing backwards used to make a perfectly valid historical track stay invisible
          // after restarting the app. Re-derive visibility from the restored clock instead.
          const loadedTy = parsedTyphoons.map((ty: Typhoon) => {
            const history = Array.isArray(ty.history) ? ty.history : [];
            const firstHistoryHour = Number(history[0]?.simHour ?? ty.seasonStartHour ?? 0);
            return {
              ...ty,
              timelineHidden: firstHistoryHour > restoredHour + 1e-6
            };
          });
          setTyphoons(loadedTy);
          typhoonsRef.current = loadedTy;

          if (savedStateConfig) {
            const parsedStateConfig = JSON.parse(savedStateConfig);
            if (parsedStateConfig && typeof parsedStateConfig === "object") {
              delete parsedStateConfig.fujiwharaEnabled;
              delete parsedStateConfig.uiStyle;
              parsedStateConfig.newEnvironmentPanelsEnabled = false;
              parsedStateConfig.newEnvironmentPhysicsEnabled = false;
              parsedStateConfig.manualDryAirRegions = [];
              parsedStateConfig.manualShearRegions = [];
            }
            const restoredConfig = { ...DEFAULT_CONFIG, ...parsedStateConfig, newEnvironmentPanelsEnabled: false, newEnvironmentPhysicsEnabled: false } as SimulationConfig;
            setConfig(restoredConfig);
            configRef.current = restoredConfig;
          }
          
          if (savedLogs) {
            setEventLogs(JSON.parse(savedLogs));
          }
          if (savedHour) {
            setCurrentHour(parseInt(savedHour, 10));
          }
          if (savedMaxHour) {
            setMaxHour(parseInt(savedMaxHour, 10));
          }
          if (savedMins) {
            totalSimMinutesRef.current = parseFloat(savedMins);
          }
          if (savedPrngState !== null && Number.isSafeInteger(Number(savedPrngState)) && Number(savedPrngState) >= 0) {
            importedPrngRestoreRef.current = Number(savedPrngState);
          }
          setSeasonEnded(savedSeasonEnded === "1");
          return true;
        }
      }
    } catch (e) {
      console.error("Failed to restore saved simulation state", e);
    }
    return false;
  };

  // Initialize the simulation while the AETHER launch animation is playing.  GIS loading is the
  // slowest startup dependency; the splash remains visible for a minimum presentation time and,
  // when necessary, waits for this initialization promise to settle before revealing the author
  // card and the interactive application.
  useEffect(() => {
    let cancelled = false;
    const naturalEarthInit = loadNaturalEarthData();
    const loaded = loadSavedSimulationState();
    if (!loaded) {
      resetSimulation();
    }
    Promise.resolve(naturalEarthInit).finally(() => {
      if (!cancelled) setInitializationReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Save configurations to localStorage on change safely
  useEffect(() => {
    try {
      localStorage.setItem("typhoon_sim_config", JSON.stringify(config));
    } catch (e) {
      console.warn("localStorage config save error:", e);
    }
  }, [config]);

  useEffect(() => {
    try {
      localStorage.setItem("typhoon_sim_layers", JSON.stringify(layers));
    } catch (e) {
      console.warn("localStorage layers save error:", e);
    }
  }, [layers]);

  // A confirmed hand-drawn framework is required for its display layer. If the route is cleared
  // (or an older save restores the layer flag without route data), force the layer back off so a
  // future newly drawn route never appears unexpectedly from stale UI state.
  useEffect(() => {
    if ((config.drawnTrackRoute?.length || 0) >= 2 || !layers.drawnForecastRoute) return;
    setLayers((prev) => prev.drawnForecastRoute ? { ...prev, drawnForecastRoute: false } : prev);
  }, [config.drawnTrackRoute?.length, layers.drawnForecastRoute]);

  // Persist simulation state continuously.  This is an interval-based throttle rather than a
  // debounce: at high simulation speed the state changes every frame, so a debounce could be
  // postponed forever and lose the route/config snapshots if the page closes mid-simulation.
  const persistSimulationState = useCallback(() => {
    const snapshotTyphoons = typhoonsRef.current;
    if (localRecoveryDisabledRef.current || snapshotTyphoons.length === 0) return;
    try {
      localStorage.setItem("typhoon_sim_state_typhoons", serializeTyphoonsForPersistence(snapshotTyphoons));
      localStorage.setItem("typhoon_sim_state_logs", JSON.stringify(eventLogsRef.current));
      localStorage.setItem("typhoon_sim_state_current_hour", currentHourRef.current.toString());
      localStorage.setItem("typhoon_sim_state_max_hour", maxHourRef.current.toString());
      localStorage.setItem("typhoon_sim_state_mins", totalSimMinutesRef.current.toString());
      localStorage.setItem("typhoon_sim_state_config", JSON.stringify(snapshotConfigForHistory(configRef.current)));
      localStorage.setItem("typhoon_sim_state_prng", String(engineRef.current.capturePrngState()));
      localStorage.setItem("typhoon_sim_state_season_ended", seasonEnded ? "1" : "0");
    } catch (e) {
      // Quota failure usually means the history has outgrown localStorage. Repeating
      // JSON serialization/writes every few seconds freezes the restored simulation.
      localRecoveryDisabledRef.current = true;
      persistedHistoryJsonCache.clear();
      clearLocalRecovery(); // Avoid an incomplete multi-key checkpoint on next startup.
      console.warn("Local recovery disabled after storage failure; portable archive export remains available:", e);
    }
  }, [seasonEnded]);

  // Round144: a portable checkpoint deliberately lives outside localStorage.
  // Autosave quotas can be too small for a full season of hourly station/history snapshots.
  // Export is user initiated and does not make the regular 10-minute physics loop any heavier.
  const exportCompleteSimulation = async (mode: "readable" | "compressed" = "readable"): Promise<void> => {
    const data: SimulationArchiveData = {
      typhoons: typhoonsRef.current,
      eventLogs: eventLogsRef.current,
      config: snapshotConfigForHistory(configRef.current),
      layers: { ...layersRef.current },
      currentHour: currentHourRef.current,
      maxHour: maxHourRef.current,
      totalSimMinutes: totalSimMinutesRef.current,
      startDate: startDate.toISOString(),
      seasonEnded,
      speed,
      prngState: engineRef.current.capturePrngState(),
      timelineCollapsed,
      genesisPos: { ...genesisPos },
      productPreferences: captureProductPreferences(localStorage)
    };
    const blob = await createSimulationArchiveBlob(data, mode);
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "_").slice(0, 15);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `AETHER_${stamp}_${data.typhoons.length}storms${mode === "readable" ? ".aether.json" : ".aether"}`;
    document.body.appendChild(anchor);
    try { anchor.click(); }
    finally {
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    showToast(`${mode === "readable" ? "AI 可编辑 JSON" : "压缩备份"}已生成（${(blob.size / 1024 / 1024).toFixed(2)} MB）`, "success");
  };

  const importCompleteSimulation = async (file: File): Promise<boolean> => {
    // Parse/validate the COMPLETE file before touching playback or user data.
    const archive = await readSimulationArchiveFile(file);
    const data = archive.data;
    const confirmed = window.confirm(
      `读取 AETHER 模拟存档？\n\n来源版本 ${archive.applicationVersion} · ${data.typhoons.length} 个台风 · 历史 ${data.maxHour} 小时\n\n这将替换当前模拟及其历史记录。建议先导出当前存档。`
    );
    if (!confirmed) return false;

    setIsPlaying(false);
    isPlayingRef.current = false;
    if (animationFrameIdRef.current !== null) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (physicsTaskTimerRef.current !== null) {
      clearTimeout(physicsTaskTimerRef.current);
      physicsTaskTimerRef.current = null;
    }
    if (physicsWakeTimerRef.current !== null) {
      clearTimeout(physicsWakeTimerRef.current);
      physicsWakeTimerRef.current = null;
    }
    simMinutesBufferRef.current = 0;
    pendingFrameLogsRef.current = [];
    pendingCirculationSizeOriginRef.current = null;
    continuingDrawnTrackRef.current = false;
    physicsFrameConfigCacheRef.current = { base: null, speed: Number.NaN, value: null };
    forecastPeakSliderDraftRef.current = null;
    setForecastPeakSliderDraft(null);
    lastPreviewSeekHourRef.current = null;
    lastUiCommitTimeRef.current = 0;
    localRecoveryDisabledRef.current = false;
    totalSimMinutesRef.current = data.totalSimMinutes;
    currentHourRef.current = data.currentHour;
    maxHourRef.current = data.maxHour;
    persistedHistoryJsonCache.clear();

    // Legacy/experimental physics toggles are retired; preserve all supported
    // customizations, and restore the rest of the full object unchanged.
    const restoredConfig = {
      ...DEFAULT_CONFIG, ...data.config,
      newEnvironmentPanelsEnabled: false,
      newEnvironmentPhysicsEnabled: false
    } as SimulationConfig;
    delete (restoredConfig as any).fujiwharaEnabled;
    delete (restoredConfig as any).uiStyle;
    const restoredLayers = { ...DEFAULT_LAYERS, ...data.layers };
    if ((restoredConfig.drawnTrackRoute?.length || 0) < 2) restoredLayers.drawnForecastRoute = false;
    const importedSeedChanged = configRef.current.seed !== restoredConfig.seed;
    configRef.current = restoredConfig;
    layersRef.current = restoredLayers;
    eventLogsRef.current = data.eventLogs;
    typhoonsRef.current = data.typhoons;
    engineRef.current = new TyphoonEngine(restoredConfig.seed);
    engineRef.current.restorePrngState(data.prngState);
    // Only the seed-change React effect can rebuild the engine again. Do not
    // leave a stale restore token behind when importing the same seed.
    importedPrngRestoreRef.current = importedSeedChanged ? data.prngState : null;

    setTyphoons(data.typhoons);
    setEventLogs(data.eventLogs);
    setConfig(restoredConfig);
    setLayers(restoredLayers);
    setStartDate(new Date(data.startDate));
    setCurrentHour(data.currentHour);
    setMaxHour(data.maxHour);
    setSeasonEnded(data.seasonEnded);
    setSpeed(data.speed);
    setGenesisPos(data.genesisPos);
    setTimelineSeekPreview(false);
    setTimelineCollapsed(data.timelineCollapsed);
    setIsForecastRouteDrawing(false);
    setForecastRouteDraft([]);
    setDrawRoutePhase("off");
    setDrawnTrackDraft([]);
    setPlacementMode("none");
    setAppInputDialog(null);
    setShowReport(false);
    setSummaryReportTyphoon(null);
    setReportModalTyphoon(null);
    setVideoExportTyphoon(null);
    setForecastModalOpen(false);
    setSeasonReportOpen(false);
    setTerminationDialogOpen(false);
    setIsInfluenceModalOpen(false);
    setDrawerOpen(false);

    // A pretty-printed archive may be tens of megabytes. Serializing and writing
    // that same dataset to synchronous localStorage immediately on import is both
    // an expensive UI pause and likely to exceed the browser's quota. Only use
    // the local recovery slot when the imported history is comfortably small.
    // The portable archive itself is always retained by the user independently.
    const importedSnapshotCount = data.typhoons.reduce((sum, ty) => sum + ty.history.length, 0);
    const oversizedImport = skipOversizedLocalRecovery(file.size, importedSnapshotCount);
    let storedLocally = !oversizedImport;
    localRecoveryDisabledRef.current = oversizedImport;
    if (oversizedImport) {
      persistedHistoryJsonCache.clear();
      clearLocalRecovery();
    } else {
      try {
        if (data.typhoons.length === 0) clearLocalRecovery();
        else {
          localStorage.setItem("typhoon_sim_state_typhoons", serializeTyphoonsForPersistence(data.typhoons));
          localStorage.setItem("typhoon_sim_state_logs", JSON.stringify(data.eventLogs));
          localStorage.setItem("typhoon_sim_state_current_hour", String(data.currentHour));
          localStorage.setItem("typhoon_sim_state_max_hour", String(data.maxHour));
          localStorage.setItem("typhoon_sim_state_mins", String(data.totalSimMinutes));
          localStorage.setItem("typhoon_sim_state_config", JSON.stringify(snapshotConfigForHistory(restoredConfig)));
          localStorage.setItem("typhoon_sim_state_season_ended", data.seasonEnded ? "1" : "0");
          localStorage.setItem("typhoon_sim_state_prng", String(data.prngState));
        }
      } catch (error) {
        storedLocally = false;
        localRecoveryDisabledRef.current = true;
        persistedHistoryJsonCache.clear();
        clearLocalRecovery();
        console.warn("Local recovery quota exhausted during archive import:", error);
      }
    }

    // Some product makers read the simulated calendar directly from localStorage.
    // These settings are whitelisted so archive files cannot set arbitrary browser keys.
    try {
      localStorage.setItem("typhoon_sim_start_date", data.startDate);
      if (data.productPreferences) {
        const oldKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && isAllowedProductPreference(key)) oldKeys.push(key);
        }
        oldKeys.forEach(key => localStorage.removeItem(key));
        Object.entries(data.productPreferences).forEach(([key, value]) => localStorage.setItem(key, value));
      }
    } catch (error) {
      console.warn("Some saved product preferences could not be restored:", error);
    }
    showToast(`已读取完整模拟：${data.typhoons.length} 个台风，时间轴 ${data.currentHour}/${data.maxHour} 小时（已暂停）`, "success");
    if (!storedLocally) showToast(oversizedImport
      ? "大型存档已读取：为避免卡顿，已暂停浏览器本地自动备份；后续修改请用“保存 AI 可编辑 JSON”或压缩备份手动保存。"
      : "存档已读取，但浏览器存储空间不足，已暂停本地自动备份；请使用导出存档保存后续修改。", "warning");
    return true;
  };

  useEffect(() => {
    if (!isPlaying) return;

    // Serialising a long season (all track snapshots + station readings) is a synchronous,
    // potentially multi-megabyte main-thread job. Doing that every 2 seconds caused a very
    // visible periodic freeze once the archive became large. During playback, defer saves until
    // the browser is idle and reduce the cadence further at high simulation multipliers. Pausing,
    // hiding or leaving the page still performs the immediate safety flushes below.
    let idleHandle: number | null = null;
    let fallbackTimer: number | null = null;
    const scheduleIdlePersist = () => {
      if (localRecoveryDisabledRef.current || idleHandle !== null || fallbackTimer !== null) return;
      const requestIdle = (window as any).requestIdleCallback as
        | ((cb: () => void, options?: { timeout: number }) => number)
        | undefined;
      if (requestIdle) {
        idleHandle = requestIdle(() => {
          idleHandle = null;
          persistSimulationState();
        }, { timeout: 5000 });
      } else {
        fallbackTimer = window.setTimeout(() => {
          fallbackTimer = null;
          persistSimulationState();
        }, 0);
      }
    };

    // Full-season JSON grows with every archived hourly state. A longer idle-save cadence removes
    // the progressively larger synchronous stringify/localStorage spike from normal animation.
    // Visibility-change and beforeunload still flush immediately, so simulation data fidelity is unchanged.
    const intervalMs = speed > 30 ? 15000 : speed > 15 ? 12000 : 9000;
    const timer = window.setInterval(scheduleIdlePersist, intervalMs);
    scheduleIdlePersist();
    return () => {
      window.clearInterval(timer);
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      if (idleHandle !== null) {
        const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
        cancelIdle?.(idleHandle);
      }
    };
  }, [isPlaying, speed, persistSimulationState]);

  useEffect(() => {
    if (isPlaying || typhoons.length === 0) return;
    const timer = window.setTimeout(persistSimulationState, 120);
    return () => window.clearTimeout(timer);
  }, [typhoons, eventLogs, currentHour, maxHour, config, isPlaying, persistSimulationState]);

  useEffect(() => {
    const flushOnExit = () => persistSimulationState();
    const flushOnHidden = () => {
      if (document.visibilityState === "hidden") persistSimulationState();
    };
    window.addEventListener("beforeunload", flushOnExit);
    document.addEventListener("visibilitychange", flushOnHidden);
    return () => {
      window.removeEventListener("beforeunload", flushOnExit);
      document.removeEventListener("visibilitychange", flushOnHidden);
    };
  }, [persistSimulationState]);

  // Track background suspension across tab discards (including browsers without
  // document.wasDiscarded). Do not use persistent localStorage: opening a fresh
  // program session must still show the AETHER startup sequence.
  useEffect(() => {
    const markBackground = () => {
      try { sessionStorage.setItem("aether_background_pending", "1"); } catch {}
    };
    const markForeground = () => {
      try { sessionStorage.removeItem("aether_background_pending"); } catch {}
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") markBackground();
      else markForeground();
    };
    // On a restored tab, clear the pending marker only *after* the initializer
    // has read it and suppressed the redundant startup animation.
    if (document.visibilityState === "visible") markForeground();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", markForeground);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", markForeground);
    };
  }, []);

  // Page-lifecycle recovery. Mobile browsers may suspend a page in the middle of a touch/pointer
  // sequence; after resume WebKit can otherwise retain a stale scroll/drag owner and both overflow
  // panels and Leaflet become inert until a full reload. Reset only transient gesture state here --
  // simulation state is left untouched.
  useEffect(() => {
    let restoreRaf = 0;
    const restoreForegroundInteraction = () => {
      if (document.visibilityState === "hidden") return;
      simMinutesBufferRef.current = 0;
      lastTimeRef.current = performance.now();
      window.cancelAnimationFrame(restoreRaf);
      restoreRaf = window.requestAnimationFrame(() => {
        // Clear any inline gesture styles a suspended browser/overlay may have left behind.
        document.documentElement.style.removeProperty("touch-action");
        document.body.style.removeProperty("touch-action");
        document.body.style.removeProperty("pointer-events");

        // Force iOS momentum-scrollers to rebind without changing their visible position.
        document.querySelectorAll<HTMLElement>(".overflow-y-auto,.overflow-auto,.touch-pan-y,.control-drawer,[role='dialog']")
          .forEach((el) => {
            const top = el.scrollTop;
            el.style.setProperty("-webkit-overflow-scrolling", "auto");
            void el.offsetHeight;
            el.style.setProperty("-webkit-overflow-scrolling", "touch");
            el.scrollTop = top;
          });
        window.dispatchEvent(new Event("app-foreground-restored"));
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") restoreForegroundInteraction();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", restoreForegroundInteraction);
    window.addEventListener("pageshow", restoreForegroundInteraction);
    window.addEventListener("resume", restoreForegroundInteraction as EventListener);
    return () => {
      window.cancelAnimationFrame(restoreRaf);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", restoreForegroundInteraction);
      window.removeEventListener("pageshow", restoreForegroundInteraction);
      window.removeEventListener("resume", restoreForegroundInteraction as EventListener);
    };
  }, []);

  // Handle PRNG seed updates
  useEffect(() => {
    engineRef.current = new TyphoonEngine(config.seed);
    if (importedPrngRestoreRef.current !== null) {
      engineRef.current.restorePrngState(importedPrngRestoreRef.current);
      importedPrngRestoreRef.current = null;
    } else engineRef.current.syncPrngToHour(currentHourRef.current);
  }, [config.seed]);

  // Master reset logic: Blank canvas by default!
   const resetSimulation = () => {
    localRecoveryDisabledRef.current = false;
    persistedHistoryJsonCache.clear();
    importedPrngRestoreRef.current = null;
    simMinutesBufferRef.current = 0;
    pendingFrameLogsRef.current = [];
    lastUiCommitTimeRef.current = 0;
    totalSimMinutesRef.current = 0;
    engineRef.current.syncPrngToHour(0);
    
    setTyphoons([]); // Empty array for direct genesis on click!
    setIsForecastRouteDrawing(false);
    setForecastRouteDraft([]);
    setDrawRoutePhase("off");
    setDrawnTrackDraft([]);
    setConfig((prev) => {
      const next = {
        ...prev,
        manualForecastRouteEnabled: false,
        manualForecastRoute: [],
        manualForecastIntensityEnabled: false,
        manualForecastIntensityCurve: [],
        drawnTrackRoute: [],
        typhoonNamingCursor: prev.typhoonNamingStartIndex ?? 0
      };
      configRef.current = next;
      return next;
    });
    setTerminationDialogOpen(false);
    setSeasonReportOpen(false);
    setSeasonEnded(false);
    setShowReport(false);
    setSummaryReportTyphoon(null);
    setCurrentHour(0);
    setMaxHour(0);
    setIsPlaying(false);
    
    const initLog: EventLog = {
      id: "init-0",
      time: new Date(),
      simHour: 0,
      type: "info",
      message: `🌱 模拟器就绪：电脑端双击鼠标中键放置台风，触屏端三连击海图并确认。`
    };
    setEventLogs([initLog]);
    
    // No toast message shown on reset as requested

    // Clear saved states on explicit manual reset to prevent reloading previous session on fresh starts
    localStorage.removeItem("typhoon_sim_state_typhoons");
    localStorage.removeItem("typhoon_sim_state_coldwakes");
    localStorage.removeItem("typhoon_sim_state_config");
    localStorage.removeItem("typhoon_sim_state_logs");
    localStorage.removeItem("typhoon_sim_state_current_hour");
    localStorage.removeItem("typhoon_sim_state_max_hour");
    localStorage.removeItem("typhoon_sim_state_mins");
    localStorage.removeItem("typhoon_sim_state_season_ended");
    localStorage.removeItem("typhoon_sim_state_prng");
  };

  // Re-generate environment random profiles
  const regenerateEnvironment = () => {
    simMinutesBufferRef.current = 0;
    totalSimMinutesRef.current = 0;
    // Modify seed slightly and trigger reload
    const rng = Math.floor(Math.random() * 9000 + 1000);
    const nextSeed = `Yelan-${rng}`;
    setConfig(c => ({ ...c, seed: nextSeed }));
    
     // reset typhoon to reflect seed change
    const defaultMain = engineRef.current.createDefaultTyphoon(
      "main",
      typhoons[0]?.name || "夜澜",
      genesisPos.lat,
      genesisPos.lon,
      config
    );
    setTyphoons([defaultMain]);
    setCurrentHour(0);
    setMaxHour(0);
    setIsPlaying(false);
    
    setEventLogs([
      {
        id: `regen-${rng}`,
        time: new Date(),
        simHour: 0,
        type: "success",
        message: `🔄 气象环境重构：成功采用新随机物理种子 【${nextSeed}】，全域海温异常、西风槽深度 and 切变场已重新编译。`
      }
    ]);
    
    showToast("气象流场背景重构完成", "success");
  };

  // Clear track
  const clearTrack = () => {
    simMinutesBufferRef.current = 0;
    totalSimMinutesRef.current = 0;
    engineRef.current.syncPrngToHour(0);
    setTyphoons((prev) =>
      prev.map((ty) => ({
        ...ty,
        history: [
          {
            ...ty.history[ty.history.length - 1],
            simHour: 0
          }
        ]
      }))
    );
    setCurrentHour(0);
    setMaxHour(0);
    showToast("历史路径轨迹已清空", "info");
  };

  // Toast adder
  const showToast = (message: string, type: "info" | "success" | "warning" | "danger") => {
    setToasts((prev) => {
      const next = [
        ...prev,
        {
          id: `toast-${Date.now()}-${Math.random()}`,
          message,
          type
        }
      ];
      // Keep transient UI bounded. Rapid interactions (especially timeline scrub/track clicks)
      // must never leave dozens of live toast timers/components behind.
      return next.slice(-5);
    });
  };

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const terminateCurrentTyphoon = (openSingleReport: boolean = false) => {
    const current = typhoonsRef.current.find((t) => t.active && !t.dissipated);
    if (!current) {
      showToast("当前没有仍在编的台风。", "warning");
      return;
    }
    const stopHour = currentHourRef.current;
    const finalizedTyphoons = typhoonsRef.current.map((t) => {
      if (t.id !== current.id) return t;
      const history = t.history.filter((h) => h.simHour <= stopHour + 1e-6).map((h) => ({ ...h }));
      const finalSnapshot: any = {
        ...t,
        simHour: stopHour,
        dissipated: true,
        active: false,
        vmax: Math.min(t.vmax, 5.0),
        category: TyphoonCategory.DS,
        forecastPath: []
      };
      if (history.length && Math.abs(history[history.length - 1].simHour - stopHour) < 1e-6) {
        history[history.length - 1] = { ...history[history.length - 1], ...makeHourlyHistorySeed(finalSnapshot), dissipated: true, category: TyphoonCategory.DS };
      } else {
        history.push({ ...makeHourlyHistorySeed(finalSnapshot) } as any);
      }
      return {
        ...t,
        ...finalSnapshot,
        seasonEndHour: stopHour,
        history,
        timelineHidden: false
      };
    });
    updateTyphoons(finalizedTyphoons);
    setIsPlaying(false);
    simMinutesBufferRef.current = 0;
    if (animationFrameIdRef.current !== null) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (physicsTaskTimerRef.current !== null) {
      window.clearTimeout(physicsTaskTimerRef.current);
      physicsTaskTimerRef.current = null;
    }
    showToast("已停编当前台风；历史路径与风季时钟均已保留。", "info");
    if (openSingleReport) {
      setSummaryReportTyphoon(finalizedTyphoons.find((t) => t.id === current.id) || current);
      setShowReport(true);
    }
  };

  const handleTerminateRequest = () => {
    setIsPlaying(false);
    simMinutesBufferRef.current = 0;
    if (configRef.current.seasonModeEnabled === false) {
      terminateCurrentTyphoon(true);
      return;
    }
    setTerminationDialogOpen(true);
  };

  const terminateWholeSeason = () => {
    const active = typhoonsRef.current.some((t) => t.active && !t.dissipated);
    if (active) terminateCurrentTyphoon(false);
    setTerminationDialogOpen(false);
    setSeasonEnded(true);
    setShowReport(false);
    setSummaryReportTyphoon(null);
    setSeasonReportOpen(true);
  };

   // Master delta-time animation tick loop ---
  useEffect(() => {
    const runGeneration=++physicsRunGenerationRef.current;
    // Cleanly reset buffer when toggling play state or changing playback speeds to avoid stutter
    simMinutesBufferRef.current = 0;

    if (!isPlaying) {
      lastTimeRef.current = 0;
      return;
    }

    // Branch simulation reset if playing from a past hour
    if (currentHour < maxHour && currentHour < maxHourRef.current - 1e-5) {
      engineRef.current.syncPrngToHour(currentHour);
      maxHourRef.current = currentHour;
      setMaxHour(currentHour);
      totalSimMinutesRef.current = currentHour * 60;
      pendingFrameLogsRef.current = [];
      setEventLogs(previous => previous.filter(log => log.simHour <= currentHour + 1e-5));
      // A branch created by merely pressing Play must reuse the approved route and its archived
      // cursor. Only an explicit trash + redraw operation is allowed to replace that path.
      const existingRouteBranch = configRef.current.controlMode === "draw" &&
        (configRef.current.drawnTrackRoute?.length || 0) >= 2
        ? branchWithExistingDrawnRoute(typhoonsRef.current, currentHour, configRef.current)
        : null;
      if (existingRouteBranch) {
        configRef.current = existingRouteBranch.config;
        setConfig(existingRouteBranch.config);
      }
      const branched = existingRouteBranch?.storms ?? typhoonsRef.current.map((ty) => {
        const restoredState = ty.history.find((h) => Math.abs(h.simHour - currentHour) < 1e-5);
        const history = ty.history.filter(h => h.simHour <= currentHour + 1e-5);
        return { ...ty, ...(restoredState || {}),
          active: restoredState ? !restoredState.dissipated : false,
          seasonEndHour: restoredState?.dissipated ? restoredState.simHour : undefined,
          history, realisticMotion:trimRealisticParameterJournal(ty,history),forecastPath: restoredState?.forecastPath || [],
          drawnRouteProgressKm: restoredState?.drawnRouteProgressKm ?? 0 };
      }).filter(ty => ty.history.length > 0 && (ty.seasonStartHour ?? ty.history[0]?.simHour ?? 0) <= currentHour);
      typhoonsRef.current = branched;
      updateTyphoons(branched);
    }

    lastTimeRef.current = performance.now();
    lastPhysicsDispatchAtRef.current = 0;

    // Run physics immediately *after* a browser paint rather than inside the rAF callback itself.
    // The previous loop performed terrain/intensity work in the pre-paint phase, so even a 7-10 ms
    // step could consume most of a 60 Hz frame budget and create rhythmic movement judder.  The
    // rAF callback now yields to paint first, then queues the deterministic fixed-step work as a
    // normal task.  Physics cadence/results are unchanged; visual interpolation remains independent.
    const scheduleNextTick = () => {
      // The live centre/radii have their own 60-fps renderer, so the deterministic physics scheduler
      // does not need to wake on every display refresh while less than one 10-minute step is buffered.
      // Sleep most of the remaining wall-clock time, then re-enter through rAF so paint still wins.
      // This changes only scheduler wakeups: elapsed time is measured from performance.now() and every
      // physics integration still runs at the exact same fixed 10-minute step.
      const simMinutesPerMs = Math.max(1e-6, speed * 60 / 1000);
      const missingMinutes = Math.max(0, 10 - simMinutesBufferRef.current);
      const estimatedUntilStepMs = missingMinutes / simMinutesPerMs;
      // Keep the intentional sleep below the 100-ms delta clamp. rAF may add one display interval.
      const wakeDelayMs = estimatedUntilStepMs > 22 ? Math.min(68, Math.max(0, estimatedUntilStepMs - 18)) : 0;

      const requestPaintAlignedTick = () => {
        if(runGeneration!==physicsRunGenerationRef.current || !isPlayingRef.current)return;
        physicsWakeTimerRef.current = null;
        animationFrameIdRef.current = requestAnimationFrame((paintTime) => {
          animationFrameIdRef.current = null;
          if(runGeneration!==physicsRunGenerationRef.current || !isPlayingRef.current)return;
          const minDispatchMs = speed > 30 ? 8.5 : speed > 15 ? 10.5 : 12;
          if (lastPhysicsDispatchAtRef.current > 0 && paintTime - lastPhysicsDispatchAtRef.current < minDispatchMs) {
            scheduleNextTick();
            return;
          }
          lastPhysicsDispatchAtRef.current = paintTime;
          physicsTaskTimerRef.current = window.setTimeout(() => {
            physicsTaskTimerRef.current = null;
            if(runGeneration!==physicsRunGenerationRef.current || !isPlayingRef.current)return;
            tick(performance.now());
          }, 0);
        });
      };

      if (wakeDelayMs >= 4) {
        physicsWakeTimerRef.current = window.setTimeout(requestPaintAlignedTick, wakeDelayMs);
      } else {
        requestPaintAlignedTick();
      }
    };

    const tick = (now: number) => {
      if(runGeneration!==physicsRunGenerationRef.current || !isPlayingRef.current)return;
      if (typhoonsRef.current.length === 0 || typhoonsRef.current.every((t) => !t.active || t.dissipated)) {
        setIsPlaying(false);
        return;
      }

      const deltaMs = Math.min(100, now - lastTimeRef.current); // Clamp deltaMs to 100ms max to prevent stutter on tab switch
      lastTimeRef.current = now;

      // At 1x speed, 1 simulation hour = 1000ms.
      // Therefore, delta sim hours = (deltaMs / 1000) * speed.
      // delta sim minutes = delta sim hours * 60.
      const elapsedSimMins = (deltaMs / 1000.0) * speed * 60.0;
      simMinutesBufferRef.current += elapsedSimMins;

      // Keep enough backlog to honor high playback multipliers without allowing an unbounded
      // catch-up spiral. The old fixed 120-minute cap silently turned 30-60x playback into roughly
      // 20x whenever rendering/physics had one slow frame, which made travelled distance disagree
      // with the selected playback rate.
      const maxBufferedMinutes = Math.max(120, Math.min(720, speed * 12));
      if (simMinutesBufferRef.current > maxBufferedMinutes) {
        simMinutesBufferRef.current = maxBufferedMinutes;
      }

      // Loop to consume buffer in steps of 10 simulation minutes (our calculation step)
      let stateUpdated = false;
      let newTyphoons = [...typhoonsRef.current];
      let newLogs: EventLog[] = [];
      let stepsRun = 0;
      const frameWorkStartedAt = performance.now();
      // Use a frame-time budget instead of a tiny fixed step cap. Cheap devices simply process fewer
      // 10-minute physics steps in one frame, while faster devices can actually reach the requested
      // high playback rate. This preserves fixed-step physics and prevents long main-thread stalls.
      const maxStepsPerFrame = speed > 30 ? 32 : speed > 15 ? 24 : 14;
      const frameWorkBudgetMs = speed > 30 ? 8 : 7;
      const currentConfig = configRef.current;
      let frameConfig = currentConfig;
      if (currentConfig.speed !== speed) {
        const cached = physicsFrameConfigCacheRef.current;
        if (cached.base === currentConfig && cached.speed === speed && cached.value) {
          frameConfig = cached.value;
        } else {
          frameConfig = { ...currentConfig, speed };
          physicsFrameConfigCacheRef.current = { base: currentConfig, speed, value: frameConfig };
        }
      }

      while (isPlayingRef.current && runGeneration===physicsRunGenerationRef.current &&
        simMinutesBufferRef.current >= 10.0 && stepsRun < maxStepsPerFrame && (stepsRun === 0 || performance.now() - frameWorkStartedAt < frameWorkBudgetMs)) {
        try {
          simMinutesBufferRef.current -= 10.0;
          totalSimMinutesRef.current += 10.0;
          stepsRun++;

          const currentHourFloat = totalSimMinutesRef.current / 60.0;

          // Run calculation step
          const result = engineRef.current.stepSimulation(
            newTyphoons,
            frameConfig,
            currentHourFloat,
            startDate,
            { liveForecastMode: needsLiveForecastGeometry(layersRef.current) ? "preview" : "off" }
          );
          newTyphoons = result.updatedTyphoons;
          
          // Throttled logging for high speed simulation to prevent memory exhaustion & crash
          if (speed <= 15) {
            newLogs.push(...result.logs);
          } else {
            const criticalKeywords = ["登陆", "停编", "消散"];
            const criticalLogs = result.logs.filter(l => 
              criticalKeywords.some(k => l.message.includes(k)) && l.type === "danger"
            );
            newLogs.push(...criticalLogs);
          }
          stateUpdated = true;
        } catch (err) {
          console.error("Simulation step failed:", err);
          // 3.3.17: a numerical/runtime guard should never look like a mysterious play-button
          // failure. Surface one bounded diagnostic to the user while still stopping the loop
          // safely. This does not change simulation physics; it only makes future first-step
          // regressions immediately diagnosable on mobile where the console is usually hidden.
          const detail = err instanceof Error ? err.message : String(err);
          const simulationErrorLog: EventLog = {
            id: `simulation-error-${Date.now()}`,
            time: new Date(),
            simHour: totalSimMinutesRef.current / 60.0,
            type: "danger",
            message: `模拟计算异常，已安全暂停：${detail}`
          };
          setEventLogs((prev) => [...prev, simulationErrorLog].slice(-100));
          showToast(`模拟计算异常，已暂停：${detail}`, "danger");
          setIsPlaying(false);
          simMinutesBufferRef.current = 0;
          break;
        }
      }

      if (stateUpdated) {
        // Archive a naturally completed cyclone in-place. Keep its complete history, but drop
        // stale future forecast graphics and record an absolute season end time so the next
        // genesis can continue on the same season clock without mutating the finished storm.
        const archiveHour = totalSimMinutesRef.current / 60.0;
        newTyphoons = newTyphoons.map((ty) => {
          if (!ty.dissipated) return ty;
          const alreadyArchived = !ty.active && (ty.forecastPath?.length || 0) === 0 &&
            ty.timelineHidden !== true && ty.seasonEndHour !== undefined;
          if (alreadyArchived) return ty;
          return {
            ...ty,
            active: false,
            forecastPath: [],
            timelineHidden: false,
            seasonEndHour: ty.seasonEndHour ?? archiveHour
          };
        });
        // The physics state always advances in the ref. React/Leaflet only need a bounded visual
        // refresh rate; committing every physics batch made the entire map and status UI rerender
        // dozens of times per second at high playback speeds.
        typhoonsRef.current = newTyphoons;
        if (newLogs.length) pendingFrameLogsRef.current.push(...newLogs);

        const allDissipated = newTyphoons.length > 0 && newTyphoons.every((t) => !t.active || t.dissipated);
        // Keep physics fixed-step and centre interpolation on independent rAF, but limit expensive
        // React/Leaflet tree commits on slow frames. More frequent UI commits never add physical
        // accuracy: they only compete with the continuous marker animation for main-thread time.
        const physicsWorkMs = performance.now() - frameWorkStartedAt;
        const nominalUiIntervalMs = speed > 30 ? 205 : speed > 15 ? 160 : speed > 5 ? 115 : 92;
        const mobileCommitScale = useLegacyMobileUi ? (speed > 15 ? 1.38 : speed > 5 ? 1.32 : 1.22) : 1;
        const uiIntervalMs = nominalUiIntervalMs * mobileCommitScale * (physicsWorkMs > 9 ? 1.32 : 1);
        const shouldCommitUi = allDissipated || now - lastUiCommitTimeRef.current >= uiIntervalMs;

        if (shouldCommitUi) {
          lastUiCommitTimeRef.current = now;
          setTyphoons(newTyphoons);

          // Update timeline/UI from the same committed physics snapshot so center position, path
          // endpoint and displayed clock cannot visually refer to different simulation instants.
          const nextHour = Math.floor(totalSimMinutesRef.current / 60.0);
          maxHourRef.current = nextHour;
          currentHourRef.current = nextHour;
          setMaxHour(nextHour);
          setCurrentHour(nextHour);

          const committedLogs = pendingFrameLogsRef.current.splice(0);
          if (committedLogs.length > 0) {
            setEventLogs((prev) => {
              const combined = [...prev, ...committedLogs];
              return combined.slice(-100);
            });
          
            // Only show toasts and play sounds when playing at normal/moderate speed (<= 15x)
            if (speed <= 15) {
              committedLogs.slice(0, 1).forEach((log) => {
              showToast(log.message, log.type);

              if (log.message.includes("已登陆") || log.message.includes("登陆")) {
                playSndLand(currentConfig.soundVolume, currentConfig.soundEnabled);
              } else if (log.message.includes("爆发性增强")) {
                playSndRapid(currentConfig.soundVolume, currentConfig.soundEnabled);
              } else if (log.message.includes("眼墙置换")) {
                playSndEWRC(currentConfig.soundVolume, currentConfig.soundEnabled);
              } else if (log.message.includes("变性")) {
                playSndET(currentConfig.soundVolume, currentConfig.soundEnabled);
              } else if (log.message.includes("消散") || log.message.includes("停止编号")) {
                playSndDissipate(currentConfig.soundVolume, currentConfig.soundEnabled);
              } else if (log.message.includes("增强为") || log.message.includes("升级")) {
                playSndUpgrade(currentConfig.soundVolume, currentConfig.soundEnabled);
              }
              });
            }
          }
        }

        // Stop simulation if all typhoons have dissipated

        if (allDissipated) {
          setIsPlaying(false);
          const seasonMode = configRef.current.seasonModeEnabled !== false;
          showToast(seasonMode
            ? "本台风已结束。风季时钟已保留，电脑双击中键或触屏三连击可放置下一台风继续本风季。"
            : "台风已消散，模拟停止。", "info");
          if (!seasonMode) {
            setSummaryReportTyphoon(newTyphoons.find((t) => t.dissipated) || newTyphoons[0] || null);
            setShowReport(true);
          }
          return;
        }
      }

      if(isPlayingRef.current && runGeneration===physicsRunGenerationRef.current)scheduleNextTick();
    };

    scheduleNextTick();

    return () => {
      if(physicsRunGenerationRef.current===runGeneration)physicsRunGenerationRef.current++;
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      if (physicsTaskTimerRef.current !== null) {
        window.clearTimeout(physicsTaskTimerRef.current);
        physicsTaskTimerRef.current = null;
      }
      if (physicsWakeTimerRef.current !== null) {
        window.clearTimeout(physicsWakeTimerRef.current);
        physicsWakeTimerRef.current = null;
      }
    };
  }, [isPlaying, speed, useLegacyMobileUi]);

  // Seeker Jump-To-Time tracking. Preview restores are paint-coalesced by the timeline controls.
  // Mark map-heavy preview state as a React transition as well: the range thumb stays urgent while
  // superseded Leaflet/history renders can be abandoned in favour of the newest requested hour.
  const [timelineSeekPreview, setTimelineSeekPreview] = useState(false);
  const lastPreviewSeekHourRef = useRef<number | null>(null);
  const handleSeek = (hour: number, mode: "preview" | "commit" = "commit") => {
    const normalizedHour = Math.round(hour);
    if (normalizedHour > maxHourRef.current || normalizedHour < 0) return;
    if (mode === "preview" && lastPreviewSeekHourRef.current === normalizedHour) return;
    if (mode === "preview") lastPreviewSeekHourRef.current = normalizedHour;
    else lastPreviewSeekHourRef.current = null;
    setTimelineSeekPreview(mode === "preview");

    const archivedCirculationIssue = mode === "commit"
      ? (() => {
          const exactStates = typhoonsRef.current
            .map((ty) => findHistoryStateAtHour(ty.history, normalizedHour))
            .filter((state) => !!state?.configSnapshot);
          return exactStates.find((state) => state && !state.dissipated) ?? exactStates[0];
        })()
      : undefined;

    currentHourRef.current = normalizedHour;
    setIsPlaying(false);
    totalSimMinutesRef.current = normalizedHour * 60;
    simMinutesBufferRef.current = 0;

    // A committed timeline seek establishes a possible branch origin. Restore the circulation-size
    // schedule that actually existed at that archived hour before the user can press Play or edit
    // a new target. Otherwise a later branch's 72 h target leaks backward and reappears on the new
    // branch at its old future issue time.
    if (mode === "commit" && archivedCirculationIssue?.configSnapshot) {
      const restoredConfig = restoreCirculationSizeConfigFromSnapshot(configRef.current, archivedCirculationIssue.configSnapshot);
      configRef.current = restoredConfig;
      setConfig(restoredConfig);
    }

    const restoreSeekSnapshot = () => {
      setCurrentHour(normalizedHour);
      updateTyphoons((prev) => {
      const restored = prev.map((ty) => {
        const hState = findHistoryStateAtHour(ty.history, normalizedHour);
        if (!hState) {
          const first = ty.history[0];
          const last = ty.history[ty.history.length - 1];
          if (first && normalizedHour < first.simHour) {
            return { ...ty, active: false, timelineHidden: true };
          }
          if (last && normalizedHour > last.simHour) {
            return { ...ty, ...last, id: ty.id, name: ty.name, officialNumber: ty.officialNumber, seasonOrdinal: ty.seasonOrdinal, history: ty.history, active: false, dissipated: true, timelineHidden: false };
          }
          return { ...ty, active: false, timelineHidden: false };
        }
        return {
          ...ty,
          // Explicitly restore intervention/counter state before the full snapshot spread.
          forcedEWRC: hState.forcedEWRC,
          forcedDryAir: hState.forcedDryAir,
          forcedShear: hState.forcedShear,
          forcedRapidIntensification: hState.forcedRapidIntensification,
          manualForcedDecay: hState.manualForcedDecay,
          forcedDecayStartVmax: hState.forcedDecayStartVmax,
          forcedDecayTargetVmax: hState.forcedDecayTargetVmax,
          forcedDecayElapsedHours: hState.forcedDecayElapsedHours,
          forcedDecayDuration: hState.forcedDecayDuration,
          forcedDecayIsContinuous: hState.forcedDecayIsContinuous,
          dryAirPenaltyHours: hState.dryAirPenaltyHours,
          dryAirPenaltyTotalHours: hState.dryAirPenaltyTotalHours,
          shearPenaltyHours: hState.shearPenaltyHours,
          shearPenaltyTotalHours: hState.shearPenaltyTotalHours,
          ewrcFailurePenaltyHours: hState.ewrcFailurePenaltyHours,
          ewrcPenaltyTotalHours: hState.ewrcPenaltyTotalHours,
          cloggedRecoveryHours: hState.cloggedRecoveryHours,
          cloggedRecoveryTotalHours: hState.cloggedRecoveryTotalHours,
          isEyeClogged: hState.isEyeClogged || false,
          isStructureDamaged: hState.isStructureDamaged || false,
          upwellingHours: hState.upwellingHours || 0,
          consecutiveUpwellingHours: hState.consecutiveUpwellingHours || 0,
          upwellingPersistentPenaltyHours: hState.upwellingPersistentPenaltyHours || 0,
          structuralDamageHours: hState.structuralDamageHours || 0,
          tdHours: hState.tdHours || 0,
          landTdHours: hState.landTdHours || 0,
          superTyLandHours: hState.superTyLandHours || 0,
          landHours: hState.landHours || 0,
          landContactHours: hState.landContactHours || 0,
          r10LandContactHours: hState.r10LandContactHours || 0,
          vmax6Hours: hState.vmax6Hours || 0,
          etHours: hState.etHours || 0,
          warmWaterHoursAfterSea: hState.warmWaterHoursAfterSea || 0,
          ewrcCooldownHours: hState.ewrcCooldownHours || 0,
          ewrcCount: hState.ewrcCount || 0,
          ewrcState: hState.ewrcState || "none",
          ewrcProgress: hState.ewrcProgress || 0,
          ewrcIsFailure: hState.ewrcIsFailure || false,
          ...hState,
          // Preserve the complete history array as a stable reference. Replacing it with any
          // snapshot-local value would force needless track reconstruction and break future seeks.
          history: ty.history,
          timelineHidden: false,
          active: !hState.dissipated,
          // Identity is live metadata, not historical meteorological state. Never let an archived
          // snapshot restore an obsolete user-edited name/number during timeline scrubbing.
          id: ty.id,
          name: ty.name,
          officialNumber: ty.officialNumber,
          seasonOrdinal: ty.seasonOrdinal
        };
      });
      // Keep the cyclone that actually exists at the selected season hour in slot zero so all
      // legacy single-primary panels/controls operate on the correct historical state.
      restored.sort((a, b) => Number(!!b.active) - Number(!!a.active) ||
        (Number(b.seasonStartHour ?? b.history?.[0]?.simHour ?? 0) - Number(a.seasonStartHour ?? a.history?.[0]?.simHour ?? 0)));
        return restored;
      });
    };
    if (mode === "preview") startTransition(restoreSeekSnapshot);
    else restoreSeekSnapshot();

    if (mode === "commit") {
      if (normalizedHour === maxHourRef.current && maxHourRef.current > 0) {
        const allDissipated = typhoonsRef.current.every((ty) => {
          const hState = findHistoryStateAtHour(ty.history, normalizedHour);
          return hState ? hState.dissipated : true;
        });
        if (allDissipated && typhoonsRef.current.length > 0 && configRef.current.seasonModeEnabled === false) {
          setSummaryReportTyphoon(typhoonsRef.current[0]);
          setShowReport(true);
        }
      }
      playSndClick(configRef.current.soundVolume, configRef.current.soundEnabled, configRef.current.soundMode || "mouse");
      showToast(`时光穿梭：切换到模拟第 ${normalizedHour} 小时`, "info");
    }
  };

  const handleSelectTrackPoint = (hour: number) => {
    if (hour <= maxHour && hour >= 0) {
      handleSeek(hour);
      setIsPlaying(false);
    }
  };

  // Manual step forward
  // Manual step forward to next time point (either existing track point or simulates next hour)
  const handleStepForward = () => {
    // Collect all history hours across all typhoons
    const historyHours: number[] = typhoons.flatMap((ty) => (ty.history || []).map((h) => Number(h.simHour)));
    const uniqueSortedHours: number[] = Array.from(new Set<number>(historyHours)).sort((a, b) => a - b);
    
    // Find the first hour that is strictly greater than currentHour
    const nextHour = uniqueSortedHours.find((h) => h > currentHour);
    
    if (nextHour !== undefined) {
      handleSeek(nextHour);
      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
    } else {
      let baseTyphoons = [...typhoons];
      if (currentHour < maxHour) {
         engineRef.current.syncPrngToHour(currentHour);
         // Truncate history manually because we stepped from past
         baseTyphoons = typhoons.map((ty) => {
           const restoredState = ty.history.find((h) => h.simHour === currentHour);
           return {
             ...ty,
             forcedEWRC: restoredState?.forcedEWRC,
             forcedDryAir: restoredState?.forcedDryAir,
             forcedShear: restoredState?.forcedShear,
             forcedRapidIntensification: restoredState?.forcedRapidIntensification,
             manualForcedDecay: restoredState?.manualForcedDecay,
             forcedDecayStartVmax: restoredState?.forcedDecayStartVmax,
             forcedDecayTargetVmax: restoredState?.forcedDecayTargetVmax,
             forcedDecayElapsedHours: restoredState?.forcedDecayElapsedHours,
             forcedDecayDuration: restoredState?.forcedDecayDuration,
             forcedDecayIsContinuous: restoredState?.forcedDecayIsContinuous,
             dryAirPenaltyHours: restoredState?.dryAirPenaltyHours,
             dryAirPenaltyTotalHours: restoredState?.dryAirPenaltyTotalHours,
             shearPenaltyHours: restoredState?.shearPenaltyHours,
             shearPenaltyTotalHours: restoredState?.shearPenaltyTotalHours,
             ewrcFailurePenaltyHours: restoredState?.ewrcFailurePenaltyHours,
             ewrcPenaltyTotalHours: restoredState?.ewrcPenaltyTotalHours,
             cloggedRecoveryHours: restoredState?.cloggedRecoveryHours,
             cloggedRecoveryTotalHours: restoredState?.cloggedRecoveryTotalHours,
             isEyeClogged: restoredState?.isEyeClogged || false,
             isStructureDamaged: restoredState?.isStructureDamaged || false,
             upwellingHours: restoredState?.upwellingHours || 0,
             consecutiveUpwellingHours: restoredState?.consecutiveUpwellingHours || 0,
             upwellingPersistentPenaltyHours: restoredState?.upwellingPersistentPenaltyHours || 0,
             structuralDamageHours: restoredState?.structuralDamageHours || 0,
             tdHours: restoredState?.tdHours || 0,
             landTdHours: restoredState?.landTdHours || 0,
             superTyLandHours: restoredState?.superTyLandHours || 0,
             landHours: restoredState?.landHours || 0,
             landContactHours: restoredState?.landContactHours || 0,
             r10LandContactHours: restoredState?.r10LandContactHours || 0,
             vmax6Hours: restoredState?.vmax6Hours || 0,
             etHours: restoredState?.etHours || 0,
             warmWaterHoursAfterSea: restoredState?.warmWaterHoursAfterSea || 0,
             ewrcCooldownHours: restoredState?.ewrcCooldownHours || 0,
             ewrcCount: restoredState?.ewrcCount || 0,
             ewrcState: restoredState?.ewrcState || "none",
             ewrcProgress: restoredState?.ewrcProgress || 0,
             ewrcIsFailure: restoredState?.ewrcIsFailure || false,
             ...(restoredState ? restoredState : {}),
             active: restoredState ? !restoredState.dissipated : ty.active,
             history: ty.history.filter((h) => h.simHour <= currentHour)
           };
         }).filter((ty) => ty.history.length > 0 && (ty.seasonStartHour ?? ty.history[0]?.simHour ?? 0) <= currentHour);
         updateTyphoons(baseTyphoons);
      }
      const targetHour = currentHour + 1;
      let currentTyphoons = baseTyphoons;
      let accumulatedLogs: EventLog[] = [];

      // Advance 1 full simulation hour by running 6 sub-steps of 10 simulation minutes (matching live loop)
      for (let step = 1; step <= 6; step++) {
        const stepHour = currentHour + (step / 6.0);
        const result = engineRef.current.stepSimulation(
          currentTyphoons, config, stepHour, startDate,
          { liveForecastMode: needsLiveForecastGeometry(layersRef.current) ? "preview" : "off" }
        );
        currentTyphoons = result.updatedTyphoons;
        if (result.logs.length > 0) {
          accumulatedLogs.push(...result.logs);
        }
      }

      updateTyphoons(currentTyphoons);
      setMaxHour(targetHour);
      setCurrentHour(targetHour);
      totalSimMinutesRef.current = targetHour * 60;
      simMinutesBufferRef.current = 0;

      if (accumulatedLogs.length > 0) {
        setEventLogs((prev) => [...prev, ...accumulatedLogs]);
        accumulatedLogs.forEach((l) => showToast(l.message, l.type));
      }

      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
    }
  };

  // Manual step backward to previous existing time point
  const handleStepBackward = () => {
    // Collect all history hours across all typhoons
    const historyHours: number[] = typhoons.flatMap((ty) => (ty.history || []).map((h) => Number(h.simHour)));
    historyHours.push(0);
    const uniqueSortedHours: number[] = Array.from(new Set<number>(historyHours)).sort((a, b) => b - a);
    
    // Find the first hour that is strictly less than currentHour
    const prevHour = uniqueSortedHours.find((h) => h < currentHour);
    
    if (prevHour !== undefined) {
      handleSeek(prevHour);
    } else {
      if (currentHour > 0) {
        handleSeek(Math.max(0, Math.floor(currentHour - 1)));
      }
    }
    playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
  };

  // Keyboard ←/→ inspect EXISTING snapshots only. The right arrow at the latest observation
  // must not silently run a new physics hour; the dedicated forward button retains that action.
  const seekAdjacentRecordedPoint = (direction: -1 | 1) => {
    const at = currentHourRef.current;
    const hours: number[] = Array.from(new Set<number>(typhoonsRef.current.flatMap(ty =>
      (ty.history || []).map(h => Number(h.simHour))))).filter((h: number) =>
      Number.isFinite(h) && h >= 0 && h <= maxHourRef.current + 1e-5);
    const candidate = direction < 0
      ? hours.filter(h => h < at - 1e-5).sort((a, b) => b - a)[0]
      : hours.filter(h => h > at + 1e-5).sort((a, b) => a - b)[0];
    if (candidate !== undefined) handleSeek(candidate);
  };

  // Joystick steer adjustments callback. Before the first simulation step the joystick is
  // intentionally live while paused: users can pre-position it, inspect the desired heading,
  // and then press Play. Starting the simulation no longer waits for another joystick gesture.
  const joystickUiCommitAtRef = useRef(0);
  const handleJoystickChange = useCallback((dx: number, dy: number, dragging?: boolean) => {
    if (configRef.current.controlMode === "draw") return;
    const nextConfig: SimulationConfig = {
      ...configRef.current,
      joystickDx: dx,
      joystickDy: dy,
      joystickDragging: dragging !== undefined ? dragging : configRef.current.joystickDragging
    };
    // Physics consumes configRef synchronously, so steering remains lossless. React only needs a
    // slower visual commit while a pointer is moving; otherwise every touch sample rerenders App,
    // MapView and the settings tree and can steal frame time from Leaflet on phones.
    configRef.current = nextConfig;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const mustCommit = dragging === false || dragging === undefined || now - joystickUiCommitAtRef.current >= 84;
    if (mustCommit) {
      joystickUiCommitAtRef.current = now;
      setConfig(nextConfig);
    }
  }, []);

  // Map click deployment handler. Triple-click genesis follows the season lifecycle:
  // an active cyclone is never replaced implicitly, while a completed cyclone remains
  // archived and the next cyclone is spawned at the retained absolute season hour.
  const createTyphoonAtSeasonHour = (lat: number, lon: number, continueSeason: boolean, initialVmax = 15) => {
    // A new storm must never inherit the preceding storm's steering polyline or stale forecast.
    const activeConfig: SimulationConfig = configRef.current.controlMode === "draw"
      ? { ...configRef.current, drawnTrackRoute: [], manualForecastRouteEnabled: false, manualForecastRoute: [], manualForecastIntensityEnabled: false, manualForecastIntensityCurve: [] }
      : configRef.current;
    setSeasonEnded(false);
    const startIndex = activeConfig.typhoonNamingStartIndex ?? 0;
    const cursor = activeConfig.typhoonNamingCursor ?? startIndex;
    const namingEntry = getTyphoonNamingEntry(cursor, activeConfig.typhoonNamingOverrides);
    const spawnHour = continueSeason ? maxHourRef.current : 0;
    const seasonOrdinal = continueSeason ? typhoonsRef.current.length + 1 : 1;
    const id = `season-${seasonOrdinal}-${Date.now()}`;
    const nextTyphoon = engineRef.current.createDefaultTyphoon(id, namingEntry.chinese, lat, lon, activeConfig, initialVmax);
    nextTyphoon.seasonOrdinal = seasonOrdinal;
    nextTyphoon.seasonStartHour = spawnHour;
    nextTyphoon.drawnRouteProgressKm = 0;
    nextTyphoon.officialNumber = `${getTyphoonYearCode(nextTyphoon, startDate)}${String(Math.max(1, Math.min(99, seasonOrdinal))).padStart(2, "0")}`;
    nextTyphoon.seasonEndHour = undefined;
    nextTyphoon.timelineHidden = false;
    nextTyphoon.simHour = spawnHour;
    nextTyphoon.history = (nextTyphoon.history || []).map((h) => ({
      ...h,
      simHour: spawnHour + Number(h.simHour || 0),
      configSnapshot: snapshotConfigForHistory(activeConfig)
    }));
    if (!nextTyphoon.history.length) {
      nextTyphoon.history = [{ ...(nextTyphoon as any), simHour: spawnHour, configSnapshot: snapshotConfigForHistory(activeConfig) } as any];
    }
    nextTyphoon.forecastPath = buildLiveForecastIfNeeded(nextTyphoon, activeConfig, 120);

    const nextConfig: SimulationConfig = {
      ...activeConfig,
      typhoonNamingCursor: (cursor + 1) % TYPHOON_NAMING_TABLE.length
    };
    configRef.current = nextConfig;
    setConfig(nextConfig);
    if (activeConfig.controlMode === "draw") {
      setIsPlaying(false);
      setDrawnTrackDraft([{ lat, lon }]);
      setDrawRoutePhase("drawing");
      setIsForecastRouteDrawing(false);
      setForecastRouteDraft([]);
    } else {
      setDrawRoutePhase("off");
      setDrawnTrackDraft([]);
    }

    simMinutesBufferRef.current = 0;
    totalSimMinutesRef.current = spawnHour * 60;
    engineRef.current.syncPrngToHour(spawnHour);
    const historical = continueSeason
      ? typhoonsRef.current.map((t) => ({
          ...t,
          active: false,
          timelineHidden: false,
          forecastPath: [],
          seasonEndHour: t.seasonEndHour ?? t.history[t.history.length - 1]?.simHour ?? t.simHour
        }))
      : [];
    const nextList = [nextTyphoon, ...historical];
    typhoonsRef.current = nextList;
    setTyphoons(nextList);
    setCurrentHour(spawnHour);
    currentHourRef.current = spawnHour;
    setMaxHour(spawnHour);
    maxHourRef.current = spawnHour;
    setIsPlaying(false);
    setGenesisPos({ lat, lon });
    setPlacementMode("none");
    setEventLogs((prev) => {
      const entry: EventLog = {
        id: `season-genesis-${Date.now()}`,
        time: new Date(),
        simHour: spawnHour,
        type: "success",
        message: `🌱 ${continueSeason ? `风季第 ${seasonOrdinal} 个台风` : "新风季"}：${nextTyphoon.officialNumber}【${namingEntry.chinese}】在 (${lat.toFixed(1)}°N, ${lon.toFixed(1)}°E) 生成，初始强度 ${initialVmax} m/s，风季时钟 ${spawnHour}h。`
      };
      return continueSeason ? [...prev, entry].slice(-200) : [entry];
    });
    playSndSpawn(activeConfig.soundVolume, activeConfig.soundEnabled);
    showToast(`${continueSeason ? "继续风季：" : "已生成："}${nextTyphoon.officialNumber} ${namingEntry.chinese} · ${initialVmax} m/s`, "success");
  };

  // Triple-click genesis now follows a season lifecycle. A completed cyclone stays immutable in
  // the season archive and a new cyclone starts at the same absolute season hour. Explicit Reset
  // is the only action that clears the season clock/archive.
  const applyCirculationSizeTarget = (rawTarget: number) => {
    const target = Math.max(0, Math.round(rawTarget));
    const duration = Math.max(0, Number(configRef.current.circulationSizeTransitionHours ?? 0));
    // Use the exact fixed-step clock instead of the integer timeline cursor. At high playback
    // speeds the React clock can lag physics by part of an hour; using it as the transition epoch
    // made short transitions appear to start early and damaged branch reproducibility.
    const nowHour = Number.isFinite(totalSimMinutesRef.current)
      ? totalSimMinutesRef.current / 60
      : currentHourRef.current;
    const effectiveNow = resolveCirculationSizeTransition(configRef.current, nowHour).referenceKm;
    if (duration <= 1e-6 && Math.abs(target - effectiveNow) > 1e-6) {
      const pending = pendingCirculationSizeOriginRef.current;
      pendingCirculationSizeOriginRef.current = {
        fromKm: pending ? pending.fromKm : effectiveNow,
        targetKm: target,
        atHour: pending ? pending.atHour : nowHour,
        // Preserve the exact pre-edit live wind circles. Slider `onChange` can fire many times
        // before the user selects 24/48/72 h; keeping only `fromKm` forced us to approximately
        // reverse all those immediate rescalings later and could leave the storm already close to
        // the target when Play was pressed. The first edit now owns an exact rollback snapshot.
        radiiById: pending ? pending.radiiById : Object.fromEntries(
          typhoonsRef.current
            .filter((ty) => ty.active && !ty.dissipated)
            .map((ty) => [ty.id, {
              r7: { ...ty.r7 },
              r10: { ...ty.r10 },
              r12: { ...ty.r12 }
            }])
        )
      };
    } else if (duration > 1e-6) {
      pendingCirculationSizeOriginRef.current = null;
    }
    applyConfigPatch({
      circulationSizeReferenceKm: target,
      circulationSizeTransitionFromKm: duration > 0 ? effectiveNow : target,
      circulationSizeTransitionTargetKm: target,
      circulationSizeTransitionStartHour: nowHour,
      circulationSizeTransitionHours: duration
    });
  };

  const applyCirculationTransitionDuration = (rawDuration: number) => {
    const duration = Math.max(0, Number(rawDuration) || 0);
    const nowHour = Number.isFinite(totalSimMinutesRef.current)
      ? totalSimMinutesRef.current / 60
      : currentHourRef.current;
    const liveConfig = configRef.current;
    const target = Math.max(0, Number(liveConfig.circulationSizeReferenceKm ?? 320));
    const effectiveNow = resolveCirculationSizeTransition(liveConfig, nowHour).referenceKm;
    const pending = pendingCirculationSizeOriginRef.current;

    if (duration > 1e-6) {
      // Common UI sequence: edit size first, then choose "72 h". The old implementation had
      // already resized the live circles before the duration was selected. Restore their pre-edit
      // size once, then schedule from that origin on the exact simulation clock.
      const canReusePendingOrigin = !!pending && Math.abs(pending.targetKm - target) < 1e-6 &&
        Number(liveConfig.circulationSizeTransitionHours ?? 0) <= 1e-6;
      const from = canReusePendingOrigin ? pending!.fromKm : effectiveNow;
      if (canReusePendingOrigin && Math.abs(from - target) > 1e-6) {
        const fromConfig = { ...liveConfig, circulationSizeReferenceKm: from } as SimulationConfig;
        const sameSimulationInstant = Math.abs(nowHour - pending!.atHour) <= 1e-6;
        // Restore synchronously before scheduling the transition. `updateTyphoons(fn)` normally
        // updates the ref inside React's queued state callback; if the user selected 72 h and then
        // immediately pressed Play, the first physics step could still read the already-resized
        // target circles. Writing typhoonsRef now removes that race entirely.
        const restoredTyphoons = typhoonsRef.current.map((ty) => {
          if (!ty.active || ty.dissipated) return ty;
          const archived = sameSimulationInstant ? pending!.radiiById[ty.id] : undefined;
          if (archived) {
            return {
              ...ty,
              r7: { ...archived.r7 },
              r10: { ...archived.r10 },
              r12: { ...archived.r12 }
            };
          }
          return reweightLiveWindRadiiForPreference(ty, liveConfig, fromConfig);
        });
        typhoonsRef.current = restoredTyphoons;
        setTyphoons(restoredTyphoons);
      }
      pendingCirculationSizeOriginRef.current = null;
      applyConfigPatch({
        circulationSizeReferenceKm: target,
        circulationSizeTransitionFromKm: from,
        circulationSizeTransitionTargetKm: target,
        circulationSizeTransitionStartHour: nowHour,
        circulationSizeTransitionHours: duration
      });
      return;
    }

    // Switching back to "immediate" consumes only the remaining part of an active transition.
    // Reweight from its exact current effective size to the target once, without a discontinuous
    // second jump caused by stale transition metadata.
    if (Math.abs(effectiveNow - target) > 1e-6) {
      const effectiveConfig = { ...liveConfig, circulationSizeReferenceKm: effectiveNow } as SimulationConfig;
      const targetConfig = { ...liveConfig, circulationSizeReferenceKm: target } as SimulationConfig;
      updateTyphoons((prev) => prev.map((ty) => ty.active && !ty.dissipated
        ? reweightLiveWindRadiiForPreference(ty, effectiveConfig, targetConfig)
        : ty));
    }
    pendingCirculationSizeOriginRef.current = null;
    applyConfigPatch({
      circulationSizeReferenceKm: target,
      circulationSizeTransitionFromKm: target,
      circulationSizeTransitionTargetKm: target,
      circulationSizeTransitionStartHour: nowHour,
      circulationSizeTransitionHours: 0
    });
  };

  const applyForecastPeakReference = (rawValue: number, enabled = true) => {
    const value = Math.max(5, Math.min(110, Math.round(rawValue * 10) / 10));
    const nextConfig: SimulationConfig = {
      ...configRef.current,
      forecastPeakIntensityEnabled: enabled,
      forecastPeakIntensityReference: value
    };
    configRef.current = nextConfig;
    setConfig(nextConfig);
    updateTyphoons((prev) => prev.map((ty, idx) => {
      if (idx !== 0 || !ty.active || ty.dissipated) return ty;
      const issueHour = currentHourRef.current;
      const issueConfig = snapshotConfigForHistory(nextConfig);
      const history = Math.abs(issueHour - maxHourRef.current) < 1e-6
        ? ty.history.map((h) => Math.abs(h.simHour - issueHour) < 1e-6
          ? { ...h, configSnapshot: issueConfig }
          : h)
        : ty.history;
      // Forecast-peak edits do not change geometry. Keep the stored path untouched and save only
      // the issue configuration; intensity will be reconstructed when a product is generated.
      return { ...ty, configSnapshot: issueConfig, history };
    }));
  };

  const previewForecastPeakSlider = (rawValue: number) => {
    const value = Math.max(5, Math.min(110, Math.round(rawValue)));
    forecastPeakSliderDraftRef.current = value;
    setForecastPeakSliderDraft(value);
  };
  const commitForecastPeakSlider = () => {
    const value = forecastPeakSliderDraftRef.current;
    if (value == null) return;
    forecastPeakSliderDraftRef.current = null;
    setForecastPeakSliderDraft(null);
    applyForecastPeakReference(value, true);
  };
  const cancelForecastPeakSlider = () => {
    forecastPeakSliderDraftRef.current = null;
    setForecastPeakSliderDraft(null);
  };

  const applyManualTargetIntensity = (rawValue: string): string | void => {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 5) {
      return "请输入不低于 5 m/s 的有效数值；游乐场模式不设置手动输入上限。";
    }
    const target = Math.round(value * 10) / 10;
    const nextConfig: SimulationConfig = {
      ...configRef.current,
      maxIntensityLimitEnabled: true,
      maxIntensityLimit: target,
    };
    configRef.current = nextConfig;
    setConfig(nextConfig);
    updateTyphoons((prev) => prev.map((ty, idx) => {
      if (idx !== 0 || !ty.active || ty.dissipated) return ty;
      const issueHour = currentHourRef.current;
      const issueConfig = snapshotConfigForHistory(nextConfig);
      const history = Math.abs(issueHour - maxHourRef.current) < 1e-6
        ? ty.history.map((h) => Math.abs(h.simHour - issueHour) < 1e-6
          ? { ...h, configSnapshot: issueConfig }
          : h)
        : ty.history;
      // Target-intensity edits do not change geometry. Keep the stored path untouched and save only
      // the issue configuration; intensity will be reconstructed when a product is generated.
      return { ...ty, configSnapshot: issueConfig, history };
    }));
    showToast(`${configRef.current.autoAdjustIntensity ? "目标巅峰强度" : "目标强度"}已应用：${target} m/s`, "success");
  };

  const handleMapClickPlacement = (lat: number, lon: number, initialVmax = 15) => {
    if (placementMode === "home") {
      applyConfigPatch({ localAdvisoryLat: lat, localAdvisoryLon: lon, localAdvisoryLabel: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°` });
      setPlacementMode("none");
      showToast(`所在地已设为 ${lat.toFixed(2)}°, ${lon.toFixed(2)}°，左侧公告将使用该位置。`, "success");
      return;
    }
    const activeTyphoon = typhoonsRef.current.find((t) => t.active && !t.dissipated);
    const seasonMode = configRef.current.seasonModeEnabled !== false;

    if ((placementMode === "none" || placementMode === "genesis") && activeTyphoon) {
      if (placementMode === "genesis") {
        setPlacementMode("none");
        showToast("当前台风仍在编。请先使用时间轴终止键停编，再生成本风季下一台风。", "warning");
      } else {
        showToast("当前台风仍在编，三连击不会删除现有路径。需要改中心请使用“部署主台风”工具。", "warning");
      }
      return;
    }

    if (placementMode === "none" || placementMode === "genesis" || typhoonsRef.current.length === 0) {
      const canContinueSeason = seasonMode && typhoonsRef.current.length > 0 && !activeTyphoon;
      if (!canContinueSeason && typhoonsRef.current.length > 0 && !seasonMode) {
        // Legacy single-storm mode intentionally starts a fresh simulation, but only because the
        // user explicitly disabled season mode.
        typhoonsRef.current = [];
      }
      createTyphoonAtSeasonHour(lat, lon, canContinueSeason, initialVmax);
      return;
    }

    if (placementMode === "main") {
      setTyphoons((prev) => {
        const copy = [...prev];
        const main = copy.find((t) => t.active && !t.dissipated) || copy[0];
        if (main) {
          main.lat = lat;
          main.lon = lon;
          main.forecastPath = buildLiveForecastIfNeeded(main, configRef.current, 120);
          // Repositioning is an explicit editing action, but previous observations are retained.
          // Add a new current-time state instead of deleting the accumulated track.
          const last = main.history[main.history.length - 1];
          if (!last || Math.abs(last.simHour - currentHourRef.current) > 1e-6 || Math.hypot(last.lat - lat, last.lon - lon) > 0.001) {
            main.history = [...main.history, { ...makeHourlyHistorySeed(main), simHour: currentHourRef.current } as any];
          }
        }
        typhoonsRef.current = copy;
        return copy;
      });
      setPlacementMode("none");
      showToast(`主台风中心已部署于北纬 ${lat.toFixed(2)}°, 东经 ${lon.toFixed(2)}°；既有路径未删除。`, "success");
      playSndClick(configRef.current.soundVolume, configRef.current.soundEnabled, configRef.current.soundMode || "mouse");
    }
  };

  // Desktop shortcut: middle mouse button directly repositions the active cyclone, or
  // creates the next cyclone when no active system exists. Manual dry-air / shear placement
  // tools were removed in Round 66; environmental dry air and wind shear remain model physics.
  const handleMiddleClickPlacement = (lat: number, lon: number) => {
    if (placementMode === "home") { handleMapClickPlacement(lat, lon); return; }
    const active = typhoonsRef.current.find((t) => t.active && !t.dissipated);
    if (!active) {
      const continueSeason = configRef.current.seasonModeEnabled !== false && typhoonsRef.current.length > 0;
      createTyphoonAtSeasonHour(lat, lon, continueSeason);
      return;
    }
    updateTyphoons((prev) => prev.map((ty) => {
      if (ty.id !== active.id) return ty;
      const moved = { ...ty, lat, lon };
      moved.forecastPath = buildLiveForecastIfNeeded(moved, configRef.current, 120);
      // Explicit relocation is an edit of the current live state; archived best-track points stay
      // immutable so hovering/scrubbing still reports what really occurred before relocation.
      return moved;
    }));
    setGenesisPos({ lat, lon });
    setPlacementMode("none");
    showToast(`已用鼠标中键双击将主台风中心放置到 ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E。`, "info");
  };

  const startDrawnTrack = () => {
    const selectedHour = currentHourRef.current;
    const rewound = selectedHour < maxHourRef.current - 1e-5;
    const ty = typhoonsRef.current.find(t => rewound
      ? t.history.some(h => Math.abs(h.simHour - selectedHour) < 1e-5 && !h.dissipated)
      : t.active && !t.dissipated);
    if (!ty) return;
    setIsPlaying(false);
    setIsForecastRouteDrawing(false);
    setPlacementMode("none");
    const route = configRef.current.drawnTrackRoute || [];
    const archivedCenter = rewound ? getDrawnBranchCenter([ty], selectedHour) : null;
    if (rewound && !archivedCenter) {
      showToast("此时间点缺少可恢复的台风中心，请先选择一个历史模拟点。", "warning");
      return;
    }
    // A route may only be extended when the cyclone actually reached its endpoint. Otherwise
    // its cursor would traverse an obsolete future leg before reaching any newly drawn points.
    const currentCenter = archivedCenter ?? { lat: ty.lat, lon: ty.lon };
    const continueAtEndpoint = route.length >= 2 &&
      (rewound || drawnRouteDistanceKm(currentCenter, route[route.length - 1]) < 6);
    continuingDrawnTrackRef.current = continueAtEndpoint;
    setDrawnTrackDraft(continueAtEndpoint ? route.map(point => ({ ...point })) : [currentCenter]);
    setDrawRoutePhase("drawing");
    showToast(rewound ? (continueAtEndpoint ? "历史分支保留原画点路线及进度；继续绘制只会追加节点，清空后才能重画。" : "历史中心已恢复：从此处重新画点。")
      : continueAtEndpoint ? "从已有路径末端继续添加节点；中键平移地图。"
      : "从当前台风中心重新画点；左键添加节点，中键拖动地图。", "info");
  };

  const clearDrawnTrack = () => {
    const rewound = currentHourRef.current < maxHourRef.current - 1e-5;
    const ty = typhoonsRef.current.find(t => rewound
      ? t.history.some(h => Math.abs(h.simHour - currentHourRef.current) < 1e-5 && !h.dissipated)
      : t.active && !t.dissipated);
    if (!ty) return;
    setIsPlaying(false);
    continuingDrawnTrackRef.current = false;
    const origin = rewound ? getDrawnBranchCenter([ty], currentHourRef.current) : { lat: ty.lat, lon: ty.lon };
    if (!origin) { showToast("选定时间没有可用台风中心，无法重画。", "warning"); return; }
    const next: SimulationConfig = { ...configRef.current, drawnTrackRoute: [], manualForecastRouteEnabled: false, manualForecastRoute: [], manualForecastIntensityEnabled: false, manualForecastIntensityCurve: [] };
    configRef.current = next;
    setConfig(next);
    if (!rewound) updateTyphoons(prev => prev.map(t => t.id === ty.id ? { ...t, drawnRouteProgressKm: 0,
      forecastPath: buildLiveForecastIfNeeded(t, next, 120) } : t));
    // A scrub preview must not mutate the future live storm before the new route is confirmed.
    setDrawnTrackDraft([{ ...origin }]);
    setDrawRoutePhase("off");
    showToast("已清空画点路径并暂停模拟；点击「继续画点」从当前中心重新绘制。", "info");
  };

  const addDrawnTrackPoint = (lat: number, lon: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    // Match the engine's physical domain; accepting unreachable points would silently clamp the storm.
    if (lat < 0 || lat > 55 || lon < 95 || lon > 180) {
      showToast("实时路径仅支持北纬 0–55°、东经 95–180° 的模拟范围。", "warning");
      return;
    }
    setDrawnTrackDraft(prev => {
      const last = prev[prev.length - 1];
      if (last && Math.hypot((lat - last.lat) * 111.12,
        (lon - last.lon) * 111.12 * Math.max(.15, Math.cos(lat * Math.PI / 180))) < 4) return prev;
      return prev.length >= 160 ? prev : [...prev, { lat, lon }];
    });
  };

  const confirmDrawnTrack = () => {
    if (drawnTrackDraft.length < 2) { showToast("请至少绘制一个方向节点。", "warning"); return; }
    const branchHour = currentHourRef.current;
    const rewound = branchHour < maxHourRef.current - 1e-5;
    const currentStorm = typhoonsRef.current.find(ty => rewound
      ? ty.history.some(h => Math.abs(h.simHour - branchHour) < 1e-5 && !h.dissipated)
      : ty.active && !ty.dissipated);
    const archivedCenter = rewound && currentStorm ? getDrawnBranchCenter([currentStorm], branchHour) : null;
    if (rewound && !archivedCenter) {
      showToast("当前历史点没有可恢复的台风中心，未修改原路径。", "warning");
      return;
    }
    // Never trust a future route's first node or progress after a seek. The selected historical
    // storm position is the authoritative branch origin, including during rapid scrub+confirm.
    const route = drawnTrackDraft.map(p => ({ ...p }));
    if (archivedCenter && !continuingDrawnTrackRef.current) route[0] = archivedCenter;
    const next: SimulationConfig = { ...configRef.current, drawnTrackRoute: route };
    configRef.current = next;
    setConfig(next);
    if (rewound) {
      const preserved = continuingDrawnTrackRef.current && route.length >= 2
        ? branchWithExistingDrawnRoute(typhoonsRef.current, branchHour, next) : null;
      const branched = preserved?.storms ?? branchWithDrawnRoute(typhoonsRef.current, branchHour, route, next);
      if (preserved) { configRef.current = preserved.config; setConfig(preserved.config); }
      engineRef.current.syncPrngToHour(branchHour);
      maxHourRef.current = branchHour;
      setMaxHour(branchHour);
      totalSimMinutesRef.current = branchHour * 60;
      simMinutesBufferRef.current = 0;
      pendingFrameLogsRef.current = [];
      setEventLogs(prev => prev.filter(log => log.simHour <= branchHour + 1e-5));
      updateTyphoons(branched);
      continuingDrawnTrackRef.current = false;
    } else {
      const updated = typhoonsRef.current.map(ty => !ty.active || ty.dissipated ? ty : ({
        ...ty, drawnRouteProgressKm: continuingDrawnTrackRef.current ? (ty.drawnRouteProgressKm ?? 0) : 0,
        // The *current* hour is an editable branch origin even after many prior observations.
        // Never overwrite earlier history, only the latest matching current-hour snapshot.
        history: ty.history.map(h => Math.abs(h.simHour - branchHour) < 1e-5
          ? { ...h, drawnRouteProgressKm: continuingDrawnTrackRef.current ? (ty.drawnRouteProgressKm ?? 0) : 0,
            configSnapshot: snapshotConfigForHistory(next) } : h)
      }));
      updateTyphoons(updated);
    }
    setDrawRoutePhase("sync");
  };

  const completeDrawnTrack = (syncForecast: boolean) => {
    const route = configRef.current.drawnTrackRoute || [];
    const next: SimulationConfig = { ...configRef.current,
      manualForecastRouteEnabled: syncForecast && route.length >= 2,
      manualForecastRoute: syncForecast ? route.map(p => ({ ...p })) : [],
      manualForecastIntensityEnabled: false,
      manualForecastIntensityCurve: [],
      manualForecastRouteWeight: syncForecast ? .985 : configRef.current.manualForecastRouteWeight
    };
    configRef.current = next;
    setConfig(next);
    updateTyphoons(prev => prev.map(ty => {
      if (!ty.active || ty.dissipated) return ty;
      const routeSource=syncForecast ? revokePreSimulationFromHour(ty,currentHourRef.current) : ty;
      const forecastPath=buildLiveForecastIfNeeded(routeSource,next,120);
      return {
        ...routeSource,forecastPath,
        history:routeSource.history.map(h=>Math.abs(h.simHour-currentHourRef.current)<1e-5
          ? {...h,forecastPath,configSnapshot:snapshotConfigForHistory(next)}:h)
      };
    }));
    setDrawRoutePhase("off");
    setDrawnTrackDraft([]);
    continuingDrawnTrackRef.current = false;
    showToast(syncForecast ? "实时画点路径已启用，并同步到大体预报路径。" : "实时画点路径已启用，预报路径独立计算。", "success");
  };

  const startForecastRouteDrawing = () => {
    const mainTy = typhoonsRef.current[0];
    if (!mainTy) return;
    setPlacementMode("none");
    setForecastRouteDraft([{ lat: mainTy.lat, lon: mainTy.lon }]);
    setIsForecastRouteDrawing(true);
    showToast("路径框架绘制已开始：点击地图放置关键点，完成后保存。", "info");
  };

  const beginForecastPreSimulation = () => {
    const hour=currentHourRef.current;
    const ty=typhoonsRef.current.find(t => t.history.some(h => Math.abs(h.simHour-hour)<1e-5 && !h.dissipated))
      || typhoonsRef.current.find(t=>t.active&&!t.dissipated);
    if(!ty){showToast("当前时刻没有可预模拟的台风中心。","warning");return;}
    const hist=ty.history.find(h=>Math.abs(h.simHour-hour)<1e-5);
    if(hour<maxHourRef.current-1e-5 && !hist){
      showToast("当前回放时间没有精确历史状态，请先选择记录点。","warning");return;
    }
    // Clone the timeline ONCE. Cloning a whole storm (including thousands of
    // snapshots) and then cloning the very same history again caused a large
    // blocking main-thread allocation before the Worker could even start.
    const branch=structuredClone(ty);
    const initial:Typhoon={...branch,...(hist?structuredClone(hist):{}),
      id:ty.id,name:ty.name,active:!(hist?.dissipated??ty.dissipated),
      simHour:hour,history:branch.history.filter(h=>h.simHour<=hour+1e-5),forecastPath:[]};
    const liveMap=synopticMapRef.current;
    if(liveMap){
      const center=liveMap.getCenter();
      liveCameraBeforeForecastRef.current={center:[center.lat,center.lng],zoom:liveMap.getZoom()};
    }
    // This branch owns an independent engine and cannot advance the parent simulation.
    // Close ALL live-only overlays before opening the sandbox portal. Otherwise a
    // previously viewed drawer/product/modal can remain above the restored map.
    setIsPlaying(false);
    setDrawerOpen(false);
    setForecastModalOpen(false);
    setIsInfluenceModalOpen(false);
    setPlacementMode("none");
    setIsForecastRouteDrawing(false);
    const branchConfig=hist?.configSnapshot && hour<maxHourRef.current-1e-5
      ? snapshotConfigForHistory({...DEFAULT_CONFIG,...hist.configSnapshot})
      : snapshotConfigForHistory(configRef.current);
    setPreSimulationInput({initial,issueHour:hour,seed:branchConfig.seed || "AETHER",
      randomState:Math.abs(hour-maxHourRef.current)<1e-5
        ? engineRef.current.capturePrngState() : NaN,
      config:branchConfig});
  };

  /** Reenter the live map without leaving a hidden sandbox/modal in its interaction stack. */
  const leaveForecastPreSimulation = () => {
    setPreSimulationInput(null);
    setIsForecastRouteDrawing(false);
    setForecastRouteDraft([]);
    setDrawerOpen(false);
    setDrawerOpenTab(null);
    setForecastModalOpen(false);
    setIsInfluenceModalOpen(false);
    setPlacementMode("none");
    setIsPlaying(false);
    // Leaflet was covered by another full-screen map; resize after the portal
    // unmounts so touch/drag ownership and viewport calculations are refreshed.
    requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))));
  };

  const confirmForecastPreSimulation = (reference:PreSimulationReference, copyToMain?:{
    storm:Typhoon;config:SimulationConfig;prngState:number;endHour:number
  }) => {
    const issue=reference.issueHour;
    // Commit to the synchronous ref first. Calling setState(updater) alone allows
    // an immediate map/product generation to read the *old* ref until React flushes.
    const existing=typhoonsRef.current;
    let installed=false;
    const updated=existing.map(ty=>{
      if(ty.id!==reference.stormId)return ty;
      const index=ty.history.findIndex(h=>Math.abs(h.simHour-issue)<1e-5);
      if(index<0)return ty;
      installed=true;
      const history=ty.history.map((h,i)=>i===index
        ? {...h,preSimulationReference:reference,preSimulationReferenceCleared:false,forecastPath:[]}
        : h);
      // Keep the reference on the LIVE object as well as the issue-hour archive:
      // later 10-minute integration steps spread this field into their snapshots.
      if(copyToMain){
        // Replace only the sandboxed storm's issue-and-future history. Keep all
        // earlier observations and other storms. Preserve the reference on its
        // archived issue node so historical forecast products can retrieve it.
        const branch=copyToMain.storm;
        if(branch.id!==ty.id || copyToMain.endHour<issue+1-1e-5)return {...ty,history,preSimulationReference:reference,forecastPath:[]};
        const mergedHistory=[...history.filter(h=>h.simHour<issue-1e-5),
          ...branch.history.filter(h=>h.simHour>=issue-1e-5).map(h=>
            Math.abs(h.simHour-issue)<1e-5
              ? {...h,preSimulationReference:reference,preSimulationReferenceCleared:false,forecastPath:[]}
              : h)];
        return {...branch,history:mergedHistory,preSimulationReference:reference,forecastPath:[]};
      }
      const next={...ty,history,preSimulationReference:reference,forecastPath:[]};
      const atIssue=Math.abs(currentHourRef.current-issue)<1e-5;
      return atIssue?{...next,forecastPath:buildLiveForecastIfNeeded(next,configRef.current,120)}:next;
    });
    if(!installed){showToast('未找到预模拟起报记录，预报未应用。','danger');return;}
    updateTyphoons(updated);
    if(copyToMain){
      // Worker checkpoint is captured only AFTER pause has acknowledged the last
      // completed 10-minute physics step. Reuse it to make Play deterministic.
      const end=Math.max(issue,copyToMain.endHour);
      const branchCfg={...configRef.current,...copyToMain.config,
        // The sandbox intentionally starts with forecast drawing disabled;
        // copying its physics must not erase the user's saved forecast controls.
        speed:configRef.current.speed,
        manualForecastRouteEnabled:configRef.current.manualForecastRouteEnabled,
        manualForecastRoute:configRef.current.manualForecastRoute,
        manualForecastIntensityEnabled:configRef.current.manualForecastIntensityEnabled,
        manualForecastIntensityCurve:configRef.current.manualForecastIntensityCurve};
      configRef.current=branchCfg;setConfig(branchCfg);
      engineRef.current.restorePrngState(copyToMain.prngState);
      totalSimMinutesRef.current=end*60;
      // Live presentation/timeline uses whole-hour cursors; the integrator
      // retains the complete ten-minute remainder for seamless continuation.
      const displayedHour=Math.floor(end+1e-6);
      currentHourRef.current=displayedHour;maxHourRef.current=displayedHour;
      setCurrentHour(displayedHour);setMaxHour(displayedHour);
      simMinutesBufferRef.current=0;
      isPlayingRef.current=false;setIsPlaying(false);
    }
    leaveForecastPreSimulation();
    showToast(copyToMain
      ? `已将完整预模拟结果复制到主模拟（+${copyToMain.endHour.toFixed(0)}h），并同步应用预报参考。`
      : `已应用 +${issue.toFixed(0)}h 预模拟参考（有效预演 ${reference.completedLeadHour}h），主模拟未变。`,"success");
  };


  /** Round179: copy the completed main history, not merely a tail selected by
   * the playback cursor. Every historical issue can then replay its own next
   * 120 hours without a new speculative solver or stale geometry override. */
  const applyCurrentSimulationToForecast = () => {
    const storm=typhoonsRef.current.find(t=>t.history.length>=2);
    if(!storm){showToast('至少先正常模拟一个完整小时。','warning');return;}
    try{
      const transferred=copyMainHistoryToForecast(storm);
      updateTyphoons(typhoonsRef.current.map(ty=>ty.id===storm.id?transferred:ty));
      const from=transferred.history[0].simHour;
      const to=transferred.history[transferred.history.length-1].simHour;
      const atHistoryEnd=currentHourRef.current>=to-1e-5;
      showToast(`已将主模拟 +${from.toFixed(0)}h～+${to.toFixed(0)}h 的完整实际路径与强度应用到预报。${atHistoryEnd?'请回拨时间轴选择历史起报时刻：末端之后尚未运行的未来仍需正常预测。':''}`,'success');
    }catch(e){showToast(e instanceof Error?e.message:String(e),'warning');}
  };

  /** Cancellable atomic history rewrite: no half-written geometry or station diagnostics. */
  const openRealisticMotion = () => {
    const storm=typhoonsRef.current[0];
    if (!storm || storm.history.length<7){showToast('至少需要 6 小时的台风历史。','warning');return;}
    setIsPlaying(false); setRealisticStrength('mid');setRealisticProgress(0);setRealisticDialogMode('apply');
  };
  const openUndoRealisticMotion = () => {
    if(!typhoonsRef.current[0]?.realisticMotion){showToast('当前没有可撤销的真实化记录。','info');return;}
    setIsPlaying(false);setRealisticProgress(0);setRealisticDialogMode('undo');
  };
  const cancelRealisticMotion = () => {
    if(realisticBusy){realisticAbortRef.current?.abort();return;}
    setRealisticDialogMode(null);
  };
  const confirmRealisticMotion = async () => {
    if(realisticBusy||realisticAbortRef.current||!realisticDialogMode)return;
    const ty=typhoonsRef.current[0];if(!ty)return;
    setIsPlaying(false);
    const controller=new AbortController();realisticAbortRef.current=controller;
    setRealisticBusy(true);setRealisticProgress(0);
    const originalMode=realisticDialogMode;
    try{
      const progress=(p:{completed:number;total:number})=>setRealisticProgress(Math.round(p.completed/p.total*100));
      let next:Typhoon;
      let displacement=0;
      if(originalMode==='undo'){
        next=await undoRealisticParameters(ty,configRef.current,progress,controller.signal);
      }else{
        const serial=Math.max(++realisticApplicationCountRef.current,(ty.historyRevision||0)+1);
        realisticApplicationCountRef.current=serial;
        const seed=`${configRef.current.seed}:${ty.id}:REALISTIC-MOTION:${serial}`;
        const result=await prepareRealisticParameters(ty,configRef.current,realisticStrength,seed,
          progress,controller.signal,(lat,lon)=>getLandMetrics(lat,lon,configRef.current.coastlineSource,true).isLand);
        next=result.typhoon;displacement=result.maximumOffsetKm;
      }
      if(controller.signal.aborted)throw Error('用户取消');
      if(!typhoonsRef.current.some(t=>t.id===ty.id&&t.history===ty.history))
        throw Error('计算期间历史已更新，已放弃本次应用。');
      updateTyphoons(typhoonsRef.current.map(t=>t.id===ty.id?next:t));
      const nextConfig={...configRef.current,realisticMotionEnabled:false};
      configRef.current=nextConfig;setConfig(nextConfig);
      setForecastModalOpen(false);setRealisticDialogMode(null);
      showToast(originalMode==='undo'?'已恢复原历史参数、路径和站点诊断。':
        `参数已转为 3 小时折线节点，风圈保持原值；路径最大偏移约 ${displacement.toFixed(1)} km。`,'success');
    }catch(e){
      const detail=e instanceof Error?e.message:String(e);
      if(controller.signal.aborted){showToast('计算已取消，历史没有修改。','info');setRealisticDialogMode(null);}
      else showToast(`参数真实化未应用：${detail}`,'warning');
    }finally{
      if(realisticAbortRef.current===controller)realisticAbortRef.current=null;
      setRealisticBusy(false);
    }
  };

  const addForecastRoutePoint = (lat: number, lon: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    setForecastRouteDraft((prev) => {
      // Do not de-duplicate nearby forecast-framework taps. Repeated/very close waypoints are an
      // explicit tempo signal: they let the user draw a slowdown or a true near-stall at one place.
      // The route-tempo solver requires a *run* of close points before applying a strong slowdown,
      // so an occasional imprecise phone tap still stays almost neutral.
      if (prev.length >= 220) return prev;
      return [...prev, { lat, lon }];
    });
  };

  const cancelForecastRouteDrawing = () => {
    setIsForecastRouteDrawing(false);
    setForecastRouteDraft([]);
    showToast("已取消本次路径框架绘制，原框架保持不变。", "info");
  };

  const undoForecastRoutePoint = () => {
    setForecastRouteDraft((prev) => prev.length > 1 ? prev.slice(0, -1) : prev);
  };

  /** Persist an issue-time tombstone. Historical forecasts before this hour remain intact. */
  const revokePreSimulationFromHour = (ty: Typhoon, hour: number): Typhoon => {
    const index=ty.history.findIndex(h=>Math.abs(h.simHour-hour)<1e-5);
    if(index<0)return ty;
    const history=ty.history.map((h,i)=>i===index
      ? {...h,preSimulationReference:undefined,preSimulationReferenceCleared:true,forecastPath:[]}
      : h);
    return {...ty,history,preSimulationReference:undefined,forecastPath:[]};
  };

  const clearPreSimulationReference = () => {
    const hour=currentHourRef.current;
    const target=typhoonsRef.current[0];
    if(!target || !issuePreSimulationReference(target,hour)){
      showToast('当前时刻没有正在生效的预模拟参考。','info');return;
    }
    if(!target.history.some(h=>Math.abs(h.simHour-hour)<1e-5)){
      showToast('当前时刻没有精确历史记录，请先定位历史整点。','warning');return;
    }
    updateTyphoons(prev=>prev.map(t=>t.id===target.id?revokePreSimulationFromHour(t,hour):t));
    showToast('已从当前时刻清除预模拟参考；此前历史预报仍可回放。','success');
  };

  const finishForecastRouteDrawing = () => {
    if (forecastRouteDraft.length < 2) {
      showToast("至少需要 1 个方向关键点（起点会自动使用当前台风中心）。", "warning");
      return;
    }
    const route = forecastRouteDraft.map((p) => ({ ...p }));
    const nextConfig: SimulationConfig = {
      ...configRef.current,
      manualForecastRouteEnabled: true,
      manualForecastRoute: route,
      // A drawn forecast route changes geometry only. Never carry an obsolete
      // manual intensity curve from an earlier edit into a new forecast.
      manualForecastIntensityEnabled: false,
      manualForecastIntensityCurve: [],
      // Large-scale hand-drawn forecast frameworks should meaningfully steer the deterministic
      // reference path. Ensemble spread is generated later from independent model/member modes,
      // so increasing this reference-path weight does not collapse the ensemble fan.
      manualForecastRouteWeight: Math.max(0.97, configRef.current.manualForecastRouteWeight ?? 0)
    };
    setConfig(nextConfig);
    configRef.current = nextConfig;
    updateTyphoons((prev) => prev.map((ty, idx) => {
      if (idx !== 0 || !ty.active || ty.dissipated) return ty;
      const revoked=revokePreSimulationFromHour(ty,currentHourRef.current);
      const forecastPath = buildLiveForecastIfNeeded(revoked, nextConfig, 120);
      // Existing simulation-time snapshots are immutable records of what was actually shown at
      // that time.  Only the untouched initial state may be updated in place; once simulation has
      // progressed, the new framework is persisted by the next newly-created history snapshot.
      const history=revoked.history.map(h=>Math.abs(h.simHour-currentHourRef.current)<1e-5
        ? {...h,forecastPath,configSnapshot:snapshotConfigForHistory(nextConfig)}:h);
      return { ...revoked, forecastPath, history };
    }));
    setIsForecastRouteDrawing(false);
    setForecastRouteDraft([]);
    showToast(`预报路径总框架已保存并立即应用（${route.length} 个关键点）。`, "success");
  };

  const clearForecastRoute = () => {
    const nextConfig: SimulationConfig = {
      ...configRef.current,
      manualForecastRoute: [],
      manualForecastRouteEnabled: false,
      manualForecastIntensityEnabled: false,
      manualForecastIntensityCurve: []
    };
    setConfig(nextConfig);
    configRef.current = nextConfig;
    setIsForecastRouteDrawing(false);
    setForecastRouteDraft([]);
    updateTyphoons((prev) => prev.map((ty, idx) => {
      if (idx !== 0 || !ty.active || ty.dissipated) return ty;
      const forecastPath = buildLiveForecastIfNeeded(ty, nextConfig, 120);
      // Clearing the live framework must not rewrite any already-simulated forecast snapshot.
      const history = maxHour <= 0
        ? ty.history.map((h) => h.simHour === 0 ? { ...h, forecastPath, configSnapshot: snapshotConfigForHistory(nextConfig) } : h)
        : ty.history;
      return { ...ty, forecastPath, history };
    }));
    showToast("已清除预报路径总框架，预报恢复为纯环境场计算。", "info");
  };

  const handlePlayToggle = () => {
    if (synopticSelectingRef.current || preSimulationActiveRef.current) return;
    // Use the synchronous ref, not an event-handler capture of React state.
    const nextPlaying = !isPlayingRef.current;
    if (nextPlaying && configRef.current.controlMode === "draw" &&
      ((configRef.current.drawnTrackRoute?.length || 0) < 2 || drawRoutePhase !== "off")) {
      startDrawnTrack();
      showToast("请先画好并确认实时台风路径。", "info");
      return;
    }
    // Commit the toggle synchronously. Old queued physics is invalidated before
    // React updates the UI, eliminating a brief window where sound says paused
    // yet an already queued integration task still advances the storm.
    isPlayingRef.current=nextPlaying;
    if(!nextPlaying){
      physicsRunGenerationRef.current++;
      simMinutesBufferRef.current=0;
      if(animationFrameIdRef.current!==null){cancelAnimationFrame(animationFrameIdRef.current);animationFrameIdRef.current=null;}
      if(physicsWakeTimerRef.current!==null){clearTimeout(physicsWakeTimerRef.current);physicsWakeTimerRef.current=null;}
      if(physicsTaskTimerRef.current!==null){clearTimeout(physicsTaskTimerRef.current);physicsTaskTimerRef.current=null;}
    }

    // A brand-new storm can be aimed before Play. If the paused joystick is off-centre,
    // seed the retained manual velocity from that preset so the first physics step follows
    // the chosen heading. A centred joystick still starts on the environmental steering flow.
    const isFirstLaunch = nextPlaying && currentHour <= 1e-6 && maxHour <= 1e-6 &&
      typhoonsRef.current.some((ty) => ty.active && !ty.dissipated);
    if (isFirstLaunch && configRef.current.controlMode !== "draw") {
      const dx = Math.max(-1, Math.min(1, Number(configRef.current.joystickDx) || 0));
      const dy = Math.max(-1, Math.min(1, Number(configRef.current.joystickDy) || 0));
      if (Math.hypot(dx, dy) >= 0.02) {
        const speedMultiplier = configRef.current.joystickStrength * configRef.current.joystickSensitivity * 4.5;
        const seedU = dx * speedMultiplier;
        const seedV = dy * speedMultiplier;
        updateTyphoons((prev) => prev.map((ty) => {
          if (!ty.active || ty.dissipated || ty.simHour > 1e-6) return ty;
          const history = (ty.history || []).map((h) => Math.abs(Number(h.simHour)) <= 1e-6
            ? { ...h, isManualSteering: true, lastVelocityU: seedU, lastVelocityV: seedV }
            : h);
          return { ...ty, isManualSteering: true, lastVelocityU: seedU, lastVelocityV: seedV, history };
        }));
        showToast("已按预设摇杆方向开始模拟。", "success");
      }
    }

    if (!nextPlaying) {
      // Clear only the active drag on pause.  In hold mode the displayed joystick coordinates
      // remain at the last release position; auto-return mode intentionally centres them.
      const shouldCenterJoystick = !!configRef.current.joystickReturnToCenter;
      const nextConfig = {
        ...configRef.current,
        joystickDx: shouldCenterJoystick ? 0 : configRef.current.joystickDx,
        joystickDy: shouldCenterJoystick ? 0 : configRef.current.joystickDy,
        joystickDragging: false
      };
      setConfig(nextConfig);
      configRef.current = nextConfig;
    }
    if (nextPlaying && currentHour < maxHour) {
      updateTyphoons((prev) =>
        prev.map((ty) => {
          const restoredState = ty.history.find((h) => h.simHour === currentHour);
          return {
            ...ty,
            forcedEWRC: restoredState?.forcedEWRC,
            forcedDryAir: restoredState?.forcedDryAir,
            forcedShear: restoredState?.forcedShear,
            forcedRapidIntensification: restoredState?.forcedRapidIntensification,
            dryAirPenaltyHours: restoredState?.dryAirPenaltyHours,
            dryAirPenaltyTotalHours: restoredState?.dryAirPenaltyTotalHours,
            shearPenaltyHours: restoredState?.shearPenaltyHours,
            shearPenaltyTotalHours: restoredState?.shearPenaltyTotalHours,
            ewrcFailurePenaltyHours: restoredState?.ewrcFailurePenaltyHours,
            ewrcPenaltyTotalHours: restoredState?.ewrcPenaltyTotalHours,
            cloggedRecoveryHours: restoredState?.cloggedRecoveryHours,
            cloggedRecoveryTotalHours: restoredState?.cloggedRecoveryTotalHours,
            ...(restoredState ? restoredState : {}),
            active: restoredState ? !restoredState.dissipated : ty.active,
            history: ty.history.filter((h) => h.simHour <= currentHour)
          };
        })
      );
      setMaxHour(currentHour);
      totalSimMinutesRef.current = currentHour * 60;
      simMinutesBufferRef.current = 0;
      engineRef.current.syncPrngToHour(currentHour);
    }
    setIsPlaying(nextPlaying);
    playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
  };

  const applyConfigPatch = (patch: Partial<SimulationConfig>) => {
    const safePatch = { ...(patch as any) };
    delete safePatch.uiStyle;
    // Removed 4.1.2 experimental environment switches are intentionally non-addressable in 4.1.4.
    delete safePatch.newEnvironmentPanelsEnabled;
    delete safePatch.newEnvironmentPhysicsEnabled;

    const enablingJoystickReturn =
      safePatch.joystickReturnToCenter === true && !configRef.current.joystickReturnToCenter;
    // Switching from “hold” to “return” is itself a centred-control command.  Zero the persisted
    // joystick coordinates immediately instead of letting the old held coordinates survive until
    // the spring animation finishes.  The live cyclone state is also zeroed below, so the status
    // card does not display the pre-switch translation speed for another integration frame.
    if (enablingJoystickReturn) {
      safePatch.joystickDx = 0;
      safePatch.joystickDy = 0;
      safePatch.joystickDragging = false;
    }

    if (safePatch.controlMode === "draw" && configRef.current.controlMode !== "draw") {
      safePatch.joystickDx = 0; safePatch.joystickDy = 0; safePatch.joystickDragging = false;
      if (typhoonsRef.current.some(t => t.active && !t.dissipated) && (configRef.current.drawnTrackRoute?.length || 0) < 2) {
        startDrawnTrack();
      }
    } else if (safePatch.controlMode === "joystick") {
      setDrawRoutePhase("off");
      setDrawnTrackDraft([]);
    }
    const previousConfig = configRef.current;
    const nextConfig = { ...previousConfig, ...safePatch, newEnvironmentPanelsEnabled: false, newEnvironmentPhysicsEnabled: false } as SimulationConfig;
    delete (nextConfig as any).uiStyle;
    setConfig(nextConfig);
    configRef.current = nextConfig;

    // Forecast intensity is materialized later from archived issue state. If the user changes an
    // intensity-control switch exactly on the current archived hour, persist that setting into the
    // same issue snapshot now; otherwise a later historical product could accidentally read the
    // pre-change target/forecast-peak configuration. Past snapshots remain immutable.
    const historyIssueControlKeys = [
      "maxIntensityLimitEnabled", "maxIntensityLimit", "autoAdjustIntensity",
      "forecastPeakIntensityEnabled", "forecastPeakIntensityReference",
      // Circulation-size transitions are timeline physics, not merely UI preferences. Persist the
      // request into the issue-hour snapshot so rewinding to this exact hour can faithfully branch
      // from the newly scheduled 3/6/12/.../72 h transition.
      "circulationSizeReferenceKm", "circulationSizeTransitionHours",
      "circulationSizeTransitionStartHour", "circulationSizeTransitionFromKm",
      "circulationSizeTransitionTargetKm"
    ];
    if (Math.abs(currentHourRef.current - maxHourRef.current) < 1e-6 &&
        historyIssueControlKeys.some((key) => Object.prototype.hasOwnProperty.call(safePatch, key))) {
      const issueHour = currentHourRef.current;
      const issueConfig = snapshotConfigForHistory(nextConfig);
      updateTyphoons((prev) => prev.map((ty) => !ty.active || ty.dissipated ? ty : ({
        ...ty,
        configSnapshot: issueConfig,
        history: ty.history.map((h) => Math.abs(h.simHour - issueHour) < 1e-6
          ? { ...h, configSnapshot: issueConfig }
          : h)
      })));
    }

    if (Object.prototype.hasOwnProperty.call(safePatch, "circulationSizeReferenceKm") &&
        Number(nextConfig.circulationSizeReferenceKm) !== Number(previousConfig.circulationSizeReferenceKm)) {
      const scheduledTransition = Number(nextConfig.circulationSizeTransitionHours ?? 0) > 1e-6 &&
        Object.prototype.hasOwnProperty.call(safePatch, "circulationSizeTransitionTargetKm");
      if (!scheduledTransition) {
        updateTyphoons(previous => previous.map(ty => ty.active && !ty.dissipated
          ? reweightLiveWindRadiiForPreference(ty, previousConfig, nextConfig) : ty));
      }
    }

    if (enablingJoystickReturn) {
      updateTyphoons((prev) => prev.map((ty) => {
        if (!ty.active || ty.dissipated || !ty.isManualSteering) return ty;
        return {
          ...ty,
          lastVelocityU: 0,
          lastVelocityV: 0,
          speed: 0
        };
      }));
    }

    if (Object.prototype.hasOwnProperty.call(patch, "manualForecastRouteEnabled")) {
      updateTyphoons((prev) => prev.map((ty, idx) => {
        if (idx !== 0 || !ty.active || ty.dissipated) return ty;
        const forecastPath = buildLiveForecastIfNeeded(ty, nextConfig, 120);
        const history = maxHour <= 0
          ? ty.history.map((h) => h.simHour === 0 ? { ...h, forecastPath, configSnapshot: snapshotConfigForHistory(nextConfig) } : h)
          : ty.history;
        return { ...ty, forecastPath, history };
      }));
    }
  };

  useEffect(() => {
    document.documentElement.classList.add("theme-default");
    document.documentElement.style.colorScheme = "dark";
    document.title = "AETHER · Typhoon Simulation System";
  }, []);

  const finishAetherLaunch = useCallback(() => {
    setLaunchFinished(true);
  }, []);

  const acceptAetherTerms = () => {
    try {
      localStorage.setItem(AETHER_TERMS_STORAGE_KEY, "1");
    } catch {
      // Keep the current-session acceptance even when persistent storage is unavailable.
    }
    setTermsAccepted(true);
  };

  // Keep the one installed desktop-input loop pointed at the newest React actions.
  desktopActionsRef.current = {
    togglePlay: handlePlayToggle,
    stepForward: handleStepForward,
    stepBackward: handleStepBackward,
    seekNextPoint: () => seekAdjacentRecordedPoint(1),
    seekPreviousPoint: () => seekAdjacentRecordedPoint(-1),
    seekHourDelta: (delta: number) => {
      // Only recorded history is seekable. Never synthesize a future observation from an arrow.
      const limit = maxHourRef.current;
      const target = Math.max(0, Math.min(limit, Math.round(currentHourRef.current + delta)));
      if (Math.abs(target - currentHourRef.current) < 1e-5) return;
      setIsPlaying(false);
      handleSeek(target, "commit");
    },
    applyInfluence: (type, option) => handleApplyInfluence(type, option),
    openProducts: () => { if (typhoonsRef.current.length) setForecastModalOpen(true); },
    openSettings: () => { setDrawerOpenTab(null); setDrawerOpen(true); },
    openInfluence: () => { setIsPlaying(false); setIsInfluenceModalOpen(true); setActiveInfluenceCategory("main"); },
    toggleTimeline: () => setTimelineCollapsed((v) => !v),
    joystick: handleJoystickChange
  };

  // During wind-field framing, desktop keyboard/gamepad dispatchers must be
  // inert even if their listeners remain mounted. Only map pan and zoom are live.
  if (synopticSelecting || !!preSimulationInput) {
    desktopActionsRef.current = {
      togglePlay: () => {}, stepForward: () => {}, stepBackward: () => {},
      seekNextPoint: () => {}, seekPreviousPoint: () => {}, seekHourDelta: () => {},
      applyInfluence: () => {}, openProducts: () => {}, openSettings: () => {},
      openInfluence: () => {}, toggleTimeline: () => {}, joystick: () => {}
    };
  }

  // Keep keyboard shortcuts from reaching any other workstation control.
  useEffect(() => {
    if (!synopticSelecting) return;
    const block = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (event.key === "Escape") exitSynopticSelection(false);
    };
    window.addEventListener("keydown", block, true);
    window.addEventListener("keyup", block, true);
    return () => {
      window.removeEventListener("keydown", block, true);
      window.removeEventListener("keyup", block, true);
    };
  }, [synopticSelecting]);

  // PC + standard Gamepad API controls. ←/→ seek ±1 simulated hour, while ↑/↓
  // retain their joystick/draw-speed behavior and the analogue gamepad stick remains unchanged.
  useEffect(() => {
    const held = new Set<string>();
    const updateKeyboardJoystick = () => {
      const dy = (held.has("ArrowUp") ? 1 : 0) - (held.has("ArrowDown") ? 1 : 0);
      desktopActionsRef.current.joystick(0, dy, dy !== 0);
    };
    const editable = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
    };
    const onDown = (e: KeyboardEvent) => {
      if (editable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const influenceShortcuts: Record<string, ["ewrc" | "dry_air" | "shear" | "rapid_intensify", string]> = {
        Digit1: ["dry_air", "core"], Digit2: ["dry_air", "periphery"],
        Digit3: ["shear", "35.0"], Digit4: ["shear", "22.0"],
        Digit5: ["ewrc", "auto"], Digit6: ["ewrc", "success"], Digit7: ["ewrc", "failure"],
        Digit8: ["rapid_intensify", "ri"], Digit9: ["rapid_intensify", "eri"], Digit0: ["rapid_intensify", "uri"]
      };
      if (e.shiftKey && influenceShortcuts[e.code]) {
        e.preventDefault();
        if (!e.repeat) desktopActionsRef.current.applyInfluence(...influenceShortcuts[e.code]);
        return;
      }
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        if (!e.repeat) {
          if (e.code === "ArrowLeft") desktopActionsRef.current.seekHourDelta(-1);
          else desktopActionsRef.current.seekHourDelta(1);
        }
        return;
      }
      if (e.code === "ArrowUp" || e.code === "ArrowDown") { held.add(e.code); updateKeyboardJoystick(); return; }
      if (e.repeat) return;
      if (e.code === "Space") desktopActionsRef.current.togglePlay();
      else if (e.code === "BracketRight") desktopActionsRef.current.stepForward();
      else if (e.code === "BracketLeft") desktopActionsRef.current.stepBackward();
      else if (e.code === "KeyP") desktopActionsRef.current.openProducts();
      else if (e.code === "KeyO") desktopActionsRef.current.openInfluence();
      else if (e.code === "KeyG") desktopActionsRef.current.openSettings();
      else if (e.code === "KeyT") desktopActionsRef.current.toggleTimeline();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "ArrowUp" && e.code !== "ArrowDown") return;
      held.delete(e.code);
      updateKeyboardJoystick();
    };
    window.addEventListener("keydown", onDown, { passive: false });
    window.addEventListener("keyup", onUp, { passive: false });

    let raf = 0;
    let lastStickX = 0, lastStickY = 0;
    const buttonState = new Map<number, boolean>();
    const pressedEdge = (pad: Gamepad, index: number) => {
      const now = !!pad.buttons[index]?.pressed;
      const prev = buttonState.get(index) || false;
      buttonState.set(index, now);
      return now && !prev;
    };
    const poll = () => {
      const pad = Array.from(navigator.getGamepads?.() || []).find(Boolean) as Gamepad | undefined;
      if (pad) {
        const deadzone = 0.12;
        let x = Math.abs(pad.axes[0] || 0) >= deadzone ? (pad.axes[0] || 0) : 0;
        let y = Math.abs(pad.axes[1] || 0) >= deadzone ? -(pad.axes[1] || 0) : 0;
        const mag = Math.hypot(x, y);
        if (mag > 1) { x /= mag; y /= mag; }
        // D-pad works as a digital fallback when a controller exposes no useful axes.
        if (!x && !y) {
          x = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
          y = (pad.buttons[12]?.pressed ? 1 : 0) - (pad.buttons[13]?.pressed ? 1 : 0);
        }
        if (Math.abs(x-lastStickX) > .015 || Math.abs(y-lastStickY) > .015) {
          desktopActionsRef.current.joystick(x, y, Math.hypot(x,y) > 0.01);
          lastStickX = x; lastStickY = y;
        }
        if (pressedEdge(pad, 0)) desktopActionsRef.current.togglePlay();       // A
        if (pressedEdge(pad, 1)) desktopActionsRef.current.openInfluence();    // B
        if (pressedEdge(pad, 2)) desktopActionsRef.current.openProducts();     // X
        if (pressedEdge(pad, 3)) desktopActionsRef.current.openSettings();     // Y
        if (pressedEdge(pad, 4)) desktopActionsRef.current.stepBackward();     // LB
        if (pressedEdge(pad, 5)) desktopActionsRef.current.stepForward();      // RB
        if (pressedEdge(pad, 9)) desktopActionsRef.current.toggleTimeline();   // Start
      } else if (Math.abs(lastStickX) > .001 || Math.abs(lastStickY) > .001) {
        desktopActionsRef.current.joystick(0, 0, false);
        lastStickX = 0; lastStickY = 0;
        buttonState.clear();
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      desktopActionsRef.current.joystick(0, 0, false);
    };
  }, []);

  return (
    <OrientationGuard>
      <div id="typhoon-app-container" className={`relative w-screen h-screen overflow-hidden bg-[#090a0d] text-slate-100 font-sans theme-default ${useLegacyMobileUi ? "aether-mobile-root" : ""} ${synopticSelecting ? "aether-synoptic-selection-active" : ""}`}>
        
        {/* The professional workstation owns its complete chrome. */}
        <GeoJsonStatusBadge />
        {useLegacyMobileUi && !preSimulationInput && <aside className="aether-landscape-rail" aria-label="横屏模拟控制区域">
          <div className="aether-landscape-rail-caption">台风状态 · 模拟操作</div>
          <div className="aether-landscape-joystick-bay"><span>方向控制</span></div>
        </aside>}

   {/* 1. Map View viewport: only one full Leaflet scene may be mounted.
        Two concurrent scenes used to rerender expensive land/track layers and
        leave duplicate touch/drawer ownership behind on Forecast exit. */}
        {!preSimulationInput && <MapView
          initialViewport={liveCameraBeforeForecastRef.current ?? undefined}
          onMapReady={handleSynopticMapReady}
          synopticSelectionActive={synopticSelecting}
          typhoons={typhoons}
          layers={layers}
          config={config}
          speed={speed}
          currentHour={currentHour}
          historicalPlayback={!isPlaying || currentHour < maxHour - 1e-6}
          timelineSeekPreview={timelineSeekPreview}
          isPlaying={isPlaying && typhoons.some((ty) => ty.active && !ty.dissipated)}
          startDate={startDate}
          onMapClickPlacement={handleMapClickPlacement}
          onMiddleClickPlacement={handleMiddleClickPlacement}
          placementMode={placementMode}
          onDeployTyphoon={setPlacementMode}
          onSelectTrackPoint={handleSelectTrackPoint}
          isForecastRouteDrawing={isForecastRouteDrawing || drawRoutePhase === "drawing"}
          forecastRouteDraft={drawRoutePhase === "drawing" ? drawnTrackDraft : forecastRouteDraft}
          onForecastRoutePoint={drawRoutePhase === "drawing" ? addDrawnTrackPoint : addForecastRoutePoint}
        />}

        {preSimulationInput && createPortal(
          <ForecastPreSimulation
            key={`${preSimulationInput.issueHour}:${preSimulationInput.initial.id}`}
            initial={preSimulationInput.initial} issueHour={preSimulationInput.issueHour}
            config={preSimulationInput.config} layers={layers} startDate={startDate}
            seed={preSimulationInput.seed} randomState={preSimulationInput.randomState}
            mobileChrome={useLegacyMobileUi}
            mapViewport={liveCameraBeforeForecastRef.current ?? undefined}
            onConfirm={confirmForecastPreSimulation}
            onCancel={leaveForecastPreSimulation}
          />,document.body
        )}

        {!preSimulationInput && (useLegacyMobileUi ? <AetherMobileChrome
          typhoon={typhoons[0] || null}
          currentHour={currentHour}
          startDate={startDate}
          isPlaying={isPlaying}
          maxHour={maxHour}
          config={config}
          soundEnabled={config.soundEnabled !== false}
          onProducts={() => { if (typhoons[0]) setForecastModalOpen(true); }}
          onSettings={() => { setDrawerOpenTab(null); setDrawerOpen(true); }}
          onHelp={() => { setDrawerOpenTab("usage"); setDrawerOpen(true); }}
          onInfluence={() => { setIsPlaying(false); setActiveInfluenceCategory("main"); setIsInfluenceModalOpen(true); }}
          onToggleSound={() => setConfig((prev) => ({ ...prev, soundEnabled: prev.soundEnabled === false }))}
          onFullscreen={() => { isFullScreen() ? exitFullScreen() : requestFullScreen(document.documentElement); }}
          onStartForecastRoute={startForecastRouteDrawing}
          onClearForecastRoute={clearForecastRoute}
          onClearPreSimulationReference={clearPreSimulationReference}
          onApplyCurrentSimulationToForecast={applyCurrentSimulationToForecast}
          onRealisticMotion={openRealisticMotion}
          onUndoRealisticMotion={openUndoRealisticMotion}
          hasPreSimulationReference={!!(typhoons[0] && issuePreSimulationReference(typhoons[0],currentHour))}
          onForecastPeakChange={applyForecastPeakReference}
        /> : <AetherDesktopChrome
          onApplyCurrentSimulationToForecast={applyCurrentSimulationToForecast}
          onRealisticMotion={openRealisticMotion}
          onUndoRealisticMotion={openUndoRealisticMotion}
          typhoon={typhoons[0] || null}
          currentHour={currentHour}
          startDate={startDate}
          isPlaying={isPlaying}
          maxHour={maxHour}
          config={config}
          soundEnabled={config.soundEnabled !== false}
          onProducts={() => { if (typhoons[0]) setForecastModalOpen(true); }}
          onSettings={() => { setDrawerOpenTab(null); setDrawerOpen(true); }}
          onHelp={() => { setDrawerOpenTab("usage"); setDrawerOpen(true); }}
          onInfluence={() => { setIsPlaying(false); setActiveInfluenceCategory("main"); setIsInfluenceModalOpen(true); }}
          onToggleSound={() => setConfig((prev) => ({ ...prev, soundEnabled: prev.soundEnabled === false }))}
          onFullscreen={() => { isFullScreen() ? exitFullScreen() : requestFullScreen(document.documentElement); }}
        />)}
        {!preSimulationInput && !useLegacyMobileUi && <AetherIntensityPanel typhoon={typhoons[0] || null} currentHour={currentHour} config={config} />}

        {isForecastRouteDrawing && drawRoutePhase === "off" && createPortal(
          <div className="pro-route-toolbar fixed left-3 bottom-[max(205px,27dvh)] z-[2200] flex items-center gap-1 rounded-lg border border-slate-600/80 bg-[#111820]/96 p-1 shadow-2xl backdrop-blur-md">
            <button
              onClick={finishForecastRouteDrawing}
              title="确认并应用"
              aria-label="确认并应用"
              className="w-9 h-9 rounded-lg bg-emerald-500/95 hover:bg-emerald-400 text-white flex items-center justify-center transition active:scale-95"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={cancelForecastRouteDrawing}
              title="取消绘制"
              aria-label="取消绘制"
              className="w-9 h-9 rounded-lg border border-slate-600 bg-slate-800/90 hover:bg-slate-700 text-slate-200 flex items-center justify-center transition active:scale-95"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              onClick={beginForecastPreSimulation}
              title="以当前台风状态进行预报预模拟（默认 8×）"
              aria-label="预报预模拟"
              className="w-9 h-9 rounded-lg bg-sky-700 hover:bg-sky-600 text-white flex items-center justify-center transition active:scale-95"
            ><Play className="w-4 h-4"/></button>
            <button
              onClick={undoForecastRoutePoint}
              disabled={forecastRouteDraft.length <= 1}
              title="撤回上一个关键点"
              aria-label="撤回上一个关键点"
              className="w-9 h-9 rounded-lg border border-slate-600 bg-slate-800/90 hover:bg-slate-700 text-slate-200 disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center transition active:scale-95"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          </div>, document.body
        )}

        {!useLegacyMobileUi && config.controlMode === "draw" && typhoons.some(t => t.active && !t.dissipated) && (
          <aside className="draw-track-toolbar fixed right-5 top-28 z-[1200] w-[min(280px,calc(100vw-40px))] rounded-xl border border-white/25 bg-slate-900/65 backdrop-blur-md p-3 shadow-xl text-slate-100 pointer-events-auto" aria-label="画点路径控制面板">
            <div className="flex items-center justify-between gap-2 text-xs font-bold">
              <span>画点 · 台风实时路径</span>
              <span className="font-mono text-sky-300">{config.drawnTrackSpeedKmh ?? 20} km/h</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400">
              <span className="rounded-full border border-slate-700/80 bg-slate-900/75 px-2 py-1">模式：{drawRoutePhase === "drawing" ? "绘制中" : drawRoutePhase === "sync" ? "待同步" : "已启用"}</span>
              <span className="rounded-full border border-slate-700/80 bg-slate-900/75 px-2 py-1">节点 {Math.max(0, (drawRoutePhase === "drawing" ? drawnTrackDraft.length : (config.drawnTrackRoute?.length || 0)) - 1)}</span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-300">{drawRoutePhase === "drawing" ? "左键添加节点，按住鼠标中键移动地图；移动地图不会改变台风中心。" : drawRoutePhase === "sync" ? "实时路径已确认。是否将它同步到大体预报路径？" : "台风沿节点依次运动；滚轮或 ↑ ↓ 调整速度。"}</p>
            {drawRoutePhase === "drawing" && <>
              <p className="mt-2 text-[11px] font-mono">已绘制 {Math.max(0,drawnTrackDraft.length - 1)} 个方向节点{continuingDrawnTrackRef.current ? " · 接续原路径" : ""}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={confirmDrawnTrack} disabled={drawnTrackDraft.length < 2} className="rounded-xl bg-emerald-500/85 px-2 py-2.5 text-xs font-semibold disabled:opacity-40">确定路径</button>
                <button onClick={() => setDrawnTrackDraft(p => p.length > 1 ? p.slice(0,-1) : p)} disabled={drawnTrackDraft.length < 2} className="rounded-xl bg-white/10 border border-white/15 px-2 py-2.5 text-xs disabled:opacity-40">撤销节点</button>
              </div>
              <button onClick={() => { setDrawRoutePhase("off"); setDrawnTrackDraft([]); const next={...configRef.current,controlMode:"joystick" as const};configRef.current=next;setConfig(next); }} className="mt-2 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-[10px] text-slate-300 hover:text-white">取消绘制并改用摇杆</button>
            </>}
            {drawRoutePhase === "sync" && <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => completeDrawnTrack(true)} className="rounded-xl bg-sky-500/80 p-2.5 text-xs font-semibold">同步预报</button>
              <button onClick={() => completeDrawnTrack(false)} className="rounded-xl bg-white/10 border border-white/20 p-2.5 text-xs font-semibold">仅实时路径</button>
            </div>}
            {drawRoutePhase === "off" && <>
              <div className="mt-2 grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-2">
                <button onClick={startDrawnTrack} className="rounded-xl bg-white/10 border border-white/20 px-3 py-2.5 text-xs font-semibold">继续画点</button>
                <button onClick={clearDrawnTrack} className="rounded-xl bg-rose-900/30 border border-rose-300/30 px-3 py-2.5 text-xs font-semibold text-rose-200" title="删除全部画点" aria-label="删除全部画点">清空</button>
                <button onClick={() => { const next={...configRef.current,drawnTrackSpeedKmh:Math.max(0,(configRef.current.drawnTrackSpeedKmh??20)-2)};configRef.current=next;setConfig(next); }} className="rounded-xl bg-white/10 border border-white/20 px-3 py-2.5 text-xs font-semibold" aria-label="减速">减速</button>
                <button onClick={() => { const next={...configRef.current,drawnTrackSpeedKmh:Math.min(150,(configRef.current.drawnTrackSpeedKmh??20)+2)};configRef.current=next;setConfig(next); }} className="rounded-xl bg-white/10 border border-white/20 px-3 py-2.5 text-xs font-semibold" aria-label="加速">加速</button>
              </div>
            </>}
          </aside>
        )}

        {terminationDialogOpen && (
          <div className="termination-dialog-overlay fixed inset-0 z-[9100] bg-black/65 flex items-center justify-center p-4" onClick={() => setTerminationDialogOpen(false)}>
            <div className="termination-dialog-panel w-full max-w-sm rounded-2xl border border-slate-700 bg-[#0b1420] p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-100">终止操作</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-500">模拟已暂停。停编当前台风会保留风季时间和全部历史资料；终止风季将进入风季综合报告。</p></div><button onClick={() => setTerminationDialogOpen(false)} className="w-8 h-8 rounded-lg border border-slate-700 flex items-center justify-center text-slate-400"><X className="w-4 h-4"/></button></div>
              <div className="mt-4 grid gap-2">
                <button
                  onClick={() => { setTerminationDialogOpen(false); terminateCurrentTyphoon(false); }}
                  disabled={!typhoons.some((t) => t.active && !t.dissipated)}
                  className="w-full rounded-xl border border-sky-700/40 bg-sky-500/10 px-3 py-3 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                ><div className="text-xs font-bold text-sky-200">{typhoons.some((t) => t.active && !t.dissipated) ? "停编当前台风" : "当前无在编台风"}</div><div className="mt-1 text-[10px] text-slate-500">当前台风归档；之后电脑双击中键／手机三连击海图继续本风季下一台风。</div></button>
                <button onClick={terminateWholeSeason} className="w-full rounded-xl border border-rose-800/50 bg-rose-950/20 px-3 py-3 text-left"><div className="text-xs font-bold text-rose-300">终止整个风季模拟</div><div className="mt-1 text-[10px] text-slate-500">停编仍在运行的台风并打开风季报告页面。</div></button>
              </div>
            </div>
          </div>
        )}

        {seasonReportOpen && typhoons.length > 0 && (
          <SeasonReport
            typhoons={typhoons}
            startDate={startDate}
            onClose={() => setSeasonReportOpen(false)}
            onOpenTyphoonReport={(typhoon) => {
              setSummaryReportTyphoon(typhoon);
              setShowReport(true);
            }}
          />
        )}

        {showReport && (summaryReportTyphoon || typhoons[0]) && (
          <TyphoonReport 
            typhoon={(summaryReportTyphoon ? (typhoons.find((t) => t.id === summaryReportTyphoon.id) || summaryReportTyphoon) : typhoons[0])!}
            startDate={startDate}
            config={config}
            onClose={() => { setShowReport(false); setSummaryReportTyphoon(null); }} 
            onOpenVideoExport={(t) => {
              setShowReport(false);
              setVideoExportTyphoon(t);
            }}
            onOpenReportModal={(t) => {
              setShowReport(false);
              setReportModalTyphoon(t);
            }}
          />
        )}

        {videoExportTyphoon && (
          <VideoExportModal
            typhoon={typhoons.find((t) => t.id === videoExportTyphoon.id) || videoExportTyphoon}
            startDate={startDate}
            onClose={() => setVideoExportTyphoon(null)}
            onStartSynopticRecordSelection={(style,aspect)=>startSynopticSelection({style,aspect})}
          />
        )}

        {reportModalTyphoon && (
          <TyphoonReportModal
            typhoon={typhoons.find((t) => t.id === reportModalTyphoon.id) || reportModalTyphoon}
            startDate={startDate}
            config={config}
            onClose={() => setReportModalTyphoon(null)}
          />
        )}

        {isInfluenceModalOpen && (
          <div className="aether-influence-overlay fixed inset-0 z-[10000] flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto touch-pan-y overscroll-contain">
            <div className={`aether-influence-modal relative w-[min(520px,calc(100vw-24px))] max-h-[min(86dvh,820px)] overflow-y-auto touch-pan-y overscroll-contain rounded-2xl p-4 sm:p-5 lg:p-6 border shadow-2xl transition-all duration-200 ${
              "bg-[#0b1726]/98 border-slate-700/60 text-slate-100"
            }`}>
              <button
                type="button"
                className="aether-influence-sheet-handle"
                aria-label="下滑收起快捷工具"
                onPointerDown={(e) => {
                  influenceSheetDragRef.current = { pointerId: e.pointerId, startY: e.clientY };
                  try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                }}
                onPointerUp={(e) => {
                  const drag = influenceSheetDragRef.current;
                  influenceSheetDragRef.current = null;
                  if (drag && drag.pointerId === e.pointerId && e.clientY - drag.startY >= 44) {
                    setIsInfluenceModalOpen(false); setActiveInfluenceCategory("main");
                  }
                }}
                onPointerCancel={() => { influenceSheetDragRef.current = null; }}
                onClick={() => { setIsInfluenceModalOpen(false); setActiveInfluenceCategory("main"); }}
              ><span /></button>
              
              <div className="mb-4 flex items-center justify-between border-b border-slate-700/50 pb-3">
                <div>
                  <div className="text-sm font-bold tracking-wide">快捷工具</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">结构干预 · 环境影响 · 强度与环流参考</div>
                </div>
                <Sparkles className="h-4 w-4 text-slate-400" />
              </div>

              {/* Main Categories Menu */}
              {activeInfluenceCategory === "main" && (() => {
                const activeTy = typhoons[0];
                const hasEwrc = activeTy && (activeTy.forcedEWRC || (activeTy.ewrcState && activeTy.ewrcState !== "none"));
                const hasDryAir = activeTy && activeTy.forcedDryAir;
                const hasShear = activeTy && activeTy.forcedShear !== undefined;
                const hasRI = activeTy && (activeTy.forcedRapidIntensification || activeTy.rapidIntensifying);
                const activeRIMode = activeTy ? (activeTy.forcedRapidIntensificationMode || activeTy.rapidIntensificationMode || "ri") : "ri";
                const isRISuppressed = activeTy && (!!activeTy.forcedDryAir || (activeTy.forcedShear !== undefined && activeTy.forcedShear > 15.0) || activeTy.ewrcState === "penalty_failure" || activeTy.ewrcIsFailure);

                return (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("ewrc");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      hasEwrc
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 text-slate-200"
                    }`}
                  >
                    <span>🌀 开启眼墙置换 (EWRC) {hasEwrc && <span className="text-xs text-emerald-400 font-bold ml-1.5">[周期演变中]</span>}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("dry_air");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      hasDryAir
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 text-slate-200"
                    }`}
                  >
                    <span>🍂 干空气卷入 (Dry Air) {hasDryAir && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("shear");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      hasShear
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 text-slate-200"
                    }`}
                  >
                    <span>⚡ 强风切变 (Wind Shear) {hasShear && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length === 0) {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                        return;
                      }
                      const active = typhoons[0];
                      if (active.forcedColdAirStrength) setColdAirStrength(active.forcedColdAirStrength);
                      if (Number.isFinite(active.forcedColdAirArrivalHour)) setColdAirDelayHours(Math.max(0, Math.round((active.forcedColdAirArrivalHour as number) - currentHour)));
                      setActiveInfluenceCategory("cold_air");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      activeTy?.forcedColdAirStrength
                        ? "border-2 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.42)] bg-cyan-950/30 text-cyan-200"
                        : "bg-sky-950/20 border-sky-900/40 hover:bg-sky-900/40 text-sky-200"
                    }`}
                  >
                    <span>❄️ 冷空气南下 {activeTy?.forcedColdAirStrength ? <span className="text-xs text-cyan-300 font-bold ml-1.5">[已安排 · {activeTy.forcedColdAirStrength}档]</span> : null}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length === 0) {
                        showToast("当前没有活跃台风，无法设置冷水区", "warning");
                        return;
                      }
                      const active = typhoons[0];
                      if (Number.isFinite(active.forcedColdWaterTemperatureC)) setColdWaterTemperatureC(Math.max(0, Math.min(30, active.forcedColdWaterTemperatureC as number)));
                      if (Number.isFinite(active.forcedColdWaterEndHour)) setColdWaterDurationHours(Math.max(0, Math.round(((active.forcedColdWaterEndHour as number) - currentHour) * 2) / 2));
                      setActiveInfluenceCategory("cold_water");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      activeTy?.forcedColdWaterEndHour !== undefined && currentHour <= (activeTy.forcedColdWaterEndHour as number)
                        ? "border-2 border-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.42)] bg-blue-950/30 text-blue-200"
                        : "bg-blue-950/20 border-blue-900/40 hover:bg-blue-900/40 text-blue-200"
                    }`}
                  >
                    <span>🌊 冷水区 {activeTy?.forcedColdWaterEndHour !== undefined && currentHour <= (activeTy.forcedColdWaterEndHour as number) ? <span className="text-xs text-blue-300 font-bold ml-1.5">[影响中]</span> : null}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length === 0) {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                        return;
                      }
                      setActiveInfluenceCategory("rapid");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      hasRI
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : isRISuppressed
                        ? "bg-amber-950/15 border-amber-900/30 text-amber-300"
                        : "bg-red-950/20 border-red-900/30 hover:bg-red-900/50 text-red-300"
                    }`}
                  >
                    <span>🔥 爆发增强 (RI / ERI / URI) {hasRI && <span className="text-xs text-emerald-400 font-bold ml-1">[{activeRIMode.toUpperCase()} 演变中]</span>} {isRISuppressed && !hasRI && <span className="text-[10px] text-amber-400 font-normal ml-1">(当前环境不利)</span>}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      handleCancelAllPenalties();
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    disabled={!activeTy || !activeTy.active || activeTy.dissipated}
                    className={`w-full py-3.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-between border transition-all ${
                      activeTy?.penaltyRecoveryActive
                        ? "border-2 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.38)] bg-cyan-950/30 text-cyan-200"
                        : "bg-cyan-950/20 border-cyan-900/50 hover:bg-cyan-900/35 text-cyan-300"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                    title="清除人为干预/置换失败等惩罚；严重高山穿越造成的持久中心空洞不会被此按钮抹除，需用爆发增强重构"
                  >
                    <span>🛡️ 取消所有惩罚</span>
                    <span className="text-xs opacity-60">↻</span>
                  </button>

                  {/* Forecast framework, forecast peak reference and drawn environment tools live in the phone/desktop More menu. */}

                  {/* Target Intensity Control Slider */}
                  <div className={`p-3.5 rounded-xl border space-y-2 mt-1 ${
                    "bg-slate-800/40 border-slate-700/50"
                  }`}>
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                      <span className="flex items-center gap-1.5 text-blue-400">
                        <span>{config.autoAdjustIntensity ? "🎯 目标巅峰强度" : "🎯 目标强度"}</span>
                      </span>
                      <label className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-slate-400 cursor-pointer select-none" title="勾选后，滑块只设定全程期望巅峰；实际每小时目标由海温、海洋热含量、风切、水汽、结构和眼墙置换阶段动态计算，不保证达到。">
                        <input
                          type="checkbox"
                          checked={!!config.autoAdjustIntensity}
                          onChange={(e) => applyConfigPatch({ maxIntensityLimitEnabled: true, autoAdjustIntensity: e.target.checked })}
                          className="w-3.5 h-3.5 accent-blue-500"
                        />
                        自动调整强度
                      </label>
                      <button
                        type="button"
                        className="font-mono text-blue-400 font-bold hover:text-blue-300 underline decoration-dotted underline-offset-2"
                        title={config.autoAdjustIntensity ? "点击手动输入目标巅峰强度（实际强度由环境动态调整）" : "点击手动输入目标强度（可高于滑块上限）"}
                        onClick={() => setAppInputDialog({
                          kind: "targetIntensity",
                          title: config.autoAdjustIntensity ? "手动输入目标巅峰强度" : "手动输入目标强度",
                          initialValue: String(config.maxIntensityLimit || 70)
                        })}
                      >{config.maxIntensityLimit || 70} m/s</button>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={150}
                      step={1}
                      value={Math.min(150, Math.max(5, config.maxIntensityLimit || 70))}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        applyConfigPatch({ maxIntensityLimitEnabled: true, maxIntensityLimit: val });
                      }}
                      className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none accent-blue-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>5 m/s</span>
                      <span>150 m/s</span>
                    </div>
                    {(config.maxIntensityLimit || 0) >= 115 && (
                      <div className="rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-[9px] font-bold text-fuchsia-300">🎡 游乐场模式已启动：海上默认自动 ERI · 增强 ×8 · 海温 +5℃ · 禁用背景风切/EWRC · 手动干空气/风切可中断 · 登陆正常减弱 · 风圈/强度无上限</div>
                    )}
                    <p className="text-[9px] leading-snug text-slate-500">{config.autoAdjustIntensity ? "自动调整开启：该数值是全程目标巅峰而不是当前硬上限。环境、内核结构、RI/EWRC阶段会连续决定实际目标；第一次成功置换后的再增强通常获得最大巅峰机会，后续置换默认趋于持平或略弱，但环境显著改善时仍可例外。" : "自动调整关闭：该数值继续作为当前目标强度上限，按原有平滑方式逼近。"} 达到 115 m/s 仍进入游乐场模式。</p>
                  </div>

                  {/* Soft circulation-size reference: not a hard radius constraint. */}
                  <div className={`p-3.5 rounded-xl border space-y-2 mt-1 ${
                    "bg-slate-800/40 border-slate-700/50"
                  }`}>
                    <div className="flex items-center justify-between gap-3 text-xs font-semibold">
                      <span className="text-slate-300">🌀 台风环流大小参考</span>
                      <label className="flex items-center gap-1 font-mono font-bold text-slate-100" title="可点击数值手动输入；最低 0 km，不设最高限制">
                        <input
                          key={`circulation-size-${Math.round(config.circulationSizeReferenceKm ?? 320)}`}
                          type="number"
                          min={0}
                          step={5}
                          defaultValue={Math.round(config.circulationSizeReferenceKm ?? 320)}
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          onBlur={(e) => {
                            const raw = Number(e.currentTarget.value);
                            const val = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : Math.round(config.circulationSizeReferenceKm ?? 320);
                            e.currentTarget.value = String(val);
                            applyCirculationSizeTarget(val);
                          }}
                          className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right font-mono font-bold text-slate-100 outline-none focus:border-cyan-500"
                        />
                        <span>km</span>
                      </label>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(500, Math.ceil((config.circulationSizeReferenceKm ?? 320) / 100) * 100)}
                      step={5}
                      value={Math.max(0, config.circulationSizeReferenceKm ?? 320)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        applyCirculationSizeTarget(val);
                      }}
                      className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none accent-slate-300 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>最小 0 km</span><span>62 m/s · 7级风圈参考</span><span>数值输入无上限</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-950/45 px-2.5 py-2">
                      <div><div className="text-[10px] font-bold text-slate-300">风圈变化生效时间</div><div className="text-[8px] text-slate-500">从当前模拟时刻平滑变化到新参考值</div></div>
                      <select value={Number(config.circulationSizeTransitionHours ?? 0)} onChange={(e)=>applyCirculationTransitionDuration(Number(e.target.value))} className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] text-slate-200">
                        <option value={0}>立即</option><option value={3}>3 小时</option><option value={6}>6 小时</option><option value={12}>12 小时</option><option value={24}>24 小时</option><option value={36}>36 小时</option><option value={48}>48 小时</option><option value={72}>72 小时</option>
                      </select>
                    </div>
                    <p className="text-[9px] leading-snug text-slate-500">
                      这是62 m/s台风的七级风圈平均半径“软参考”，不是硬性锁定。最低可设为 0 km，数值输入不设最高限制；滑块会随当前大值自动扩展。实际风圈仍会随移速、纬度、风切、海气供能、置换、核心损伤、登陆与环流膨胀变化；紧凑型更利于峰值风集中，宽广型更倾向大雨带、慢收紧和更大的外围风场。
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm transition-all border border-transparent text-red-500 hover:bg-red-500/10 text-center cursor-pointer"
                  >
                    关闭
                  </button>
                </div>
                );
              })()}

              {/* EWRC Sub Menu */}
              {activeInfluenceCategory === "ewrc" && (() => {
                const activeTy = typhoons[0];
                const isCycleRunning = activeTy && (activeTy.ewrcState === "forming" || activeTy.ewrcState === "max_decay");
                const isAutoActive = activeTy && !activeTy.manualEwrcOutcomeOverride && (activeTy.forcedEWRC === "auto" || !!isCycleRunning);
                const isSuccessActive = activeTy && (activeTy.manualEwrcOutcomeOverride === "success" || activeTy.forcedEWRC === "success" || activeTy.ewrcState === "recovering_success");
                const isFailureActive = activeTy && (activeTy.manualEwrcOutcomeOverride === "failure" || activeTy.forcedEWRC === "failure" || activeTy.ewrcState === "penalty_failure" || activeTy.ewrcState === "recovering_failure");
                const hasManualOutcomeLock = !!activeTy?.manualEwrcOutcomeOverride;

                return (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("ewrc", "auto");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      isAutoActive
                        ? "border-2 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.45)] bg-cyan-950/30 text-cyan-200"
                        : "bg-cyan-950/20 border-cyan-800/30 hover:bg-cyan-900/30 text-cyan-200"
                    }`}
                  >
                    🌀 正常开始置换 (Auto EWRC) {isAutoActive && <span className="text-xs text-cyan-300 font-bold ml-1.5">[程序判定中 - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("ewrc", "success");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      isSuccessActive
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-emerald-950/20 border-emerald-800/30 hover:bg-emerald-900/30 text-emerald-300"
                    }`}
                  >
                    🚀 置换成功 (Success EWRC) {isSuccessActive && <span className="text-xs text-emerald-400 font-bold ml-1.5">[{hasManualOutcomeLock && activeTy?.manualEwrcOutcomeOverride === "success" ? "人工锁定" : "置换演变中"} - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("ewrc", "failure");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      isFailureActive
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-amber-950/20 border-amber-800/30 hover:bg-amber-900/30 text-amber-300"
                    }`}
                  >
                    💥 置换失败 (Failure EWRC) {isFailureActive && <span className="text-xs text-emerald-400 font-bold ml-1.5">[{hasManualOutcomeLock && activeTy?.manualEwrcOutcomeOverride === "failure" ? "人工锁定" : "影响演变中"} - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("main");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3 px-4 rounded-xl font-medium text-sm border transition-all text-center cursor-pointer ${
                      "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300"
                    }`}
                  >
                    返回上一级
                  </button>
                </div>
                );
              })()}

              {/* Dry Air Sub Menu */}
              {activeInfluenceCategory === "dry_air" && (() => {
                const activeTy = typhoons[0];
                const isCoreActive = activeTy && activeTy.forcedDryAir === "core";
                const isPeripheryActive = activeTy && activeTy.forcedDryAir === "periphery";

                return (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("dry_air", "core");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      isCoreActive
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-red-950/20 border-red-800/30 hover:bg-red-900/30 text-red-300"
                    }`}
                  >
                    💀 卷入核心 (Severe Core Damage) {isCoreActive && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("dry_air", "periphery");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      isPeripheryActive
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-amber-950/20 border-amber-800/30 hover:bg-amber-900/30 text-amber-300"
                    }`}
                  >
                    🍂 卷入外围 (Peripheral Erosion) {isPeripheryActive && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("main");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3 px-4 rounded-xl font-medium text-sm border transition-all text-center cursor-pointer ${
                      "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300"
                    }`}
                  >
                    返回上一级
                  </button>
                </div>
                );
              })()}

              {/* Shear Sub Menu */}
              {activeInfluenceCategory === "shear" && (() => {
                const activeTy = typhoons[0];
                const is35Active = activeTy && activeTy.forcedShear === 35;
                const is22Active = activeTy && activeTy.forcedShear === 22;

                return (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("shear", "35.0");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      is35Active
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-red-950/20 border-red-800/30 hover:bg-red-900/30 text-red-300"
                    }`}
                  >
                    ⚡ 35节极强风切变 (35kt Extreme) {is35Active && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("shear", "22.0");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      is22Active
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-amber-950/20 border-amber-800/30 hover:bg-amber-900/30 text-amber-300"
                    }`}
                  >
                    ⚡ 22节中强风切变 (22kt Moderate) {is22Active && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("main");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3 px-4 rounded-xl font-medium text-sm border transition-all text-center cursor-pointer ${
                      "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300"
                    }`}
                  >
                    返回上一级
                  </button>
                </div>
                );
              })()}

              {/* Cold Water Sub Menu */}
              {activeInfluenceCategory === "cold_water" && (() => {
                const activeTy = typhoons[0];
                const activeUntil = activeTy?.forcedColdWaterEndHour;
                const isActive = Number.isFinite(activeUntil) && currentHour <= (activeUntil as number) + 1e-6;
                const remaining = isActive ? Math.max(0, (activeUntil as number) - currentHour) : 0;
                return (
                  <div className="flex flex-col gap-3">
                    <div className="px-3 py-2 rounded-lg text-[10px] leading-relaxed border bg-blue-950/20 border-blue-800/40 text-blue-200/80">
                      将当前台风置于指定海温的冷水区中。持续时间使用模拟时；期间中心海温按设定值进入强度、OHC、对流和冷水压制计算，结束后由既有冷水记忆机制平滑恢复。
                    </div>
                    <label className="block rounded-xl border border-slate-700 bg-slate-900/45 p-3">
                      <div className="flex justify-between text-xs mb-2"><span className="text-slate-200">持续时间（模拟时）</span><b className="text-blue-300">{coldWaterDurationHours.toFixed(1)} h</b></div>
                      <input type="range" min={0} max={120} step={0.5} value={coldWaterDurationHours} onChange={e => setColdWaterDurationHours(Number(e.target.value))} className="w-full" />
                      {isActive && <div className="mt-2 text-[10px] text-blue-300">当前事件剩余约 {remaining.toFixed(1)}h</div>}
                    </label>
                    <label className="block rounded-xl border border-slate-700 bg-slate-900/45 p-3">
                      <div className="flex justify-between text-xs mb-2"><span className="text-slate-200">冷水区温度</span><b className="text-blue-300">{coldWaterTemperatureC.toFixed(1)}℃</b></div>
                      <input type="range" min={0} max={30} step={0.5} value={coldWaterTemperatureC} onChange={e => setColdWaterTemperatureC(Number(e.target.value))} className="w-full" />
                      <div className="mt-1 flex justify-between text-[9px] text-slate-500"><span>0℃</span><span>26℃以下显著抑制</span><span>30℃</span></div>
                    </label>
                    <button onClick={() => { handleScheduleColdWater(coldWaterTemperatureC, coldWaterDurationHours); setIsInfluenceModalOpen(false); playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse"); }} className="w-full py-3.5 px-4 rounded-xl font-semibold text-sm border border-blue-600/60 bg-blue-950/30 hover:bg-blue-900/40 text-blue-200">
                      🌊 {isActive ? "更新冷水区" : "启动冷水区"}
                    </button>
                    {isActive && <button onClick={() => { handleCancelColdWater(); setIsInfluenceModalOpen(false); }} className="w-full py-3 px-4 rounded-xl font-medium text-sm border border-red-900/40 bg-red-950/20 text-red-300">取消冷水区</button>}
                    <button onClick={() => setActiveInfluenceCategory("main")} className="w-full py-3 px-4 rounded-xl font-medium text-sm border bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300">返回上一级</button>
                  </div>
                );
              })()}

              {/* Cold Air Sub Menu */}
              {activeInfluenceCategory === "cold_air" && (() => {
                const activeTy = typhoons[0];
                const existing = activeTy?.forcedColdAirStrength;
                const arrival = activeTy?.forcedColdAirArrivalHour;
                const remaining = Number.isFinite(arrival) ? Math.max(0, (arrival as number) - currentHour) : null;
                return (
                  <div className="flex flex-col gap-3">
                    <div className="px-3 py-2 rounded-lg text-[10px] leading-relaxed border bg-sky-950/20 border-sky-800/40 text-sky-200/80">
                      冷空气由渤海和西日本海两支同时南下（西日本海支明显较弱），在东海交汇后绕台湾分流：西南侧经台湾海峡、巴士海峡进入南海，东南侧进入菲律宾以东海域并更快减弱消散。主输送路径位于海上，不再从华东、华南陆地直接南压。到达时间仍按模拟时绝对时刻锁定，并与台风强度响应同步。
                    </div>
                    <label className="block rounded-xl border border-slate-700 bg-slate-900/45 p-3">
                      <div className="flex justify-between text-xs mb-2"><span className="text-slate-200">强度</span><b className="text-cyan-300">{coldAirStrength} 档 · {coldAirStrength === 1 ? "弱" : coldAirStrength === 2 ? "中" : "强"}</b></div>
                      <input type="range" min={1} max={3} step={1} value={coldAirStrength} onChange={e => setColdAirStrength(Number(e.target.value) as 1 | 2 | 3)} className="w-full" />
                      <div className="mt-1 flex justify-between text-[9px] text-slate-500"><span>1 · 约24kt海面</span><span>2 · 约28kt</span><span>3 · 约32kt</span></div>
                    </label>
                    <label className="block rounded-xl border border-slate-700 bg-slate-900/45 p-3">
                      <div className="flex justify-between text-xs mb-2"><span className="text-slate-200">延迟到达时间（模拟时）</span><b className="text-cyan-300">{coldAirDelayHours} h</b></div>
                      <input type="range" min={0} max={72} step={1} value={coldAirDelayHours} onChange={e => setColdAirDelayHours(Number(e.target.value))} className="w-full" />
                      {existing && remaining !== null && <div className="mt-2 text-[10px] text-cyan-300">当前事件：{existing}档，距强风前锋抵达台风中心约 {remaining.toFixed(1)}h</div>}
                    </label>
                    <button onClick={() => { handleScheduleColdAir(coldAirStrength, coldAirDelayHours); setIsInfluenceModalOpen(false); playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse"); }} className="w-full py-3.5 px-4 rounded-xl font-semibold text-sm border border-cyan-600/60 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-200">
                      ❄️ {existing ? "更新冷空气事件" : "启动冷空气南下"}
                    </button>
                    {existing && <button onClick={() => { handleCancelColdAir(); setIsInfluenceModalOpen(false); }} className="w-full py-3 px-4 rounded-xl font-medium text-sm border border-red-900/40 bg-red-950/20 text-red-300">取消冷空气事件</button>}
                    <button onClick={() => setActiveInfluenceCategory("main")} className="w-full py-3 px-4 rounded-xl font-medium text-sm border bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300">返回上一级</button>
                  </div>
                );
              })()}

              {/* Rapid Intensification Sub Menu */}
              {activeInfluenceCategory === "rapid" && (() => {
                const activeTy = typhoons[0];
                const currentMode = activeTy ? (activeTy.forcedRapidIntensificationMode || activeTy.rapidIntensificationMode || "ri") : "ri";
                const active = !!activeTy && !!(activeTy.forcedRapidIntensification || activeTy.rapidIntensifying);
                const extratropicalBurstBlocked = !!activeTy && !!activeTy.coldAirWarmCoreDestroyed;
                const suppressed = !!activeTy && (extratropicalBurstBlocked || !!activeTy.forcedDryAir || (activeTy.forcedShear !== undefined && activeTy.forcedShear > 15.0) || activeTy.ewrcState === "penalty_failure" || !!activeTy.ewrcIsFailure);

                const chooseMode = (mode: "ri" | "eri" | "uri") => {
                  if (!activeTy) {
                    showToast("当前没有活跃台风，无法施加影响", "warning");
                    return;
                  }
                  const sameActive = active && currentMode === mode;
                  if (suppressed && !sameActive) {
                    showToast(extratropicalBurstBlocked ? "强冷空气已彻底摧毁暖心，该残留低压路径禁止任何爆发增强。" : "当前处于干空气/强风切/置换失败压制状态，无法新开启爆发增强。", "warning");
                    return;
                  }
                  handleApplyInfluence("rapid_intensify", mode);
                  setIsInfluenceModalOpen(false);
                  playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                };

                return (
                <div className="flex flex-col gap-2.5">
                  <div className={`px-3 py-2 rounded-lg text-[10px] leading-relaxed border ${
                    "bg-slate-900/50 border-slate-700/50 text-slate-400"
                  }`}>
                    RI：典型约 15–22 m/s / 24h；ERI：典型约 24–30 m/s / 24h。URI 超高速爆发为 2.28–2.37 m/s/h、持续25h。正常北上进入副热带/温带阶段后，手动爆发会转化为斜压能量驱动的受动爆发，不再按热带暖心 RI 处理；若 32 kt 强冷空气已彻底摧毁暖心，则系统直接成为残留低压云团，不进入副热带/温带气旋阶段，并永久禁止任何增强。
                  </div>

                  <button
                    onClick={() => chooseMode("ri")}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all ${
                      active && currentMode === "ri"
                        ? "border-2 border-emerald-500 bg-emerald-950/30 text-emerald-300"
                        : suppressed
                        ? "opacity-55 bg-slate-800/30 border-slate-700/40 text-slate-400"
                        : "bg-orange-950/20 border-orange-800/30 hover:bg-orange-900/30 text-orange-300"
                    }`}
                  >
                    ⚡ RI 快速增强
                    <div className="text-[10px] font-normal opacity-70 mt-1">≥30 kt / 24h 级别；常见 6h 平均增幅约 8–12 kt。</div>
                    {active && currentMode === "ri" && <div className="text-[10px] text-emerald-400 mt-1">当前运行中 · 再次点击将平滑结束</div>}
                  </button>

                  <button
                    onClick={() => chooseMode("eri")}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all ${
                      active && currentMode === "eri"
                        ? "border-2 border-emerald-500 bg-emerald-950/30 text-emerald-300"
                        : suppressed
                        ? "opacity-55 bg-slate-800/30 border-slate-700/40 text-slate-400"
                        : "bg-red-950/20 border-red-800/30 hover:bg-red-900/30 text-red-300"
                    }`}
                  >
                    🔥 ERI 极端快速增强
                    <div className="text-[10px] font-normal opacity-70 mt-1">典型约 50–70 kt / 24h 级别，极少数可进入纪录级尾部。</div>
                    {active && currentMode === "eri" && <div className="text-[10px] text-emerald-400 mt-1">当前运行中 · 再次点击将平滑结束</div>}
                  </button>

                  <button
                    onClick={() => chooseMode("uri")}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all ${
                      active && currentMode === "uri"
                        ? "border-2 border-emerald-500 bg-emerald-950/30 text-emerald-300"
                        : suppressed
                        ? "opacity-55 bg-slate-800/30 border-slate-700/40 text-slate-400"
                        : "bg-fuchsia-950/20 border-fuchsia-800/30 hover:bg-fuchsia-900/30 text-fuchsia-300"
                    }`}
                  >
                    🚀 URI 超高速爆发
                    <div className="text-[10px] font-normal opacity-70 mt-1">2.28–2.37 m/s/h 动态增强 · 25h · 前2h渐入 · 结束后2h渐退。</div>
                    {active && currentMode === "uri" && <div className="text-[10px] text-emerald-400 mt-1">当前运行中 · 再次点击将平滑结束</div>}
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("main");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3 px-4 rounded-xl font-medium text-sm border transition-all text-center cursor-pointer ${
                      "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300"
                    }`}
                  >
                    返回上一级
                  </button>
                </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* 3. Top-Right UI Controls */}
        <div className="fixed top-2.5 right-2.5 z-[1000] flex flex-col gap-2">
          {/* Desktop actions live in the AETHER top bar and bottom dock; the old duplicate
              quick-tool/menu pair was removed to keep one keyboard/gamepad-addressable command surface. */}
        </div>

        {/* 4. Bottom-Left Virtual Steering Joystick */}
        {config.controlMode !== "draw" && <div
          id="joystick-wrapper"
          className="fixed bottom-24 left-8 z-[1000]"
          style={{
            marginLeft: "env(safe-area-inset-left, 0px)"
          }}
        >
          <VirtualJoystick
            compact={useLegacyMobileUi}
            dx={config.joystickDx}
            dy={config.joystickDy}
            onChange={handleJoystickChange}
            strength={config.joystickStrength}
            returnToCenter={!!config.joystickReturnToCenter}
            enabled={typhoons[0] ? (!typhoons[0].dissipated && typhoons[0].active) : false}
          />
        </div>}

        {/* 5. Bottom Controls Timeline bar */}
        {useLegacyMobileUi ? <AetherMobileTransport
          currentHour={currentHour}
          maxHour={maxHour}
          isPlaying={isPlaying}
          onTerminate={() => {
            const active = typhoonsRef.current.some(t => t.active && !t.dissipated);
            if (active) handleTerminateRequest();
            else { setSummaryReportTyphoon(typhoonsRef.current[0] || null); setShowReport(true); }
          }}
          isTerminationReport={!typhoons.some(t => t.active && !t.dissipated) && typhoons.length > 0}
          onOpenForecast={() => { if (typhoons.length === 0) return; setForecastModalOpen(true); playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse"); }}
          onOpenInfluence={() => { setIsPlaying(false); setActiveInfluenceCategory("main"); setIsInfluenceModalOpen(true); }}
          collapsed={timelineCollapsed}
          onCollapseChange={setTimelineCollapsed}
          onPlayToggle={handlePlayToggle}
          onStepForward={handleStepForward}
          onStepBackward={handleStepBackward}
          onReset={resetSimulation}
          onSeek={handleSeek}
          speed={speed}
          onSpeedChange={(s) => { setSpeed(s); playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse"); }}
          startDate={startDate}
          onStartDateChange={handleStartDateChange}
        /> : <Timeline
          currentHour={currentHour}
          maxHour={maxHour}
          isPlaying={isPlaying}
          onTerminate={() => {
            const active = typhoonsRef.current.some(t => t.active && !t.dissipated);
            if (active) handleTerminateRequest();
            else { setSummaryReportTyphoon(typhoonsRef.current[0] || null); setShowReport(true); }
          }}
          isTerminationReport={!typhoons.some(t => t.active && !t.dissipated) && typhoons.length > 0}
          onOpenForecast={() => {
            if (typhoons.length === 0) return;
            setForecastModalOpen(true);
            playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
          }}
          onOpenInfluence={() => { setIsPlaying(false); setActiveInfluenceCategory("main"); setIsInfluenceModalOpen(true); }}
          collapsed={timelineCollapsed}
          onCollapseChange={setTimelineCollapsed}
          onPlayToggle={handlePlayToggle}
          onStepForward={handleStepForward}
          onStepBackward={handleStepBackward}
          onReset={resetSimulation}
          onSeek={handleSeek}
          speed={speed}
          onSpeedChange={(s) => {
            setSpeed(s);
            playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
          }}
          startDate={startDate}
          onStartDateChange={handleStartDateChange}
        />}

        {/* 气象图入口已并入 Timeline 控制组，避免与终止键在窄屏/缩放布局中互相覆盖。 */}

        {synopticSelecting && (
          <div className="fixed inset-0 z-[8800] pointer-events-none" aria-label="风场图手动选区">
            {/* Four transparent interaction shields leave ONLY the map area within the
                selection rectangle touchable. This disables timeline, joystick,
                floating panels and placement tools without disabling Leaflet pan/zoom. */}
            <div className="absolute inset-0 flex flex-col pointer-events-none">
              <div className="flex-1 bg-slate-950/25 pointer-events-auto" />
              <div className="flex w-full shrink-0 pointer-events-none">
                <div className="flex-1 bg-slate-950/25 pointer-events-auto" />
                <div className="shrink-0 pointer-events-none" style={{ width: synopticCropWidth, aspectRatio: String(synopticCropRatio), maxHeight: "calc(100dvh - 220px)" }} />
                <div className="flex-1 bg-slate-950/25 pointer-events-auto" />
              </div>
              <div className="flex-1 bg-slate-950/25 pointer-events-auto" />
            </div>
            <div id="aether-synoptic-selection-frame"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-[3px] border-cyan-300 rounded-md shadow-[0_0_0_9999px_rgba(0,0,0,0.13),0_0_18px_rgba(34,211,238,0.7)]"
              style={{ width: synopticCropWidth, aspectRatio: String(synopticCropRatio), maxHeight: "calc(100dvh - 220px)" }}>
              <span className="absolute top-1 left-2 rounded bg-slate-900/80 px-2 py-1 text-[10px] font-semibold text-cyan-100">风场图纯画面选区 · 拖动 / 缩放地图</span>
            </div>
            <div className="absolute left-3 bottom-[max(190px,24vh)] flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-950/90 p-2 shadow-xl pointer-events-auto">
              <button type="button" aria-label="确认风场图选区" onClick={() => exitSynopticSelection(true)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white"><Check size={24}/></button>
              <button type="button" aria-label="取消风场图选区" onClick={() => exitSynopticSelection(false)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-700 text-white"><X size={24}/></button>
            </div>
          </div>
        )}

        {forecastModalOpen && typhoons[0] && (
          <ForecastImageModal
            isOpen={forecastModalOpen}
            onClose={() => { setForecastModalOpen(false); setPickedSynopticBounds(null); }}
            onStartSynopticMapSelection={startSynopticSelection}
            pickedSynopticBounds={pickedSynopticBounds}
            typhoon={typhoons[0]}
            typhoons={typhoons}
            currentHour={currentHour}
            observedRainfallEndHour={isPlaying && currentHour >= maxHour
              ? totalSimMinutesRef.current / 60.0
              : currentHour}
            maxHour={maxHour}
            startDate={startDate}
            config={config}
            mobileMode={useLegacyMobileUi}
            onBeforeHeavyGeneration={persistSimulationState}
            onAfterHeavyGeneration={persistSimulationState}
            onOpenTyphoonNetwork={() => { isPlayingRef.current = false; setIsPlaying(false); setForecastModalOpen(false); setTyphoonNetworkSetupOpen(true); }}
          />
        )}

        {typhoonNetworkSetupOpen && (
          <NetworkEntrySettings config={config} storm={typhoons[0]} currentHour={currentHour} startDate={startDate} mobileMode={useLegacyMobileUi}
            onStartSynopticMapSelection={()=>{setTyphoonNetworkSetupOpen(false);setForecastModalOpen(true);startSynopticSelection();}}
            onCancel={() => {setTyphoonNetworkSetupOpen(false);setForecastModalOpen(true);}}
            onConfirm={(networkConfig,settings) => {
              setNetworkEntryOptions({config:networkConfig,settings});
              setTyphoonNetworkSetupOpen(false);setTyphoonNetworkOpen(true);
            }}/>
        )}
        {typhoonNetworkOpen && typhoons[0] && networkEntryOptions && (
          <TyphoonNetworkSimulator storm={typhoons[0]} startDate={startDate} currentHour={currentHour}
            config={networkEntryOptions.config} chartSettings={networkEntryOptions.settings}
            onClose={() => { setTyphoonNetworkOpen(false); setForecastModalOpen(true); }} />
        )}

        <RealisticParameterDialog open={!!realisticDialogMode} mode={realisticDialogMode||'apply'}
          busy={realisticBusy} strength={realisticStrength} progress={realisticProgress}
          onStrength={setRealisticStrength} onCancel={cancelRealisticMotion} onConfirm={confirmRealisticMotion}/>

        <AetherInputDialog
          open={!!appInputDialog}
          title={appInputDialog?.title || "输入"}
          description={appInputDialog?.kind === "forecastPeak" ? "输入 5–110 m/s。该值仅用于未来预报与集合指导。" : "输入 m/s；115 m/s 起进入游乐场模式。"}
          initialValue={appInputDialog?.initialValue || ""}
          inputMode="decimal"
          onClose={() => setAppInputDialog(null)}
          onSubmit={(raw) => {
            if (!appInputDialog) return;
            if (appInputDialog.kind === "forecastPeak") {
              const value = Number(raw);
              if (!Number.isFinite(value) || value < 5 || value > 110) return "请输入 5–110 m/s。";
              cancelForecastPeakSlider();
              applyForecastPeakReference(value, true);
              return;
            }
            return applyManualTargetIntensity(raw);
          }}
        />

        {/* The live drawer must UNMOUNT while the sandbox drawer is active:
            keeping two drawers in the DOM duplicates internal control IDs and
            on mobile can leave a fullscreen settings page blocking the map. */}
        {!preSimulationInput && <ControlDrawer
          drawerId="control-drawer-sidebar"
          isOpen={drawerOpen}
          requestedTab={drawerOpenTab}
          onClose={() => setDrawerOpen(false)}
          typhoons={typhoons}
          startDate={startDate}
          config={config}
          desktopDevice={isDesktopDevice}
          mobileMode={useLegacyMobileUi}
          onConfigChange={applyConfigPatch}
          onUpdateTyphoonIdentity={(index, patch) => {
            const targetId = typhoonsRef.current[index]?.id;
            const patchSnapshot = (snapshot: Typhoon | null) => {
              if (!snapshot || !targetId || snapshot.id !== targetId) return snapshot;
              const merged = { ...snapshot, ...patch } as Typhoon;
              return patch.name !== undefined ? syncTyphoonNameIntoSnapshots(merged, String(patch.name)) : merged;
            };
            setSummaryReportTyphoon((prev) => patchSnapshot(prev));
            setVideoExportTyphoon((prev) => patchSnapshot(prev));
            setReportModalTyphoon((prev) => patchSnapshot(prev));
            setTyphoons((prev) => {
              const newTys = [...prev];
              if (newTys[index]) {
                const merged = { ...newTys[index], ...patch } as Typhoon;
                newTys[index] = patch.name !== undefined
                  ? syncTyphoonNameIntoSnapshots(merged, String(patch.name))
                  : merged;
              }
              typhoonsRef.current = newTys;
              return newTys;
            });
          }}
          layers={layers}
          onLayersChange={(l) => setLayers((prev) => ({ ...prev, ...l }))}
          onDeployTyphoon={setPlacementMode}
          onGenerateEnvironment={regenerateEnvironment}
          onResetSimulation={resetSimulation}
          onClearTrack={clearTrack}
          onExportSimulationArchive={exportCompleteSimulation}
          onImportSimulationArchive={importCompleteSimulation}
          eventLogs={eventLogs}
          onClearLogs={() => setEventLogs([])}
          onSeekHour={handleSeek}
          genesisPos={genesisPos}
          isForecastRouteDrawing={isForecastRouteDrawing}
          forecastRoutePointCount={forecastRouteDraft.length}
          onStartForecastRoute={startForecastRouteDrawing}
          onFinishForecastRoute={finishForecastRouteDrawing}
          onCancelForecastRoute={cancelForecastRouteDrawing}
          onClearForecastRoute={clearForecastRoute}
          onClearPreSimulationReference={clearPreSimulationReference}
          onApplyCurrentSimulationToForecast={applyCurrentSimulationToForecast}
          hasPreSimulationReference={!!(typhoons[0] && issuePreSimulationReference(typhoons[0],currentHour))}
        />}

        {!launchFinished && (
          <AetherLaunchSequence
            ready={initializationReady}
            showAuthor={showLaunchAuthor}
            onComplete={finishAetherLaunch}
          />
        )}
        {/* Pre-mount the terms underneath the opaque launch overlay. As the launch fades,
            the terms are already rendered; no underlying map/black flash can leak through. */}
        {!termsAccepted && (
          <AetherTermsModal onAccept={acceptAetherTerms} />
        )}
      </div>
    </OrientationGuard>
  );
}
