/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";

(L.TileLayer as any).Bing = L.TileLayer.extend({
  getTileUrl: function (coords: any) {
    var quadkey = '';
    for (var i = coords.z; i > 0; i--) {
      var digit = 0;
      var mask = 1 << (i - 1);
      if ((coords.x & mask) !== 0) digit += 1;
      if ((coords.y & mask) !== 0) digit += 2;
      quadkey += digit;
    }
    return `https://ecn.t0.tiles.virtualearth.net/tiles/a${quadkey}.jpeg?g=129&mkt=en-US`;
  }
});

import "leaflet/dist/leaflet.css";
import StationHistory from "./StationHistory";
import { TyphoonCategory } from "../types";
import type { Typhoon, ActiveLayers, SimulationConfig } from "../types";
import { CITIES } from "../utils/stations";
import { getSST, getShear, getRH700, checkPointInPolygon, getCategoryColor, getWindForceCategory, getAgencyIntensity, calculateLiveForecastTrackPath, calculateRadialPressure, getLandMetrics, getDistanceToLand, WEATHER_STATIONS_DATA, getFilteredLandMasses, calculateStationStormSurge, fetchOsmStationName, shouldHideCmaWindRadiiAfterLandfall } from "../simulation/Engine";
import { landGeoJson, countriesGeoJson, subscribeLoaderState, getLoaderState } from "../simulation/NaturalEarthLoader";
import { MapPin, Info, X } from "lucide-react";
import { renderToString } from "react-dom/server";
import { computeTyphoonPrecipitation } from "../simulation/PrecipitationModel";
import { calculateJmaWindCircleGeometry } from "../utils/JmaWindRadii";
import { isJmaTrackDotTime } from "../utils/JmaOperationalTiming";
import { drawBlueMarble2002Tile, loadBlueMarble2002 } from "../utils/BlueMarble2002";
import { getSimulationBeijingDate, isCmaTyphoonProductTime } from "../simulation/CmaOperationalClock";
import { getTyphoonDisplayName } from "../utils/TyphoonDisplayName";

import { mergeTyphoonStateWithCurrentIdentity } from "../utils/TyphoonIdentity";
import { getLocalVectorBasemapStyle, JMA_PRODUCT_COLORS } from "../utils/LocalVectorBasemaps";
import { getStormTerrainTextureDataUrl, STORM_TERRAIN_BOUNDS } from "../utils/StormTerrainBasemap";
import { stationCityDisplayName, stationCityName } from "../utils/CityNames";
import { bakeOceanTexture, oceanTextureFingerprint, WEST_PACIFIC_TEXTURE_BOUNDS } from "../utils/RealtimeWeatherTextures";
import { getSynopticEnvironmentState } from "../simulation/SynopticEnvironment";
import type { SynopticFeatureKind } from "../simulation/SynopticEnvironment";
import { buildAetherCenterTrackGuidance, smoothGuidanceTrackForDisplay } from "../simulation/AetherEnsembleGuidance";

const MAPVIEW_UI_ONLY_CONFIG_KEYS = new Set([
  "drawnTrackSpeedKmh", "drawnTrackRoute", "manualForecastRoute", "manualForecastRouteEnabled",
  "manualForecastRouteWeight", "controlMode", "followMainTyphoon", "circulationSizeReferenceKm"
]);

const WEATHER_STATION_RENDER_META = WEATHER_STATIONS_DATA.map((station) => ({
  station,
  cosLat: Math.cos(station.lat * (Math.PI / 180))
}));
const WEATHER_STATION_NAME_SET = new Set(WEATHER_STATIONS_DATA.map((station) => station.name));

function readStationPopupTitle(stationName: string, lat: number, lon: number): string {
  try {
    const customTitle = (localStorage.getItem(`typhoon_station_custom_title_${stationName}`) || "").trim();
    if (customTitle) return customTitle;
    const legacyName = (localStorage.getItem(`typhoon_station_custom_name_${stationName}`) || "").trim();
    const displayName = stationCityDisplayName(legacyName || stationName, lat, lon);
    return ["洋面站点", "浮标", "临时站点"].includes(displayName) ? displayName : `${displayName}气象站`;
  } catch {
    const displayName = stationCityDisplayName(stationName, lat, lon);
    return ["洋面站点", "浮标", "临时站点"].includes(displayName) ? displayName : `${displayName}气象站`;
  }
}
function escapeStationPopupText(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
}

// Local vector basemap palettes are shared with video export in LocalVectorBasemaps.ts.

function getWindRadiusAtBearing(
  radii: { ne: number; se: number; sw: number; nw: number } | undefined,
  bearingDeg: number
): number {
  if (!radii) return 0;
  const b = ((bearingDeg % 360) + 360) % 360;
  const value = b < 90 ? radii.ne : b < 180 ? radii.se : b < 270 ? radii.sw : radii.nw;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

type WindQuadrants = { ne: number; se: number; sw: number; nw: number };
type LiveRadiiLevel = "r7" | "r10" | "r12";

const copyWindQuadrants = (radii: WindQuadrants | undefined | null): WindQuadrants | null => radii ? ({
  ne: Number.isFinite(radii.ne) ? radii.ne : 0,
  se: Number.isFinite(radii.se) ? radii.se : 0,
  sw: Number.isFinite(radii.sw) ? radii.sw : 0,
  nw: Number.isFinite(radii.nw) ? radii.nw : 0
}) : null;

const windQuadrantsEqual = (a: WindQuadrants | null, b: WindQuadrants | null, eps = 1e-4) => {
  if (!a || !b) return a === b;
  return Math.abs(a.ne - b.ne) <= eps && Math.abs(a.se - b.se) <= eps &&
    Math.abs(a.sw - b.sw) <= eps && Math.abs(a.nw - b.nw) <= eps;
};

const interpolateWindQuadrants = (from: WindQuadrants | null, to: WindQuadrants | null, t: number): WindQuadrants | null => {
  if (!from && !to) return null;
  const a = from || { ne: 0, se: 0, sw: 0, nw: 0 };
  const b = to || { ne: 0, se: 0, sw: 0, nw: 0 };
  return {
    ne: a.ne + (b.ne - a.ne) * t,
    se: a.se + (b.se - a.se) * t,
    sw: a.sw + (b.sw - a.sw) * t,
    nw: a.nw + (b.nw - a.nw) * t
  };
};

const hasVisibleWindQuadrants = (radii: WindQuadrants | null | undefined) => !!radii &&
  [radii.ne, radii.se, radii.sw, radii.nw].some((value) => Number.isFinite(value) && value > 0.1);

function buildQuadrantOffsets(radii: WindQuadrants | null, centerLat: number, stepDeg = 3): Array<[number, number]> {
  if (!radii) return [];
  const offsets: Array<[number, number]> = [];
  const lonScale = 111.12 * Math.max(0.2, Math.cos(centerLat * Math.PI / 180));
  const quadrant: Array<[number, number, number]> = [
    [0, 90, radii.ne], [90, 180, radii.se], [180, 270, radii.sw], [270, 360, radii.nw]
  ];
  quadrant.forEach(([from, to, radius]) => {
    if (!Number.isFinite(radius) || radius <= 0) return;
    for (let deg = from; deg <= to; deg += stepDeg) {
      const a = deg * Math.PI / 180;
      offsets.push([(radius * Math.cos(a)) / 111.12, (radius * Math.sin(a)) / lonScale]);
    }
  });
  return offsets;
}

function findHistoryAtOrBefore(history: Typhoon["history"] | undefined, targetHour: number) {
  if (!history?.length || !Number.isFinite(targetHour)) return undefined;
  // Engine history is append-only and ordered by simHour. Binary search avoids cloning, filtering
  // and sorting the entire lifetime on every visual physics commit as long-lived storms grow.
  let lo = 0;
  let hi = history.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (Number(history[mid].simHour) <= targetHour + 1e-6) lo = mid + 1;
    else hi = mid;
  }
  return history[Math.max(0, lo - 1)];
}

function resolveSteppedWindRadii(typhoon: Typhoon, currentHour: number, historicalPlayback: boolean) {
  // Engine.ts is the single authority for the existing 3-hour wind-area issue clock.
  // Live simulation must read the latest Typhoon object directly: App.tsx deliberately exposes
  // currentHour as an integer UI cursor while typhoon.simHour can already be several 10-minute
  // physics steps ahead. Inferring "live vs replay" from those two clocks caused the live map
  // to fall back to an older hourly archive and show stale/missing R7/R10/R12 areas.
  // Timeline replay is explicit, so only replay resolves the archived state at-or-before the cursor.
  const archived = historicalPlayback ? findHistoryAtOrBefore(typhoon.history, currentHour) : undefined;
  const source = archived ?? typhoon;
  return {
    sourceHour: Number(source.simHour ?? currentHour),
    r7: copyWindQuadrants(source.r7 ?? typhoon.r7),
    r10: copyWindQuadrants(source.r10 ?? typhoon.r10),
    r12: copyWindQuadrants(source.r12 ?? typhoon.r12)
  };
}


