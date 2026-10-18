/** NMC image-specific output memory guard, separate from meteorological physics.
 * RGBA canvas + backing store + PNG encoding + browser image decoding can hold
 * multiple copies of the same frame. Raw pixel count, not JPEG/PNG file size,
 * is the primary crash risk on mobile devices. */
const NMC_ASPECT = 1103 / 1295;
export type NmcDeviceClass = { mobile: boolean; deviceMemoryGb?: number };

export function chooseSafeNmcWidth(requestedWidth: number, device: NmcDeviceClass): number {
  const memory = Number(device.deviceMemoryGb);
  const lowMemory = Number.isFinite(memory) && memory > 0 && memory <= 2;
  const generousMemory = Number.isFinite(memory) && memory >= 8;
  // Conservative defaults when navigator.deviceMemory isn't exposed (Safari/iOS).
  // Values are total drawing pixels; the actual browser may have multiple copies.
  const budget = device.mobile
    ? (lowMemory ? 2_600_000 : generousMemory ? 5_700_000 : 3_900_000)
    : (lowMemory ? 6_000_000 : generousMemory ? 51_000_000 : 14_000_000);
  const maxWidth = Math.floor(Math.sqrt(budget / NMC_ASPECT));
  const requested = Number.isFinite(requestedWidth) ? Math.max(320, Math.round(requestedWidth)) : 1920;
  return Math.max(320, Math.min(requested, maxWidth));
}

export function detectNmcDeviceClass(explicitMobile = false): NmcDeviceClass {
  if (typeof navigator === 'undefined') return { mobile: explicitMobile };
  const nav = navigator as Navigator & { deviceMemory?: number };
  // Touchscreen laptops are not treated as phones merely because of pointer type.
  const mobile = explicitMobile || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '');
  return { mobile, deviceMemoryGb: nav.deviceMemory };
}
