/**
 * Cold-air event timing contract.
 *
 * The user-selected `forcedColdAirArrivalHour` is the actual cyclone-centre encounter time.
 * At that same simulated instant the coherent strong-wind leading edge reaches the cyclone centre
 * and the intensity engine begins the cold-air response. Keep the shared helper even with zero
 * delay so products and physics cannot drift onto separate clocks again.
 */
export const COLD_AIR_CENTER_CONTACT_DELAY_HOURS = 0;

export function getColdAirCenterContactHour(arrivalHour: number): number {
  return Number(arrivalHour) + COLD_AIR_CENTER_CONTACT_DELAY_HOURS;
}
