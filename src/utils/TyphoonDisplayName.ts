import type { Typhoon, TyphoonState } from "../types";
import { isCmaTyphoonProductTime } from "../simulation/CmaOperationalClock";

/**
 * Public-facing naming clock.
 *
 * A newly generated disturbance keeps its configured future name internally so saves,
 * presets and logs can still identify it.  Public products, however, must continue to
 * call it “热带低压” until it has first reached tropical-storm strength AND the next
 * three-hour operational analysis time is reached.  Once named, subsequent weakening
 * below TS does not remove the name.
 */
export const PRE_NAMING_TD_LABEL = "热带低压";

function orderedStates(typhoon: Typhoon): TyphoonState[] {
  const history = [...(typhoon.history || [])]
    .filter((h) => Number.isFinite(Number(h?.simHour)))
    .sort((a, b) => Number(a.simHour) - Number(b.simHour));
  if (!history.length || Number(history[history.length - 1].simHour) < Number(typhoon.simHour ?? 0) - 1e-6) {
    history.push({ ...(typhoon as any), simHour: Number(typhoon.simHour ?? 0) } as TyphoonState);
  }
  return history;
}

export function getTyphoonNamingSimHour(typhoon: Typhoon, startDate?: Date): number | null {
  if (typhoon.officialNamingHour != null && Number.isFinite(Number(typhoon.officialNamingHour))) return Number(typhoon.officialNamingHour);
  const persisted = [...(typhoon.history || [])]
    .filter((h) => h.hasBeenOfficiallyNamed && h.officialNamingHour != null && Number.isFinite(Number(h.officialNamingHour)))
    .sort((a, b) => Number(a.officialNamingHour) - Number(b.officialNamingHour));
  if (persisted.length) return Number(persisted[0].officialNamingHour);
  const states = orderedStates(typhoon);
  let hasReachedTs = false;
  for (const state of states) {
    const vmax = Number(state.vmax || 0);
    if (vmax >= 17.2) hasReachedTs = true;
    if (!hasReachedTs) continue;
    // Naming is a one-way operational event: once TS strength has first been reached,
    // use the very next agency analysis time even if the sampled wind subsequently dips
    // below 17 m/s before that bulletin. Later weakening never removes the assigned name.
    if (isCmaTyphoonProductTime(startDate, Number(state.simHour))) return Number(state.simHour);
  }
  return null;
}

export function getTyphoonDisplayName(typhoon: Typhoon, simHour?: number, startDate?: Date): string {
  const officialName = (typhoon.name || "无名").trim() || "无名";
  const hour = Number.isFinite(Number(simHour)) ? Number(simHour) : Number(typhoon.simHour ?? 0);
  const namingHour = getTyphoonNamingSimHour(typhoon, startDate);
  return namingHour !== null && hour + 1e-6 >= namingHour ? officialName : PRE_NAMING_TD_LABEL;
}

export function hasTyphoonBeenNamed(typhoon: Typhoon, simHour?: number, startDate?: Date): boolean {
  return getTyphoonDisplayName(typhoon, simHour, startDate) !== PRE_NAMING_TD_LABEL;
}

/** Return the simulated genesis date used by the official YYNN storm number. */
export function getTyphoonGenesisDate(typhoon: Typhoon, startDate?: Date): Date {
  const base = startDate ? new Date(startDate) : new Date();
  const genesisHour = Number.isFinite(Number(typhoon.seasonStartHour))
    ? Number(typhoon.seasonStartHour)
    : Math.min(Number(typhoon.simHour ?? 0), ...((typhoon.history || []).map((h) => Number(h.simHour)).filter(Number.isFinite)));
  const safeHour = Number.isFinite(genesisHour) ? genesisHour : 0;
  return new Date(base.getTime() + safeHour * 3600000);
}

/** Two-digit simulated season year. This is never accepted from free-form user text. */
export function getTyphoonYearCode(typhoon: Typhoon, startDate?: Date): string {
  return String(getTyphoonGenesisDate(typhoon, startDate).getFullYear()).slice(-2).padStart(2, "0");
}

/** Normalize the editable storm sequence to 01..99. Full YYNN input is accepted; only NN is retained. */
export function normalizeTyphoonSequenceNumber(value: string | number | undefined, fallback = 1): number {
  const digits = String(value ?? "").replace(/\D/g, "");
  const raw = digits.length >= 2 ? Number(digits.slice(-2)) : Number(digits || fallback);
  if (!Number.isFinite(raw) || raw <= 0) return Math.max(1, Math.min(99, Math.round(fallback || 1)));
  return Math.max(1, Math.min(99, Math.round(raw)));
}

/**
 * Canonical public storm number. Example: simulated genesis in 2026 and sequence 12 => 2612.
 * The year prefix always follows simulated time, so stale saved identifiers cannot carry a wrong year.
 */
export function getTyphoonOfficialNumber(typhoon: Typhoon, startDate?: Date): string {
  const fallback = Number(typhoon.seasonOrdinal || 1);
  const sequence = normalizeTyphoonSequenceNumber(typhoon.officialNumber, fallback);
  return `${getTyphoonYearCode(typhoon, startDate)}${String(sequence).padStart(2, "0")}`;
}

/** 1-based sequence portion used in Chinese phrases such as “今年第12号台风”. */
export function getTyphoonOrdinalNumber(typhoon: Typhoon, startDate?: Date): number {
  return normalizeTyphoonSequenceNumber(getTyphoonOfficialNumber(typhoon, startDate), Number(typhoon.seasonOrdinal || 1));
}
