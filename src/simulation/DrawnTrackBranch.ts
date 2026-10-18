import {trimRealisticParameterJournal} from "./RealisticParameterJournal";
/** Pure timeline-branch helpers: a new drawn route must never inherit a future route cursor. */
import type { Typhoon, SimulationConfig } from "../types";
import type { RoutePoint } from "./DrawnTrack";
import { mergeTyphoonStateWithCurrentIdentity } from "../utils/TyphoonIdentity";

export function drawnRouteDistanceKm(a: RoutePoint, b: RoutePoint): number {
  return Math.hypot((a.lat - b.lat) * 111.12,
    (a.lon - b.lon) * 111.12 * Math.max(0.15, Math.cos((a.lat + b.lat) * Math.PI / 360)));
}

/** Use archived coordinates, not a (possibly still mounted) future live-state position. */
export function getDrawnBranchCenter(storms: readonly Typhoon[], hour: number): RoutePoint | null {
  for (const ty of storms) {
    const state = ty.history?.find((h) => Math.abs(h.simHour - hour) < 1e-5);
    if (state && !state.dissipated && Number.isFinite(state.lat) && Number.isFinite(state.lon)) {
      return { lat: state.lat, lon: state.lon };
    }
  }
  return null;
}

/**
 * Create an explicit timeline branch on route confirmation, never merely on scrub preview.
 * The archived hour is the authority for position, state and route progress; all later history
 * and later-born storms are removed. The new route is anchored to that archived position.
 */
export function branchWithDrawnRoute(
  storms: readonly Typhoon[], hour: number, route: readonly RoutePoint[], config: SimulationConfig
): Typhoon[] {
  const snapshotConfig: SimulationConfig = {
    ...config,
    drawnTrackRoute: route.map(({ lat, lon }) => ({ lat, lon })),
    manualForecastRoute: (config.manualForecastRoute || []).map(({ lat, lon }) => ({ lat, lon })),
    manualForecastIntensityCurve: (config.manualForecastIntensityCurve || []).map(({ leadHour, vmax }) => ({ leadHour, vmax })),
    categoryColors: config.categoryColors ? { ...config.categoryColors } : config.categoryColors
  };
  return storms.flatMap((ty): Typhoon[] => {
    const history = (ty.history || []).filter((h) => h.simHour <= hour + 1e-5);
    if (!history.length) return []; // This storm did not yet exist at the branching hour.
    const state = [...history].reverse().find((h) => Math.abs(h.simHour - hour) < 1e-5) ?? history[history.length - 1];
    const active = !state.dissipated && Math.abs(state.simHour - hour) < 1e-5;
    const isRouteOwner = active && drawnRouteDistanceKm(state, route[0]) < 0.01;
    const rebasedHistory = isRouteOwner ? history.map((h, index) => index === history.length - 1
      ? { ...h, drawnRouteProgressKm: 0, configSnapshot: snapshotConfig }
      : h) : history;
    return [mergeTyphoonStateWithCurrentIdentity(ty, state, {
      active,
      // Never retain future termination metadata, forecast, or position after history truncation.
      seasonEndHour: active ? undefined : state.dissipated ? state.simHour : ty.seasonEndHour,
      timelineHidden: false,
      drawnRouteProgressKm: isRouteOwner ? 0 : state.drawnRouteProgressKm,
      configSnapshot: isRouteOwner ? snapshotConfig : state.configSnapshot,
      history: rebasedHistory,
      forecastPath: active ? state.forecastPath : [],
      simHour: state.simHour
    })];
  });
}

/** Sample the original polyline at an archived arc-length cursor, without advancing time. */
export function pointOnDrawnRoute(route: readonly RoutePoint[], progressKm: number): RoutePoint | null {
  if (route.length < 2 || !Number.isFinite(progressKm)) return null;
  let remaining = Math.max(0, progressKm);
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i], b = route[i + 1], length = drawnRouteDistanceKm(a, b);
    if (length < 1e-5) continue;
    if (remaining <= length || i === route.length - 2) {
      const fraction = Math.min(1, remaining / length);
      return { lat: a.lat + (b.lat - a.lat) * fraction, lon: a.lon + (b.lon - a.lon) * fraction };
    }
    remaining -= length;
  }
  return route[route.length - 1];
}

/**
 * Maintain the historical cursor and route by default. If an older save holds a cursor from a
 * different route, splice the archived centre into the nearest *remaining* leg: the very next
 * ten-minute step must start at the restored cyclone, never jump to a future waypoint.
 */
