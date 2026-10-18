import React, { useEffect, useRef } from 'react';
import { WMSTileLayer, WMSTileLayerProps } from '../lib/LeafletReactLite';
import L from 'leaflet';

export interface SmartWMSTileProps extends WMSTileLayerProps {
  time?: string;
  [key: string]: any;
}

export function SmartWMSTileLayer(props: SmartWMSTileProps) {
  const layerRef = useRef<L.TileLayer.WMS>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const handleTileError = (e: L.TileErrorEvent) => {
      const tile = e.tile;
      if (!tile) return;

      const currentRetries = parseInt(tile.dataset.retryCount || '0', 10);
      if (currentRetries < 4) {
        tile.dataset.retryCount = (currentRetries + 1).toString();
        const retryDelay = 300 * (currentRetries + 1);
        setTimeout(() => {
          if (tile.src) {
            const cleanSrc = tile.src.replace(/&_retry=\d+/, '');
            tile.src = `${cleanSrc}&_retry=${Date.now()}`;
          }
        }, retryDelay);
      }
    };

    layer.on('tileerror', handleTileError);
    return () => {
      layer.off('tileerror', handleTileError);
    };
  }, []);

  return (
    <WMSTileLayer
      ref={layerRef}
      keepBuffer={4}
      updateWhenIdle={false}
      updateWhenZooming={false}
      {...props}
    />
  );
}
