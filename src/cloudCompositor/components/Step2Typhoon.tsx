import React, { useEffect, useRef, useState } from 'react';
import { AppState } from '../types';
import { MapContainer, useMap } from '../lib/LeafletReactLite';
import { SmartWMSTileLayer } from './SmartWMSTileLayer';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ChevronRight, ChevronLeft, Calendar, Moon, Sun, Loader2, ChevronUp, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { AdaptiveCrosshair } from './AdaptiveCrosshair';

interface Props {
  state: AppState;
  updateState: (s: Partial<AppState>) => void;
  onNext: () => void;
  onPrev: () => void;
}

function PinchCenterLock() {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    let isPinching = false;
    let lockCenter: L.LatLng | null = null;

    const container = map.getContainer();

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        isPinching = true;
        lockCenter = map.getCenter();
        map.dragging.disable();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isPinching && lockCenter) {
        map.setView(lockCenter, map.getZoom(), { animate: false });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (isPinching && e.touches.length < 2) {
        isPinching = false;
        if (lockCenter) {
          map.setView(lockCenter, map.getZoom(), { animate: false });
        }
        lockCenter = null;
        map.dragging.enable();
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [map]);

  return null;
}

function MapBoxEvents({ aspectW, aspectH, onChange }: { aspectW: number; aspectH: number; onChange: (lat: number, lon: number, deltaLat: number, deltaLon: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const handleMove = () => {
      try {
        const center = map.getCenter();
        if (!center || isNaN(center.lat) || isNaN(center.lng)) return;

        const box = document.getElementById('crop-box');
        if (box) {
          const rect = box.getBoundingClientRect();
          const mapContainer = map.getContainer();
          if (!mapContainer) return;
          const mapRect = mapContainer.getBoundingClientRect();

          if (rect.width === 0 || rect.height === 0 || mapRect.width === 0 || mapRect.height === 0) return;

          // Calculate crop box corners relative to map container
          const left = rect.left - mapRect.left;
          const top = rect.top - mapRect.top;
          const right = left + rect.width;
          const bottom = top + rect.height;

          const nw = map.containerPointToLatLng(L.point(left, top));
          const se = map.containerPointToLatLng(L.point(right, bottom));

          if (!nw || !se || isNaN(nw.lat) || isNaN(se.lat) || isNaN(nw.lng) || isNaN(se.lng)) return;

          const deltaLat = Math.abs(nw.lat - se.lat);
          // Calculate deltaLon using the exact mathematical aspect ratio to avoid any projection/pixel distortion
          const deltaLon = deltaLat * (aspectW / aspectH);

          if (!isNaN(deltaLat) && !isNaN(deltaLon) && deltaLat > 0 && deltaLon > 0) {
            onChange(center.lat, center.lng, deltaLat, deltaLon);
          }
        }
      } catch (err) {
        console.warn('Error calculating crop box geographic bounds:', err);
      }
    };

    map.on('move', handleMove);
    map.on('zoom', handleMove);
    window.addEventListener('resize', handleMove);

    // Initial calculation after map layout stabilizes
    const timer = setTimeout(handleMove, 200);

    return () => {
      clearTimeout(timer);
      map.off('move', handleMove);
      map.off('zoom', handleMove);
      window.removeEventListener('resize', handleMove);
    };
  }, [map, onChange, aspectW, aspectH]);

  return null;
}

// Module-level cache to prevent multi-megabyte XML requests on every component mount or layer toggle
let cachedCapabilitiesText: string | null = null;

