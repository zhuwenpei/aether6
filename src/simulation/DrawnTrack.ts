/** Deterministic arc-length traversal of a user-authored polyline. No browser/Leaflet dependencies. */
export type RoutePoint = { lat: number; lon: number };
const DEG_KM = 111.12;
export function advanceDrawnTrack(route: RoutePoint[], progressKm: number, speedKmh: number, hours = 1 / 6) {
  if (route.length < 2) return null;
  const lengths = route.slice(1).map((p, i) => {
    const a = route[i];
    return Math.hypot((p.lat - a.lat) * DEG_KM, (p.lon - a.lon) * DEG_KM * Math.max(.15, Math.cos((p.lat + a.lat) * Math.PI / 360)));
  });
  const total = lengths.reduce((sum, n) => sum + n, 0);
  if (total < .001) return null;
  const from = Math.max(0, Math.min(total, Number.isFinite(progressKm) ? progressKm : 0));
  const to = Math.min(total, from + Math.max(0, Math.min(240, Number.isFinite(speedKmh) ? speedKmh : 20)) * Math.max(0, hours));
  let remaining = to;
  let heading = 0;
  for (let i = 0; i < lengths.length; i++) {
    const a = route[i], b = route[i + 1], len = lengths[i];
    if (len < .001) continue;
    heading = (Math.atan2((b.lon - a.lon) * Math.cos((a.lat + b.lat) * Math.PI / 360), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
    if (remaining <= len || i === lengths.length - 1) {
      const fraction = Math.min(1, remaining / len);
      return { lat: a.lat + (b.lat - a.lat) * fraction, lon: a.lon + (b.lon - a.lon) * fraction,
        progressKm: to, direction: Math.round(heading), speedKmh: (to - from) / Math.max(.000001, hours), finished: to >= total - .000001 };
    }
    remaining -= len;
  }
  return null;
}
