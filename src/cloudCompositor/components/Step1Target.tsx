import React, { useEffect, useRef, useState } from 'react';
import { AppState } from '../types';
import { MapContainer, useMap } from '../lib/LeafletReactLite';
import { SmartWMSTileLayer } from './SmartWMSTileLayer';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, ChevronRight, ChevronLeft } from 'lucide-react';
import { parseCoords } from '../lib/parseCoords';
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

function MapEvents({ onChange }: { onChange: (lat: number, lon: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const handleMove = () => {
      try {
        const center = map.getCenter();
        if (center && !isNaN(center.lat) && !isNaN(center.lng)) {
          onChange(center.lat, center.lng);
        }
      } catch (err) {
        console.warn('Error getting map center:', err);
      }
    };
    map.on('move', handleMove);
    return () => {
      map.off('move', handleMove);
    };
  }, [map, onChange]);
  return null;
}

export default function Step1Target({ state, updateState, onNext, onPrev }: Props) {
  const [inputCoords, setInputCoords] = useState('');
  const [error, setError] = useState('');
  const mapRef = useRef<L.Map>(null);

  // Configure Leaflet's native touchZoom to 'center' for smooth 60fps pinch zooming
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.options.touchZoom = 'center';
  }, []);

  const handleCenterChange = (lat: number, lon: number) => {
    updateState({ targetLat: lat, targetLon: lon });
  };

  const jumpToCoords = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseCoords(inputCoords);
    if (parsed) {
      setError('');
      try {
        if (mapRef.current) {
          const currentZoom = mapRef.current.getZoom() || 4;
          mapRef.current.setView([parsed.lat, parsed.lon], currentZoom, { animate: false });
        }
        updateState({ targetLat: parsed.lat, targetLon: parsed.lon });
        setInputCoords('');
      } catch (err) {
        setError('无法将地图中心定位到该坐标');
      }
    } else {
      setError('格式无效。试着输入“30°54.60′N, 121°43.25′E”或“31.2, 121.4”');
    }
  };

  const initialLat = isNaN(state.targetLat) ? 31.2304 : state.targetLat;
  const initialLon = isNaN(state.targetLon) ? 121.4737 : state.targetLon;

  return (
    <div className="flex flex-col h-full bg-slate-900 relative overflow-hidden">
      <div className="flex-1 relative z-0">
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
          style={{ height: '100%', width: '100%' }}
          ref={mapRef}
          worldCopyJump={true}
        >
          <SmartWMSTileLayer
            url="https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
            layers="BlueMarble_NextGeneration"
            format="image/jpeg"
            transparent={false}
            version="1.1.1"
            time="2004-08-01"
            zIndex={1}
          />
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
          <MapEvents onChange={handleCenterChange} />
          <PinchCenterLock />
        </MapContainer>

        {/* Small, Thin Adaptive Crosshair fixed dead-center in the screen */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-[1000]">
          <AdaptiveCrosshair className="w-5 h-5" size={20} />
        </div>
      </div>

      {/* Top Search Bar Overlay */}
      <div className="absolute top-0 left-0 right-0 p-4 z-[1100]">
        <div className="bg-white/95 backdrop-blur-md p-3 rounded-2xl shadow-lg border border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">步骤 1：目标位置</p>
          <form onSubmit={jumpToCoords} className="flex gap-2">
            <input
              type="text"
              placeholder="例如：30°54.60′N, 121°43.25′E"
              className="flex-1 px-3 py-2 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 placeholder:text-slate-400"
              value={inputCoords}
              onChange={(e) => setInputCoords(e.target.value)}
            />
            <button type="submit" className="bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-slate-900 transition-colors">
              确定
            </button>
          </form>
          {error && <p className="text-red-500 text-xs mt-1 font-medium">{error}</p>}
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="bg-white rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)] p-6 z-[1100]">
        <div className="flex items-center gap-3 mb-6 bg-slate-50 p-3 rounded-2xl border border-slate-100">
          <div className="bg-blue-100 text-blue-600 p-2 rounded-xl">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-500">中心坐标</div>
            <div className="font-mono text-sm font-medium text-slate-700">
              {state.targetLat.toFixed(4)}°, {state.targetLon.toFixed(4)}°
            </div>
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
    </div>
  );
}
