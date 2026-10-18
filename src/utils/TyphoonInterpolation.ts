import type { TyphoonState } from "../types";

/** Catmull-Rom spline used by replay and generated products for smooth C1 center motion. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * Smoothly interpolate a typhoon state between archived fixes.
 * Wind radii remain held at the previous issued analysis until the next fix,
 * matching the replay/video product semantics used elsewhere in AETHER.
 */
export function interpolateTyphoonSmooth(history: TyphoonState[], currentSimHour: number): TyphoonState {
  if (!history || history.length === 0) return {} as TyphoonState;
  if (history.length === 1 || currentSimHour <= history[0].simHour) return history[0];
  if (currentSimHour >= history[history.length - 1].simHour) return history[history.length - 1];

  let i = 0;
  for (; i < history.length - 1; i++) {
    if (currentSimHour >= history[i].simHour && currentSimHour <= history[i + 1].simHour) break;
  }

  const s1 = history[i];
  const s2 = history[i + 1];
  const span = s2.simHour - s1.simHour;
  const t = span > 0 ? (currentSimHour - s1.simHour) / span : 0;
  const s0 = history[Math.max(0, i - 1)];
  const s3 = history[Math.min(history.length - 1, i + 2)];
  const lerp = (a: number, b: number) => a + (b - a) * t;

  return {
    ...s1,
    lat: catmullRom(s0.lat, s1.lat, s2.lat, s3.lat, t),
    lon: catmullRom(s0.lon, s1.lon, s2.lon, s3.lon, t),
    vmax: lerp(s1.vmax, s2.vmax),
    pmin: lerp(s1.pmin, s2.pmin),
    rmw: lerp(s1.rmw, s2.rmw),
    r7: s1.r7,
    r10: s1.r10,
    r12: s1.r12,
    casualties: lerp(s1.casualties || 0, s2.casualties || 0),
    simHour: currentSimHour,
    stationReadings: s1.stationReadings
  };
}