export default function Step2Typhoon({ state, updateState, onNext, onPrev }: Props) {
  const mapRef = useRef<L.Map>(null);
  const [isTopCollapsed, setIsTopCollapsed] = useState(false);
  const [isBottomCollapsed, setIsBottomCollapsed] = useState(false);

  // Configure Leaflet's native touchZoom to 'center' for smooth 60fps pinch zooming
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.options.touchZoom = 'center';
  }, []);

  const handleBoxChange = (lat: number, lon: number, deltaLat: number, deltaLon: number) => {
    updateState({ typhoonLat: lat, typhoonLon: lon, deltaLat, deltaLon });
  };

  // Determine intended Layer ID
  const dayNight = state.isNight ? 'Night' : 'Day';
  const satelliteStr = state.satellite === 'NOAA20' ? 'NOAA20' : 'SNPP';
  const intendedLayerId = `VIIRS_CrIS_${satelliteStr}_BT_Band33_Fusion_${dayNight}`;

  // Use optimistic state: load map and layer instantly without blocking
  const [isValidating, setIsValidating] = useState(false);
  const [validLayerId, setValidLayerId] = useState<string | null>(intendedLayerId);

  // Update optimistic layer ID immediately when options change
  useEffect(() => {
    setValidLayerId(intendedLayerId);
    updateState({ cloudLayerId: intendedLayerId });
  }, [intendedLayerId]);

  useEffect(() => {
    let isMounted = true;
    const validateLayer = async () => {
      // If we already have the capabilities cached, use them instantly
      if (cachedCapabilitiesText) {
        if (cachedCapabilitiesText.includes(`<Name>${intendedLayerId}</Name>`)) {
          if (isMounted) { setValidLayerId(intendedLayerId); updateState({ cloudLayerId: intendedLayerId }); }
        } else {
          const regex = new RegExp(`<Name>([^<]*Band33_Fusion_${dayNight}[^<]*)</Name>`, 'i');
          const match = cachedCapabilitiesText.match(regex);
          if (match && match[1]) {
            if (isMounted) { setValidLayerId(match[1]); updateState({ cloudLayerId: match[1] }); }
          }
        }
        return;
      }

      // Otherwise, fetch in the background with a timeout so it never blocks the UI indefinitely
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4-second timeout limit

      try {
        const res = await fetch(
          "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1",
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error("GetCapabilities request failed");
        const text = await res.text();
        cachedCapabilitiesText = text;

        if (text.includes(`<Name>${intendedLayerId}</Name>`)) {
          if (isMounted) { setValidLayerId(intendedLayerId); updateState({ cloudLayerId: intendedLayerId }); }
        } else {
          const regex = new RegExp(`<Name>([^<]*Band33_Fusion_${dayNight}[^<]*)</Name>`, 'i');
          const match = text.match(regex);
          if (match && match[1]) {
            if (isMounted) { setValidLayerId(match[1]); updateState({ cloudLayerId: match[1] }); }
          }
        }
      } catch (err) {
        console.warn("Capabilities background validation bypassed or timed out:", err);
        // Ensure we keep the optimistic fallback layer on failure
        if (isMounted) { setValidLayerId(intendedLayerId); updateState({ cloudLayerId: intendedLayerId }); }
      }
    };

    validateLayer();
    return () => { isMounted = false; };
  }, [intendedLayerId, dayNight]);

  const initialLat = isNaN(state.typhoonLat) ? 20.0 : state.typhoonLat;
  const initialLon = isNaN(state.typhoonLon) ? 130.0 : state.typhoonLon;

  // Compute exact numeric aspect ratio from state
  const [aspectW, aspectH] = (state.aspectRatio || '1:1').split(':').map(Number);

  return (
    <div className="flex flex-col h-full bg-slate-900 relative overflow-hidden">
      <div className="flex-1 relative z-0 flex items-center justify-center">
        {isValidating ? (
          <div className="text-white z-50 flex items-center gap-2 bg-slate-800/80 backdrop-blur-md px-5 py-3 rounded-2xl border border-slate-700 shadow-xl">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
            <span className="text-sm font-medium">正在验证 GIBS 卫星图层...</span>
          </div>
        ) : (
          <MapContainer
            center={[initialLat, initialLon]}
            zoom={4}
            zoomSnap={0}
            zoomDelta={0.1}
            wheelPxPerZoomLevel={120}
            touchZoom="center"
            bounceAtZoomLimits={false}
            zoomControl={false}
            crs={L.CRS.EPSG4326}
            style={{ position: 'absolute', inset: 0 }}
            ref={mapRef}
            worldCopyJump={true}
          >
            {validLayerId && (
              <SmartWMSTileLayer
                key={`${validLayerId}-${state.layerTime}`}
                url="https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
                layers={validLayerId}
                format="image/png"
                transparent={true}
                version="1.1.1"
                time={state.layerTime}
                zIndex={1}
              />
            )}
            <SmartWMSTileLayer
              url="https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
              layers="Coastlines"
              format="image/png"
              transparent={true}
              version="1.1.1"
              opacity={0.75}
              zIndex={100}
              className="black-coastlines"
            />
            <MapBoxEvents aspectW={aspectW} aspectH={aspectH} onChange={handleBoxChange} />
            <PinchCenterLock />
          </MapContainer>
        )}

        {/* Fixed Crop Box & Center Crosshair:
            Using precise aspectW / aspectH and setting width OR height based on the orientation
            to prevent independent dimension clamping from distorting the aspect ratio.
        */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-[1000] p-6">
          <div
            id="crop-box"
            style={{
              aspectRatio: `${aspectW} / ${aspectH}`,
              width: aspectW >= aspectH ? 'min(76vw, 320px)' : 'auto',
              height: aspectH > aspectW ? 'min(40vh, 280px)' : 'auto',
            }}
            className="border-2 border-dashed border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] flex items-center justify-center relative rounded-xs"
          >
            <AdaptiveCrosshair className="w-5 h-5" size={20} />
          </div>
        </div>
      </div>

      {/* Top Action Bar (Collapsible Controls - slides over map without moving crop box) */}
      <div className={`absolute top-0 left-0 right-0 p-4 z-[1100] transition-transform duration-300 transform ${isTopCollapsed ? '-translate-y-full' : 'translate-y-0'}`}>
        <div className="bg-white/95 backdrop-blur-md p-3 rounded-2xl shadow-lg border border-slate-100 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">步骤 2：选择台风云图层</p>
            <button
              onClick={() => setIsTopCollapsed(true)}
              className="flex items-center gap-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5" /> 收起
            </button>
          </div>

          <div className="flex gap-2">
            <div className="flex-1 bg-slate-100 rounded-xl p-1 flex">
              <button
                onClick={() => updateState({ isNight: false })}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${!state.isNight ? 'bg-white shadow text-amber-600 font-bold' : 'text-slate-500'}`}
              >
                <Sun className="w-4 h-4" /> 白天
              </button>
              <button
                onClick={() => updateState({ isNight: true })}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${state.isNight ? 'bg-white shadow text-indigo-600 font-bold' : 'text-slate-500'}`}
              >
                <Moon className="w-4 h-4" /> 夜间
              </button>
            </div>

            <div className="flex-1 bg-slate-100 rounded-xl p-1 flex">
              <button
                onClick={() => updateState({ satellite: 'NOAA20' })}
                className={`flex-1 flex items-center justify-center py-1.5 text-xs font-medium rounded-lg transition-colors ${state.satellite === 'NOAA20' ? 'bg-white shadow text-slate-800 font-bold' : 'text-slate-500'}`}
              >
                NOAA-20
              </button>
              <button
                onClick={() => updateState({ satellite: 'SNPP' })}
                className={`flex-1 flex items-center justify-center py-1.5 text-xs font-medium rounded-lg transition-colors ${state.satellite === 'SNPP' ? 'bg-white shadow text-slate-800 font-bold' : 'text-slate-500'}`}
              >
                Suomi NPP
              </button>
            </div>
          </div>

          <div className="flex items-center bg-slate-100 rounded-xl px-3 py-1">
            <Calendar className="w-4 h-4 text-slate-500 mr-2" />
            <input
              type="date"
              className="flex-1 bg-transparent text-sm font-medium outline-none py-1.5 text-slate-700"
              value={state.layerTime}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => updateState({ layerTime: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Floating top chevron button when top bar is collapsed */}
      {isTopCollapsed && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1100]">
          <button
            onClick={() => setIsTopCollapsed(false)}
            className="bg-white/95 backdrop-blur-md hover:bg-white text-slate-700 w-10 h-10 rounded-full shadow-lg border border-slate-100 flex items-center justify-center transition-all active:scale-95"
            title="展开顶部栏"
          >
            <ChevronDown className="w-5 h-5 text-slate-600 animate-pulse" />
          </button>
        </div>
      )}

      {/* Bottom Action Bar */}
      <div className={`absolute bottom-0 left-0 right-0 p-6 bg-white rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-[1100] transition-transform duration-300 transform ${isBottomCollapsed ? 'translate-y-full' : 'translate-y-0'}`}>
        <button
          onClick={() => setIsBottomCollapsed(true)}
          className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-md text-slate-500 hover:text-slate-800 border border-slate-100 shadow-md px-4 py-1 rounded-full text-xs flex items-center gap-1 active:scale-95 transition-all"
        >
          <ChevronDown className="w-3.5 h-3.5" /> 收起底栏
        </button>

        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-slate-500">台风中心</div>
          <div className="font-mono text-sm font-medium text-slate-700">
            {state.typhoonLat.toFixed(4)}°, {state.typhoonLon.toFixed(4)}°
          </div>
        </div>
        <div className="flex items-center justify-between mb-5">
          <div className="text-xs text-slate-500">选区跨度 ({state.aspectRatio})</div>
          <div className="font-mono text-sm font-medium text-slate-700">
            {state.deltaLat.toFixed(2)}° × {state.deltaLon.toFixed(2)}°
          </div>
        </div>

        <div className="flex gap-4">
          <button
            onClick={onPrev}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" /> 返回
          </button>
          <button
            onClick={onNext}
            className="flex-[2] flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
          >
            下一步 <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Floating bottom chevron button when bottom bar is collapsed */}
      {isBottomCollapsed && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1100]">
          <button
            onClick={() => setIsBottomCollapsed(false)}
            className="bg-white/95 backdrop-blur-md hover:bg-white text-slate-700 w-10 h-10 rounded-full shadow-lg border border-slate-100 flex items-center justify-center transition-all active:scale-95"
            title="展开底栏"
          >
            <ChevronUp className="w-5 h-5 text-slate-600 animate-pulse" />
          </button>
        </div>
      )}
    </div>
  );
}

