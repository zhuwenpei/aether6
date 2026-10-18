/**
 * Local/offline vector basemap styles shared by the live Leaflet map and
 * Canvas video renderer.  Keeping the palette in one place prevents the
 * simulation map and exported products from drifting apart.
 */
export const LOCAL_VECTOR_BASEMAPS = {
  // Sampled from the uploaded operational JMA forecast chart (Typhoon No.26).
  // Keep this base palette shared by live JMA maps, forecast products and video export.
  jma: {
    ocean: "#1963CA",
    land: "#59965A",
    coast: "rgba(214,235,226,0.62)",
    border: "rgba(220,238,232,0.58)"
  },
  blackGray: {
    ocean: "#262626",
    land: "#0F0F0F",
    coast: "#303438",
    border: "rgba(84,90,94,0.40)"
  },
  // Matches the cloud-free map plate used by the Himawari-9 observation
  // replay style.  Only the vector geography is reused; no cloud imagery.
  himawari: {
    ocean: "#252F47",
    land: "#4A614B",
    coast: "#111A1B",
    border: "rgba(15,24,24,0.72)"
  },
  // Stylised operational terrain plate inspired by warning-centre map products.
  // The embedded ETOPO terrain tint is drawn by MapView as a cached ImageOverlay above this
  // green lowland plate; no live raster field is evaluated while the map moves.
  stormTerrain: {
    ocean: "#0D192B",
    land: "#356B49",
    coast: "#B9B48D",
    border: "rgba(196,191,153,0.48)"
  }
} as const;

export type LocalVectorBasemapId = keyof typeof LOCAL_VECTOR_BASEMAPS;

export function isLocalVectorBasemap(baseMap: string): baseMap is LocalVectorBasemapId {
  return Object.prototype.hasOwnProperty.call(LOCAL_VECTOR_BASEMAPS, baseMap);
}

export function getLocalVectorBasemapStyle(baseMap: string) {
  return isLocalVectorBasemap(baseMap) ? LOCAL_VECTOR_BASEMAPS[baseMap] : null;
}


/** Operational JMA product colours sampled from the user supplied No.26 chart. */
export const JMA_PRODUCT_COLORS = {
  ocean: "#1963CA",
  land: "#59965A",
  grid: "rgba(222,239,248,0.70)",
  strongWind: "#EEF537",
  stormWind: "#CB3045",
  forecast: "#F8FBFC",
  labelOutline: "rgba(18,42,66,0.92)",
  headerBlue: "#08448C",
  headerBorder: "#06417F",
  headerLight: "#FDFEFE",
  headerText: "#083E78",
  logoGreen: "#02B80B"
} as const;
