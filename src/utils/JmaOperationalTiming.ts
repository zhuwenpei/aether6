import type { TyphoonState } from "../types";
import { getDistanceToLand, getLandMetrics } from "../simulation/Engine";

const EPS = 1e-6;
const JMA_TRACK_DOT_CADENCE_HOURS = 24;
const JMA_NEAR_COAST_THRESHOLD_KM = 260;

function hasWindArea(q: any): boolean {
  if (!q) return false;
  return [q.ne, q.se, q.sw, q.nw].some((v) => Number.isFinite(Number(v)) && Number(v) > 0);
}

function findHistoryAtOrBefore(history: TyphoonState[], targetHour: number): TyphoonState | null {
  if (!history.length) return null;
  let lo = 0;
  let hi = history.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (Number(history[mid].simHour) <= targetHour + EPS) lo = mid + 1;
    else hi = mid;
  }
  return history[Math.max(0, lo - 1)] || null;
}

function jmaBaseWindRadiiCadenceHours(state: Partial<TyphoonState>, coastlineSource?: string): number {
  const lat = Number(state.lat);
  const lon = Number(state.lon);
  const landed = !!state.landed || (Number.isFinite(lat) && Number.isFinite(lon) && getLandMetrics(lat, lon, coastlineSource).isLand);
  if (landed) return 6;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const distKm = Math.max(0, getDistanceToLand(lat, lon, coastlineSource, true) * 111.12);
    if (distKm <= JMA_NEAR_COAST_THRESHOLD_KM) return 6;
  }
  return 12;
}

function triggersWindAreaDisappearance(issued: Partial<TyphoonState>, actual: Partial<TyphoonState>): boolean {
  return (["r7", "r10", "r12"] as const).some((key) => hasWindArea((issued as any)?.[key]) && !hasWindArea((actual as any)?.[key]));
}

export function getJmaTrackDotCadenceHours() {
  return JMA_TRACK_DOT_CADENCE_HOURS;
}

export function isJmaTrackDotTime(simHour: number, firstSimHour = 0): boolean {
  if (!Number.isFinite(simHour)) return false;
  const delta = simHour - firstSimHour;
  if (delta < -EPS) return false;
  return Math.abs(delta / JMA_TRACK_DOT_CADENCE_HOURS - Math.round(delta / JMA_TRACK_DOT_CADENCE_HOURS)) < EPS;
}

export function getJmaWindRadiiCadenceHours(history: TyphoonState[], currentSimHour: number, currentState?: Partial<TyphoonState>, coastlineSource?: string) {
  const resolved = resolveJmaIssuedWindRadiiState(history, currentSimHour, currentState as TyphoonState | undefined, coastlineSource);
  return resolved.stepHours;
}

export function resolveJmaIssuedWindRadiiState(
  historyInput: TyphoonState[],
  currentSimHour: number,
  currentState?: Partial<TyphoonState>,
  coastlineSource?: string
): { state: TyphoonState; sourceHour: number; stepHours: number } {
  const history = (historyInput || [])
    .filter((h) => Number.isFinite(Number(h?.simHour)))
    .slice()
    .sort((a, b) => Number(a.simHour) - Number(b.simHour));
  const fallback = (currentState as TyphoonState | undefined) || history[history.length - 1] || history[0];
  if (!fallback) {
    throw new Error("resolveJmaIssuedWindRadiiState requires at least one state");
  }
  if (!history.length || !Number.isFinite(currentSimHour)) {
    return {
      state: fallback,
      sourceHour: Number(fallback.simHour || currentSimHour || 0),
      stepHours: jmaBaseWindRadiiCadenceHours(fallback, coastlineSource)
    };
  }

  let issuedState = history[0];
  let issueHour = Number(issuedState.simHour || 0);
  let stepHours = jmaBaseWindRadiiCadenceHours(issuedState, coastlineSource);
  let nextNormalIssueHour = issueHour + stepHours;
  let pendingEmergencyHour = Number.POSITIVE_INFINITY;

  const processIssuesUpTo = (targetHour: number) => {
    while (Math.min(nextNormalIssueHour, pendingEmergencyHour) <= targetHour + EPS) {
      const issueAt = Math.min(nextNormalIssueHour, pendingEmergencyHour);
      const source = findHistoryAtOrBefore(history, issueAt) || issuedState;
      issuedState = source;
      issueHour = issueAt;
      stepHours = jmaBaseWindRadiiCadenceHours(issuedState, coastlineSource);
      nextNormalIssueHour = issueHour + stepHours;
      pendingEmergencyHour = Number.POSITIVE_INFINITY;
    }
  };

  for (let i = 1; i < history.length; i++) {
    const actual = history[i];
    const actualHour = Number(actual.simHour || 0);
    if (actualHour > currentSimHour + EPS) break;
    processIssuesUpTo(actualHour);
    if (actualHour > issueHour + EPS && actualHour < nextNormalIssueHour - EPS && triggersWindAreaDisappearance(issuedState, actual)) {
      const next3hNode = issueHour + Math.ceil((actualHour - issueHour) / 3) * 3;
      if (next3hNode <= actualHour + EPS && next3hNode < nextNormalIssueHour - EPS) {
        pendingEmergencyHour = Math.min(pendingEmergencyHour, actualHour);
        processIssuesUpTo(actualHour);
      } else if (next3hNode > actualHour + EPS && next3hNode < pendingEmergencyHour && next3hNode < nextNormalIssueHour - EPS) {
        pendingEmergencyHour = next3hNode;
      }
    }
  }

  processIssuesUpTo(currentSimHour);
  return { state: issuedState, sourceHour: issueHour, stepHours };
}
