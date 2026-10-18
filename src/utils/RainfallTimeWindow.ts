/**
 * Temporal integration helpers for accumulated-rainfall products.
 *
 * The simulation archives cyclone analyses hourly but advances physics every 10 minutes.  The map
 * therefore must integrate the intervals *between* analyses and, while live, include the current
 * fractional hour. Keeping this logic in a DOM-free module also makes the time-window semantics
 * regression-testable without loading Leaflet/Turf or a browser canvas.
 */
import type { Typhoon, TyphoonState } from "../types";

export type WeightedRainSnapshot = {
  state: TyphoonState;
  dtHours: number;
};

const clamp01Range = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const RAIN_ANGLE_KEYS = new Set([
  "direction", "shearDir", "drySlotBearingDeg", "dryAirConvectiveArcBearingDeg",
  "terrainInteractionBearingDeg", "asymmetricReburstBearingDeg", "terrainHollowCoreBearingDeg"
]);

function interpolateAngleDeg(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return ((a + delta * t) % 360 + 360) % 360;
}

function interpolateQuadrant(a: any, b: any, t: number): any {
  if (!a && !b) return undefined;
  const aa = a || b;
  const bb = b || a;
  return {
    ne: Number(aa?.ne || 0) + (Number(bb?.ne || 0) - Number(aa?.ne || 0)) * t,
    se: Number(aa?.se || 0) + (Number(bb?.se || 0) - Number(aa?.se || 0)) * t,
    sw: Number(aa?.sw || 0) + (Number(bb?.sw || 0) - Number(aa?.sw || 0)) * t,
    nw: Number(aa?.nw || 0) + (Number(bb?.nw || 0) - Number(aa?.nw || 0)) * t
  };
}

/** Interpolate an hourly analysis to the time that actually contributed rain. */
export function interpolateRainState(a: TyphoonState, b: TyphoonState, t: number, simHour: number): TyphoonState {
  const base: any = { ...(t < 0.5 ? a : b) };
  const keys = new Set([...Object.keys(a as any), ...Object.keys(b as any)]);
  for (const key of keys) {
    if (key === "simHour" || key === "r7" || key === "r10" || key === "r12" || key === "history") continue;
    const av = (a as any)[key];
    const bv = (b as any)[key];
    if (typeof av === "number" && Number.isFinite(av) && typeof bv === "number" && Number.isFinite(bv)) {
      base[key] = RAIN_ANGLE_KEYS.has(key)
        ? interpolateAngleDeg(av, bv, t)
        : av + (bv - av) * t;
    }
  }
  base.r7 = interpolateQuadrant((a as any).r7, (b as any).r7, t);
  base.r10 = interpolateQuadrant((a as any).r10, (b as any).r10, t);
  base.r12 = interpolateQuadrant((a as any).r12, (b as any).r12, t);
  base.simHour = simHour;
  base.history = undefined;
  return base as TyphoonState;
}

export function buildWeightedRainSnapshots(typhoon: Typhoon, currentHour: number, requestedWindow: number): {
  snapshots: WeightedRainSnapshot[];
  actualStartHour: number;
  actualEndHour: number;
  actualWindow: number;
} {
  const actualEndHour = Math.max(0, currentHour);
  const history = [...(typhoon.history || [])]
    .filter((h) => Number.isFinite(h.simHour) && h.simHour <= actualEndHour + 1e-6)
    .sort((a, b) => a.simHour - b.simHour);

  // The live state can be up to 59m59s ahead of the newest hourly archive.  Add it as a final knot
  // at the precise model time so a past-N-hours map never silently omits that partial hour.
  const lastHistoryHour = history.length ? history[history.length - 1].simHour : -Infinity;
  if (actualEndHour > lastHistoryHour + 1e-4 && Number.isFinite(typhoon.lat) && Number.isFinite(typhoon.lon)) {
    history.push({ ...(typhoon as any), simHour: actualEndHour, history: undefined } as TyphoonState);
  }

  const earliest = history.length ? history[0].simHour : actualEndHour;
  const requestedStart = Math.max(0, actualEndHour - Math.max(1, requestedWindow));
  const actualStartHour = Math.max(earliest, requestedStart);
  const snapshots: WeightedRainSnapshot[] = [];

  // Integrate true time segments and sample each piece at its midpoint.  The previous implementation
  // assigned state H to the whole (H-1,H] interval, phase-shifting a moving rain swath by roughly half
  // to one hour. Legacy gaps are split into <=1 h pieces without multiplying normal-history cost.
  for (let i = 0; i < history.length - 1; i++) {
    const a = history[i];
    const b = history[i + 1];
    const segStart = Math.max(actualStartHour, a.simHour);
    const segEnd = Math.min(actualEndHour, b.simHour);
    if (segEnd <= segStart + 1e-6) continue;
    const pieces = Math.max(1, Math.ceil((segEnd - segStart) / 1.0));
    const pieceDt = (segEnd - segStart) / pieces;
    const span = Math.max(1e-6, b.simHour - a.simHour);
    for (let p = 0; p < pieces; p++) {
      const midHour = segStart + (p + 0.5) * pieceDt;
      const t = clamp01Range((midHour - a.simHour) / span, 0, 1);
      snapshots.push({ state: interpolateRainState(a, b, t, midHour), dtHours: pieceDt });
    }
  }

  if (!snapshots.length) {
    const fallbackState: TyphoonState = {
      ...(typhoon as any),
      simHour: actualEndHour,
      history: undefined
    } as TyphoonState;
    snapshots.push({
      state: fallbackState,
      dtHours: Math.max(0.25, Math.min(1, actualEndHour - actualStartHour || 1))
    });
  }

  return {
    snapshots,
    actualStartHour,
    actualEndHour,
    actualWindow: Math.max(0.25, actualEndHour - actualStartHour || snapshots.reduce((s, x) => s + x.dtHours, 0))
  };
}
