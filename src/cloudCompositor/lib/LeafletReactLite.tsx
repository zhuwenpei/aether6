/**
 * Minimal, locally-owned React bridge for the cloud compositor's two Leaflet
 * maps and their WMS layers. Keeps the existing map and tile behaviour without
 * the missing react-leaflet package (R208 bun.lock did not contain it).
 * This module intentionally does NOT replace the simulator's Leaflet renderer.
 */
import React, { createContext, forwardRef, useContext, useEffect, useRef, useState } from 'react';
import L from 'leaflet';

const MapContext = createContext<L.Map | null>(null);

export function useMap(): L.Map {
  const map = useContext(MapContext);
  if (!map) throw new Error('useMap must be rendered inside MapContainer');
  return map;
}

type MapContainerProps = Omit<L.MapOptions, 'center' | 'zoom'> & {
  center: L.LatLngExpression;
  zoom: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

export const MapContainer = forwardRef<L.Map, MapContainerProps>(function MapContainer(
  { center, zoom, style, children, ...options }, ref
) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const initialProps = useRef({ center, zoom, options });

  useEffect(() => {
    if (!elementRef.current) return;
    const { center: initCenter, zoom: initZoom, options: initOptions } = initialProps.current;
    const nextMap = L.map(elementRef.current, {
      ...initOptions,
      center: initCenter,
      zoom: initZoom,
    });
    if (typeof ref === 'function') ref(nextMap);
    else if (ref) ref.current = nextMap;
    setMap(nextMap);
    const resizeId = window.requestAnimationFrame(() => nextMap.invalidateSize(false));
    return () => {
      window.cancelAnimationFrame(resizeId);
      if (typeof ref === 'function') ref(null);
      else if (ref) ref.current = null;
      nextMap.remove();
    };
  }, [ref]);

  return (
    <div ref={elementRef} style={style}>
      {map ? <MapContext.Provider value={map}>{children}</MapContext.Provider> : null}
    </div>
  );
});

export type WMSTileLayerProps = Omit<L.WMSOptions, 'layers'> & {
  url: string;
  layers: string;
  time?: string;
  className?: string;
};

export const WMSTileLayer = forwardRef<L.TileLayer.WMS, WMSTileLayerProps>(function WMSTileLayer(
  { url, ...options }, ref
) {
  const map = useMap();
  const original = useRef({ url, options });
  useEffect(() => {
    const { url: layerUrl, options: layerOptions } = original.current;
    const layer = L.tileLayer.wms(layerUrl, layerOptions).addTo(map);
    if (typeof ref === 'function') ref(layer);
    else if (ref) ref.current = layer;
    return () => {
      if (typeof ref === 'function') ref(null);
      else if (ref) ref.current = null;
      map.removeLayer(layer);
    };
  }, [map, ref]);
  return null;
});
