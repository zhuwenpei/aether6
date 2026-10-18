import type { SimulationConfig } from "../types";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const finiteOr = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export interface CirculationSizeTransitionState {
  referenceKm: number;
  fromKm: number;
  targetKm: number;
  startHour: number;
  durationHours: number;
  progress: number;
  easedProgress: number;
  scheduled: boolean;
  active: boolean;
  complete: boolean;
}

/**
 * Resolve the user-requested circulation-size transition on the simulation clock.
 *
 * `circulationSizeReferenceKm` is the UI/requested target. The physics must never consume that
 * raw target while a timed transition is in progress; it consumes `referenceKm` instead.
 */
export function resolveCirculationSizeTransition(
  config: SimulationConfig | undefined,
  simHour: number
): CirculationSizeTransitionState {
  const fallbackReference = Math.max(0, finiteOr(config?.circulationSizeReferenceKm, 320));
  const targetKm = Math.max(0, finiteOr(config?.circulationSizeTransitionTargetKm, fallbackReference));
  const fromKm = Math.max(0, finiteOr(config?.circulationSizeTransitionFromKm, fallbackReference));
  const durationHours = Math.max(0, finiteOr(config?.circulationSizeTransitionHours, 0));
  const startHour = finiteOr(config?.circulationSizeTransitionStartHour, Number.isFinite(simHour) ? simHour : 0);
  const scheduled = durationHours > 1e-6 && Math.abs(targetKm - fromKm) > 1e-6;

  if (!scheduled || !Number.isFinite(simHour)) {
    return {
      referenceKm: targetKm,
      fromKm,
      targetKm,
      startHour,
      durationHours,
      progress: scheduled ? 0 : 1,
      easedProgress: scheduled ? 0 : 1,
      scheduled,
      active: false,
      complete: !scheduled
    };
  }

  const progress = clamp01((simHour - startHour) / durationHours);
  const easedProgress = progress * progress * (3 - 2 * progress);
  return {
    referenceKm: fromKm + (targetKm - fromKm) * easedProgress,
    fromKm,
    targetKm,
    startHour,
    durationHours,
    progress,
    easedProgress,
    scheduled,
    active: simHour > startHour + 1e-6 && simHour < startHour + durationHours - 1e-6,
    complete: simHour >= startHour + durationHours - 1e-6
  };
}

/**
 * Wind radii are operationally published on a 3-hour clock. During a user-requested size
 * transition, use the exact time-resolved reference at every issuance instead of applying a
 * second 52% low-pass on top of the requested duration. Keep the exact mode through the first
 * post-deadline issuance so a 72-hour request cannot still be chasing its target afterward.
 */
export function shouldUseExactCirculationTransitionAnalysis(
  state: CirculationSizeTransitionState,
  simHour: number,
  issueCadenceHours = 3
): boolean {
  if (!state.scheduled || !Number.isFinite(simHour)) return false;
  return simHour >= state.startHour - 1e-6 &&
    simHour <= state.startHour + state.durationHours + Math.max(0, issueCadenceHours) + 1e-6;
}

const CIRCULATION_TRANSITION_KEYS = [
  "circulationSizeTransitionHours",
  "circulationSizeTransitionStartHour",
  "circulationSizeTransitionFromKm",
  "circulationSizeTransitionTargetKm"
] as const;

/**
 * Restore only timeline-sensitive circulation-size controls from an archived snapshot. Global UI
 * preferences (sound, basemap, etc.) stay live. This prevents a later branch's size target from
 * leaking backward when the timeline is rewound.
 */
export function restoreCirculationSizeConfigFromSnapshot(
  live: SimulationConfig,
  archived: SimulationConfig | undefined
): SimulationConfig {
  if (!archived) return live;
  const next: SimulationConfig = { ...live };
  for (const key of CIRCULATION_TRANSITION_KEYS) {
    const value = archived[key];
    if (value === undefined) delete (next as any)[key];
    else (next as any)[key] = value;
  }
  // History snapshots taken during a transition store the *effective* instantaneous reference in
  // circulationSizeReferenceKm. The UI/requested target must remain the archived final target.
  const archivedTarget = archived.circulationSizeTransitionTargetKm ?? archived.circulationSizeReferenceKm;
  if (Number.isFinite(Number(archivedTarget))) next.circulationSizeReferenceKm = Math.max(0, Number(archivedTarget));
  return next;
}
