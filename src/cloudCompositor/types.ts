export type AspectRatio = '4:3' | '3:4' | '16:9' | '9:16' | '1:1';

export interface AppState {
  step: number;
  aspectRatio: AspectRatio;
  targetLat: number;
  targetLon: number;
  typhoonLat: number;
  typhoonLon: number;
  deltaLat: number;
  deltaLon: number;
  layerTime: string; // YYYY-MM-DD
  isNight: boolean;
  satellite: 'NOAA20' | 'SNPP';
  /** Resolved NASA GIBS layer name. Step 2 stores the capability-validated name for export. */
  cloudLayerId?: string;
  resolution: number; // long edge pixels
  addCoastlines: boolean;
}

export const INITIAL_STATE: AppState = {
  step: 0,
  aspectRatio: '1:1',
  targetLat: 31.2304,
  targetLon: 121.4737,
  typhoonLat: 20.0,
  typhoonLon: 130.0,
  deltaLat: 10,
  deltaLon: 10,
  layerTime: new Date().toISOString().split('T')[0],
  isNight: false,
  satellite: 'NOAA20',
  resolution: 1080,
  addCoastlines: true,
};

const clampDateToToday = (value?: string) => {
  const today = new Date().toISOString().split('T')[0];
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  return value > today ? today : value;
};

export const createCloudCompositorInitialState = (
  targetLat: number,
  targetLon: number,
  initialDate?: string
): AppState => {
  const lat = Number.isFinite(targetLat) ? targetLat : INITIAL_STATE.targetLat;
  const lon = Number.isFinite(targetLon) ? targetLon : INITIAL_STATE.targetLon;
  return {
    ...INITIAL_STATE,
    targetLat: lat,
    targetLon: lon,
    typhoonLat: lat,
    typhoonLon: lon,
    layerTime: clampDateToToday(initialDate),
  };
};