export function reconcileDrawnRouteAtBranch(route: readonly RoutePoint[], center: RoutePoint,
  historicalProgressKm: number | undefined): { route: RoutePoint[]; progressKm: number } {
  const copied = route.map(p => ({ lat: p.lat, lon: p.lon }));
  if (copied.length < 2) return { route: copied, progressKm: 0 };
  const archived = pointOnDrawnRoute(copied, Number(historicalProgressKm));
  if (archived && drawnRouteDistanceKm(archived, center) < 0.8) {
    return { route: copied, progressKm: Math.max(0, Number(historicalProgressKm)) };
  }
  let bestSegment = 0, bestDist = Infinity;
  for (let i = 0; i + 1 < copied.length; i++) {
    const a = copied[i], b = copied[i + 1];
    const cos = Math.max(0.15, Math.cos((a.lat + b.lat + center.lat) * Math.PI / 540));
    const dx = (b.lon - a.lon) * 111.12 * cos, dy = (b.lat - a.lat) * 111.12;
    const cx = (center.lon - a.lon) * 111.12 * cos, cy = (center.lat - a.lat) * 111.12;
    const t = Math.max(0, Math.min(1, (cx * dx + cy * dy) / Math.max(1e-9, dx * dx + dy * dy)));
    const d = Math.hypot(cx - dx * t, cy - dy * t);
    if (d < bestDist) { bestDist = d; bestSegment = i; }
  }
  // This is an explicit slowly traversed connection rather than a teleport: next simulation
  // samples the exact archived centre at progress=0, then advances by speed * 1/6 h.
  const suffix = copied.slice(bestSegment + 1).filter((p, i) => i > 0 || drawnRouteDistanceKm(p, center) > 0.01);
  return { route: [center, ...suffix], progressKm: 0 };
}

/** The normal time-axis branch preserves the already approved drawn path and its cursor. */
export function branchWithExistingDrawnRoute(storms: readonly Typhoon[], hour: number,
  config: SimulationConfig): { storms: Typhoon[]; config: SimulationConfig } {
  const owner = storms.find(ty => (ty.history || []).some(h =>
    Math.abs(h.simHour - hour) < 1e-5 && !h.dissipated));
  const state = owner?.history?.find(h => Math.abs(h.simHour - hour) < 1e-5);
  // Historical configuration is the authority: live config may belong to an entirely different
  // future branch and may contain an arc-length cursor from that future route.
  const archivedRoute = state?.configSnapshot?.drawnTrackRoute;
  const liveRoute = config.drawnTrackRoute || [];
  // An explicit continuation appends nodes to the archived polyline. Preserve that extension;
  // otherwise the saved historical route wins over unrelated future-branch live configuration.
  const extendsArchived = !!archivedRoute && archivedRoute.length >= 2 && liveRoute.length > archivedRoute.length &&
    archivedRoute.every((point, index) => drawnRouteDistanceKm(point, liveRoute[index]) < 0.05);
  const sourceRoute = extendsArchived ? liveRoute : archivedRoute && archivedRoute.length >= 2 ? archivedRoute : liveRoute;
  const aligned = state && sourceRoute.length >= 2
    ? reconcileDrawnRouteAtBranch(sourceRoute, state, state.drawnRouteProgressKm)
    : { route: sourceRoute.map(p => ({ ...p })), progressKm: 0 };
  const nextConfig: SimulationConfig = { ...config, drawnTrackRoute: aligned.route };
  const snapshotConfig: SimulationConfig = {
    ...nextConfig, drawnTrackRoute: aligned.route.map(p => ({ ...p })),
    manualForecastRoute: (nextConfig.manualForecastRoute || []).map(p => ({ ...p })),
    manualForecastIntensityCurve: (nextConfig.manualForecastIntensityCurve || []).map(p => ({ ...p }))
  };
  const result = storms.flatMap((ty): Typhoon[] => {
    const history = (ty.history || []).filter(h => h.simHour <= hour + 1e-5);
    if (!history.length) return [];
    const archive = [...history].reverse().find(h => Math.abs(h.simHour - hour) < 1e-5) ?? history[history.length - 1];
    const active = !archive.dissipated && Math.abs(archive.simHour - hour) < 1e-5;
    const isOwner = active && ty.id === owner?.id;
    const progress = isOwner ? aligned.progressKm : archive.drawnRouteProgressKm;
    return [mergeTyphoonStateWithCurrentIdentity(ty, archive, { active, timelineHidden: false,
      seasonEndHour: active ? undefined : archive.dissipated ? archive.simHour : ty.seasonEndHour,
      drawnRouteProgressKm: progress,
      configSnapshot: isOwner ? snapshotConfig : archive.configSnapshot,
      realisticMotion:trimRealisticParameterJournal(ty,history),
      history: isOwner ? history.map((h, i) => i === history.length - 1
        ? { ...h, drawnRouteProgressKm: progress, configSnapshot: snapshotConfig } : h) : history,
      forecastPath: active ? archive.forecastPath : [], simHour: archive.simHour })];
  });
  return { storms: result, config: nextConfig };
}