function getContinuousStationColor(wind: number): string {
  const anchors = [
    [0, 16, 185, 129],    // emerald-500: #10b981 (weak wind, soft green)
    [10, 34, 197, 94],   // green-500: #22c55e
    [17, 234, 179, 8],   // yellow-500: #eab308
    [24, 249, 115, 22],  // orange-500: #f97316
    [32, 239, 68, 68],   // red-500: #ef4444
    [41, 220, 38, 38],   // red-700: #dc2626
    [51, 168, 85, 247]   // purple-500: #a855f7 (hurricane-force/extreme wind)
  ];
  if (wind <= 0) return `rgb(${anchors[0][1]}, ${anchors[0][2]}, ${anchors[0][3]})`;
  if (wind >= anchors[anchors.length - 1][0]) {
    const last = anchors[anchors.length - 1];
    return `rgb(${last[1]}, ${last[2]}, ${last[3]})`;
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const a1 = anchors[i];
    const a2 = anchors[i + 1];
    if (wind >= a1[0] && wind <= a2[0]) {
      const ratio = (wind - a1[0]) / (a2[0] - a1[0]);
      const r = Math.round(a1[1] + (a2[1] - a1[1]) * ratio);
      const g = Math.round(a1[2] + (a2[2] - a1[2]) * ratio);
      const b = Math.round(a1[3] + (a2[3] - a1[3]) * ratio);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return "rgb(16, 185, 129)";
}


 interface MapViewProps {
  /** Unique DOM viewport id for concurrently mounted sandbox and live maps. */
  viewportId?: string;
  initialViewport?: {center:[number,number];zoom:number};
  onMapReady?: (map: L.Map | null) => void;
  synopticSelectionActive?: boolean;
  typhoons: Typhoon[];
  layers: ActiveLayers;
  config: SimulationConfig;
  speed: number;
  currentHour: number;
  /** Historical timeline replay: use exact archived positions without visual interpolation. */
  historicalPlayback?: boolean;
  /** While dragging the timeline, only update the current center/camera; finalize all heavy layers on release. */
  timelineSeekPreview?: boolean;
  isPlaying?: boolean;
  startDate?: Date;
  onMapClickPlacement: (lat: number, lon: number, initialVmax?: number) => void;
  onMiddleClickPlacement?: (lat: number, lon: number) => void;
  placementMode: "main" | "genesis" | "home" | "none";
  onDeployTyphoon?: (mode: "main" | "genesis" | "home" | "none") => void;
  onSelectTrackPoint?: (hour: number) => void;
  isForecastRouteDrawing?: boolean;
  forecastRouteDraft?: Array<{ lat: number; lon: number }>;
  forecastRoutePreviewPoint?: { lat: number; lon: number; leadHour: number; vmax: number };
  onForecastRoutePoint?: (lat: number, lon: number) => void;
}



 export default function MapView({
  viewportId = "typhoon-gis-viewport",initialViewport,
  onMapReady, synopticSelectionActive = false,
  typhoons,
  layers,
  config,
  speed,
  currentHour,
  historicalPlayback = false,
  timelineSeekPreview = false,
  isPlaying = false,
  startDate,
  onMapClickPlacement,
  onMiddleClickPlacement,
  placementMode,
  onDeployTyphoon,
  onSelectTrackPoint,
  isForecastRouteDrawing = false,
  forecastRouteDraft = [],
  forecastRoutePreviewPoint,
  onForecastRoutePoint
}: MapViewProps) {
  // Shared pointer-capability flag. Round 29 accidentally declared this only inside the
  // initialization effect while later render effects also referenced it, causing the mobile
  // runtime crash `touchFirst is not defined`. Keep it in component scope so every effect uses
  // the same capability decision.
  const touchFirst = !!(typeof window !== "undefined" && (
    window.matchMedia?.("(pointer: coarse)")?.matches || window.matchMedia?.("(hover: none)")?.matches
  ));
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // On returning from an isolated Forecast page the live camera is restored
  // exactly once. A replay-mode follow effect must not recenter it before the
  // user makes the next timeline/camera action.
  const preserveRestoredCameraRef=useRef(!!initialViewport);
  const synopticSelectionActiveRef = useRef(synopticSelectionActive);
  synopticSelectionActiveRef.current = synopticSelectionActive;
  const rasterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rasterCacheKeyRef = useRef<string>("");
  const previousRasterConfigRef = useRef(config);
  const synopticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const synopticCacheKeyRef = useRef<string>("");
  // SST/OHC are baked into a reusable Web-Mercator image and handed to Leaflet as one overlay.
  // Pan/zoom then becomes a GPU-friendly image transform instead of thousands of field samples.
  const oceanTextureOverlayRef = useRef<L.ImageOverlay | null>(null);
  const oceanTextureCacheRef = useRef<Map<string, string>>(new Map());
  const oceanTextureTaskRef = useRef(0);
  const [selectedStation, setSelectedStation] = useState<{id: string, name: string, lat: number, lon: number, wind: number, pressure: number} | null>(null);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const tileLayerRef = useRef<L.Layer | null>(null);
  const stormTerrainOverlayRef = useRef<L.ImageOverlay | null>(null);
  const stormTerrainTaskRef = useRef(0);
  const pathGroupRef = useRef<L.FeatureGroup | null>(null);
  const forecastGeometryGroupRef = useRef<L.FeatureGroup | null>(null);
  const forecastPathFingerprintCacheRef = useRef<WeakMap<object, string>>(new WeakMap());
  // Multi-model guidance is an issued forecast product, not a frame-by-frame animation. Cache it
  // across the many lightweight UI commits between 3-hour guidance cycles.
  const modelGuidanceCacheRef = useRef<Map<string, ReturnType<typeof buildAetherCenterTrackGuidance>>>(new Map());
  const liveMotionGroupRef = useRef<L.FeatureGroup | null>(null);
  // Keep the 60-fps live-centre animation on its own renderer. Reusing the map's main Canvas
  // renderer would invalidate and repaint every track/radius Canvas layer whenever the centre moves.
  const liveMotionRendererRef = useRef<L.Renderer | null>(null);
  const nodeHitRendererRef = useRef<L.Renderer | null>(null);
  const liveMotionMarkerRef = useRef<L.CircleMarker | L.Marker | null>(null);
  const liveMotionHitAreaRef = useRef<L.CircleMarker | null>(null);
  const liveMotionLineRef = useRef<L.Polyline | null>(null);
  // Active wind radii share the exact same interpolated centre as the live marker. Keeping them
  // on a dedicated renderer prevents 30/60-fps radius translation from repainting historical paths.
  const liveRadiiGroupRef = useRef<L.FeatureGroup | null>(null);
  const liveRadiiRendererRef = useRef<L.Renderer | null>(null);
  const liveRadiiLayersRef = useRef<Array<
    | { kind: "polygon"; layer: L.Polygon; level: LiveRadiiLevel }
    | {
        kind: "circle"; layer: L.Circle; level: "r7" | "r10";
        currentLatOffset: number; currentLonOffset: number; currentRadiusKm: number;
        fromLatOffset: number; fromLonOffset: number; fromRadiusKm: number;
        targetLatOffset: number; targetLonOffset: number; targetRadiusKm: number;
        startedAt: number; durationMs: number;
      }
  >>([]);
  const liveRadiiMotionRef = useRef({
    initialized: false,
    startedAt: 0,
    durationMs: 150,
    from: { r7: null as WindQuadrants | null, r10: null as WindQuadrants | null, r12: null as WindQuadrants | null },
    current: { r7: null as WindQuadrants | null, r10: null as WindQuadrants | null, r12: null as WindQuadrants | null },
    target: { r7: null as WindQuadrants | null, r10: null as WindQuadrants | null, r12: null as WindQuadrants | null }
  });
  const lastLiveRadiiFrameRef = useRef(0);
  // A drag/zoom intentionally suppresses per-frame Leaflet mutations. Remember if the physical
  // centre/radii advanced during that lock so the first post-gesture frame cannot leave the wind
  // envelope stranded at its pre-gesture coordinates.
  const liveOverlayNeedsSyncRef = useRef(false);
  const liveMotionRafRef = useRef<number | null>(null);
  const liveMotionIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRadiiGeometryKeyRef = useRef("");
  const liveMotionRef = useRef({
    initialized: false, lat: 0, lon: 0, fromLat: 0, fromLon: 0, targetLat: 0, targetLon: 0,
    startedAt: 0, durationMs: 120, lastTargetAt: 0, lastFrameAt: 0, targetIntervalMs: 160,
    anchorLat: 0, anchorLon: 0, visible: false
  });
  // Programmatic follow panning fires Leaflet move/moveend just like a user gesture. Keep a short
  // marker so those internal camera updates do not drive React cursor state at animation FPS.
  const followPanUntilRef = useRef(0);
  const lastFollowDiagnosticAtRef = useRef(0);
  const archivedPathGroupRef = useRef<L.FeatureGroup | null>(null);
  // Completed season tracks are immutable. Keep the Leaflet layer objects so live updates only
  // rebuild the active cyclone instead of recreating every archived storm on every UI commit.
  const archivedTrackLayerCacheRef = useRef<Map<string, { key: string; layers: L.Layer[] }>>(new Map());
  const guidanceGroupRef = useRef<L.FeatureGroup | null>(null);
  const radiiGroupRef = useRef<L.FeatureGroup | null>(null);
  const landGroupRef = useRef<L.FeatureGroup | null>(null);
  const stationsGroupRef = useRef<L.FeatureGroup | null>(null);
  const transientGroupRef = useRef<L.FeatureGroup | null>(null);
  const stationMarkersRef = useRef<{ [key: string]: L.Marker }>({});
  const stationIconCacheRef = useRef<Map<string, L.DivIcon>>(new Map());
  const categoryColorsKey = useMemo(() => JSON.stringify(config.categoryColors || {}), [config.categoryColors]);

  const [mapZoom, setMapZoom] = useState(4);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [cursorExpanded, setCursorExpanded] = useState(false);
  const [openStationName, setOpenStationName] = useState<string | null>(null);
  const [stationNameRevision, setStationNameRevision] = useState(0);
  const stationNameRevisionRef = useRef(0);
  const [activeHistoryStation, setActiveHistoryStation] = useState<{ id: string; name: string; lat: number; lon: number; temporary?: boolean } | null>(null);
  const [pendingGenesisPoint, setPendingGenesisPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [pendingGenesisIntensity, setPendingGenesisIntensity] = useState<5 | 12 | 15 | 18>(15);
  const [temporaryStationPoint, setTemporaryStationPoint] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [stationPlacementTransition, setStationPlacementTransition] = useState<{ lat: number; lon: number } | null>(null);
  const [mapInitialized, setMapInitialized] = useState(false);

  const [geoJsonState, setGeoJsonState] = useState(() => getLoaderState());
  useEffect(() => {
    return subscribeLoaderState(setGeoJsonState);
  }, []);

  useEffect(() => {
    (window as any).showStationHistory = (name: string, lat: number, lon: number) => {
      setActiveHistoryStation({ id: name, name, lat, lon });
    };
    const refreshStationNames = () => setStationNameRevision((value) => value + 1);
    window.addEventListener("aether:station-name-changed", refreshStationNames);
    return () => {
      delete (window as any).showStationHistory;
      window.removeEventListener("aether:station-name-changed", refreshStationNames);
    };
  }, []);

  // Sync props to refs to avoid stale closure issues in Leaflet listeners and canvas render loops
  const placementModeRef = useRef(placementMode);
  const onMapClickPlacementRef = useRef(onMapClickPlacement);
  const onMiddleClickPlacementRef = useRef(onMiddleClickPlacement);
  const isForecastRouteDrawingRef = useRef(isForecastRouteDrawing);
  const onForecastRoutePointRef = useRef(onForecastRoutePoint);
  const routeDrawingWasActiveRef = useRef(false);
  // Middle-button gestures are navigation only. Suppress the subsequent synthetic click.
  const middlePanRef = useRef({ active: false, x: 0, y: 0, moved: false, suppressClickUntil: 0 });
  const clickSequenceRef = useRef<{ count: number; lastAt: number; x: number; y: number; lat: number; lon: number; firstLat: number; firstLon: number }>({ count: 0, lastAt: 0, x: 0, y: 0, lat: 0, lon: 0, firstLat: 0, firstLon: 0 });
  const clickSequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTrackClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   const onSelectTrackPointRef = useRef(onSelectTrackPoint);
  const configRef = useRef(config);
  const typhoonsRef = useRef(typhoons);
  const layersRef = useRef(layers);
  const mapZoomRef = useRef(mapZoom);
  const currentHourRef = useRef(currentHour);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => {
    onSelectTrackPointRef.current = onSelectTrackPoint;
  }, [onSelectTrackPoint]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    placementModeRef.current = placementMode;
  }, [placementMode]);

  useEffect(() => {
    isForecastRouteDrawingRef.current = isForecastRouteDrawing;
  }, [isForecastRouteDrawing]);

  useEffect(() => {
    onForecastRoutePointRef.current = onForecastRoutePoint;
  }, [onForecastRoutePoint]);

  useEffect(() => {
    onMapClickPlacementRef.current = onMapClickPlacement;
  }, [onMapClickPlacement]);

  useEffect(() => {
    onMiddleClickPlacementRef.current = onMiddleClickPlacement;
  }, [onMiddleClickPlacement]);

  useEffect(() => {
    configRef.current = config;
    // Speed-wheel, drawn routes and UI-only controls do not change the environmental raster.
    // Rebuilding the entire viewport on each 2-km/h mouse-wheel step caused visible stutters.
    const previous = previousRasterConfigRef.current;
    previousRasterConfigRef.current = config;
    const environmentalChange = Object.keys(config).some(key =>
      !MAPVIEW_UI_ONLY_CONFIG_KEYS.has(key) && (config as unknown as Record<string, unknown>)[key] !==
        (previous as unknown as Record<string, unknown>)[key]
    );
    if (environmentalChange) {
      rasterCacheKeyRef.current = "";
    }
  }, [config]);

  useEffect(() => {
    typhoonsRef.current = typhoons;
  }, [typhoons]);

  useEffect(() => {
    currentHourRef.current = currentHour;
  }, [currentHour]);

  const updateTemporaryStationName = (name: string) => {
    setTemporaryStationPoint((prev) => prev ? { ...prev, name } : prev);
    setActiveHistoryStation((prev) => prev?.temporary ? { ...prev, name, id: `temp-${name}-${prev.lat.toFixed(4)}-${prev.lon.toFixed(4)}` } : prev);
  };

  const updateTemporaryStationLocation = (lat: number, lon: number, name: string) => {
    setTemporaryStationPoint((prev) => prev ? { ...prev, lat, lon, name } : { lat, lon, name });
    setActiveHistoryStation((prev) => prev?.temporary
      ? { ...prev, lat, lon, name, id: `temp-${name}-${lat.toFixed(4)}-${lon.toFixed(4)}` }
      : prev);
  };

  // Explicit confirmation bridge for the Leaflet-anchored triple-click placement marker.
  // Keeping the controls in the map pane makes them stay attached to the selected coordinate
  // while the user pans/zooms instead of floating at the top of the screen.
  useEffect(() => {
    (window as any).confirmPendingTyphoonGenesis = () => {
      setPendingGenesisPoint((point) => {
        if (point) onMapClickPlacementRef.current(point.lat, point.lon, pendingGenesisIntensity);
        return null;
      });
    };
    (window as any).setPendingTyphoonGenesisIntensity = (value: number) => {
      if (value === 5 || value === 12 || value === 15 || value === 18) setPendingGenesisIntensity(value);
    };
    (window as any).cancelPendingTyphoonGenesis = () => setPendingGenesisPoint(null);
    return () => {
      delete (window as any).confirmPendingTyphoonGenesis;
      delete (window as any).cancelPendingTyphoonGenesis;
      delete (window as any).setPendingTyphoonGenesisIntensity;
    };
  }, [pendingGenesisIntensity]);

  const snapTemporaryStationNameToNearestLand = async () => {
    const station = activeHistoryStation;
    if (!station?.temporary) return;
    let best: { lat: number; lon: number } | null = null;
    outer: for (let radiusKm = 5; radiusKm <= 320; radiusKm += radiusKm < 60 ? 5 : 10) {
      for (let bearing = 0; bearing < 360; bearing += 15) {
        const rad = bearing * Math.PI / 180;
        const lat = station.lat + (radiusKm * Math.cos(rad)) / 111.12;
        const lon = station.lon + (radiusKm * Math.sin(rad)) / (111.12 * Math.max(0.2, Math.cos(station.lat * Math.PI / 180)));
        if (getLandMetrics(lat, lon, configRef.current?.coastlineSource).isLand) {
          best = { lat, lon };
          break outer;
        }
      }
    }
    if (!best) return;
    const resolved = await fetchOsmStationName(best.lat, best.lon, configRef.current?.coastlineSource);
    const snappedName = stationCityName(resolved && resolved !== "洋面站点" ? resolved : "临时检测点", best.lat, best.lon);
    // "Snap to nearest land" now moves the temporary observation coordinate itself. Previously it
    // only renamed an ocean point after querying a nearby city, so the UI could claim a land station
    // while its meteorological reconstruction still sampled the original sea coordinate.
    updateTemporaryStationLocation(best.lat, best.lon, snappedName);
  };

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    mapZoomRef.current = mapZoom;
  }, [mapZoom]);

  const animationFrameRef = useRef<number | null>(null);
  const canvasIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCanvasFrameRef = useRef<number>(0);
  // Adaptive display-only quality: never drop simulation steps or modify storm physics.
  // Hysteresis prevents constant quality flipping on slower desktop graphics drivers.
  const renderBudgetRef = useRef({ last: 0, averageMs: 16.7, samples: 0, degraded: touchFirst, nextVisualAt: 0 });
  // During a user drag/pinch Leaflet temporarily transforms every pane as one visual unit. Do not
  // mutate the fast live-centre/radii canvases inside that gesture: doing so creates a second
  // coordinate update stream and can visually detach overlays until the gesture ends.
  const mapGestureActiveRef = useRef(false);
  const mapGestureReleaseRafRef = useRef<number | null>(null);

  // --- 1. Map Initialization ---
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Bulletproof reset of Leaflet container to prevent "Map container is already initialized" error
    if ((mapContainerRef.current as any)._leaflet_id !== undefined) {
      (mapContainerRef.current as any)._leaflet_id = null;
    }
    mapContainerRef.current.innerHTML = "";

    // Default center at 21°N, 134°E (covering NW Pacific)
    const map = L.map(mapContainerRef.current, {
      center: initialViewport?.center ?? [20.0, 134.0],
      zoom: initialViewport?.zoom ?? 4,
      minZoom: 3,
      maxZoom: 20,
      zoomSnap: 0,
      zoomDelta: 0.5,
      zoomControl: false,
      // WMC supplies its own workstation chrome; suppress Leaflet's bottom-right badge.
      attributionControl: false,
      preferCanvas: true,
      doubleClickZoom: false,
      scrollWheelZoom: true,
      // Fractional zoom + reduced wheel sensitivity avoids huge jumps; debounce bounds raster work.
      wheelDebounceTime: 55,
      wheelPxPerZoomLevel: 170,
      boxZoom: true,
      keyboard: false,
      touchZoom: true
    });

    mapRef.current = map;
    onMapReady?.(map);
    setMapZoom(map.getZoom());
    // Explicit map panes keep offline land geometry below every cyclone overlay.
    // Leaflet's default vector pane is z=400, so putting filled GeoJSON land there can
    // cover wind radii/path layers depending on insertion order.  The basemap pane stays
    // below tiles; the optional coastline overlay stays above tiles but below weather data.
    if (!map.getPane("basemapVectorPane")) {
      map.createPane("basemapVectorPane");
      map.getPane("basemapVectorPane")!.style.zIndex = "180";
      map.getPane("basemapVectorPane")!.style.pointerEvents = "none";
    }
    if (!map.getPane("terrainBasemapPane")) {
      map.createPane("terrainBasemapPane");
      map.getPane("terrainBasemapPane")!.style.zIndex = "185";
      map.getPane("terrainBasemapPane")!.style.pointerEvents = "none";
    }
    if (!map.getPane("environmentTexturePane")) {
      map.createPane("environmentTexturePane");
      map.getPane("environmentTexturePane")!.style.zIndex = "300";
      map.getPane("environmentTexturePane")!.style.pointerEvents = "none";
    }
    if (!map.getPane("coastlinePane")) {
      map.createPane("coastlinePane");
      map.getPane("coastlinePane")!.style.zIndex = "330";
      map.getPane("coastlinePane")!.style.pointerEvents = "none";
    }

    // Custom Leaflet Map Panes for touch priority: Stations (600) > Path Points (500) > Wind Radii (400)
    if (!map.getPane("radiiPane")) {
      map.createPane("radiiPane");
      map.getPane("radiiPane")!.style.zIndex = "400";
    }
    if (!map.getPane("guidancePane")) {
      map.createPane("guidancePane");
      map.getPane("guidancePane")!.style.zIndex = "470";
    }
    if (!map.getPane("pathPane")) {
      map.createPane("pathPane");
      map.getPane("pathPane")!.style.zIndex = "500";
    }
    // Hover targets are in a higher pane than the non-interactive Canvas paths. A separate
    // SVG renderer prevents the full-screen path Canvas from swallowing hover events.
    if (!map.getPane("trackHitPane")) {
      map.createPane("trackHitPane");
      map.getPane("trackHitPane")!.style.zIndex = "585";
    }
    if (!map.getPane("stationsPane")) {
      map.createPane("stationsPane");
      map.getPane("stationsPane")!.style.zIndex = "600";
    }

    // Feature Groups assigned to respective zIndex panes
    const canvasRenderer = L.canvas({ padding: 0.5 });
    const liveMotionRenderer = L.canvas({ pane: "pathPane", padding: 0.08 });
    nodeHitRendererRef.current = L.svg({ pane: "trackHitPane", padding: 0.08 });
    const liveRadiiRenderer = L.canvas({ pane: "radiiPane", padding: 0.10 });
    liveMotionRendererRef.current = liveMotionRenderer;
    liveRadiiRendererRef.current = liveRadiiRenderer;
    // The Natural Earth basemap is static, non-interactive geometry.  A dedicated Canvas
    // renderer avoids creating thousands of SVG DOM nodes and keeps pan/zoom smooth on mobile.
    const basemapVectorRenderer = L.canvas({ pane: "basemapVectorPane", padding: 0.18 });
    const coastlineRenderer = L.canvas({ pane: "coastlinePane", padding: 0.18 });
    (map as any)._basemapVectorRenderer = basemapVectorRenderer;
    (map as any)._coastlineRenderer = coastlineRenderer;
    landGroupRef.current = L.featureGroup().addTo(map);
    radiiGroupRef.current = L.featureGroup([], { pane: "radiiPane" }).addTo(map);
    liveRadiiGroupRef.current = L.featureGroup([], { pane: "radiiPane" }).addTo(map);
    guidanceGroupRef.current = L.featureGroup([], { pane: "guidancePane" }).addTo(map);
    archivedPathGroupRef.current = L.featureGroup([], { pane: "pathPane" }).addTo(map);
    pathGroupRef.current = L.featureGroup([], { pane: "pathPane" }).addTo(map);
    forecastGeometryGroupRef.current = L.featureGroup([], { pane: "pathPane" }).addTo(map);
    liveMotionGroupRef.current = L.featureGroup([], { pane: "pathPane" }).addTo(map);
    stationsGroupRef.current = L.featureGroup([], { pane: "stationsPane" }).addTo(map);
    transientGroupRef.current = L.featureGroup([], { pane: "stationsPane" }).addTo(map);

    (map as any)._canvasRenderer = canvasRenderer; // store for easy access

    // Event listeners are registered below after the shared gesture helpers are available.

    const beginUserMapGesture = () => {
      if (mapGestureReleaseRafRef.current !== null) {
        cancelAnimationFrame(mapGestureReleaseRafRef.current);
        mapGestureReleaseRafRef.current = null;
      }
      mapGestureActiveRef.current = true;
      document.documentElement.classList.add("aether-map-interacting");
      // Make the external weather canvas redraw at display cadence while Leaflet is transforming.
      lastCanvasFrameRef.current = 0;
    };
    const settleUserMapGesture = () => {
      if (mapGestureReleaseRafRef.current !== null) cancelAnimationFrame(mapGestureReleaseRafRef.current);
      mapGestureReleaseRafRef.current = requestAnimationFrame(() => {
        mapGestureReleaseRafRef.current = null;
        mapGestureActiveRef.current = false;
        document.documentElement.classList.remove("aether-map-interacting");
        setMapZoom(map.getZoom());
        lastCanvasFrameRef.current = 0;
        // Snap each Canvas renderer to the same post-gesture map transform. Optional chaining keeps
        // compatibility with Leaflet renderer implementations that do not expose redraw publicly.
        [
          (map as any)._canvasRenderer,
          liveMotionRenderer,
          liveRadiiRenderer,
          (map as any)._basemapVectorRenderer,
          (map as any)._coastlineRenderer
        ].forEach((renderer) => renderer?.redraw?.());
      });
    };
    map.on("dragstart", beginUserMapGesture);
    map.on("zoomstart", beginUserMapGesture);
    // Keep the lock through Leaflet's post-touch inertia / animated zoom transform. `moveend` is
    // the point at which all panes have reached one final transform, so releasing on dragend alone
    // can be one animation phase too early on phones.
    map.on("moveend", () => {
      if (mapGestureActiveRef.current) settleUserMapGesture();
    });
    map.on("zoomend", () => {
      if (!mapGestureActiveRef.current) setMapZoom(map.getZoom());
    });


    const handleMapMove = () => {
      if (!layersRef.current.cursor) return;
      const now = performance.now();
      const programmaticFollow = now < followPanUntilRef.current;
      if (programmaticFollow) {
        const minDiagnosticInterval = touchFirst ? 180 : 110;
        if (now - lastFollowDiagnosticAtRef.current < minDiagnosticInterval) return;
        lastFollowDiagnosticAtRef.current = now;
      }
      const center = map.getCenter();
      setCursorCoords({ lat: center.lat, lon: center.lng });
    };
    map.on("moveend", handleMapMove);

    // Cursor coordinates are display-only diagnostics; seed them only when the panel is visible.
    if (layersRef.current.cursor) {
      setCursorCoords({ lat: map.getCenter().lat, lon: map.getCenter().lng });
    }



    map.on("click", (e: L.LeafletMouseEvent) => {
      if (synopticSelectionActiveRef.current) return;
      if (performance.now() < middlePanRef.current.suppressClickUntil ||
          (e.originalEvent instanceof MouseEvent && e.originalEvent.button !== 0)) return;
      if (isForecastRouteDrawingRef.current && e.latlng) {
        onForecastRoutePointRef.current?.(e.latlng.lat, e.latlng.lng);
        return;
      }
      if (!e.latlng) return;
      if (placementModeRef.current !== "none") {
        // The desktop cyclone placement gesture is exclusively a double middle click; retain
        // the legacy direct placement only for touch interfaces and the home-location selector.
        if (placementModeRef.current !== "home" &&
            (e.originalEvent instanceof MouseEvent) && window.matchMedia?.("(pointer: fine)").matches) return;
        // Consume placement synchronously before React state/effects flush. A browser double-click
        // emits two click events; without this guard the second click could still observe the old
        // placement mode and relocate the freshly placed cyclone instead of becoming a station gesture.
        placementModeRef.current = "none";
        clickSequenceRef.current = { count: 0, lastAt: 0, x: 0, y: 0, lat: 0, lon: 0, firstLat: 0, firstLon: 0 };
        if (clickSequenceTimerRef.current) clearTimeout(clickSequenceTimerRef.current);
        setStationPlacementTransition(null);
        onMapClickPlacementRef.current(e.latlng.lat, e.latlng.lng);
        return;
      }

      // Unified tap resolver. Ignore clicks originating from Leaflet controls/popups/markers:
      // these used to bubble into the map and could accidentally advance the genesis tap counter.
      const originalTarget = e.originalEvent?.target as HTMLElement | null;
      if (originalTarget?.closest?.(".leaflet-control, .leaflet-popup, .leaflet-marker-icon, .leaflet-tooltip, button, input, select, a")) return;

      // A single tap is reserved for track-point selection and a double tap creates a temporary
      // diagnostic station. Cyclone genesis is never armed by an implicit multi-click gesture:
      // it must go through the explicit placement mode, which prevents exploratory clicks from
      // accidentally opening a new-storm placement workflow.
      const now = performance.now();
      const seq = clickSequenceRef.current;
      const cp = e.containerPoint || map.latLngToContainerPoint(e.latlng);
      const closeInTime = now - seq.lastAt <= 430;
      const closeInSpace = Math.hypot(cp.x - seq.x, cp.y - seq.y) <= 26;
      seq.count = closeInTime && closeInSpace ? seq.count + 1 : 1;
      if (seq.count === 1) {
        // Triple-click placement is confirmed at the position of the FIRST click, not the last
        // browser click in the gesture. This makes rapid touch/mouse placement predictable.
        seq.firstLat = e.latlng.lat;
        seq.firstLon = e.latlng.lng;
      }
      seq.lastAt = now;
      seq.x = cp.x;
      seq.y = cp.y;
      seq.lat = e.latlng.lat;
      seq.lon = e.latlng.lng;
      if (clickSequenceTimerRef.current) clearTimeout(clickSequenceTimerRef.current);

      const hasSimulation = typhoonsRef.current.length > 0;
      if (seq.count >= 2 && pendingTrackClickTimerRef.current) {
        clearTimeout(pendingTrackClickTimerRef.current);
        pendingTrackClickTimerRef.current = null;
        map.closePopup();
      }
      if (seq.count === 2 && hasSimulation) {
        // Show an immediate visual acknowledgement while the gesture resolver waits briefly before
        // opening the temporary station. This removes the previous ~0.7 s "frozen" feeling.
        setStationPlacementTransition({ lat: e.latlng.lat, lon: e.latlng.lng });
      }

      if (seq.count >= 3) {
        if (clickSequenceTimerRef.current) clearTimeout(clickSequenceTimerRef.current);
        // Touch users keep the historical three-tap genesis workflow. Mouse users must double
        // middle-click instead: ordinary three left clicks cannot relocate or create a cyclone.
        const desktopMouse = e.originalEvent instanceof MouseEvent && window.matchMedia?.("(pointer: fine)").matches;
        if (desktopMouse) {
          clickSequenceRef.current = { count: 0, lastAt: 0, x: 0, y: 0, lat: 0, lon: 0, firstLat: 0, firstLon: 0 };
          setStationPlacementTransition(null);
          return;
        }
        const firstPoint = { lat: seq.firstLat || e.latlng.lat, lon: seq.firstLon || e.latlng.lng };
        clickSequenceRef.current = { count: 0, lastAt: 0, x: 0, y: 0, lat: 0, lon: 0, firstLat: 0, firstLon: 0 };
        setStationPlacementTransition(null);
        setTemporaryStationPoint(null);
        // 3.5.8: rapid triple click arms cyclone placement/re-placement.  It never immediately
        // mutates the simulation: a small white point with explicit confirm/cancel controls is
        // shown at the FIRST click coordinate.
        setPendingGenesisIntensity(15);
        setPendingGenesisPoint(firstPoint);
        if (touchFirst) navigator.vibrate?.([10, 30, 10]);
        return;
      }

      clickSequenceTimerRef.current = setTimeout(() => {
        const finalSeq = clickSequenceRef.current;
        clickSequenceRef.current = { count: 0, lastAt: 0, x: 0, y: 0, lat: 0, lon: 0, firstLat: 0, firstLon: 0 };
        if (finalSeq.count === 2 && hasSimulation) {
          const lat = finalSeq.lat;
          const lon = finalSeq.lon;
          setPendingGenesisPoint(null);
          const land = getLandMetrics(lat, lon, configRef.current?.coastlineSource).isLand;
          const provisional = land ? "临时检测点" : "洋面站点";
          setTemporaryStationPoint({ lat, lon, name: provisional });
          setActiveHistoryStation({ id: `temp-${lat.toFixed(4)}-${lon.toFixed(4)}`, name: provisional, lat, lon, temporary: true });
          setStationPlacementTransition(null);
          if (land) {
            fetchOsmStationName(lat, lon, configRef.current?.coastlineSource).then((resolved) => {
              const name = stationCityName(resolved || "临时检测点", lat, lon);
              setTemporaryStationPoint((prev) => prev && Math.abs(prev.lat - lat) < 1e-5 && Math.abs(prev.lon - lon) < 1e-5 ? { ...prev, name } : prev);
              setActiveHistoryStation((prev) => prev?.temporary && Math.abs(prev.lat - lat) < 1e-5 && Math.abs(prev.lon - lon) < 1e-5 ? { ...prev, name, id: `temp-${name}-${lat.toFixed(4)}-${lon.toFixed(4)}` } : prev);
            }).catch(() => {});
          }
        } else {
          setStationPlacementTransition(null);
        }
      }, 300);
    });

    // A crop gesture may pan/zoom the map, but must never arm a placement,
    // station popup or clickable track/marker. Intercept clicks in the capture
    // phase while keeping pointerdown/move and wheel zoom fully functional.
    const captureSelectionClick = (event: MouseEvent) => {
      if (!synopticSelectionActiveRef.current) return;
      event.stopImmediatePropagation();
      event.stopPropagation();
      event.preventDefault();
    };
    map.getContainer().addEventListener("click", captureSelectionClick, true);

    map.on("popupclose", () => {
      setOpenStationName(null);
    });

    setMapInitialized(true);

    return () => {
      if (clickSequenceTimerRef.current) clearTimeout(clickSequenceTimerRef.current);
      if (pendingTrackClickTimerRef.current) clearTimeout(pendingTrackClickTimerRef.current);
      if (mapGestureReleaseRafRef.current !== null) cancelAnimationFrame(mapGestureReleaseRafRef.current);
      mapGestureReleaseRafRef.current = null;
      mapGestureActiveRef.current = false;
      document.documentElement.classList.remove("aether-map-interacting");
      map.getContainer().removeEventListener("click", captureSelectionClick, true);
      onMapReady?.(null);
      map.remove();
      mapRef.current = null;
      liveMotionRendererRef.current = null;
      liveRadiiRendererRef.current = null;
      liveRadiiGroupRef.current = null;
      liveRadiiLayersRef.current = [];
    };
  }, []);

  // Recover Leaflet after a mobile page-lifecycle suspension. A background transition can happen
  // between touchstart/touchend, leaving Leaflet.Draggable or TouchZoom internally "down" even
  // though the browser has discarded the finger sequence. Rebinding the two gesture handlers is a
  // deliberate soft reset and is substantially safer than touching Leaflet's private pointer ids.
  useEffect(() => {
    let restoreRaf1 = 0;
    let restoreRaf2 = 0;
    const handleRestore = () => {
      if (document.visibilityState === "hidden") return;
      const map = mapRef.current;
      if (!map) return;

      if (mapGestureReleaseRafRef.current !== null) {
        cancelAnimationFrame(mapGestureReleaseRafRef.current);
        mapGestureReleaseRafRef.current = null;
      }
      mapGestureActiveRef.current = false;
      document.documentElement.classList.remove("aether-map-interacting");
      lastCanvasFrameRef.current = 0;
      map.stop();

      const container = map.getContainer();
      container.style.touchAction = "none";
      container.style.removeProperty("pointer-events");

      try {
        if (map.dragging?.enabled()) {
          map.dragging.disable();
          map.dragging.enable();
        }
        if ((map.touchZoom as any)?.enabled?.()) {
          (map.touchZoom as any).disable();
          (map.touchZoom as any).enable();
        }
      } catch (error) {
        console.warn("[MapView] gesture handler restore failed", error);
      }

      cancelAnimationFrame(restoreRaf1);
      cancelAnimationFrame(restoreRaf2);
      restoreRaf1 = requestAnimationFrame(() => {
        map.invalidateSize({ pan: false, animate: false });
        restoreRaf2 = requestAnimationFrame(() => {
          map.invalidateSize({ pan: false, animate: false });
          setMapZoom(map.getZoom());
          [
            (map as any)._canvasRenderer,
            liveMotionRendererRef.current,
            liveRadiiRendererRef.current,
            (map as any)._basemapVectorRenderer,
            (map as any)._coastlineRenderer
          ].forEach((renderer) => renderer?.redraw?.());
        });
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") handleRestore();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", handleRestore);
    window.addEventListener("pageshow", handleRestore);
    window.addEventListener("resize", handleRestore);
    window.addEventListener("app-foreground-restored", handleRestore);

    return () => {
      cancelAnimationFrame(restoreRaf1);
      cancelAnimationFrame(restoreRaf2);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", handleRestore);
      window.removeEventListener("pageshow", handleRestore);
      window.removeEventListener("resize", handleRestore);
      window.removeEventListener("app-foreground-restored", handleRestore);
    };
  }, []);

  // Sync Placement Mode Cursor style
  useEffect(() => {
    const mapContainer = mapContainerRef.current;
    if (!mapContainer) return;
    if (placementMode !== "none" || isForecastRouteDrawing) {
      mapContainer.style.cursor = "crosshair";
    } else {
      mapContainer.style.cursor = "";
    }
  }, [placementMode, isForecastRouteDrawing]);

  // Desktop map navigation: mouse wheel and shift-drag box zoom are first-class controls.
  // Leaflet keyboard panning stays disabled because the arrow keys steer the cyclone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.doubleClickZoom.disable();
    if (config.controlMode === "draw" && isPlaying) map.scrollWheelZoom.disable();
    else map.scrollWheelZoom.enable();
    const desktopLockedDrawing = !touchFirst && (isForecastRouteDrawing);
    const mobileDrawing = touchFirst && (isForecastRouteDrawing);
    if (desktopLockedDrawing) {
      // Desktop drawing reserves the primary button for nodes and keeps middle-button panning.
      map.dragging.disable();
      map.boxZoom.disable();
      map.touchZoom.disable();
    } else {
      // Phone drawing uses the same gesture model for forecast routes and dry-air polygons:
      // one-finger drag pans, a stationary tap emits the Leaflet click that adds a node, and
      // two fingers keep native pinch zoom. Leaflet suppresses click after a real drag.
      map.dragging.enable();
      map.boxZoom.enable();
      map.touchZoom.enable();
      if (mobileDrawing) map.boxZoom.disable();
    }
    map.keyboard.disable();
    if (isForecastRouteDrawing && !routeDrawingWasActiveRef.current) map.closePopup();
    routeDrawingWasActiveRef.current = isForecastRouteDrawing;
  }, [isForecastRouteDrawing, config.controlMode, isPlaying, mapInitialized, touchFirst]);

  // Two stationary middle clicks within 370 ms place a storm. A single middle click or a
  // middle-button drag never changes cyclone coordinates. Touch keeps existing gesture flow.
  useEffect(() => {
    const container = mapContainerRef.current;
    const map = mapRef.current;
    if (!container || !map || !mapInitialized) return;
    let downX = 0, downY = 0, downValid = false;
    let previousTime = 0, previousX = 0, previousY = 0;
    const down = (e: MouseEvent) => {
      if (e.button !== 1 || (e.target as HTMLElement)?.closest?.('button,input,.leaflet-control')) return;
      e.preventDefault();
      // Clear stale pan state from an earlier drawing session; this gesture has its own delta check.
      middlePanRef.current.moved = false;
      downValid = true; downX = e.clientX; downY = e.clientY;
    };
    const up = (e: MouseEvent) => {
      if (e.button !== 1 || !downValid) return;
      downValid = false;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5 ||
          isForecastRouteDrawingRef.current || middlePanRef.current.moved) {
        previousTime = 0; return;
      }
      const now = performance.now();
      if (now - previousTime <= 370 && Math.hypot(e.clientX - previousX, e.clientY - previousY) < 14) {
        previousTime = 0;
        const point = map.mouseEventToLatLng(e);
        onMiddleClickPlacementRef.current?.(point.lat, point.lng);
      } else {
        previousTime = now; previousX = e.clientX; previousY = e.clientY;
      }
    };
    const suppress = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    container.addEventListener('mousedown', down, true);
    container.addEventListener('auxclick', suppress, true);
    window.addEventListener('mouseup', up, true);
    return () => {
      container.removeEventListener('mousedown', down, true);
      container.removeEventListener('auxclick', suppress, true);
      window.removeEventListener('mouseup', up, true);
    };
  }, [mapInitialized]);

  // Leaflet dragging uses the primary mouse button. During path drawing, use a separate
  // middle-button pan handler with RAF coalescing; never feed this gesture to cyclone placement.
  useEffect(() => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container || !(isForecastRouteDrawing)) return;
    const pane = map.getPane("mapPane");
    if (!pane) return;
    let startX = 0, startY = 0, totalX = 0, totalY = 0;
    let panFrame = 0;
    let base = L.point(0, 0);
    const restorePane = () => L.DomUtil.setPosition(pane, base);
    const down = (event: MouseEvent) => {
      if (event.button !== 1 || (event.target as HTMLElement)?.closest?.('.leaflet-control,button,input')) return;
      event.preventDefault();event.stopPropagation();
      base = L.DomUtil.getPosition(pane)?.clone() || L.point(0, 0);
      startX = event.clientX;startY = event.clientY;totalX = totalY = 0;
      middlePanRef.current = {active:true,x:startX,y:startY,moved:false,suppressClickUntil:performance.now()+500};
      // Preview only the Leaflet map pane (single compositor transform).  Calling map.panBy
      // on each mousemove used to trigger all raster/move listeners dozens of times per second.
      pane.style.willChange = 'transform';container.style.cursor = 'grabbing';
      document.documentElement.classList.add('aether-map-interacting');
    };
    const move = (event: MouseEvent) => {
      if (!middlePanRef.current.active) return;
      event.preventDefault();event.stopPropagation();
      totalX = event.clientX - startX;totalY = event.clientY - startY;
      middlePanRef.current.moved ||= Math.abs(totalX)+Math.abs(totalY)>2;
      if (!panFrame) panFrame = requestAnimationFrame(() => {
        panFrame = 0;
        if (middlePanRef.current.active) L.DomUtil.setPosition(pane, base.add(L.point(totalX,totalY)));
      });
    };
    const up = (event: MouseEvent) => {
      if (!middlePanRef.current.active || event.button !== 1) return;
      event.preventDefault();event.stopPropagation();
      middlePanRef.current.active = false;
      middlePanRef.current.suppressClickUntil = performance.now()+500;
      if (panFrame) cancelAnimationFrame(panFrame);
      panFrame = 0;
      restorePane();pane.style.willChange = '';container.style.cursor = 'crosshair';
      document.documentElement.classList.remove('aether-map-interacting');
      if (Math.abs(totalX)+Math.abs(totalY)>1) map.panBy([-totalX,-totalY],{animate:false});
    };
    const contextMenu = (event: MouseEvent) => event.preventDefault();
    container.addEventListener('mousedown',down,true);
    container.addEventListener('auxclick',contextMenu,true);
    window.addEventListener('mousemove',move,true);
    window.addEventListener('mouseup',up,true);
    return () => {
      container.removeEventListener('mousedown',down,true);
      container.removeEventListener('auxclick',contextMenu,true);
      window.removeEventListener('mousemove',move,true);
      window.removeEventListener('mouseup',up,true);
      if (panFrame) cancelAnimationFrame(panFrame);
      if (middlePanRef.current.active) restorePane();
      middlePanRef.current.active=false;pane.style.willChange='';container.style.cursor='';
      document.documentElement.classList.remove('aether-map-interacting');
    };
  }, [isForecastRouteDrawing, mapInitialized]);

  // Desktop draw mode: +/- uses the compositor while held and commits ONE Leaflet
  // zoom after key release. Rebuilding terrain/path canvases every 60 ms made
  // continuous zoom look stepped and caused stalls on desktop GPUs.
  useEffect(() => {
    const map=mapRef.current;
    const container=mapContainerRef.current;
    if (!map || !container || config.controlMode !== "draw" || !mapInitialized) return;
    const pane=map.getPane("mapPane");
    if(!pane)return;
    let direction=0,raf=0,lastFrame=0,previewZoom=map.getZoom(),baseZoom=previewZoom;
    let priorTransform="",priorOrigin="",priorWillChange="",previewing=false;
    const restore=()=>{
      if(!previewing)return;
      pane.style.transform=priorTransform;
      pane.style.transformOrigin=priorOrigin;
      pane.style.willChange=priorWillChange;
      previewing=false;
      document.documentElement.classList.remove('aether-map-interacting');
    };
    const start=()=>{
      if(previewing)return;
      baseZoom=previewZoom=map.getZoom();lastFrame=0;
      priorTransform=pane.style.transform;
      priorOrigin=pane.style.transformOrigin;
      priorWillChange=pane.style.willChange;
      const pos=L.DomUtil.getPosition(pane)||L.point(0,0);
      pane.style.transformOrigin=`${container.clientWidth/2-pos.x}px ${container.clientHeight/2-pos.y}px`;
      pane.style.willChange='transform';previewing=true;
      document.documentElement.classList.add('aether-map-interacting');
    };
    const tick=(now:number)=>{
      if(!direction){raf=0;return;}
      const dt=lastFrame?Math.min(64,now-lastFrame):16;lastFrame=now;
      // Time-based fractional zoom: 1.5 Leaflet levels/s, full RAF visual cadence,
      // zero terrain and precipitation reconstruction until the key is released.
      previewZoom=Math.max(map.getMinZoom(),Math.min(map.getMaxZoom(),previewZoom+direction*dt*.0015));
      pane.style.transform=`${priorTransform} scale(${Math.pow(2,previewZoom-baseZoom)})`;
      raf=requestAnimationFrame(tick);
    };
    const commit=(tapDirection=0)=>{
      if(raf)cancelAnimationFrame(raf);raf=0;direction=0;
      // Very short taps may have ended before the first animation frame.
      if(tapDirection && Math.abs(previewZoom-baseZoom)<.015)
        previewZoom=Math.max(map.getMinZoom(),Math.min(map.getMaxZoom(),baseZoom+tapDirection*.12));
      restore();lastFrame=0;
      if(Math.abs(previewZoom-map.getZoom())>1e-5)
        map.setZoom(previewZoom,{animate:false});
    };
    const directionFor=(e:KeyboardEvent)=>
      (e.key==='+'||e.key==='='||e.code==='NumpadAdd')?1:
      (e.key==='-'||e.key==='_'||e.code==='NumpadSubtract')?-1:0;
    const down=(e:KeyboardEvent)=>{
      if(e.altKey||e.ctrlKey||e.metaKey||
         (e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable="true"]')))return;
      const next=directionFor(e);if(!next)return;
      e.preventDefault();e.stopImmediatePropagation();
      start();direction=next;
      if(!raf)raf=requestAnimationFrame(tick);
    };
    const up=(e:KeyboardEvent)=>{
      const keyDir=directionFor(e);if(!keyDir||!previewing)return;
      e.preventDefault();e.stopImmediatePropagation();
      if(direction===keyDir)commit(keyDir);
    };
    const blur=()=>{if(previewing)commit();};
    window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);
    window.addEventListener('blur',blur);
    return ()=>{
      if(raf)cancelAnimationFrame(raf);
      restore();
      window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);
      window.removeEventListener('blur',blur);
    };
  }, [config.controlMode,mapInitialized]);

  // Handle ESC key to cancel placement mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && placementMode !== "none") {
        onDeployTyphoon?.("none");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [placementMode, onDeployTyphoon]);

  // User-drawn overlays (forecast framework / manual dry-air areas) are kept separate from the
  // simulation/forecast layers so high-speed path redraw throttling cannot erase points while the
  // user is drawing. A confirmed forecast framework can optionally remain visible through the
  // dedicated drawnForecastRoute layer; this is display-only and never triggers forecast physics.
  // Saved dry-air polygons intentionally do not remain painted on the map after saving.
  useEffect(() => {
    const map = mapRef.current;
    const group = guidanceGroupRef.current;
    if (!map || !group) return;
    group.clearLayers();

    // While editing, the draft always takes priority so every accepted node remains visible even
    // if the persistent display layer is switched off. Outside editing, render only when the user
    // explicitly enables the confirmed hand-drawn framework layer.
    const confirmedRoute = config.drawnTrackRoute || [];
    if (!isForecastRouteDrawing && layers.drawnForecastRoute && confirmedRoute.length >= 2) {
      L.polyline(confirmedRoute.map((p) => [p.lat, p.lon] as [number, number]), {
        color: "#67e8f9",
        weight: 2.8,
        opacity: 0.88,
        dashArray: "8, 6",
        interactive: false,
        renderer: (map as any)._canvasRenderer
      }).addTo(group);
      confirmedRoute.forEach((p, i) => {
        L.circleMarker([p.lat, p.lon], {
          radius: i === 0 ? 4.2 : 3.2,
          color: "#cffafe",
          weight: 1.4,
          fillColor: i === 0 ? "#0e7490" : "#164e63",
          fillOpacity: 0.92,
          interactive: false,
          renderer: (map as any)._canvasRenderer
        }).addTo(group);
      });
    }

    if (isForecastRouteDrawing && forecastRouteDraft.length > 0) {
      if (forecastRouteDraft.length >= 2) {
        L.polyline(forecastRouteDraft.map((p) => [p.lat, p.lon] as [number, number]), {
          color: "#f8fafc",
          weight: 3.4,
          opacity: 0.95,
          dashArray: "9, 5",
          interactive: false,
          renderer: (map as any)._canvasRenderer
        }).addTo(group);
      }
      forecastRouteDraft.forEach((p, i) => {
        let stackedNearby = 0;
        for (let j = Math.max(0, i - 8); j < i; j++) {
          const q = forecastRouteDraft[j];
          const cosLat = Math.max(.15, Math.cos(((p.lat + q.lat) * .5 * Math.PI) / 180));
          const km = Math.hypot((p.lat - q.lat) * 111.12, (p.lon - q.lon) * 111.12 * cosLat);
          if (km <= 3) stackedNearby++;
        }
        L.circleMarker([p.lat, p.lon], {
          // Repeated close taps are valid dwell/stall nodes. Grow the top marker slightly so a
          // phone user gets visible feedback even when several accepted nodes overlap exactly.
          radius: i === 0 ? 5 : 4 + Math.min(3.6, stackedNearby * .75),
          color: stackedNearby > 0 ? "#fde68a" : "#f8fafc",
          weight: stackedNearby > 0 ? 2 : 1.5,
          fillColor: i === 0 ? "#475569" : stackedNearby > 0 ? "#d97706" : "#0f172a",
          fillOpacity: 1,
          interactive: false,
          renderer: (map as any)._canvasRenderer
        }).addTo(group);
      });
      if (forecastRoutePreviewPoint && Number.isFinite(forecastRoutePreviewPoint.lat) && Number.isFinite(forecastRoutePreviewPoint.lon)) {
        const marker = L.circleMarker([forecastRoutePreviewPoint.lat, forecastRoutePreviewPoint.lon], {
          radius: 8.5,
          color: "#fde047",
          weight: 2.8,
          fillColor: "#0891b2",
          fillOpacity: 0.96,
          interactive: false,
          renderer: (map as any)._canvasRenderer
        }).addTo(group);
        marker.bindTooltip(`T+${Math.round(forecastRoutePreviewPoint.leadHour)}h · ${forecastRoutePreviewPoint.vmax.toFixed(1)} m/s`, {
          permanent: true, direction: "top", offset: [0, -8], className: "forecast-intensity-time-tooltip"
        });
        marker.bringToFront();
      }
    }
  }, [forecastRouteDraft, forecastRoutePreviewPoint, isForecastRouteDrawing, config.drawnTrackRoute, config.controlMode, layers.drawnForecastRoute, mapInitialized]);

  // Seed cursor diagnostics on demand; hidden diagnostics never participate in the follow hot path.
  useEffect(() => {
    if (!mapInitialized || !layers.cursor || !mapRef.current) return;
    const center = mapRef.current.getCenter();
    setCursorCoords({ lat: center.lat, lon: center.lng });
  }, [mapInitialized, layers.cursor]);

  // --- 2. Base map Tile Updating ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    if (stormTerrainOverlayRef.current) {
      map.removeLayer(stormTerrainOverlayRef.current);
      stormTerrainOverlayRef.current = null;
    }
    const terrainTask = ++stormTerrainTaskRef.current;

    if (config.agencyStyle !== "JMA" && layers.baseMap === "stormTerrain") {
      // Terrain is generated once from the embedded ETOPO field, cached as a PNG, and thereafter
      // moved/scaled by Leaflet like a normal map image.  It is deliberately not a live raster.
      getStormTerrainTextureDataUrl().then((url) => {
        if (!url || terrainTask !== stormTerrainTaskRef.current || !mapRef.current || layersRef.current.baseMap !== "stormTerrain") return;
        const overlay = L.imageOverlay(url, STORM_TERRAIN_BOUNDS as any, {
          pane: "terrainBasemapPane",
          opacity: 1,
          interactive: false,
          crossOrigin: false
        });
        stormTerrainOverlayRef.current = overlay;
        overlay.addTo(map);
      }).catch((err) => console.warn("Storm terrain texture unavailable:", err));
    }

    let url = "";
    switch (config.agencyStyle === "JMA" ? "jma" : layers.baseMap) {
      case "dark":
        // 3.3.2: OSM Night uses the canonical OpenStreetMap tile source and applies the
        // night transform locally. This removes the former CARTO dependency while keeping
        // the dark workstation presentation.
        url = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
        break;
      case "satellite":
        url = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
        break;
      case "terrain":
        url = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}";
        break;
      case "light":
        url = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
        break;
      case "googleSatellite":
        url = "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
        break;
      case "googleStreet":
        url = "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";
        break;
      case "blueMarble":
        url = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";
        break;
      case "bingSatellite":
        url = "bing";
        break;
      case "none":
      default:
        break;
    }

    if (url) {
      if (url === "bing") {
        tileLayerRef.current = new (L.TileLayer as any).Bing("", { maxNativeZoom: 18, maxZoom: 20 }).addTo(map);
      } else if (layers.baseMap === "blueMarble") {
        const BlueMarble2002Grid = (L.GridLayer as any).extend({
          createTile: function (coords: any, done: (err: any, tile: HTMLCanvasElement) => void) {
            const tile = document.createElement("canvas");
            tile.width = 256;
            tile.height = 256;
            const tileCtx = tile.getContext("2d");
            if (!tileCtx) {
              done(null, tile);
              return tile;
            }
            tileCtx.fillStyle = "#02052f";
            tileCtx.fillRect(0, 0, 256, 256);
            loadBlueMarble2002(false).then((image) => {
              if (image) drawBlueMarble2002Tile(tileCtx, image, coords.z, coords.x, coords.y, 256);
              done(null, tile);
            }).catch(() => done(null, tile));
            return tile;
          }
        });
        tileLayerRef.current = new BlueMarble2002Grid({
          minZoom: 1,
          maxZoom: 20,
          updateWhenIdle: touchFirst,
          updateWhenZooming: !touchFirst,
          updateInterval: touchFirst ? 180 : 100,
          keepBuffer: touchFirst ? 2 : 4,
          attribution: 'NASA Blue Marble 2002'
        }).addTo(map);
      } else {
        const isOsmNight = layers.baseMap === "dark";
        tileLayerRef.current = L.tileLayer(url, {
          maxNativeZoom: isOsmNight ? 19 : 18,
          maxZoom: 20,
          attribution: isOsmNight ? "&copy; OpenStreetMap contributors" : undefined,
          className: isOsmNight ? "osm-night-tiles" : "",
          crossOrigin: true,
          updateWhenIdle: touchFirst,
          updateWhenZooming: touchFirst ? false : !isOsmNight,
          updateInterval: touchFirst ? 180 : (isOsmNight ? 120 : 200),
          keepBuffer: touchFirst ? 2 : (isOsmNight ? 3 : 2)
        }).addTo(map);
      }
    } else {
      tileLayerRef.current = null;
    }
  }, [layers.baseMap, config.agencyStyle]);

  // --- 3. Render Land Boundary Polygons ---
  useEffect(() => {
    const map = mapRef.current;
    const group = landGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    const localVectorStyle = getLocalVectorBasemapStyle(config.agencyStyle === "JMA" ? "jma" : layers.baseMap);
    if (localVectorStyle && landGeoJson) {
      const renderer = (map as any)._basemapVectorRenderer;
      L.geoJSON(landGeoJson, {
        style: {
          pane: "basemapVectorPane",
          renderer,
          color: localVectorStyle.coast,
          weight: 1.05,
          fillColor: localVectorStyle.land,
          fill: true,
          fillOpacity: 1
        } as any,
        interactive: false
      }).addTo(group);
      // Do not outline country polygons on the offline vector basemap.  Their polygon exteriors
      // contain a simplified coastline which sits on top of the detailed land coastline and can
      // appear as a second, coarse/diagonal shoreline.  Keep the detailed land geometry as the
      // single coastline source.
    } else if (layers.coastline || layers.border) {
      if (landGeoJson) {
        const jmaMapStyle = config.agencyStyle === "JMA";
        const renderer = (map as any)._coastlineRenderer;
        L.geoJSON(landGeoJson, {
          style: {
            pane: "coastlinePane",
            renderer,
            color: jmaMapStyle
              ? (layers.border ? "rgba(220,224,205,0.62)" : "rgba(220,224,205,0.28)")
              : (layers.border ? "rgba(30,156,255,0.75)" : "rgba(165,180,200,0.4)"),
            weight: jmaMapStyle ? (layers.border ? 1.05 : 0.65) : (layers.border ? 1.5 : 0.8),
            fillColor: jmaMapStyle ? "transparent" : "rgba(10,25,47,0.3)",
            fill: jmaMapStyle ? false : layers.coastline,
          } as any,
          interactive: false
        }).addTo(group);
      }
    }
  }, [layers.coastline, layers.border, layers.baseMap, config.agencyStyle, geoJsonState.landLoaded]);

  // --- 4. Follow Typhoon center ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !config.followMainTyphoon || typhoons.length === 0) return;
    const mainTy = typhoons.find((t) => t.active && !t.dissipated);
    if (!mainTy) return;
    // Historical timeline replay is intentionally discrete, so the camera snaps with the archived
    // centre. Live follow is *not* handled here: an independent Leaflet pan animation and the custom
    // centre interpolation used different clocks/easing and produced a tiny but visible wobble where
    // the centre/path/radii drifted a fraction of a pixel relative to the camera. The RAF loop below
    // now moves the camera from the exact same interpolated motion state.
    if (historicalPlayback) {
      if(preserveRestoredCameraRef.current){
        preserveRestoredCameraRef.current=false;
        return;
      }
      map.stop();
      map.setView([mainTy.lat, mainTy.lon], map.getZoom(), { animate: false });
    }
  }, [typhoons, config.followMainTyphoon, historicalPlayback]);

  // --- 4b. Smooth live centre / final live-track segment ---
  // Physics intentionally advances in 10-minute chunks.  Rendering those snapshots directly made
  // the centre jump roughly six times per real second at 1x and any long main-thread frame made the
  // apparent speed disagree with the route.  Keep the simulation deterministic, but interpolate only
  // the visual centre between the latest two physics snapshots at the browser's paint cadence.
  useEffect(() => {
    const map = mapRef.current;
    const group = liveMotionGroupRef.current;
    if (!map || !group) return;

    const ty = typhoons.find((t) => {
      const firstHour = t.history?.[0]?.simHour ?? t.seasonStartHour ?? 0;
      return t.active && !t.dissipated && firstHour <= currentHour + 1e-6;
    });
    if (!ty) {
      const oldPopup = (liveMotionHitAreaRef.current as any)?.__aetherCenterPopup as L.Popup | undefined;
      if (oldPopup?.isOpen()) map.closePopup(oldPopup);
      group.clearLayers();
      liveMotionMarkerRef.current = null;
      liveMotionHitAreaRef.current = null;
      liveMotionLineRef.current = null;
      liveRadiiGroupRef.current?.clearLayers();
      liveRadiiLayersRef.current = [];
      liveRadiiGeometryKeyRef.current = "";
      liveRadiiMotionRef.current.initialized = false;
      liveMotionRef.current.initialized = false;
      liveMotionRef.current.visible = false;
      return;
    }

    const now = performance.now();
    const motion = liveMotionRef.current;
    if (historicalPlayback) {
      // Timeline replay is intentionally discrete. The history itself is hourly/discrete and the
      // user asked to see those archived analysis positions directly rather than an invented path
      // between them. Center, live-track endpoint and radii therefore snap to the same snapshot.
      Object.assign(motion, {
        initialized: true,
        lat: ty.lat, lon: ty.lon,
        fromLat: ty.lat, fromLon: ty.lon,
        targetLat: ty.lat, targetLon: ty.lon,
        startedAt: now, lastTargetAt: now, durationMs: 0, targetIntervalMs: 160,
        anchorLat: ty.lat, anchorLon: ty.lon, visible: true
      });
    } else if (!motion.initialized) {
      Object.assign(motion, {
        initialized: true,
        lat: ty.lat, lon: ty.lon,
        fromLat: ty.lat, fromLon: ty.lon,
        targetLat: ty.lat, targetLon: ty.lon,
        startedAt: now, lastTargetAt: now, durationMs: 150, targetIntervalMs: 160,
        anchorLat: ty.lat, anchorLon: ty.lon, visible: true
      });
    } else if (Math.abs(ty.lat - motion.targetLat) > 1e-8 || Math.abs(ty.lon - motion.targetLon) > 1e-8) {
      const observedInterval = Math.max(55, Math.min(420, now - (motion.lastTargetAt || now - 160)));
      // React/physics commits arrive with small scheduling jitter. Driving interpolation from each raw
      // interval turns that jitter into visible speed pulses; smooth the target cadence instead.
      const previousInterval = Number.isFinite(motion.targetIntervalMs) ? motion.targetIntervalMs : observedInterval;
      motion.targetIntervalMs = previousInterval * 0.72 + observedInterval * 0.28;
      motion.fromLat = motion.lat;
      motion.fromLon = motion.lon;
      motion.targetLat = ty.lat;
      motion.targetLon = ty.lon;
      motion.startedAt = now;
      // Slight overlap prevents an early arrival + one-frame stop when the next React snapshot is late.
      // This is display-only and never feeds back into deterministic physics.
      motion.durationMs = Math.max(65, Math.min(430, motion.targetIntervalMs * 1.08));
      motion.lastTargetAt = now;
      motion.visible = true;
    }

    // Wind-radii magnitudes should refresh as operational snapshots every 3 hours rather than
    // tweening at every 10-minute physics step. The storm centre itself remains smoothly
    // interpolated, but the actual wind-circle size/shape is held fixed until the next 3-hour
    // issuance so timeline scrubbing and playback always show the same discrete radii state.
    const radiiMotion = liveRadiiMotionRef.current;
    const nextRadii = resolveSteppedWindRadii(ty, currentHour, historicalPlayback);
    if (historicalPlayback || !radiiMotion.initialized) {
      radiiMotion.initialized = true;
      radiiMotion.startedAt = now;
      radiiMotion.durationMs = 0;
      radiiMotion.from = { r7: copyWindQuadrants(nextRadii.r7), r10: copyWindQuadrants(nextRadii.r10), r12: copyWindQuadrants(nextRadii.r12) };
      radiiMotion.current = { r7: copyWindQuadrants(nextRadii.r7), r10: copyWindQuadrants(nextRadii.r10), r12: copyWindQuadrants(nextRadii.r12) };
      radiiMotion.target = { r7: copyWindQuadrants(nextRadii.r7), r10: copyWindQuadrants(nextRadii.r10), r12: copyWindQuadrants(nextRadii.r12) };
    } else if (!windQuadrantsEqual(radiiMotion.target.r7, nextRadii.r7) ||
        !windQuadrantsEqual(radiiMotion.target.r10, nextRadii.r10) ||
        !windQuadrantsEqual(radiiMotion.target.r12, nextRadii.r12)) {
      radiiMotion.from = {
        r7: copyWindQuadrants(radiiMotion.current.r7),
        r10: copyWindQuadrants(radiiMotion.current.r10),
        r12: copyWindQuadrants(radiiMotion.current.r12)
      };
      radiiMotion.target = {
        r7: copyWindQuadrants(nextRadii.r7),
        r10: copyWindQuadrants(nextRadii.r10),
        r12: copyWindQuadrants(nextRadii.r12)
      };
      radiiMotion.startedAt = now;
      // No morphing animation when the 3-hour wind-circle snapshot changes; the geometry should
      // step to the new issuance immediately, while the centre keeps moving smoothly. Keep
      // `current` on the previous snapshot until the RAF pass so the existing polygon geometry
      // still receives one explicit update when radii change but the visible level set stays the
      // same. New force-level layers are created from `nextRadii` below, so they no longer lag one
      // level behind.
      radiiMotion.durationMs = 0;
    }

    const history = ty.history || [];
    let anchor = history[history.length - 1];
    if (anchor && anchor.simHour > currentHour + 1e-6) {
      anchor = findHistoryAtOrBefore(history, currentHour) || history[0];
    }
    motion.anchorLat = anchor?.lat ?? motion.targetLat;
    motion.anchorLon = anchor?.lon ?? motion.targetLon;

    const isJmaCenter = (config.centerStyle || config.agencyStyle) === "JMA";
    const styleKey = `${isJmaCenter ? "JMA" : "CMA"}|${ty.category}|${layers.showCenterPoint !== false ? 1 : 0}`;
    const existingMarker = liveMotionMarkerRef.current as any;
    const existingHitArea = liveMotionHitAreaRef.current as any;
    // A recreated/hidden centre must not leave a stale, independently-open popup behind.
    if (existingHitArea && (layers.showCenterPoint === false ||
        existingMarker?.__typhoonSimStyleKey !== styleKey)) {
      const oldPopup = existingHitArea.__aetherCenterPopup as L.Popup | undefined;
      if (oldPopup?.isOpen()) map.closePopup(oldPopup);
    }
    if (layers.showCenterPoint === false) {
      if (existingMarker && group.hasLayer(existingMarker)) group.removeLayer(existingMarker);
      if (existingHitArea && group.hasLayer(existingHitArea)) group.removeLayer(existingHitArea);
      liveMotionMarkerRef.current = null;
      liveMotionHitAreaRef.current = null;
    } else if (!existingMarker || existingMarker.__typhoonSimStyleKey !== styleKey) {
      if (existingMarker && group.hasLayer(existingMarker)) group.removeLayer(existingMarker);
      if (existingHitArea && group.hasLayer(existingHitArea)) group.removeLayer(existingHitArea);
      if (isJmaCenter) {
        const centerIcon = L.divIcon({
          className: "jma-center-cross-wrap",
          html: '<div class="jma-center-cross">×</div>',
          iconSize: [26, 26], iconAnchor: [13, 13]
        });
        // Keep the JMA cross in the exact same pane/transform pipeline as the live track canvas.
        // The old default markerPane DOM marker could visually phase-lag the canvas path during
        // 60-fps follow panning on mobile.  Interaction remains on the transparent hit target.
        const marker = L.marker([motion.lat, motion.lon], { icon: centerIcon, pane: "pathPane", interactive: false, keyboard: false, bubblingMouseEvents: false }).addTo(group) as any;
        marker.__typhoonSimStyleKey = styleKey;
        liveMotionMarkerRef.current = marker;
      } else {
        const marker = L.circleMarker([motion.lat, motion.lon], {
          radius: 5.2, color: "#FFFFFF", weight: 1.5,
          fillColor: getCategoryColor(ty.category, config), fillOpacity: 1,
          interactive: true, bubblingMouseEvents: false, renderer: liveMotionRendererRef.current || (map as any)._canvasRenderer
        } as any).addTo(group) as any;
        marker.__typhoonSimStyleKey = styleKey;
        liveMotionMarkerRef.current = marker;
      }
      liveMotionHitAreaRef.current = L.circleMarker([motion.lat, motion.lon], {
        radius: 18,
        color: "transparent",
        weight: 0,
        fillColor: "transparent",
        fillOpacity: 0,
        interactive: true,
        bubblingMouseEvents: true,
        renderer: liveMotionRendererRef.current || (map as any)._canvasRenderer
      } as any).addTo(group);
    }

    if (layers.track) {
      const isJmaTrack = (config.trackStyle || config.agencyStyle) === "JMA";
      const lineColor = isJmaTrack ? "#ffffff" : getCategoryColor(ty.category, config);
      if (!liveMotionLineRef.current) {
        liveMotionLineRef.current = L.polyline(
          [[motion.anchorLat, motion.anchorLon], [motion.lat, motion.lon]],
          { color: lineColor, weight: isJmaTrack ? 2.4 : 2.6, opacity: isJmaTrack ? 0.98 : 0.9, interactive: false, renderer: liveMotionRendererRef.current || (map as any)._canvasRenderer }
        ).addTo(group);
      } else {
        liveMotionLineRef.current.setStyle({ color: lineColor, weight: isJmaTrack ? 2.4 : 2.6, opacity: isJmaTrack ? 0.98 : 0.9 });
      }
    } else if (liveMotionLineRef.current) {
      group.removeLayer(liveMotionLineRef.current);
      liveMotionLineRef.current = null;
    }

    if (historicalPlayback) {
      liveMotionMarkerRef.current?.setLatLng([ty.lat, ty.lon]);
      liveMotionHitAreaRef.current?.setLatLng([ty.lat, ty.lon]);
      liveMotionLineRef.current?.setLatLngs([[motion.anchorLat, motion.anchorLon], [ty.lat, ty.lon]]);
      liveRadiiLayersRef.current.forEach((item) => {
        if (item.kind === "circle") {
          item.currentLatOffset = item.targetLatOffset;
          item.currentLonOffset = item.targetLonOffset;
          item.currentRadiusKm = item.targetRadiusKm;
          item.layer.setLatLng([ty.lat + item.currentLatOffset, ty.lon + item.currentLonOffset]);
          item.layer.setRadius(Math.max(0, item.currentRadiusKm) * 1000);
        } else {
          const q = nextRadii[item.level];
          const offsets = buildQuadrantOffsets(q, ty.lat, 3);
          if (offsets.length >= 4) item.layer.setLatLngs(offsets.map(([dLat, dLon]) => [ty.lat + dLat, ty.lon + dLon]));
        }
      });
    }
    if (liveMotionMarkerRef.current && liveMotionHitAreaRef.current) {
      // `motion` only contains the interpolated visual position. Storm metadata/intensity always
      // comes from the authoritative Typhoon state so TypeScript does not need to treat the motion
      // helper as a partial Typhoon and the hover card cannot accidentally lose intensity fields.
      const centerLat = historicalPlayback ? ty.lat : motion.lat;
      const centerLon = historicalPlayback ? ty.lon : motion.lon;
      const pressure = Math.round(Number(ty.pmin || 0));
      const displayAgency = (config.intensityAgency || config.agencyStyle || "CMA") as "CMA" | "JMA" | "JTWC";
      const ai = getAgencyIntensity(Number(ty.vmax || 0), displayAgency, config.intensityReportingMode || "public");
      const displayName = ty.name || ty.id || "热带气旋";
      const tooltipHtml = `<div class="aether-track-hover"><b>${displayName} 当前中心</b><span>T+${Math.round(currentHour)}h · ${displayAgency} ${ai.value} ${ai.unit}</span><span>${Number(centerLat).toFixed(2)}°, ${Number(centerLon).toFixed(2)}° · ${pressure} hPa</span></div>`;
      const popupHtml = `
        <div class="p-3 text-white bg-[#08121f] rounded-xl border border-slate-700/60 font-sans text-xs min-w-[210px] select-none shadow-xl">
          <div class="font-bold border-b border-slate-800 pb-1.5 mb-1.5 text-sm flex justify-between items-center">
            <span>${displayName} 当前中心</span>
            <span style="color: ${getCategoryColor(ty.category, config)}">${ty.category}</span>
          </div>
          <div class="space-y-1 font-mono text-[11px] text-slate-300">
            <div>坐标: <b>${Number(centerLat).toFixed(2)}°N, ${Number(centerLon).toFixed(2)}°E</b></div>
            <div>风速: <b style="color: #F7FAFF">${ai.value} ${ai.unit}</b> · ${displayAgency}</div>
            <div>气压: <b style="color: #1E9CFF">${pressure} hPa</b></div>
            <div>时次: <b>T+${Math.round(currentHour)}h</b></div>
          </div>
        </div>
      `;
      const markerAny = liveMotionMarkerRef.current as any;
      if (markerAny.getTooltip?.()) markerAny.setTooltipContent(tooltipHtml);
      else markerAny.bindTooltip(tooltipHtml, { direction: "top", offset: [0, -10], opacity: 0.98, className: "aether-track-tooltip", sticky: true });
      const hitAreaAny = liveMotionHitAreaRef.current as any;
      hitAreaAny.__aetherCenterPopupHtml = popupHtml;
      // Leaflet Map has no getPopup() API. Only update the popup opened by this
      // hit area; never mutate another layer's popup (e.g. a historic track node).
      const centerPopup = hitAreaAny.__aetherCenterPopup as L.Popup | undefined;
      if (centerPopup?.isOpen()) {
        centerPopup.setContent(popupHtml);
        centerPopup.setLatLng([centerLat, centerLon]);
      }
      if (hitAreaAny.getTooltip?.()) hitAreaAny.setTooltipContent(tooltipHtml);
      else hitAreaAny.bindTooltip(tooltipHtml, { direction: "top", offset: [0, -10], opacity: 0.98, className: "aether-track-tooltip", sticky: true });
      if (hitAreaAny.__aetherCenterPopupBound !== true) {
        hitAreaAny.__aetherCenterPopupBound = true;
        hitAreaAny.on("click", (e: L.LeafletMouseEvent) => {
          if (isForecastRouteDrawingRef.current) return;
          if ((L as any).DomEvent?.stop) (L as any).DomEvent.stop((e as any).originalEvent);
          const popup = hitAreaAny.__aetherCenterPopup as L.Popup | undefined;
          const activePopup = popup || L.popup({ className: "custom-leaflet-popup" });
          hitAreaAny.__aetherCenterPopup = activePopup;
          map.openPopup(activePopup.setLatLng(hitAreaAny.getLatLng()).setContent(hitAreaAny.__aetherCenterPopupHtml || ""));
        });
      }
    }

    // Keep the active wind-radii layers stable while the physics state changes. Their centre and
    // quadrant magnitudes are animated by the 60-fps RAF loop below; recreating the geometry on
    // every physics commit causes visible popping and was also the reason mobile playback used to
    // fall back to a plain mean-radius circle.
    const liveRadiiGroup = liveRadiiGroupRef.current;
    const isJmaRadii = (config.windRadiiStyle || config.agencyStyle) === "JMA";
    const hideCmaLiveRadii = !isJmaRadii && shouldHideCmaWindRadiiAfterLandfall(ty);
    const radiiGeometryKey = JSON.stringify([
      ty.id, layers.windRadii, isJmaRadii ? "JMA" : "QUADRANT", hideCmaLiveRadii,
      config.coastlineSource,
      hasVisibleWindQuadrants(nextRadii.r7), hasVisibleWindQuadrants(nextRadii.r10), hasVisibleWindQuadrants(nextRadii.r12)
    ]);
    if (liveRadiiGroup && radiiGeometryKey !== liveRadiiGeometryKeyRef.current) {
      liveRadiiGeometryKeyRef.current = radiiGeometryKey;
      liveRadiiGroup.clearLayers();
      liveRadiiLayersRef.current = [];
      if (layers.windRadii && !hideCmaLiveRadii) {
        if (isJmaRadii) {
          const levels = [
            { q: nextRadii.r7, color: JMA_PRODUCT_COLORS.strongWind, level: "strong" as const, key: "r7" as const },
            { q: nextRadii.r10, color: JMA_PRODUCT_COLORS.stormWind, level: "storm" as const, key: "r10" as const }
          ];
          levels.forEach(({ q, color, level, key }) => {
            if (!hasVisibleWindQuadrants(q)) return;
            const geometry = calculateJmaWindCircleGeometry({ lat: ty.lat, lon: ty.lon, vmaxCmaMs: ty.vmax, landed: !!ty.landed, radii: q!, level }, (lat, lon) => getLandMetrics(lat, lon, config.coastlineSource).isLand);
            if (!geometry.visible) return;
            const latOffset = geometry.centerLat - ty.lat;
            const lonOffset = geometry.centerLon - ty.lon;
            const layer = L.circle([motion.lat + latOffset, motion.lon + lonOffset], {
              radius: geometry.radiusKm * 1000, color, weight: 2.2, opacity: 0.92, fill: false,
              interactive: false, className: "leaflet-wind-radii-circle",
              renderer: liveRadiiRendererRef.current || (map as any)._canvasRenderer
            }).addTo(liveRadiiGroup);
            liveRadiiLayersRef.current.push({
              kind: "circle", layer, level: key,
              currentLatOffset: latOffset, currentLonOffset: lonOffset, currentRadiusKm: geometry.radiusKm,
              fromLatOffset: latOffset, fromLonOffset: lonOffset, fromRadiusKm: geometry.radiusKm,
              targetLatOffset: latOffset, targetLonOffset: lonOffset, targetRadiusKm: geometry.radiusKm,
              startedAt: now, durationMs: motion.durationMs
            });
          });
        } else {
          const levels = [
            { q: nextRadii.r7, color: "#f39c12", level: "r7" as const },
            { q: nextRadii.r10, color: "#d35400", level: "r10" as const },
            { q: nextRadii.r12, color: "#c0392b", level: "r12" as const }
          ];
          levels.forEach(({ q, color, level }) => {
            if (!hasVisibleWindQuadrants(q)) return;
            const offsets = buildQuadrantOffsets(q, motion.lat, 3);
            if (offsets.length < 4) return;
            const layer = L.polygon(offsets.map(([dLat, dLon]) => L.latLng(motion.lat + dLat, motion.lon + dLon)), {
              color, weight: 1.5, opacity: 0.85, fillColor: color, fillOpacity: 0.11,
              interactive: false, className: "leaflet-wind-radii-circle",
              renderer: liveRadiiRendererRef.current || (map as any)._canvasRenderer
            }).addTo(liveRadiiGroup);
            liveRadiiLayersRef.current.push({ kind: "polygon", layer, level });
          });
        }
      }
    }

    // JMA radii use a displaced operational-style circle. Compute the next coast-aware geometry
    // only when the physics state changes, then interpolate its offset/radius in RAF just like the
    // centre. This keeps the expensive coastline query out of the 60-fps loop.
    if (liveRadiiGroup && isJmaRadii && layers.windRadii) {
      for (const item of liveRadiiLayersRef.current) {
        if (item.kind !== "circle") continue;
        const q = item.level === "r7" ? nextRadii.r7 : nextRadii.r10;
        if (!hasVisibleWindQuadrants(q)) continue;
        const level = item.level === "r7" ? "strong" as const : "storm" as const;
        const geometry = calculateJmaWindCircleGeometry({ lat: ty.lat, lon: ty.lon, vmaxCmaMs: ty.vmax, landed: !!ty.landed, radii: q!, level }, (lat, lon) => getLandMetrics(lat, lon, config.coastlineSource).isLand);
        if (!geometry.visible) continue;
        const targetLatOffset = geometry.centerLat - ty.lat;
        const targetLonOffset = geometry.centerLon - ty.lon;
        if (Math.abs(item.targetLatOffset - targetLatOffset) > 1e-6 || Math.abs(item.targetLonOffset - targetLonOffset) > 1e-6 || Math.abs(item.targetRadiusKm - geometry.radiusKm) > 1e-4) {
          item.fromLatOffset = item.currentLatOffset;
          item.fromLonOffset = item.currentLonOffset;
          item.fromRadiusKm = item.currentRadiusKm;
          item.targetLatOffset = targetLatOffset;
          item.targetLonOffset = targetLonOffset;
          item.targetRadiusKm = geometry.radiusKm;
          item.startedAt = now;
          // Wind-circle geometry changes should step immediately; only the storm position itself is animated.
          item.durationMs = 0;
        }
      }
    }
  }, [typhoons, currentHour, historicalPlayback, isPlaying, layers.track, layers.windRadii, layers.showCenterPoint, config.centerStyle, config.agencyStyle, config.intensityAgency, config.intensityReportingMode, config.trackStyle, config.windRadiiStyle, config.categoryColors, config.coastlineSource]);

  useEffect(() => {
    if (!mapInitialized) return;
    const tick = (timestamp: number) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        liveMotionIdleTimerRef.current = setTimeout(() => {
          liveMotionIdleTimerRef.current = null;
          liveMotionRafRef.current = requestAnimationFrame(tick);
        }, 500);
        return;
      }
      const budget = renderBudgetRef.current;
      const frameMs = timestamp - budget.last;
      budget.last = timestamp;
      // Estimate compositor health independently from the 60 fps centre renderer.  The measurement
      // only drives secondary-layer degradation; it never lowers the live-centre target cadence.
      if (isPlaying && !historicalPlayback && frameMs > 0 && frameMs < 120) {
        budget.averageMs = budget.averageMs * .94 + frameMs * .06;
        if (++budget.samples >= 36) {
          if (budget.averageMs > 29) budget.degraded = true;
          else if (budget.averageMs < 21.5) budget.degraded = false;
        }
      }

      if (isPlaying && !historicalPlayback) {
        // Round 32: the live centre has one explicit target cadence everywhere: 60 fps.  Do not
        // lower the animation target to 35/40/45/55 fps on touch devices when the main thread is
        // otherwise capable.  Expensive secondary layers are still allowed to degrade below, but
        // the centre/interpolation clock remains a 16.667 ms timeline.
        //
        // A deadline accumulator is used instead of an integer rAF divisor.  120-Hz displays emit
        // every second refresh, 60-Hz displays emit every refresh, and awkward 90/144-Hz panels
        // distribute writes around the 60-Hz deadlines instead of collapsing to 45/48 fps.
        const targetFrameMs = 1000 / 60;
        if (!Number.isFinite(budget.nextVisualAt) || budget.nextVisualAt <= 0 || timestamp - budget.nextVisualAt > 160) {
          budget.nextVisualAt = timestamp;
        }
        if (timestamp + 0.35 < budget.nextVisualAt) {
          liveMotionRafRef.current = requestAnimationFrame(tick);
          return;
        }
        do { budget.nextVisualAt += targetFrameMs; } while (budget.nextVisualAt <= timestamp - targetFrameMs);
      } else {
        budget.nextVisualAt = 0;
      }

      const motion = liveMotionRef.current;
      if (motion.initialized && motion.visible) {
        const elapsed = Math.max(0, timestamp - motion.startedAt);
        const t = historicalPlayback || !isPlaying ? 1 : Math.min(1, motion.durationMs > 0 ? elapsed / motion.durationMs : 1);
        const nextLat = motion.fromLat + (motion.targetLat - motion.fromLat) * t;
        const nextLon = motion.fromLon + (motion.targetLon - motion.fromLon) * t;
        const motionChanged = Math.abs(nextLat - motion.lat) > 1e-9 || Math.abs(nextLon - motion.lon) > 1e-9;
        motion.lat = nextLat;
        motion.lon = nextLon;
        motion.lastFrameAt = timestamp;

        const radiiMotion = liveRadiiMotionRef.current;
        let radiiChanged = false;
        if (radiiMotion.initialized) {
          const radiiElapsed = Math.max(0, timestamp - radiiMotion.startedAt);
          const rt = historicalPlayback || !isPlaying ? 1 : Math.min(1, radiiMotion.durationMs > 0 ? radiiElapsed / radiiMotion.durationMs : 1);
          const nextR7 = interpolateWindQuadrants(radiiMotion.from.r7, radiiMotion.target.r7, rt);
          const nextR10 = interpolateWindQuadrants(radiiMotion.from.r10, radiiMotion.target.r10, rt);
          const nextR12 = interpolateWindQuadrants(radiiMotion.from.r12, radiiMotion.target.r12, rt);
          radiiChanged = !windQuadrantsEqual(radiiMotion.current.r7, nextR7, 1e-6) ||
            !windQuadrantsEqual(radiiMotion.current.r10, nextR10, 1e-6) ||
            !windQuadrantsEqual(radiiMotion.current.r12, nextR12, 1e-6);
          radiiMotion.current = { r7: nextR7, r10: nextR10, r12: nextR12 };
        }
        const circleRadiiAnimating = liveRadiiLayersRef.current.some((item) => item.kind === "circle" && (
          Math.abs(item.currentLatOffset - item.targetLatOffset) > 1e-7 ||
          Math.abs(item.currentLonOffset - item.targetLonOffset) > 1e-7 ||
          Math.abs(item.currentRadiusKm - item.targetRadiusKm) > 1e-5
        ));

        const overlayAdvanced = motionChanged || radiiChanged || circleRadiiAnimating;
        if (mapGestureActiveRef.current && overlayAdvanced) liveOverlayNeedsSyncRef.current = true;
        const forceOverlaySync = liveOverlayNeedsSyncRef.current && !mapGestureActiveRef.current;
        if (!mapGestureActiveRef.current && (overlayAdvanced || forceOverlaySync)) {
          if (motionChanged || forceOverlaySync) {
            liveMotionMarkerRef.current?.setLatLng([motion.lat, motion.lon]);
            liveMotionHitAreaRef.current?.setLatLng([motion.lat, motion.lon]);
            liveMotionLineRef.current?.setLatLngs([[motion.anchorLat, motion.anchorLon], [motion.lat, motion.lon]]);
          }

          // In follow mode the centre, radii and camera must use exactly the same emitted frame.
          // Outside follow mode the radii can remain cheaper because phase error is not camera-amplified.
          const radiiInterval = config.followMainTyphoon ? 0 : (budget.degraded ? 48 : touchFirst ? 34 : 28);
          if ((overlayAdvanced || forceOverlaySync) && (forceOverlaySync || radiiInterval === 0 || timestamp - lastLiveRadiiFrameRef.current >= radiiInterval)) {
            lastLiveRadiiFrameRef.current = timestamp;
            liveRadiiLayersRef.current.forEach((item) => {
              if (item.kind === "circle") {
                const circleElapsed = Math.max(0, timestamp - item.startedAt);
                const ct = historicalPlayback || !isPlaying ? 1 : Math.min(1, item.durationMs > 0 ? circleElapsed / item.durationMs : 1);
                item.currentLatOffset = item.fromLatOffset + (item.targetLatOffset - item.fromLatOffset) * ct;
                item.currentLonOffset = item.fromLonOffset + (item.targetLonOffset - item.fromLonOffset) * ct;
                item.currentRadiusKm = item.fromRadiusKm + (item.targetRadiusKm - item.fromRadiusKm) * ct;
                item.layer.setLatLng([motion.lat + item.currentLatOffset, motion.lon + item.currentLonOffset]);
                item.layer.setRadius(Math.max(0, item.currentRadiusKm) * 1000);
              } else {
                const q = radiiMotion.current[item.level];
                const offsets = buildQuadrantOffsets(q, motion.lat, 3);
                if (offsets.length >= 4) item.layer.setLatLngs(offsets.map(([dLat, dLon]) => [motion.lat + dLat, motion.lon + dLon]));
              }
            });
            if (forceOverlaySync) liveOverlayNeedsSyncRef.current = false;
          }

          if (motionChanged && config.followMainTyphoon && isPlaying && !historicalPlayback) {
            const map = mapRef.current;
            if (map) {
              const stormPoint = map.latLngToContainerPoint([motion.lat, motion.lon]);
              const size = map.getSize();
              const dx = stormPoint.x - size.x * 0.5;
              const dy = stormPoint.y - size.y * 0.5;
              // Keep the camera locked to the same 60-fps interpolated centre used by the final
              // path segment and radii. The former 1.75–6 px dead-zone deliberately accumulated
              // motion and released it in visible jumps, especially on phones.
              if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
                // panBy() emits move/moveend; mark this as programmatic so those events cannot
                // accidentally force React diagnostics to rerender at animation FPS.
                followPanUntilRef.current = performance.now() + 45;
                map.panBy([dx, dy], { animate: false, noMoveStart: true } as any);
              }
            }
          }
        }
      }

      if (isPlaying && !historicalPlayback) liveMotionRafRef.current = requestAnimationFrame(tick);
      else liveMotionIdleTimerRef.current = setTimeout(() => {
        liveMotionIdleTimerRef.current = null;
        liveMotionRafRef.current = requestAnimationFrame(tick);
      }, 180);
    };

    liveMotionRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (liveMotionRafRef.current !== null) cancelAnimationFrame(liveMotionRafRef.current);
      liveMotionRafRef.current = null;
      if (liveMotionIdleTimerRef.current !== null) clearTimeout(liveMotionIdleTimerRef.current);
      liveMotionIdleTimerRef.current = null;
    };
  }, [mapInitialized, historicalPlayback, isPlaying, config.followMainTyphoon]);

  // --- 5. Draw Typhoon Tracks, Center Rings, and Radii ---
  // Throttle map updates during high-speed simulation to prevent DOM/Canvas exhaustion
  const lastMapUpdateTimeRef = useRef<number>(0);
  const lastForecastGeometryUpdateTimeRef = useRef<number>(0);
  const lastLiveTrackGeometryKeyRef = useRef<string>("");
  
  useEffect(() => {
    const map = mapRef.current;
    const pathGroup = pathGroupRef.current;
    const archivedPathGroup = archivedPathGroupRef.current;
    const radiiGroup = radiiGroupRef.current;
    if (!map || !pathGroup || !archivedPathGroup || !radiiGroup) return;
    // Historical nodes/paths are immutable during a scrub. Keep the existing layers
    // until pointer-up; the separate live-center effect still follows each snapshot.
    if (timelineSeekPreview) return;

    // Limit map updates to at most ~10fps during active playback to save CPU/Memory on mobile
    const now = Date.now();
    // During ordinary live playback the persistent best-track geometry changes only when a new
    // hourly history state is appended. The 10-minute centre/radii motion is already handled by
    // dedicated RAF layers, so rebuilding all historical Leaflet nodes between hourly archives is
    // pure allocation/GC work. Use a lossless geometry fingerprint to skip those identical rebuilds.
    const activeCyclones = typhoons.filter((t) => t.active && !t.dissipated);
    const canReuseLiveTrackGeometry = !historicalPlayback && activeCyclones.length <= 1 &&
      !layers.hurricaneTrackerModels;
    const forecastPathFingerprint = (path: Typhoon["forecastPath"] | undefined) => {
      if (!path?.length) return "0";
      const ref = path as unknown as object;
      const cached = forecastPathFingerprintCacheRef.current.get(ref);
      if (cached) return cached;
      const key = path.map((p) => `${Number(p.simHour).toFixed(2)}:${Number(p.lat).toFixed(4)}:${Number(p.lon).toFixed(4)}:${Number(p.vmax ?? 0).toFixed(2)}`).join(";");
      forecastPathFingerprintCacheRef.current.set(ref, key);
      return key;
    };
    const liveTrackGeometryKey = canReuseLiveTrackGeometry ? [
      layers.track ? 1 : 0,
      layers.windRadii ? 1 : 0,
      config.trackStyle || "", config.trackDotStyle || "", config.windRadiiStyle || "", config.agencyStyle || "",
      config.intensityAgency || "", config.intensityReportingMode || "",
      categoryColorsKey,
      startDate?.getTime?.() ?? 0,
      isForecastRouteDrawing ? 1 : 0,
      ...typhoons.map((t) => {
        const history = t.history || [];
        const last = history[history.length - 1];
        const forecastKey = layers.forecast ? forecastPathFingerprint(t.forecastPath) : "";
        return `${t.id}:${t.historyRevision ?? 0}:${t.active ? 1 : 0}:${t.dissipated ? 1 : 0}:${history.length}:${Number(last?.simHour ?? -1).toFixed(4)}:${last?.category ?? ""}:${forecastKey}`;
      })
    ].join("|") : "";
    if (canReuseLiveTrackGeometry && liveTrackGeometryKey === lastLiveTrackGeometryKeyRef.current) return;

    const baseThrottleTime = speed <= 2 ? 650 : speed <= 8 ? 480 : speed <= 15 ? 330 : speed <= 30 ? 260 : 210;
    const throttleTime = baseThrottleTime * (renderBudgetRef.current.degraded ? 1.8 : 1);
    // The centre itself is animated independently at requestAnimationFrame cadence below.  The
    // expensive track/radii/forecast rebuild therefore does not need to follow every 10-minute
    // physics tick; at 1x this cuts the largest Leaflet rebuild path from ~6 Hz to ~3 Hz.
    
    const hasActiveCyclone = typhoons.some((t) => t.active && !t.dissipated);
    // Timeline scrubbing must be exact and trailing-edge safe. The old playback throttle could
    // drop the final seek event, leaving the path/forecast geometry at the previous hour while the
    // centre/radii had already snapped to the selected snapshot.
    if (!historicalPlayback && hasActiveCyclone && now - lastMapUpdateTimeRef.current < throttleTime) {
      return;
    }
    lastMapUpdateTimeRef.current = now;
    lastLiveTrackGeometryKeyRef.current = canReuseLiveTrackGeometry ? liveTrackGeometryKey : "";

    pathGroup.clearLayers();
    radiiGroup.clearLayers();

    const removeArchivedTrack = (id: string) => {
      const cached = archivedTrackLayerCacheRef.current.get(id);
      if (cached) cached.layers.forEach((layer) => archivedPathGroup.removeLayer(layer));
      archivedTrackLayerCacheRef.current.delete(id);
    };
    const liveIds = new Set(typhoons.map((ty) => ty.id));
    archivedTrackLayerCacheRef.current.forEach((_, id) => {
      if (!liveIds.has(id)) removeArchivedTrack(id);
    });
    const archiveStyleKey = [
      layers.track ? 1 : 0,
      config.historicalTrackDisplay || "visible",
      config.historicalTrackDots !== false ? 1 : 0,
      config.agencyStyle || "", config.trackStyle || "", config.trackDotStyle || "",
      categoryColorsKey,
      startDate?.getTime?.() ?? 0,
      isForecastRouteDrawing ? 1 : 0
    ].join("|");

    // Desktop path inspector: hover a best-track/forecast node to get an offset label connected
    // by a leader line.  Wind uses the same selected intensity agency as the rest of WMC.
    const trackInspectorHtml = (state: any, label: string) => {
      const agency = (config.intensityAgency || config.agencyStyle || "CMA") as "CMA" | "JMA" | "JTWC";
      const hasForecastIntensity = state.intensityDeferred !== true && Number.isFinite(Number(state.vmax)) && Number.isFinite(Number(state.pmin));
      const motion = Number.isFinite(Number(state.speed)) ? ` · 移速 ${Math.round(Number(state.speed))} km/h` : "";
      if (!hasForecastIntensity) {
        return `<div class="aether-track-hover"><b>${label}</b><span>路径预报${motion}</span><span>强度 / 气压将在生成预报图时计算 · ${Number(state.lat).toFixed(2)}°, ${Number(state.lon).toFixed(2)}°</span></div>`;
      }
      const ai = getAgencyIntensity(Number(state.vmax), agency, config.intensityReportingMode || "public");
      return `<div class="aether-track-hover"><b>${label}</b><span>${agency} ${ai.value} ${ai.unit}${motion}</span><span>${Math.round(Number(state.pmin))} hPa · ${Number(state.lat).toFixed(2)}°, ${Number(state.lon).toFixed(2)}°</span></div>`;
    };
    const attachTrackHover = (hitArea: L.CircleMarker, state: any, label: string) => {
      let leader: L.Polyline | null = null;
      let tip: L.Tooltip | null = null;
      const cleanup = () => {
        if (leader) { pathGroup.removeLayer(leader); leader = null; }
        if (tip) { map.removeLayer(tip); tip = null; }
      };
      hitArea.on("mouseover", (e: L.LeafletMouseEvent) => {
        if (isForecastRouteDrawingRef.current) return;
        cleanup();
        const px = map.latLngToContainerPoint(hitArea.getLatLng());
        const anchorPx = L.point(px.x + 88, px.y - 48);
        const anchor = map.containerPointToLatLng(anchorPx);
        leader = L.polyline([hitArea.getLatLng(), anchor], {
          color: "#e2e8f0", weight: 1.1, opacity: .9, interactive: false, renderer: nodeHitRendererRef.current || (map as any)._canvasRenderer
        }).addTo(pathGroup);
        const content = trackInspectorHtml(state, label);
        tip = L.tooltip({ permanent: true, direction: "right", offset: [0, 0], opacity: .98, className: "aether-track-tooltip", interactive: false })
          .setLatLng(anchor).setContent(content).addTo(map);
      });
      hitArea.on("mouseout", cleanup);
      hitArea.on("remove", cleanup);
    };

    typhoons.forEach((ty) => {
      if (!ty.active && !ty.dissipated && ty.history.length === 0) {
        removeArchivedTrack(ty.id);
        return;
      }
      const fullHistory = ty.history || [];
      const firstHistoryHour = fullHistory[0]?.simHour ?? ty.seasonStartHour ?? 0;
      const lastHistoryHour = fullHistory[fullHistory.length - 1]?.simHour ?? ty.seasonEndHour ?? ty.simHour ?? 0;
      // Visibility is a pure function of the selected clock. `timelineHidden` is retained in the
      // state model for playback bookkeeping, but it must never be able to hide an already-existing
      // storm after a save/restore cycle.
      if (firstHistoryHour > currentHour + 1e-6) {
        removeArchivedTrack(ty.id);
        return;
      }
      // Preserve both the playback snapshot subset and the complete archived path. Timeline replay
      // should continue showing the full lifecycle path, while state-dependent overlays/guidance
      // still need the exact replay-hour snapshot.
      let playbackHistory = fullHistory;
      if (currentHour + 1e-6 < lastHistoryHour) {
        let lo = 0, hi = fullHistory.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (fullHistory[mid].simHour <= currentHour + 1e-6) lo = mid + 1;
          else hi = mid;
        }
        playbackHistory = fullHistory.slice(0, lo);
      }
      const visibleHistory = historicalPlayback ? fullHistory : playbackHistory;
      if (!visibleHistory.length || !playbackHistory.length) {
        removeArchivedTrack(ty.id);
        return;
      }
      const isHistoricalCyclone = currentHour > lastHistoryHour + 1e-6 || (!!ty.dissipated && !ty.active);
      if (!isHistoricalCyclone) removeArchivedTrack(ty.id);
      const historicalMode = config.historicalTrackDisplay || "visible";
      const showHistoricalTrack = !isHistoricalCyclone || historicalMode !== "hidden";
      const historicalOpacityScale = isHistoricalCyclone && historicalMode === "translucent" ? 0.30 : 1;
      // Completed storms can have thousands of hourly states. Preserve all source data and official
      // analysis dots, but decimate only the old line geometry so multi-storm seasons remain smooth.
      const historyPointBudget = touchFirst ? 320 : 520;
      const historyStride = isHistoricalCyclone && visibleHistory.length > historyPointBudget ? Math.ceil(visibleHistory.length / historyPointBudget) : 1;
      const sampledHistory = historyStride > 1
        ? visibleHistory.filter((_, i) => i % historyStride === 0 || i === visibleHistory.length - 1)
        : visibleHistory;
      // The physics center advances every 10 simulated minutes while the persistent history is
      // intentionally stored hourly. Append only the current live center to the display line so
      // the route endpoint always meets the cyclone center and visually agrees with its km/h speed.
      // Official CMA/JMA analysis dots below still use the untouched hourly history.
      const lastSample = sampledHistory[sampledHistory.length - 1];
      // The heavy track layer ends at the last persisted analysis point. A tiny dedicated RAF
      // overlay connects that point to the live centre and interpolates it between 10-minute
      // physics snapshots. This removes the visible six-Hz "hop" without increasing physics cost.
      const renderHistory = sampledHistory;

      const archivedCacheKey = isHistoricalCyclone
        ? `${archiveStyleKey}|${visibleHistory.length}|${lastHistoryHour.toFixed(4)}|${showHistoricalTrack ? 1 : 0}|${config.intensityAgency}|${config.intensityReportingMode}`
        : "";
      if (isHistoricalCyclone) {
        const cached = archivedTrackLayerCacheRef.current.get(ty.id);
        if (cached?.key === archivedCacheKey) {
          cached.layers.forEach((layer) => {
            if (!archivedPathGroup.hasLayer(layer)) archivedPathGroup.addLayer(layer);
          });
          return;
        }
        removeArchivedTrack(ty.id);
      }
      const archivedLayerIdsBefore = isHistoricalCyclone
        ? new Set(Object.keys((pathGroup as any)._layers || {}))
        : null;

      // Draw historical track path line grouped by category to minimize Leaflet DOM layer count
      if (renderHistory.length > 1 && layers.track && showHistoricalTrack) {
        let currentGroup: [number, number][] = [[renderHistory[0].lat, renderHistory[0].lon]];
        let currentCat = renderHistory[0].category;
        let currentDiss = renderHistory[0].dissipated;

        for (let i = 1; i < renderHistory.length; i++) {
          const h = renderHistory[i];
          currentGroup.push([h.lat, h.lon]);

          const catChanged = h.category !== currentCat;
          const dissChanged = h.dissipated !== currentDiss;
          const isEnd = i === renderHistory.length - 1;

          if (catChanged || dissChanged || isEnd) {
            const isJmaTrack = (config.trackStyle || config.agencyStyle) === "JMA";
            const col = isJmaTrack ? JMA_PRODUCT_COLORS.forecast : getCategoryColor(currentCat, config);
            L.polyline(currentGroup, {
              color: col,
              weight: isJmaTrack ? 2.4 : 2.6,
              opacity: (isJmaTrack ? 0.98 : 0.9) * historicalOpacityScale,
              dashArray: currentDiss ? "5, 5" : undefined,
              interactive: false,
              renderer: (map as any)._canvasRenderer
            }).addTo(pathGroup);

            currentCat = h.category;
            currentDiss = h.dissipated;
            currentGroup = [[h.lat, h.lon]];
          }
        }
      }

      // CMA/NMC products keep their 02/05/08/11/14/17/20/23 clock. JMA-style products now use
      // one marker every 24 hours to stay visually sparse and closer to the requested style.
      if (layers.track && showHistoricalTrack && (!isHistoricalCyclone || config.historicalTrackDots !== false)) {
        const firstVisibleHour = Number(visibleHistory[0]?.simHour || 0);
        visibleHistory.forEach((state, stepIndex) => {
          const isLast = stepIndex === visibleHistory.length - 1;
          const isJmaDots = (config.trackDotStyle || config.agencyStyle) === "JMA";
          const showDot = isJmaDots
            ? isJmaTrackDotTime(Number(state.simHour), firstVisibleHour) || (isLast && ty.dissipated)
            : (isCmaTyphoonProductTime(startDate, state.simHour) || (isLast && ty.dissipated));
          if (!showDot) return;
          
          const markerColor = state.category === TyphoonCategory.ET
            ? "#949297"
            : state.category === TyphoonCategory.RL
              ? "#87939c"
             : (isJmaDots ? "#ffffff" : ((isLast && ty.dissipated) ? "#9ca3af" : getCategoryColor(state.category, config)));
          const jmaNodeRadius = 5.8;

          // Invisible node hit target expands to ~48 px on touch devices while keeping desktop
          // pointer precision. The visible analysis dot remains unchanged.
          const hitArea = L.circleMarker([state.lat, state.lon], {
            radius: touchFirst ? 24 : 12,
            color: "transparent",
            weight: 0,
            // Canvas hit testing uses geometry, not visible alpha. Keep the touch target fully
            // transparent: thousands of overlapping 0.2%-white circles accumulated into the
            // broad path "glow" visible on long mobile tracks.
            fillColor: "transparent",
            fillOpacity: 0,
            interactive: !isForecastRouteDrawing,
            bubblingMouseEvents: true,
            renderer: nodeHitRendererRef.current || (map as any)._canvasRenderer
          } as any).addTo(pathGroup);
          attachTrackHover(hitArea, state, `${getTyphoonDisplayName(ty, state.simHour, startDate)} · T+${Math.round(state.simHour)}h`);

          // 2. Visible circle marker
          L.circleMarker([state.lat, state.lon], {
            radius: isJmaDots ? jmaNodeRadius : 3.7,
            color: "#FFFFFF",
            weight: isJmaDots ? 1.35 : 0.9,
            fillColor: markerColor,
            fillOpacity: isHistoricalCyclone ? (historicalMode === "translucent" ? 0.34 : 0.82) : 1.0,
            interactive: false,
            zIndexOffset: 100,
            renderer: (map as any)._canvasRenderer
          } as any).addTo(pathGroup);

          // Do not bind Leaflet's automatic popup handler here. An automatic
          // layer popup competes with double-tap station placement before the map
          // gesture resolver knows whether this is a single or double tap.
          const trackPopup = L.popup({ closeButton: false, autoPan: false, className: "custom-leaflet-popup aether-track-hover-popup" })
            .setContent(trackInspectorHtml(state, `${getTyphoonDisplayName(ty, state.simHour, startDate)} · T+${Math.round(state.simHour)}h`));
          hitArea.on("click", (e: L.LeafletMouseEvent) => {
            if (e.originalEvent instanceof MouseEvent && e.originalEvent.button !== 0) return;
            if (isForecastRouteDrawingRef.current) {
              if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
              onForecastRoutePointRef.current?.(e.latlng.lat, e.latlng.lng);
              return;
            }
            // Direct desktop seek: current and archived track nodes are historical observations.
            // Consume their click so map triple-click relocation cannot run after seeking.
            if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
            onSelectTrackPointRef.current?.(state.simHour);
            map.openPopup(trackPopup.setLatLng(e.latlng));
          });
        });
      }

      // WMC multi-model centre guidance. The same builder is used by the export product, so the
      // model lines on the live map and in the product can no longer disagree. Every family starts
      // from the exact deterministic/manual-constrained forecast visible on the map and then gains a
      // smooth, bounded model-specific displacement. Live simulation intentionally defers ensemble intensity until product generation.
      if (!isHistoricalCyclone && layers.hurricaneTrackerModels && ty.active && !ty.dissipated) {
        const modelStorm: Typhoon = historicalPlayback && playbackHistory.length
          ? mergeTyphoonStateWithCurrentIdentity(ty, playbackHistory[playbackHistory.length - 1])
          : ty;
        const modelStorms = typhoons.map((other) => {
          if (!historicalPlayback) return other;
          const state = findHistoryAtOrBefore(other.history, currentHour);
          return state ? mergeTyphoonStateWithCurrentIdentity(other, state) : other;
        });
        const modelReferencePath = modelStorm.forecastPath?.length
          ? modelStorm.forecastPath
          : ty.forecastPath?.length
            ? ty.forecastPath
            : calculateLiveForecastTrackPath(modelStorm, config, 168);
        const guidanceIssueHour = Math.floor(currentHour / 3) * 3;
        const lastRef = modelReferencePath[modelReferencePath.length - 1] as any;
        const guidanceKey = [
          modelStorm.id, guidanceIssueHour, config.seed || "WMC", modelReferencePath.length,
          Number(lastRef?.lat || 0).toFixed(2), Number(lastRef?.lon || 0).toFixed(2),
          config.manualForecastRouteEnabled ? (config.manualForecastRoute?.length || 0) : 0
        ].join("|");
        let modelTracks = modelGuidanceCacheRef.current.get(guidanceKey);
        if (!modelTracks) {
          modelTracks = buildAetherCenterTrackGuidance(
            modelStorm,
            guidanceIssueHour,
            modelStorms,
            config.seed || "WMC",
            modelReferencePath,
            168,
            config
          );
          // Keep several days of 3-hour issues hot so timeline scrubbing does not repeatedly rebuild
          // eight expensive guidance families. The cache is issue-scoped and bounded.
          if (modelGuidanceCacheRef.current.size > 64) {
            const firstKey = modelGuidanceCacheRef.current.keys().next().value;
            if (firstKey) modelGuidanceCacheRef.current.delete(firstKey);
          }
          modelGuidanceCacheRef.current.set(guidanceKey, modelTracks);
        }
        modelTracks.forEach((model) => {
          if (model.track.length < 2) return;
          const latlngs = smoothGuidanceTrackForDisplay(model.track, 2).map((pt) => [pt.lat, pt.lon] as [number, number]);
          L.polyline(latlngs, {
            // Dark separator instead of a white halo. Tight model clusters on mobile used to stack
            // their white underlays into a bright band around the forecast track.
            color: "rgba(5,12,24,0.72)",
            weight: 3.4,
            opacity: 0.62,
            interactive: false,
            renderer: (map as any)._canvasRenderer
          }).addTo(pathGroup);
          const line = L.polyline(latlngs, {
            color: model.color,
            weight: 1.8,
            opacity: 0.96,
            interactive: false,
            renderer: (map as any)._canvasRenderer
          }).addTo(pathGroup);
          const modelSpeeds = model.track.map((p) => Number(p.speed)).filter((v) => Number.isFinite(v) && v >= 0);
          const meanMotion = modelSpeeds.length ? modelSpeeds.reduce((a, b) => a + b, 0) / modelSpeeds.length : 0;
          const peakMotion = modelSpeeds.length ? Math.max(...modelSpeeds) : 0;
          line.bindTooltip(`${model.modelId} · WMC 路径引导 · 移速均值 ${Math.round(meanMotion)} km/h / 最大 ${Math.round(peakMotion)} km/h · 强度在生成集系图时计算`, {
            sticky: true,
            direction: "top",
            opacity: 0.94
          });
        });
      }

      // Draw Forecast Track (72h, dashed lines, dots every 3 hours)
      if (!isHistoricalCyclone && layers.forecast) {
        const forecastPoints = ty.forecastPath || [];
        if (forecastPoints.length > 0) {
          // Dashed forecast geometry is rendered in a lightweight dedicated group below;
          // this layer keeps only issued forecast nodes and their inspectors.

          // Draw circles for forecast dots every 3 hours
          forecastPoints.forEach((state, idx) => {
            // Skip idx === 0 (0h forecast) because it sits directly at the current typhoon position
            if (idx === 0 || state.simHour % 3 !== 0) return;
            const markerColor = "#ffffff";
            
            // Forecast points receive the same finger-sized invisible hit target as analysis nodes.
            const hitArea = L.circleMarker([state.lat, state.lon], {
              radius: touchFirst ? 24 : 12,
              color: "transparent",
              weight: 0,
              fillColor: "transparent",
              fillOpacity: 0,
              interactive: !isForecastRouteDrawing,
              bubblingMouseEvents: true,
              renderer: nodeHitRendererRef.current || (map as any)._canvasRenderer
            } as any).addTo(pathGroup);
            attachTrackHover(hitArea, state, `预报 +${Math.round(state.simHour)}h`);

            // 2. Visible circle marker
            L.circleMarker([state.lat, state.lon], {
              radius: 3.5,
              color: "#0f172a",
              weight: 1.4,
              fillColor: markerColor,
              fillOpacity: 1,
              interactive: false,
              zIndexOffset: 100,
              renderer: (map as any)._canvasRenderer
            } as any).addTo(pathGroup);
            if (state.simHour >= 24 && state.simHour % 24 === 0) {
              const leadLabel = L.tooltip({ permanent: true, direction: "left", offset: [-7, -2], opacity: 1, className: "storminc-forecast-lead-label", interactive: false })
                .setLatLng([state.lat, state.lon]).setContent(`+${Math.round(state.simHour)}h`);
              pathGroup.addLayer(leadLabel);
            }
            
            const currentSimH = ty.history?.length ? ty.history[ty.history.length - 1].simHour : 0;
            const targetAbsHour = currentSimH + state.simHour;
            const forecastPopup = L.popup({ closeButton: false, autoPan: false, className: "custom-leaflet-popup aether-track-hover-popup" })
              .setContent(trackInspectorHtml(state, `${getTyphoonDisplayName(ty, currentHour, startDate)} 预报 +${Math.round(state.simHour)}h`));
            hitArea.on("click", (e: L.LeafletMouseEvent) => {
              if (e.originalEvent instanceof MouseEvent && e.originalEvent.button !== 0) return;
              if (isForecastRouteDrawingRef.current) {
                if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
                onForecastRoutePointRef.current?.(e.latlng.lat, e.latlng.lng);
                return;
              }
              // Forecast nodes may be beyond the simulated archive. Their click inspects the
              // forecast; only already-simulated times may be sought via the parent handler.
              if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
              map.openPopup(forecastPopup.setLatLng(e.latlng));
              onSelectTrackPointRef.current?.(targetAbsHour);
            });
          });
        }
      }

      // Draw Center Icon and Asymmetric Wind circles if active
      if (!ty.dissipated) {
        const centerColor = getCategoryColor(ty.category, config);

        // Live center marker is rendered by the lightweight interpolation overlay below.

        // Draw Asymmetric wind circles (R7, R10, R12)
        if (layers.windRadii && !shouldHideCmaWindRadiiAfterLandfall(ty)) {
          const liveTy = typhoons.find((t) => {
            const firstHour = t.history?.[0]?.simHour ?? t.seasonStartHour ?? 0;
            return t.active && !t.dissipated && firstHour <= currentHour + 1e-6;
          });
          // The live cyclone is drawn in the interpolated radii overlay; keep this slower group for
          // any additional active cyclones only, otherwise two envelopes would be visible at once.
          if (!liveTy || liveTy.id !== ty.id) drawAsymmetricRadii(ty, radiiGroup);
        }
      }

      if (isHistoricalCyclone && archivedLayerIdsBefore) {
        const currentLayers = (pathGroup as any)._layers || {};
        const archivedLayers = Object.entries(currentLayers)
          .filter(([id]) => !archivedLayerIdsBefore.has(id))
          .map(([, layer]) => layer as L.Layer);
        archivedLayers.forEach((layer) => {
          pathGroup.removeLayer(layer);
          archivedPathGroup.addLayer(layer);
        });
        archivedTrackLayerCacheRef.current.set(ty.id, { key: archivedCacheKey, layers: archivedLayers });
      }
    });
  }, [typhoons, currentHour, historicalPlayback, timelineSeekPreview, layers.track, layers.windRadii, layers.forecast, layers.forecastCone, layers.hurricaneTrackerModels, categoryColorsKey, config.manualForecastRouteEnabled, config.manualForecastRoute, config.seed, config.agencyStyle, config.intensityAgency, config.intensityReportingMode, config.trackStyle, config.trackDotStyle, config.windRadiiStyle, config.centerStyle, config.historicalTrackDisplay, config.historicalTrackDots, startDate, isForecastRouteDrawing]);

  // Forecast line/cone geometry follows the live 10-minute centre, while best-track dots/history
  // change only on archived analyses. Keeping these layers separate prevents a moving forecast
  // anchor from forcing hundreds of immutable history markers and hover targets to be recreated.
  useEffect(() => {
    const map = mapRef.current;
    const group = forecastGeometryGroupRef.current;
    if (!map || !group) return;
    if (timelineSeekPreview) return;
    if (!layers.forecast && !layers.forecastCone) {
      group.clearLayers();
      return;
    }
    const now = Date.now();
    const hasActiveCyclone = typhoons.some((ty) => ty.active && !ty.dissipated);
    const baseThrottleTime = speed <= 2 ? 650 : speed <= 8 ? 480 : speed <= 15 ? 330 : speed <= 30 ? 260 : 210;
    const throttleTime = baseThrottleTime * (renderBudgetRef.current.degraded ? 1.8 : 1);
    if (!historicalPlayback && hasActiveCyclone && now - lastForecastGeometryUpdateTimeRef.current < throttleTime) return;
    lastForecastGeometryUpdateTimeRef.current = now;
    group.clearLayers();

    typhoons.forEach((ty) => {
      const fullHistory = ty.history || [];
      const firstHistoryHour = fullHistory[0]?.simHour ?? ty.seasonStartHour ?? 0;
      const lastHistoryHour = fullHistory[fullHistory.length - 1]?.simHour ?? ty.seasonEndHour ?? ty.simHour ?? 0;
      if (firstHistoryHour > currentHour + 1e-6) return;
      const isHistoricalCyclone = currentHour > lastHistoryHour + 1e-6 || (!!ty.dissipated && !ty.active);
      if (isHistoricalCyclone) return;

      let coneForecastPoints = ty.forecastPath || [];
      if (layers.forecastCone && coneForecastPoints.length === 0 && !ty.dissipated && ty.vmax > 5.0) {
        coneForecastPoints = calculateLiveForecastTrackPath(ty, config, 120);
      }

      if (layers.forecastCone && coneForecastPoints.length > 0) {
        const rawConeTrack = [
          { lat: ty.lat, lon: ty.lon, simHour: 0 },
          ...coneForecastPoints.filter((point) => point.simHour > 0)
        ];
        const allConeTrack: Array<{ lat: number; lon: number; simHour: number }> = [];
        rawConeTrack.forEach((curr, idx) => {
          const prev = allConeTrack[allConeTrack.length - 1];
          const distDeg = prev ? Math.hypot(curr.lat - prev.lat, curr.lon - prev.lon) : Infinity;
          if (!prev || distDeg > 0.05 || idx === rawConeTrack.length - 1) allConeTrack.push(curr);
        });

        if (allConeTrack.length >= 2) {
          const leftLine: [number, number][] = [];
          const rightLine: [number, number][] = [];
          const tangents: Array<{ tx: number; ty: number; nx: number; ny: number; radiusDeg: number; cosLat: number }> = [];

          for (let i = 0; i < allConeTrack.length; i++) {
            const curr = allConeTrack[i];
            let dLat = 0;
            let dLon = 0;
            if (i < allConeTrack.length - 1) {
              dLat += allConeTrack[i + 1].lat - curr.lat;
              dLon += allConeTrack[i + 1].lon - curr.lon;
            }
            if (i > 0) {
              dLat += curr.lat - allConeTrack[i - 1].lat;
              dLon += curr.lon - allConeTrack[i - 1].lon;
            }
            const cosLat = Math.max(0.15, Math.cos((curr.lat * Math.PI) / 180));
            const vx = dLon * cosLat;
            const vy = dLat;
            const len = Math.hypot(vx, vy) || 1;
            const tx = vx / len;
            const ty = vy / len;
            const nx = -ty;
            const ny = tx;
            const radiusDeg = Math.min(4.2, 0.032 * Math.max(0, curr.simHour) + 0.45);
            const dLonNormal = (nx * radiusDeg) / cosLat;
            const dLatNormal = ny * radiusDeg;
            leftLine.push([curr.lat + dLatNormal, curr.lon + dLonNormal]);
            rightLine.push([curr.lat - dLatNormal, curr.lon - dLonNormal]);
            tangents.push({ tx, ty, nx, ny, radiusDeg, cosLat });
          }

          const capSteps = 10;
          const endCenter = allConeTrack[allConeTrack.length - 1];
          const endT = tangents[tangents.length - 1];
          const endCap: [number, number][] = [];
          for (let step = 1; step <= capSteps; step++) {
            const theta = (Math.PI * step) / capSteps;
            const east = endT.nx * Math.cos(theta) + endT.tx * Math.sin(theta);
            const north = endT.ny * Math.cos(theta) + endT.ty * Math.sin(theta);
            endCap.push([
              endCenter.lat + north * endT.radiusDeg,
              endCenter.lon + (east * endT.radiusDeg) / endT.cosLat
            ]);
          }

          const startCenter = allConeTrack[0];
          const startT = tangents[0];
          const startCap: [number, number][] = [];
          for (let step = 1; step < capSteps; step++) {
            const theta = (Math.PI * step) / capSteps;
            const east = -startT.nx * Math.cos(theta) - startT.tx * Math.sin(theta);
            const north = -startT.ny * Math.cos(theta) - startT.ty * Math.sin(theta);
            startCap.push([
              startCenter.lat + north * startT.radiusDeg,
              startCenter.lon + (east * startT.radiusDeg) / startT.cosLat
            ]);
          }

          const rightReverse = [...rightLine].reverse().slice(1);
          const envelope = [...leftLine, ...endCap, ...rightReverse, ...startCap];
          L.polygon(envelope, {
            color: "transparent",
            weight: 0,
            fillColor: "#24344f",
            fillOpacity: 0.52,
            interactive: false,
            renderer: (map as any)._canvasRenderer
          }).addTo(group);
        }
      }

      if (layers.forecast) {
        const issuedForecast = ty.forecastPath || [];
        for (let i = 0; i < issuedForecast.length; i++) {
          const ptStart = i === 0 ? { lat: ty.lat, lon: ty.lon } : issuedForecast[i - 1];
          const ptEnd = issuedForecast[i];
          L.polyline([[ptStart.lat, ptStart.lon], [ptEnd.lat, ptEnd.lon]], {
            color: "#22d3ee",
            weight: 2.15,
            opacity: 0.94,
            dashArray: "4, 5",
            interactive: false,
            renderer: (map as any)._canvasRenderer
          }).addTo(group);
        }
      }
    });
  }, [typhoons, timelineSeekPreview, currentHour, historicalPlayback, layers.forecast, layers.forecastCone, config, speed]);

  // Function to compute and draw multi-quadrant wind circles on the map
  
  const getStationColor = (wind: number) => {
    if (wind < 10) return "bg-emerald-500 text-white";
    if (wind < 17) return "bg-green-500 text-white";
    if (wind < 24) return "bg-yellow-500 text-slate-900";
    if (wind < 32) return "bg-orange-500 text-white";
    if (wind < 41) return "bg-red-500 text-white";
    if (wind < 51) return "bg-rose-600 text-white";
    return "bg-purple-600 text-white";
  };

  const drawAsymmetricRadii = (ty: Typhoon, group: L.FeatureGroup) => {
    const isJmaRadii = (config.windRadiiStyle || config.agencyStyle) === "JMA";
    if (!isJmaRadii && shouldHideCmaWindRadiiAfterLandfall(ty)) return;

    // Keep published wind areas visible after landfall while their radii remain non-zero.
    // The engine owns their 3-hour contraction/disappearance; JMA geometry additionally applies
    // coast-aware contraction instead of deleting the whole area merely because the centre is inland.

    // Directly use the current calculated quadrant radii for smooth real-time display.
    const displayR7 = ty.r7;
    const displayR10 = ty.r10;
    const displayR12 = ty.r12;

    // Digital-Typhoon/JMA best-track animation aesthetic: yellow outer outline +
    // red/orange inner outline, no translucent CMA-style fill.
    const levels = isJmaRadii
      ? [
          { radius: displayR7, color: JMA_PRODUCT_COLORS.strongWind, name: "强风圈", jmaLevel: "strong" as const },
          { radius: displayR10, color: JMA_PRODUCT_COLORS.stormWind, name: "暴风圈", jmaLevel: "storm" as const }
        ]
      : [
          { radius: displayR7, color: "#f39c12", name: "七级风圈" },
          { radius: displayR10, color: "#d35400", name: "十级风圈" },
          { radius: displayR12, color: "#c0392b", name: "十二级风圈" }
        ];

    levels.forEach((lvl) => {
      const q = lvl.radius;
      const vals = [q.ne, q.se, q.sw, q.nw].filter(v => Number.isFinite(v) && v > 0);
      if (!vals.length) return;

      if (isJmaRadii) {
        const geometry = calculateJmaWindCircleGeometry(
          {
            lat: ty.lat,
            lon: ty.lon,
            vmaxCmaMs: ty.vmax,
            landed: !!ty.landed,
            radii: q,
            level: (lvl as any).jmaLevel
          },
          (lat, lon) => getLandMetrics(lat, lon, config.coastlineSource).isLand
        );
        if (!geometry.visible) return;

        L.circle([geometry.centerLat, geometry.centerLon], {
          radius: geometry.radiusKm * 1000,
          color: lvl.color,
          weight: 2.2,
          opacity: 0.92,
          fill: false,
          interactive: false,
          className: "leaflet-wind-radii-circle",
          renderer: (mapRef.current as any)._canvasRenderer
        }).addTo(group);
        return;
      }

      const points: L.LatLng[] = [];
      const quadrant: Array<[number, number, number]> = [
        [0, 90, q.ne], [90, 180, q.se], [180, 270, q.sw], [270, 360, q.nw]
      ];
      quadrant.forEach(([from, to, radius]) => {
        const rr = radius || 0;
        if (rr <= 0) return;
        for (let deg = from; deg <= to; deg += (touchFirst ? 5 : 3)) {
          const angleRad = (deg * Math.PI) / 180;
          const dLat = (rr * Math.cos(angleRad)) / 111.12;
          const dLon = (rr * Math.sin(angleRad)) / (111.12 * Math.max(0.2, Math.cos((ty.lat * Math.PI) / 180)));
          points.push(L.latLng(ty.lat + dLat, ty.lon + dLon));
        }
      });
      if (points.length < 4) return;
      L.polygon(points, {
        color: lvl.color,
        weight: 1.5,
        opacity: 0.85,
        fillColor: lvl.color,
        fillOpacity: 0.11,
        interactive: false,
        className: "leaflet-wind-radii-circle",
        renderer: (mapRef.current as any)._canvasRenderer
      }).addTo(group);
    });
  };

  const lastStationUpdateRef = useRef<number>(0);

  // --- Weather Stations ---
  useEffect(() => {
    const group = stationsGroupRef.current;
    if (!group) return;
    // Station icons/readouts are expensive and not needed for every intermediate thumb position.
    // Refresh them once after the seek commits to its exact archived hour.
    if (timelineSeekPreview) return;

    if (!layers.weatherStations) {
      group.clearLayers();
      stationMarkersRef.current = {};
      return;
    }

    const now = Date.now();
    const stationBaseThrottleMs = speed > 20 ? 420 : speed > 8 ? 280 : 180;
    const stationThrottleMs = stationBaseThrottleMs * (touchFirst ? 1.4 : 1) * (renderBudgetRef.current.degraded ? 1.25 : 1);
    const stationNamesChanged = stationNameRevisionRef.current !== stationNameRevision;
    if (!stationNamesChanged && !isForecastRouteDrawing && now - lastStationUpdateRef.current < stationThrottleMs) {
      return;
    }
    lastStationUpdateRef.current = now;
    stationNameRevisionRef.current = stationNameRevision;

    const mainTy = typhoons[0];
    const currentReadingByName = new Map<string, NonNullable<Typhoon["stationReadings"]>[number]>();
    for (const reading of mainTy?.stationReadings || []) currentReadingByName.set(reading.name, reading);
    const mainLatRad = mainTy ? mainTy.lat * (Math.PI / 180) : 0;
    const cosMainLat = mainTy ? Math.cos(mainLatRad) : 1;
    const buildStationPopupHtml = (data: {
      stationName: string; stationLat: number; stationLon: number; stationDisplayName: string;
      windSpeed: number; gustSpeed: number; pressure: number; stormSurge: number; maxStormSurge: number; force: number;
    }) => `
      <div class="p-3 text-white bg-[#08121f]/95 rounded-xl border border-slate-700/60 font-sans text-xs min-w-[160px] shadow-2xl">
        <div class="font-bold border-b border-slate-800 pb-1.5 mb-1.5 text-sm text-[#1E9CFF]">${escapeStationPopupText(data.stationDisplayName)}</div>
        <div class="space-y-1 font-mono text-[11px] text-slate-300">
          <div>实时风速: <b class="text-white">${data.windSpeed.toFixed(1)} m/s</b> (${data.force}级)</div>
          <div>实时阵风: <b class="text-red-300">${data.gustSpeed.toFixed(1)} m/s</b></div>
          <div>实时气压: <b class="text-[#1E9CFF]">${data.pressure.toFixed(1)} hPa</b></div>
          <div>当前风暴增水: <b class="text-cyan-200">${data.stormSurge.toFixed(2)} m</b></div>
          <div>过程最大风暴潮: <b class="text-cyan-100">${data.maxStormSurge.toFixed(2)} m</b></div>
        </div>
        <div class="mt-2.5 pt-2 border-t border-slate-800/60 flex justify-end">
          <button onclick="window.showStationHistory('${data.stationName}', ${data.stationLat}, ${data.stationLon})" class="px-2.5 py-1 text-[10px] font-semibold bg-[#1E9CFF] hover:bg-[#1E9CFF]/80 text-white rounded transition-all cursor-pointer shadow-md">更多</button>
        </div>
      </div>`;

    WEATHER_STATION_RENDER_META.forEach(({ station, cosLat: stationCosLat }) => {
      let windSpeed = 0;
      let pressure = 1013;
      const currentReading = currentReadingByName.get(station.name);
      const stationDisplayName = readStationPopupTitle(station.name, station.lat, station.lon);
      let stormSurge = Number(currentReading?.stormSurge || 0);
      let maxStormSurge = Number(currentReading?.maxStormSurge || currentReading?.stormSurge || 0);
      let gustSpeed = Number(currentReading?.gustSpeed || 0);
      
      if (mainTy && mainTy.active) {
         // Calculate real-time dynamic readings based on current exact typhoon location on every frame
         const R = 6371;
         const dLatRad = (station.lat - mainTy.lat) * (Math.PI / 180);
         const dLonRad = (station.lon - mainTy.lon) * (Math.PI / 180);
         const a = Math.sin(dLatRad / 2) * Math.sin(dLatRad / 2) +
                   cosMainLat * stationCosLat *
                   Math.sin(dLonRad / 2) * Math.sin(dLonRad / 2);
         const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
         const dist = R * c;

         const dLat = station.lat - mainTy.lat;
         const dLon = (station.lon - mainTy.lon) * Math.cos((mainTy.lat * Math.PI) / 180);

         let quad: "ne" | "se" | "sw" | "nw" = "ne";
         if (dLat >= 0 && dLon >= 0) {
           quad = "ne";
         } else if (dLat < 0 && dLon >= 0) {
           quad = "se";
         } else if (dLat < 0 && dLon < 0) {
           quad = "sw";
         } else {
           quad = "nw";
         }

         const r7 = mainTy.r7;
         const r10 = mainTy.r10;
         const r12 = mainTy.r12;
         const vmax = mainTy.vmax;
         const rmw = mainTy.rmw;

         const qR7 = (r7 && r7[quad] > 0) ? r7[quad] : Math.max(100, vmax * 4);
         const qR10 = (r10 && r10[quad] > 0) ? r10[quad] : (vmax >= 24.5 ? Math.max(50, qR7 * 0.6) : 0);
         const qR12 = (r12 && r12[quad] > 0) ? r12[quad] : (vmax >= 32.7 ? Math.max(30, qR7 * 0.4) : 0);

         // Center low wind zone diameter 24-50km (radius R_center 12-25km)
         const R_center = mainTy.eyeRadiusKm && mainTy.eyeRadiusKm > 2
           ? Math.max(2.0, mainTy.eyeRadiusKm)
           : Math.max(8.0, Math.min(22.0, rmw * 0.65));

         let centerRatio = 0.98;
         if (vmax >= 32.7) {
           centerRatio = Math.max(0.08, 0.22 - 0.14 * Math.min(1.0, (vmax - 32.7) / 30.0));
         } else if (vmax >= 17.2) {
           const f = (vmax - 17.2) / 15.5;
           // Continuous at 32.7 m/s: do not abruptly fill the eye just because a near-landfall
           // cyclone weakens through the typhoon threshold between adjacent station locations.
           centerRatio = 0.85 - 0.63 * f;
         } else {
           centerRatio = 0.95;
         }

         const V_center = vmax * centerRatio;

         if (dist <= rmw) {
           if (dist <= R_center) {
             windSpeed = V_center;
           } else {
             const ratio = (dist - R_center) / Math.max(1, rmw - R_center);
             const steepness = vmax >= 41.5 ? 2.0 : (1.0 + 0.9 * (vmax / 41.5));
             windSpeed = V_center + (vmax - V_center) * Math.pow(ratio, steepness);
           }
         } else if (qR12 > 0 && dist <= qR12) {
           const ratio = (dist - rmw) / Math.max(1, qR12 - rmw);
           windSpeed = vmax - (vmax - 32.7) * ratio;
         } else if (qR10 > 0 && dist <= qR10) {
           const startWind = qR12 > 0 ? 32.7 : vmax;
           const startDist = qR12 > 0 ? qR12 : rmw;
           const ratio = (dist - startDist) / Math.max(1, qR10 - startDist);
           windSpeed = startWind - (startWind - 24.5) * ratio;
         } else if (qR7 > 0 && dist <= qR7) {
           const startWind = qR10 > 0 ? 24.5 : (qR12 > 0 ? 32.7 : vmax);
           const startDist = qR10 > 0 ? qR10 : (qR12 > 0 ? qR12 : rmw);
           const ratio = (dist - startDist) / Math.max(1, qR7 - startDist);
           windSpeed = startWind - (startWind - 13.9) * ratio;
         } else {
           const startWind = qR7 > 0 ? 13.9 : (qR10 > 0 ? 24.5 : (qR12 > 0 ? 32.7 : vmax));
           const startDist = qR7 > 0 ? qR7 : (qR10 > 0 ? qR10 : (qR12 > 0 ? qR12 : rmw));
           windSpeed = startWind * Math.exp(-(dist - startDist) / 150.0);
         }

         windSpeed = Math.max(0, Math.min(vmax, windSpeed));

         const frictionFactor = Math.max(0.70, 0.90 - (windSpeed / 100.0) * 0.15 - (dist / Math.max(1, qR7)) * 0.05);
         windSpeed *= frictionFactor;

         pressure = calculateRadialPressure(mainTy.pmin, dist, rmw, vmax);

         windSpeed = Number(windSpeed.toFixed(1));
         pressure = Math.round(pressure);
      } else {
         const reading = currentReading;
         if (reading) {
           windSpeed = reading.windSpeed;
           pressure = reading.pressure;
         } else if (mainTy) {
           const R = 6371;
           const dLat = (station.lat - mainTy.lat) * (Math.PI / 180);
           const dLon = (station.lon - mainTy.lon) * (Math.PI / 180);
           const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                     cosMainLat * stationCosLat *
                     Math.sin(dLon / 2) * Math.sin(dLon / 2);
           const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
           const dist = R * c;
           
           if (dist > 0) {
             if (mainTy.vmax > 48.0 && dist < mainTy.rmw) {
               windSpeed = mainTy.vmax * (0.15 + 0.85 * (dist / mainTy.rmw));
             } else {
               windSpeed = Math.max(0, Math.min(mainTy.vmax, (mainTy.vmax * mainTy.rmw) / dist));
             }
           } else {
             windSpeed = mainTy.vmax > 48.0 ? mainTy.vmax * 0.15 : mainTy.vmax;
           }
           pressure = calculateRadialPressure(mainTy.pmin, dist, mainTy.rmw, mainTy.vmax);
         }
      }
      // Always re-diagnose the surge from the current cyclone state and keep the
      // larger value. This fixes legacy/partially saved station rows that carry
      // an explicit 0 even though the coastal surge diagnostic is non-zero.
      if (mainTy) {
        const diagnosedSurge = calculateStationStormSurge(
          station, mainTy.lat, mainTy.lon, mainTy.pmin, mainTy.rmw || 35, mainTy.r7,
          windSpeed, pressure, mainTy as any
        );
        stormSurge = Math.max(stormSurge, diagnosedSurge);
        maxStormSurge = Math.max(maxStormSurge, stormSurge);
      }
      if (!Number.isFinite(gustSpeed) || gustSpeed <= 0) {
        gustSpeed = windSpeed * (1.18 + 0.14 * Math.min(1, windSpeed / 35));
      }
      
      const force = getWindForceCategory(windSpeed);
      const sizeScale = (config.capsuleSize ?? 100) / 100;
      const stationVisualKey = `${windSpeed.toFixed(1)}|${sizeScale.toFixed(3)}|${isForecastRouteDrawing ? 1 : 0}`;
      const getStationIcon = () => {
        const cached = stationIconCacheRef.current.get(stationVisualKey);
        if (cached) return cached;
        const width = 42 * sizeScale;
        const height = 18 * sizeScale;
        const fontSize = 10 * sizeScale;
        const borderRadius = 9 * sizeScale;
        const iconHtml = `
          <div class="flex flex-col items-center justify-center transform -translate-x-1/2 -translate-y-1/2 ${isForecastRouteDrawing ? "cursor-crosshair" : "cursor-pointer"} select-none">
            <div class="flex items-center justify-center transition-all shadow-md border border-white/40 font-mono font-bold text-white whitespace-nowrap overflow-hidden"
                 style="background-color:${getStationGradientColor(windSpeed)};width:${width}px;height:${height}px;border-radius:${borderRadius}px;font-size:${fontSize}px;">
                ${windSpeed.toFixed(1)}
            </div>
          </div>`;
        const icon = L.divIcon({ html: iconHtml, className: "", iconSize: [0, 0] });
        if (stationIconCacheRef.current.size >= 384) {
          const oldest = stationIconCacheRef.current.keys().next().value;
          if (oldest) stationIconCacheRef.current.delete(oldest);
        }
        stationIconCacheRef.current.set(stationVisualKey, icon);
        return icon;
      };
      const stationPopupData = {
        stationName: station.name, stationLat: station.lat, stationLon: station.lon, stationDisplayName,
        windSpeed, gustSpeed, pressure, stormSurge, maxStormSurge, force
      };

      type StationMarker = L.Marker & {
        __aetherStationVisualKey?: string;
        __aetherStationPopupData?: typeof stationPopupData;
      };
      let marker = stationMarkersRef.current[station.name] as StationMarker;
      if (!marker) {
        marker = L.marker([station.lat, station.lon], { icon: getStationIcon(), interactive: true }) as StationMarker;
        marker.__aetherStationVisualKey = stationVisualKey;
        marker.__aetherStationPopupData = stationPopupData;
        marker.on("click", (e: L.LeafletMouseEvent) => {
          if (isForecastRouteDrawingRef.current) {
            if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
            onForecastRoutePointRef.current?.(e.latlng.lat, e.latlng.lng);
            return;
          }
          if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
          setActiveHistoryStation({ id: station.name, name: station.name, lat: station.lat, lon: station.lon });
        });
        marker.on("popupopen", () => {
          setOpenStationName(station.name);
          const latest = marker.__aetherStationPopupData;
          if (latest) marker.setPopupContent(buildStationPopupHtml(latest));
        });
        marker.bindPopup("", { className: "custom-leaflet-popup" });
        marker.addTo(group);
        stationMarkersRef.current[station.name] = marker;
      } else {
        // Reuse the Leaflet marker and its listeners. Recreating every station at each cyclone
        // update caused avoidable DOM allocation/layout/GC spikes on both mobile and desktop.
        if (marker.__aetherStationVisualKey !== stationVisualKey) {
          marker.setIcon(getStationIcon());
          marker.__aetherStationVisualKey = stationVisualKey;
        }
        marker.__aetherStationPopupData = stationPopupData;
        // Only the one visible popup needs HTML rebuilt each station refresh. Keeping the latest
        // numeric payload on the marker preserves exact values while avoiding ~85 large HTML-string
        // allocations several times per second when no station popup is open.
        if ((marker as any).isPopupOpen?.()) marker.setPopupContent(buildStationPopupHtml(stationPopupData));
        if (!group.hasLayer(marker)) marker.addTo(group);
      }
    });

    Object.entries(stationMarkersRef.current).forEach(([id, marker]) => {
      if (WEATHER_STATION_NAME_SET.has(id)) return;
      if (group.hasLayer(marker)) group.removeLayer(marker);
      delete stationMarkersRef.current[id];
    });
  }, [layers.weatherStations, typhoons, timelineSeekPreview, config.capsuleSize, isForecastRouteDrawing, speed, stationNameRevision]);

  // Pending genesis / temporary diagnostic markers. These are transient and are
  // removed as soon as the user cancels/confirms or closes the station page.
  useEffect(() => {
    const map = mapRef.current;
    const group = transientGroupRef.current;
    if (!map || !group) return;
    group.clearLayers();

    if (pendingGenesisPoint) {
      L.marker([pendingGenesisPoint.lat, pendingGenesisPoint.lon], {
        interactive: true,
        keyboard: false,
        bubblingMouseEvents: false,
        icon: L.divIcon({
          className: "typhoon-genesis-confirm-wrap",
          html: `<div class="typhoon-genesis-confirm"><div class="typhoon-genesis-confirm__actions"><button id="btn-confirm-typhoon-genesis" type="button" aria-label="确认放置台风" title="确认放置台风" onclick="event.stopPropagation();window.confirmPendingTyphoonGenesis&&window.confirmPendingTyphoonGenesis()">✓</button><button id="btn-cancel-typhoon-genesis" type="button" aria-label="取消放置" title="取消放置" onclick="event.stopPropagation();window.cancelPendingTyphoonGenesis&&window.cancelPendingTyphoonGenesis()">×</button></div><div class="typhoon-genesis-confirm__intensity" role="group" aria-label="生成强度"><button class="${pendingGenesisIntensity === 5 ? "is-active" : ""}" type="button" onclick="event.stopPropagation();window.setPendingTyphoonGenesisIntensity&&window.setPendingTyphoonGenesisIntensity(5)">5</button><button class="${pendingGenesisIntensity === 12 ? "is-active" : ""}" type="button" onclick="event.stopPropagation();window.setPendingTyphoonGenesisIntensity&&window.setPendingTyphoonGenesisIntensity(12)">12</button><button class="${pendingGenesisIntensity === 15 ? "is-active" : ""}" type="button" onclick="event.stopPropagation();window.setPendingTyphoonGenesisIntensity&&window.setPendingTyphoonGenesisIntensity(15)">15</button><button class="${pendingGenesisIntensity === 18 ? "is-active" : ""}" type="button" onclick="event.stopPropagation();window.setPendingTyphoonGenesisIntensity&&window.setPendingTyphoonGenesisIntensity(18)">18</button><span>m/s</span></div><span class="typhoon-genesis-confirm__dot"></span></div>`,
          iconSize: [132, 94],
          iconAnchor: [66, 86]
        })
      }).addTo(group);
    }
    if (temporaryStationPoint) {
      L.circleMarker([temporaryStationPoint.lat, temporaryStationPoint.lon], {
        radius: 4.5, color: "#e2e8f0", weight: 1.6, fillColor: "#0f172a", fillOpacity: 1,
        interactive: false, renderer: (map as any)._canvasRenderer
      }).addTo(group);
    }
    if (stationPlacementTransition) {
      L.marker([stationPlacementTransition.lat, stationPlacementTransition.lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "typhoon-temp-station-transition-wrap",
          html: '<div class="typhoon-temp-station-transition"><span class="typhoon-temp-station-transition__ring"></span><span class="typhoon-temp-station-transition__dot"></span><span class="typhoon-temp-station-transition__text">建立临时站点…</span></div>',
          iconSize: [118, 42],
          iconAnchor: [21, 21]
        })
      }).addTo(group);
    }
  }, [pendingGenesisPoint, pendingGenesisIntensity, temporaryStationPoint, stationPlacementTransition, mapInitialized]);

  // Recreate SST/OHC texture only if actual sea-temperature/heat-content inputs change.
  const oceanFingerprint = oceanTextureFingerprint(layers.sst ? "sst" : "ohc", config,
    `ne:${geoJsonState.landLoaded ? 1 : 0}`);
  // --- 7A. Cached ocean environment textures (SST / OHC) ---
  useEffect(() => {
    if (!mapInitialized) return;
    const map = mapRef.current;
    if (!map) return;

    const kind = layers.sst ? "sst" : layers.ohc ? "ohc" : null;
    if (!kind || !geoJsonState.landLoaded || !landGeoJson) {
      if (oceanTextureOverlayRef.current) {
        oceanTextureOverlayRef.current.remove();
        oceanTextureOverlayRef.current = null;
      }
      return;
    }

    const fingerprint = oceanFingerprint;
    const applyTexture = (url: string) => {
      if (!url || !mapRef.current) return;
      const bounds = L.latLngBounds(
        [WEST_PACIFIC_TEXTURE_BOUNDS.minLat, WEST_PACIFIC_TEXTURE_BOUNDS.minLon],
        [WEST_PACIFIC_TEXTURE_BOUNDS.maxLat, WEST_PACIFIC_TEXTURE_BOUNDS.maxLon]
      );
      const opacity = kind === "sst" ? 0.82 : 0.84;
      const current = oceanTextureOverlayRef.current;
      if (current) {
        current.setUrl(url);
        current.setBounds(bounds);
        current.setOpacity(opacity);
      } else {
        oceanTextureOverlayRef.current = L.imageOverlay(url, bounds, {
          pane: "environmentTexturePane",
          opacity,
          interactive: false,
          crossOrigin: false
        }).addTo(map);
      }
    };

    const cached = oceanTextureCacheRef.current.get(fingerprint);
    if (cached) {
      applyTexture(cached);
      return;
    }

    const taskToken = ++oceanTextureTaskRef.current;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const bake = () => {
      if (taskToken !== oceanTextureTaskRef.current) return;
      const legacyOceanConfig = configRef.current.newEnvironmentPhysicsEnabled ? { ...configRef.current, newEnvironmentPhysicsEnabled: false } : configRef.current;
      const url = bakeOceanTexture(kind, legacyOceanConfig, landGeoJson);
      if (taskToken !== oceanTextureTaskRef.current || !url) return;
      oceanTextureCacheRef.current.set(fingerprint, url);
      while (oceanTextureCacheRef.current.size > 8) {
        const oldest = oceanTextureCacheRef.current.keys().next().value;
        if (!oldest) break;
        oceanTextureCacheRef.current.delete(oldest);
      }
      applyTexture(url);
    };

    const requestIdle = (window as any).requestIdleCallback as undefined | ((cb: () => void, options?: { timeout: number }) => number);
    if (requestIdle) idleHandle = requestIdle(bake, { timeout: 260 });
    else timeoutHandle = setTimeout(bake, 0);

    return () => {
      oceanTextureTaskRef.current += 1;
      if (idleHandle !== null && (window as any).cancelIdleCallback) (window as any).cancelIdleCallback(idleHandle);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    };
  }, [mapInitialized, layers.sst, layers.ohc, oceanFingerprint, geoJsonState.landLoaded]);

  // --- 7B. Remaining dynamic Canvas layers ---
  useEffect(() => {
    if (!mapInitialized) return;

    const canvas = canvasRef.current;
    const map = mapRef.current;
    if (!canvas || !map) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawLoop = (timestamp: number) => {
      if (!canvas || !map || !ctx) return;
      // Background tabs should not consume CPU/GPU rebuilding weather layers. Resume from the
      // newest physical refs when visible again; simulation state itself is not throttled here.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        canvasIdleTimerRef.current = setTimeout(() => {
          canvasIdleTimerRef.current = null;
          animationFrameRef.current = requestAnimationFrame(drawLoop);
        }, 500);
        return;
      }

      const activeLayers = layersRef.current;
      const hasSynopticContent = !!(configRef.current.newEnvironmentPanelsEnabled && (
        activeLayers.newSubtropicalHigh || activeLayers.newMonsoonTrough || activeLayers.newMonsoonLow || activeLayers.newItcz ||
        activeLayers.newWesterlyJet || activeLayers.newWesterlyTrough || activeLayers.newWesterlyRidge || activeLayers.newCutoffLow ||
        activeLayers.newUpperColdLow || activeLayers.newTropicalHigh || activeLayers.newContinentalHigh || activeLayers.newLowLatEasterlies ||
        activeLayers.newMidLatWesterlies || activeLayers.newCrossEquatorialFlow || activeLayers.newMonsoonFlow || activeLayers.newMeanFlow ||
        activeLayers.newBetaEffect || activeLayers.newDryAir || activeLayers.newWindShear || activeLayers.newSstDetailed || activeLayers.newOhcDetailed
      ));
      const hasCanvasContent = !!(
        activeLayers.shear || activeLayers.strongDryAir || activeLayers.strongWindShear ||
        hasSynopticContent ||
        activeLayers.subHigh || activeLayers.westerlies || (activeLayers as any).grid
      );

      // None of these layers contains a true frame-by-frame particle animation. The old 30 fps
      // loop therefore redrew large cached canvases even when the visual data itself had not
      // changed. Cap dynamic weather to 20 fps and static annotations to 15 fps; when no canvas
      // layer is visible, keep the RAF callback almost free. Leaflet markers/tracks remain
      // independent and responsive at the browser's normal frame rate.
      // The weather canvas sits outside Leaflet's vector panes, so during an active drag/pinch it
      // must sample the current map transform at display cadence to remain registered with them.
      const mobileCadence = touchFirst ? 1.24 : 1;
      const targetFrameMs = mapGestureActiveRef.current
        ? (renderBudgetRef.current.degraded ? 72 : touchFirst ? 48 : 34)
        : (hasCanvasContent ? 190 * (renderBudgetRef.current.degraded ? 1.7 : 1) * mobileCadence : 280);
      if (timestamp - lastCanvasFrameRef.current < targetFrameMs) {
        // On desktop and mobile a fixed weather-layer refresh does not need an idle 60-Hz
        // requestAnimationFrame polling loop. Keep at most 48-ms latency to catch a new
        // map gesture without sacrificing sampled-grid quality or physics step cadence.
        const delay = mapGestureActiveRef.current ? 12 : Math.min(48, Math.max(12, targetFrameMs - (timestamp - lastCanvasFrameRef.current)));
        canvasIdleTimerRef.current = setTimeout(() => {
          canvasIdleTimerRef.current = null;
          animationFrameRef.current = requestAnimationFrame(drawLoop);
        }, delay);
        return;
      }
      lastCanvasFrameRef.current = timestamp;

      const activeZoom = mapZoomRef.current;

    // Sync canvas dimensions with sub-pixel safety
    const size = map.getSize();
    const roundedX = Math.round(size.x);
    const roundedY = Math.round(size.y);
    if (canvas.width !== roundedX || canvas.height !== roundedY) {
      canvas.width = roundedX;
      canvas.height = roundedY;
    }

      if (!hasCanvasContent) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // No sampled weather layer is visible. Do not keep waking the main thread at display
        // refresh rate just to discover that there is nothing to draw; poll the layer refs at a
        // low cadence and return to rAF immediately when content becomes active.
        canvasIdleTimerRef.current = setTimeout(() => {
          canvasIdleTimerRef.current = null;
          animationFrameRef.current = requestAnimationFrame(drawLoop);
        }, 220);
        return;
      }

      // A. Clear background with fade trail (to create movement streaks).
      // SST/OHC are image overlays; removed realtime/accumulated-rain layers do not participate here.
      const hasLegacyRaster = !!(activeLayers.shear || activeLayers.strongDryAir || activeLayers.strongWindShear);
      const hasRaster = hasLegacyRaster || hasSynopticContent;
      if (hasRaster) {
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // New synoptic layers have their own bounded, viewport-keyed offscreen cache.  Do not run
        // the legacy per-pixel raster sampler when the user is displaying only the new system;
        // this keeps map interaction at least as light as the 3.7.7 baseline.
        if (hasLegacyRaster) drawRasterData(ctx, map);
      } else {
        // Use destination-out to fade existing drawings on the canvas while keeping the background transparent!
        // This ensures base maps (such as satellite/terrain) and Leaflet overlays (coastline/tracks/wind circles) are fully visible underneath.
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0, 0, 0, 0.22)"; // fade rate
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = "source-over";
      }

      // B. Draw Subtropical High / Westerlies annotations if toggled
      if (activeLayers.subHigh) drawSubtropicalRidge(ctx, map);
      if (activeLayers.westerlies) drawWesterliesRidge(ctx, map);
      if (hasSynopticContent) drawSynopticEnvironmentLayers(ctx, map);



      // Draw Coordinates grid directly on canvas if enabled
      if ((activeLayers as any).grid) drawGridGrid(ctx, map);

      animationFrameRef.current = requestAnimationFrame(drawLoop);
    };

    animationFrameRef.current = requestAnimationFrame(drawLoop);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (canvasIdleTimerRef.current) { clearTimeout(canvasIdleTimerRef.current); canvasIdleTimerRef.current = null; }
    };
  }, [mapInitialized]);



  // --- 8. Render remaining sampled layers (shear / dry-air diagnostics only) ---

  const drawRasterData = (ctx: CanvasRenderingContext2D, map: L.Map) => {
    const size = map.getSize();
    const activeLayers = layersRef.current;
    const activeConfig = configRef.current;
    const legacyActiveConfig = activeConfig.newEnvironmentPhysicsEnabled ? { ...activeConfig, newEnvironmentPhysicsEnabled: false } : activeConfig;

    const nw = map.containerPointToLatLng([0, 0]);
    const se = map.containerPointToLatLng([size.x, size.y]);

    // Build a viewport/config cache key. Runtime cloud imagery is intentionally absent: the only
    // satellite-cloud renderer lives in the on-demand WMC product center.
    const layerFlags = `${activeLayers.shear ? 1 : 0}_${activeLayers.strongDryAir ? 1 : 0}_${activeLayers.strongWindShear ? 1 : 0}_${activeLayers.rasterResolution || 8}`;
    const cacheKey = `${size.x}_${size.y}_${nw.lat.toFixed(3)}_${nw.lng.toFixed(3)}_${se.lat.toFixed(3)}_${se.lng.toFixed(3)}_${layerFlags}_${activeConfig?.coastlineSource || 'default'}`;

    if (!rasterCanvasRef.current) {
      rasterCanvasRef.current = document.createElement("canvas");
    }
    const rasterCanvas = rasterCanvasRef.current;

    if (rasterCanvas.width !== Math.round(size.x) || rasterCanvas.height !== Math.round(size.y)) {
      rasterCanvas.width = Math.round(size.x);
      rasterCanvas.height = Math.round(size.y);
      rasterCacheKeyRef.current = ""; // Invalidate cache on resize
    }

    if (rasterCacheKeyRef.current !== cacheKey) {
      const offCtx = rasterCanvas.getContext("2d");
      if (offCtx) {
        offCtx.clearRect(0, 0, rasterCanvas.width, rasterCanvas.height);
        const requestedSpacing = activeLayers.rasterResolution || 8;
        const interactionScale = mapGestureActiveRef.current
          ? (touchFirst ? 1.65 : 1.3)
          : (renderBudgetRef.current.degraded ? 1.35 : touchFirst ? 1.12 : 1);
        const gridSpacing = Math.max(touchFirst ? 10 : 8, Math.round(requestedSpacing * interactionScale));
        offCtx.globalAlpha = 0.5;

        const latSpan = se.lat - nw.lat;
        const lonSpan = se.lng - nw.lng;

        for (let x = 0; x < size.x; x += gridSpacing) {
          const lon = nw.lng + ((x + gridSpacing / 2) / size.x) * lonSpan;
          if (lon < 95 || lon > 180) continue;

          for (let y = 0; y < size.y; y += gridSpacing) {
            const lat = nw.lat + ((y + gridSpacing / 2) / size.y) * latSpan;
            if (lat < 0 || lat > 55) continue;

            if (activeLayers.strongDryAir) {
                const rhVal = getRH700(lat, lon, legacyActiveConfig);
                if (rhVal < 50) {
                  if (rhVal < 30) offCtx.fillStyle = "rgba(217, 119, 6, 0.65)";
                  else if (rhVal < 40) offCtx.fillStyle = "rgba(234, 179, 8, 0.55)";
                  else offCtx.fillStyle = "rgba(250, 204, 21, 0.38)";
                  offCtx.fillRect(x, y, gridSpacing, gridSpacing);
                  if (gridSpacing >= 12 && rhVal < 40) {
                    offCtx.fillStyle = "rgba(255, 255, 255, 0.75)";
                    offCtx.font = "8px sans-serif";
                    offCtx.fillText(`${Math.round(rhVal)}%`, x + 2, y + 8);
                  }
                }
              } else if (activeLayers.strongWindShear) {
                const shearVal = getShear(lat, lon, legacyActiveConfig);
                if (shearVal > 18) {
                  if (shearVal >= 32) offCtx.fillStyle = "rgba(225, 29, 72, 0.7)";
                  else if (shearVal >= 25) offCtx.fillStyle = "rgba(239, 68, 68, 0.55)";
                  else offCtx.fillStyle = "rgba(249, 115, 22, 0.42)";
                  offCtx.fillRect(x, y, gridSpacing, gridSpacing);
                  if (gridSpacing >= 12) {
                    offCtx.fillStyle = "rgba(255, 255, 255, 0.8)";
                    offCtx.font = "8px sans-serif";
                    offCtx.fillText(`${Math.round(shearVal)}kt`, x + 2, y + 8);
                  }
                }
              } else if (activeLayers.shear) {
                const shearVal = getShear(lat, lon, legacyActiveConfig);
                if (shearVal < 10) offCtx.fillStyle = "rgba(43, 156, 91, 0.4)";
                else if (shearVal < 20) offCtx.fillStyle = "rgba(246, 211, 74, 0.4)";
                else if (shearVal < 30) offCtx.fillStyle = "rgba(246, 120, 74, 0.5)";
                else offCtx.fillStyle = "rgba(200, 40, 40, 0.6)";
                offCtx.fillRect(x, y, gridSpacing, gridSpacing);
                if (gridSpacing >= 10) {
                   offCtx.fillStyle = "rgba(255, 255, 255, 0.5)";
                   offCtx.font = "8px sans-serif";
                   offCtx.fillText(Math.round(shearVal).toString(), x + 2, y + 8);
                }
              }
            }
          }
        offCtx.globalAlpha = 1.0;
        rasterCacheKeyRef.current = cacheKey;
      }
    }

    ctx.drawImage(rasterCanvas, 0, 0);
  };


  const drawSynopticEnvironmentLayers = (ctx: CanvasRenderingContext2D, map: L.Map) => {
    const activeLayers = layersRef.current;
    const activeConfig = configRef.current;
    const size = map.getSize();
    if (!activeConfig.newEnvironmentPanelsEnabled || size.x <= 0 || size.y <= 0) return;

    const featureLayers: Array<[keyof ActiveLayers, SynopticFeatureKind, string]> = [
      ["newSubtropicalHigh", "subtropicalHigh", "rgba(82,171,255,0.22)"],
      ["newMonsoonTrough", "monsoonTrough", "rgba(62,220,180,0.23)"],
      ["newMonsoonLow", "monsoonLow", "rgba(53,211,153,0.24)"],
      ["newItcz", "itcz", "rgba(45,212,191,0.21)"],
      ["newWesterlyJet", "westerlyJet", "rgba(255,151,73,0.24)"],
      ["newWesterlyTrough", "westerlyTrough", "rgba(168,85,247,0.24)"],
      ["newWesterlyRidge", "westerlyRidge", "rgba(250,204,21,0.20)"],
      ["newCutoffLow", "cutoffLow", "rgba(139,92,246,0.28)"],
      ["newUpperColdLow", "upperColdLow", "rgba(99,102,241,0.25)"],
      ["newTropicalHigh", "tropicalHigh", "rgba(56,189,248,0.18)"],
      ["newContinentalHigh", "continentalHigh", "rgba(226,232,240,0.20)"],
      ["newLowLatEasterlies", "lowLatEasterlies", "rgba(34,211,238,0.16)"],
      ["newMidLatWesterlies", "midLatWesterlies", "rgba(251,146,60,0.17)"],
      ["newCrossEquatorialFlow", "crossEquatorialFlow", "rgba(16,185,129,0.21)"],
      ["newMonsoonFlow", "monsoonFlow", "rgba(20,184,166,0.20)"],
      ["newDryAir", "dryAir", "rgba(234,179,8,0.23)"],
      ["newWindShear", "windShear", "rgba(244,63,94,0.21)"]
    ];
    const enabledFeatures = featureLayers.filter(([key]) => !!activeLayers[key]);
    const hasVector = !!(activeLayers.newMeanFlow || activeLayers.newBetaEffect);
    const hasOcean = !!(activeLayers.newSstDetailed || activeLayers.newOhcDetailed);
    if (!enabledFeatures.length && !hasVector && !hasOcean) return;

    const nw = map.containerPointToLatLng([0, 0]);
    const se = map.containerPointToLatLng([size.x, size.y]);
    const timeKey = Math.floor(currentHourRef.current * 2) / 2; // 30 min environmental render cadence
    const flags = featureLayers.map(([k]) => activeLayers[k] ? 1 : 0).join("") +
      `${activeLayers.newMeanFlow ? 1 : 0}${activeLayers.newBetaEffect ? 1 : 0}${activeLayers.newSstDetailed ? 1 : 0}${activeLayers.newOhcDetailed ? 1 : 0}`;
    const cfgKey = [activeConfig.newAtmosPreset, activeConfig.newAtmosTimeOffsetHours, activeConfig.newAtmosTimeFlowEnabled, activeConfig.newAtmosFrozenBaseHour,
      activeConfig.newAtmosAnomalyScale, activeConfig.newAtmosShearScale, activeConfig.newAtmosHumidityBias,
      activeConfig.newOceanPreset, activeConfig.newOceanTimeOffsetHours, activeConfig.newOceanTimeFlowEnabled, activeConfig.newOceanFrozenBaseHour,
      activeConfig.newOceanSstBias, activeConfig.newOceanOhcScale, activeConfig.newOceanMesoscaleScale].join("|");
    const cacheKey = `${size.x}_${size.y}_${nw.lat.toFixed(2)}_${nw.lng.toFixed(2)}_${se.lat.toFixed(2)}_${se.lng.toFixed(2)}_${timeKey}_${flags}_${cfgKey}`;

    if (!synopticCanvasRef.current) synopticCanvasRef.current = document.createElement("canvas");
    const off = synopticCanvasRef.current;
    const w = Math.round(size.x), h = Math.round(size.y);
    if (off.width !== w || off.height !== h) { off.width = w; off.height = h; synopticCacheKeyRef.current = ""; }

    if (synopticCacheKeyRef.current !== cacheKey) {
      const octx = off.getContext("2d");
      if (!octx) return;
      octx.clearRect(0, 0, w, h);
      const spacing = Math.max(touchFirst ? 46 : 36, Math.min(touchFirst ? 88 : 76, (activeLayers.rasterResolution || 6) * 7));
      const lonSpan = se.lng - nw.lng;
      const latSpan = se.lat - nw.lat;
      const labelMode = spacing >= 56;

      const sstColor = (v: number) => {
        const t = Math.max(0, Math.min(1, (v - 20) / 12));
        const r = Math.round(40 + 215 * t); const g = Math.round(120 + 90 * (1 - Math.abs(t - 0.55) * 1.8)); const b = Math.round(230 - 185 * t);
        return `rgba(${r},${Math.max(50,Math.min(220,g))},${b},0.28)`;
      };
      const ohcColor = (v: number) => {
        const t = Math.max(0, Math.min(1, v / 180));
        return `rgba(${Math.round(45 + 205*t)},${Math.round(115 + 55*(1-t))},${Math.round(220 - 150*t)},0.27)`;
      };

      for (let x = 0; x < w; x += spacing) {
        const lon = nw.lng + ((x + spacing / 2) / Math.max(1, w)) * lonSpan;
        if (lon < 90 || lon > 185) continue;
        for (let y = 0; y < h; y += spacing) {
          const lat = nw.lat + ((y + spacing / 2) / Math.max(1, h)) * latSpan;
          if (lat < -8 || lat > 62) continue;
          const state = getSynopticEnvironmentState(lat, lon, activeConfig, currentHourRef.current);
          if (activeLayers.newSstDetailed) { octx.fillStyle = sstColor(state.sst); octx.fillRect(x, y, spacing + 1, spacing + 1); }
          if (activeLayers.newOhcDetailed) { octx.fillStyle = ohcColor(state.ohc); octx.fillRect(x, y, spacing + 1, spacing + 1); }
          for (const [, scoreKey, color] of enabledFeatures) {
            const score = state.scores[scoreKey];
            if (score < 0.16) continue;
            octx.globalAlpha = Math.max(0.16, Math.min(0.92, score));
            octx.fillStyle = color;
            octx.fillRect(x, y, spacing + 1, spacing + 1);
          }
          octx.globalAlpha = 1;

          if (hasVector) {
            let u = 0, v = 0;
            if (activeLayers.newMeanFlow) { u += state.meanU; v += state.meanV; }
            if (activeLayers.newBetaEffect) { const b = state.scores.betaEffect; u += -0.9 * b; v += 1.15 * b; }
            const mag = Math.hypot(u, v);
            if (mag > 0.25) {
              const len = Math.min(spacing * 0.38, 8 + mag * 0.62);
              const ux = u / mag, vy = -v / mag;
              const cx = x + spacing / 2, cy = y + spacing / 2;
              const ex = cx + ux * len, ey = cy + vy * len;
              octx.strokeStyle = activeLayers.newMeanFlow ? "rgba(240,248,255,0.72)" : "rgba(125,211,252,0.72)";
              octx.fillStyle = octx.strokeStyle;
              octx.lineWidth = 1.15;
              octx.beginPath(); octx.moveTo(cx - ux * len * 0.45, cy - vy * len * 0.45); octx.lineTo(ex, ey); octx.stroke();
              const ang = Math.atan2(ey - cy, ex - cx);
              octx.beginPath(); octx.moveTo(ex, ey); octx.lineTo(ex - 5*Math.cos(ang-0.55), ey - 5*Math.sin(ang-0.55)); octx.lineTo(ex - 5*Math.cos(ang+0.55), ey - 5*Math.sin(ang+0.55)); octx.closePath(); octx.fill();
            }
          }
          if (labelMode && activeLayers.newWindShear && state.shear > 18) {
            octx.fillStyle = "rgba(255,255,255,0.72)"; octx.font = "8px ui-monospace,monospace"; octx.fillText(`${Math.round(state.shear)}kt`, x + 2, y + 9);
          }
        }
      }
      synopticCacheKeyRef.current = cacheKey;
    }
    ctx.drawImage(off, 0, 0);
  };

  const getMaxWindColor = (wind: number): string => {
    if (wind < 12) return "transparent";
    if (wind < 17.2) return "rgba(16, 185, 129, 0.8)";
    if (wind < 24.4) return "rgba(56, 189, 248, 0.8)";
    if (wind < 32.7) return "rgba(234, 179, 8, 0.85)";
    if (wind < 41.5) return "rgba(249, 115, 22, 0.9)";
    if (wind < 51.0) return "rgba(239, 68, 68, 0.9)";
    return "rgba(168, 85, 247, 0.95)";
  };

  const getStationGradientColor = (windSpeed: number): string => {
    if (windSpeed < 10) return "#10B981"; // green
    if (windSpeed < 17.2) return "#3B82F6"; // blue
    if (windSpeed < 24.5) return "#EAB308"; // yellow
    if (windSpeed < 32.7) return "#F97316"; // orange
    if (windSpeed < 41.5) return "#EF4444"; // red
    return "#A855F7"; // purple (super typhoon)
  };

  const getAccumulatedPrecipAt = (lat: number, lon: number): number => {
    const mainTy = typhoons[0];
    if (!mainTy || !mainTy.history?.length) return 0;
    const landMetrics = getLandMetrics(lat, lon, configRef.current?.coastlineSource, true);
    const history = mainTy.history;
    const stride = Math.max(1, Math.ceil(history.length / 96));
    let accumulatedPrecip = 0;
    for (let i = 0; i < history.length; i += stride) {
      const h = history[i];
      const dLatKm = (lat - h.lat) * 111.12;
      const dLonKm = (lon - h.lon) * 111.12 * Math.cos((h.lat * Math.PI) / 180);
      if (Math.hypot(dLatKm, dLonKm) > 780) continue;
      accumulatedPrecip += computeTyphoonPrecipitation(h, lat, lon, {
        config: configRef.current,
        isLand: landMetrics.isLand,
        elevation: landMetrics.elevation
      }).rate * stride;
    }
    return accumulatedPrecip;
  };

  const getMaxWindAccumulatedAt = (lat: number, lon: number): number => {
    const mainTy = typhoons[0];
    if (!mainTy || !mainTy.history) return 0;
    let maxWind = 0;
    mainTy.history.forEach((h) => {
      const dLatKm = (lat - h.lat) * 111.12;
      const dLonKm = (lon - h.lon) * 111.12 * Math.cos((h.lat * Math.PI) / 180);
      const dist = Math.sqrt(dLatKm * dLatKm + dLonKm * dLonKm);
      if (dist > 800) return;

      const rmw = h.rmw || 35;
      let wind = 0;
      if (dist <= rmw) {
        wind = h.vmax * (dist / rmw);
      } else {
        wind = h.vmax * Math.exp(-(dist - rmw) / (h.vmax * 3.5 + 80));
      }
      if (wind > maxWind) maxWind = wind;
    });
    return maxWind;
  };

  // --- 9. Drawing Subtropical Ridge 5880 gpm Contour ---
  const drawSubtropicalRidge = (ctx: CanvasRenderingContext2D, map: L.Map) => {
    const activeConfig = configRef.current;
    // We draw an analytical elliptical glowing ring around the Subtropical High parameters
    if (!activeConfig.subtropicalHighEnabled) return;

    // Convert analytical ridge anchors to screen.  N-S and E-W controls are independent:
    // the west-ridge longitude is still an anchor, while the span multipliers control the
    // visual/physical envelope around that anchor line.
    const ridgeLat = activeConfig.subtropicalHighLat;
    const ridgeLon = activeConfig.subtropicalHighLon;
    const westLon = activeConfig.subtropicalHighWestExtent;
    const nsSize = activeConfig.subtropicalHighNSSize ?? 1.0;
    const ewSize = activeConfig.subtropicalHighEWSize ?? 1.0;
    const centerPt = map.latLngToContainerPoint([ridgeLat, ridgeLon]);
    const westPt = map.latLngToContainerPoint([ridgeLat, westLon]);
    const ridgeMidLon = (ridgeLon + westLon) / 2;
    const ridgeMidPt = map.latLngToContainerPoint([ridgeLat, ridgeMidLon]);

    // Draw a pill-shaped 5880-gpm envelope.  Using geographic offsets before projection keeps
    // the overlay consistent with the steering-field geometry when the map is zoomed or panned.
    ctx.strokeStyle = "rgba(30, 156, 255, 0.75)";
    ctx.fillStyle = "rgba(30, 156, 255, 0.06)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);

    const northPt = map.latLngToContainerPoint([ridgeLat + 3.5 * nsSize, ridgeMidLon]);
    const radiusY = Math.max(4, Math.abs(northPt.y - ridgeMidPt.y));
    const halfAnchorPx = Math.abs(centerPt.x - westPt.x) / 2;
    const flankPt = map.latLngToContainerPoint([ridgeLat, ridgeMidLon + 4.5 * ewSize]);
    const flankPx = Math.abs(flankPt.x - ridgeMidPt.x);
    const radiusX = Math.max(8, halfAnchorPx * ewSize + flankPx);

    ctx.beginPath();
    ctx.ellipse(
      ridgeMidPt.x,
      ridgeMidPt.y,
      radiusX,
      radiusY,
      0,
      0,
      2 * Math.PI
    );
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]); // reset

    // Label
    ctx.fillStyle = "#1E9CFF";
    ctx.font = "bold 10px font-mono";
    ctx.fillText("5880 gpm (副热带高压脊)", ridgeMidPt.x - radiusX + 8, ridgeMidPt.y - radiusY - 8);
  };

  // --- 10. Drawing Westerlies Jet arrow ribbon ---
  const drawWesterliesRidge = (ctx: CanvasRenderingContext2D, map: L.Map) => {
    const activeConfig = configRef.current;
    if (!activeConfig.westerliesEnabled) return;

    // Draw flowing broad translucent arrow vectors at westerliesLat across the map
    const wLat = activeConfig.westerliesLat;
    const pt1 = map.latLngToContainerPoint([wLat, 95]);
    const pt2 = map.latLngToContainerPoint([wLat, 180]);

    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    ctx.fillRect(0, pt1.y - 30, canvasRef.current?.width || 1200, 60);

    ctx.strokeStyle = "rgba(255, 140, 58, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 8]);
    ctx.beginPath();
    ctx.moveTo(0, pt1.y);
    ctx.lineTo(canvasRef.current?.width || 1200, pt1.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw 3 wave arrowheads across the width
    ctx.fillStyle = "rgba(255, 140, 58, 0.5)";
    ctx.font = "italic 9px font-sans";
    const segmentWidth = (canvasRef.current?.width || 1000) / 4;
    for (let i = 1; i <= 3; i++) {
      const x = i * segmentWidth;
      ctx.beginPath();
      ctx.moveTo(x, pt1.y);
      ctx.lineTo(x - 12, pt1.y - 6);
      ctx.lineTo(x - 12, pt1.y + 6);
      ctx.fill();

      ctx.fillText("西风急流轴 (Westerlies Jet)", x - 80, pt1.y - 12);
    }
  };

  // --- 12. Draw Map Lat/Lon Coordinates Grid overlay ---
  const drawGridGrid = (ctx: CanvasRenderingContext2D, map: L.Map) => {
    // Draws lines every 10 degrees
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 0.8;
    ctx.font = "9px font-mono";
    ctx.fillStyle = "rgba(155, 171, 189, 0.45)";

    const step = 10;
    // Latitudes: 0 to 50
    for (let lat = 0; lat <= 50; lat += step) {
      const pLeft = map.latLngToContainerPoint([lat, 95]);
      ctx.beginPath();
      ctx.moveTo(0, pLeft.y);
      ctx.lineTo(canvasRef.current?.width || 1200, pLeft.y);
      ctx.stroke();
      ctx.fillText(`${lat}°N`, 10, pLeft.y - 4);
    }

    // Longitudes: 100 to 180
    for (let lon = 100; lon <= 180; lon += step) {
      const pBottom = map.latLngToContainerPoint([0, lon]);
      ctx.beginPath();
      ctx.moveTo(pBottom.x, 0);
      ctx.lineTo(pBottom.x, canvasRef.current?.height || 800);
      ctx.stroke();
      ctx.fillText(`${lon}°E`, pBottom.x + 4, (canvasRef.current?.height || 750) - 10);
    }
  };

  let cursorWind = 0;
  let cursorPressure = 1013;
  let cursorPrecipAccum = 0;
  let cursorMaxWindAccum = 0;
  
  if (layers.cursor && cursorCoords) {
    if (typhoons[0]?.active) {
      const mainTy = typhoons[0];
      const R = 6371;
      const dLat = (cursorCoords.lat - mainTy.lat) * (Math.PI / 180);
      const dLon = (cursorCoords.lon - mainTy.lon) * (Math.PI / 180);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(mainTy.lat * (Math.PI / 180)) * Math.cos(cursorCoords.lat * (Math.PI / 180)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const dist = R * c;
      
      if (dist > 0) {
        if (mainTy.vmax > 48.0 && dist < mainTy.rmw) {
          cursorWind = mainTy.vmax * (0.15 + 0.85 * (dist / mainTy.rmw));
        } else {
          cursorWind = Math.max(0, Math.min(mainTy.vmax, (mainTy.vmax * mainTy.rmw) / dist));
        }
      } else {
        cursorWind = mainTy.vmax > 48.0 ? mainTy.vmax * 0.15 : mainTy.vmax;
      }
      cursorPressure = Math.min(1013, mainTy.pmin + (1013 - mainTy.pmin) * Math.min(1, dist / 800));
    }
    cursorPrecipAccum = getAccumulatedPrecipAt(cursorCoords.lat, cursorCoords.lon);
    cursorMaxWindAccum = getMaxWindAccumulatedAt(cursorCoords.lat, cursorCoords.lon);
  }

  const getCursorPrimaryText = () => {
    return `风速: ${cursorWind.toFixed(1)} m/s`;
  };

  useEffect(() => {
    const handleResize = () => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    };
    window.addEventListener("resize", handleResize);
    // Also invalidate after short delay to ensure DOM has settled
    const timer = setTimeout(handleResize, 100);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timer);
    };
  }, [mapInitialized]);

  return (
    <div className="relative w-full h-full select-none" id={viewportId}>
      {/* 1. Fullscreen Leaflet container */}
      <div
        ref={mapContainerRef}
        className={`absolute inset-0 z-0 ${layers.baseMap === "none" && config.agencyStyle !== "JMA" ? "[&_.leaflet-container]:!bg-white" : ""}`}
        style={{ backgroundColor: getLocalVectorBasemapStyle(config.agencyStyle === "JMA" ? "jma" : layers.baseMap)?.ocean ?? (layers.baseMap === "none" ? "#ffffff" : "#07111F") }}
      />

      {/* 2. Remaining lightweight sampled weather canvas. */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-[1] pointer-events-none"
      />


      {/* JMA / Digital-Typhoon Best Track inspired live information typography. */}
      {(config.mechanismStyle || config.agencyStyle) === "JMA" && typhoons[0]?.active && (() => {
        const main = typhoons[0];
        const dt = new Date((startDate?.getTime() ?? Date.UTC(2026, 6, 21, 0, 0, 0)) + main.simHour * 3600000);
        const mechanism = main.rapidIntensifying
          ? "RI / 中心对流爆发"
          : main.isEyeClogged || (main.eyeObstruction || 0) > 0.55
          ? "风眼堵塞 / 中心云塞"
          : main.isStructureDamaged || main.isCoreDisrupted
          ? "结构破损 / 破碎眼墙"
          : main.ewrcState && main.ewrcState !== "none"
          ? "眼墙置换过程"
          : "Best Track Style";
        return (
          <>
            <div className="absolute right-4 bottom-5 z-[900] pointer-events-none text-right text-white font-mono drop-shadow-[0_2px_2px_rgba(0,0,0,.85)] leading-[1.12]">
              <div className="text-[18px] sm:text-[26px]">Typhoon {getTyphoonDisplayName(main, main.simHour, startDate)} ({Math.round(main.pmin)} hPa)</div>
              <div className="text-[17px] sm:text-[25px]">{dt.getUTCFullYear()}-{String(dt.getUTCMonth() + 1).padStart(2, "0")}-{String(dt.getUTCDate()).padStart(2, "0")} {String(dt.getUTCHours()).padStart(2, "0")}:00 UTC</div>
              <div className="mt-1 text-[11px] sm:text-[13px] text-white/80">{mechanism}</div>
            </div>
          </>
        );
      })()}

      {/* Cursor Layer */}
      {layers.cursor && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1000] pointer-events-none">
          {/* Crosshair */}
          <div className="relative flex items-center justify-center">
            <div className="absolute w-6 h-[1px] bg-white mix-blend-difference"></div>
            <div className="absolute h-6 w-[1px] bg-white mix-blend-difference"></div>
            
            {/* Data Capsule */}
            <div className="absolute bottom-6 pointer-events-auto cursor-pointer" onClick={() => setCursorExpanded(!cursorExpanded)}>
              <div className="px-3 py-1 bg-black/80 backdrop-blur-sm rounded-full border border-slate-600 shadow-xl whitespace-nowrap flex items-center gap-2 hover:bg-black/90 transition-colors">
                <span className="text-[10px] font-bold text-white">
                  {getCursorPrimaryText()}
                </span>
                {!cursorExpanded && <span className="text-[8px] text-slate-500">点击展开</span>}
              </div>
              
              {/* Expanded Data Panel */}
              {cursorExpanded && (
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-[#08121f]/95 border border-slate-700/60 p-2.5 rounded-lg shadow-2xl backdrop-blur-md text-[11px] font-mono text-slate-300 min-w-[150px] flex flex-col gap-1">
                  <div className="flex justify-between border-b border-slate-700/60 pb-1 mb-1 font-sans text-xs font-bold text-white">
                    光标位置参数
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">经纬度:</span>
                    <span className="text-white">{cursorCoords?.lat.toFixed(2)}°N, {cursorCoords?.lon.toFixed(2)}°E</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">实时气压:</span>
                    <span className="text-[#1E9CFF] font-bold">{cursorPressure.toFixed(1)} hPa</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">实时风级:</span>
                    <span className="text-orange-400">{getWindForceCategory(cursorWind)} 级</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeHistoryStation && (
        <StationHistory
          station={activeHistoryStation}
          typhoons={typhoons}
          startDate={startDate}
          temporaryOcean={!!activeHistoryStation.temporary && !getLandMetrics(activeHistoryStation.lat, activeHistoryStation.lon, config.coastlineSource).isLand}
          onTemporaryStationUpdate={updateTemporaryStationName}
          onSnapTemporaryStationToNearestLand={snapTemporaryStationNameToNearestLand}
          onClose={() => {
            const wasTemporary = !!activeHistoryStation.temporary;
            setActiveHistoryStation(null);
            if (wasTemporary) setTemporaryStationPoint(null);
          }}
        />
      )}
    </div>
  );
}
