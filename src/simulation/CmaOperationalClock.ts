/**
 * CMA/NMC public typhoon-path product clock.
 *
 * The National Meteorological Centre public "台风路径预报" product is issued at
 * 02/05/08/11/14/17/20/23 Beijing Time (UTC+8).  Keep this in one module so track
 * dots, wind-radius analyses, replay and forecast graphics cannot silently drift
 * onto a JMA-specific clock.
 */
export const CMA_TYPHOON_PRODUCT_BEIJING_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;

const DEFAULT_START_UTC_MS = Date.UTC(2026, 6, 21, 0, 0, 0);

export function getSimulationUtcDate(startDate: Date | undefined, simHour: number): Date {
  const startMs = startDate instanceof Date && Number.isFinite(startDate.getTime())
    ? startDate.getTime()
    : DEFAULT_START_UTC_MS;
  const simMinutes = Math.round((Number.isFinite(simHour) ? simHour : 0) * 60);
  return new Date(startMs + simMinutes * 60_000);
}

export function getSimulationBeijingDate(startDate: Date | undefined, simHour: number): Date {
  return new Date(getSimulationUtcDate(startDate, simHour).getTime() + 8 * 3_600_000);
}

/** True only at the official 3-hour CMA public typhoon-path product times in Beijing time. */
export function isCmaTyphoonProductTime(startDate: Date | undefined, simHour: number): boolean {
  const bj = getSimulationBeijingDate(startDate, simHour);
  return bj.getUTCMinutes() === 0 && bj.getUTCSeconds() === 0 &&
    CMA_TYPHOON_PRODUCT_BEIJING_HOURS.includes(bj.getUTCHours() as typeof CMA_TYPHOON_PRODUCT_BEIJING_HOURS[number]);
}

/** Latest CMA product-cycle simulation hour at or before the supplied timeline cursor. */
export function getLatestCmaProductSimHour(startDate: Date | undefined, simHour: number): number {
  const roundedMinutes = Math.floor((Number.isFinite(simHour) ? simHour : 0) * 60 + 1e-6);
  for (let minutes = roundedMinutes; minutes >= Math.max(0, roundedMinutes - 180); minutes--) {
    const h = minutes / 60;
    if (isCmaTyphoonProductTime(startDate, h)) return h;
  }
  return Math.max(0, Math.floor(simHour));
}

export function formatCmaProductBeijingTime(startDate: Date | undefined, simHour: number): string {
  const bj = getSimulationBeijingDate(startDate, simHour);
  const mm = String(bj.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(bj.getUTCDate()).padStart(2, "0");
  const hh = String(bj.getUTCHours()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:00 北京时`;
}
