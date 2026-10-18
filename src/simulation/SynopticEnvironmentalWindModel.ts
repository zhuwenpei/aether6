const KT_TO_MS = 0.514444;
const MS_TO_KT = 1 / KT_TO_MS;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth01 = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};
const gaussian01 = (lat: number, lon: number, cLat: number, cLon: number, rLat: number, rLon: number) => {
  const dy = (lat - cLat) / Math.max(1e-6, rLat);
  const dx = (lon - cLon) / Math.max(1e-6, rLon);
  return Math.exp(-(dy * dy + dx * dx));
};
const borealSummerWeight = (month: number) => {
  const rise = smooth01((month - 4.0) / 3.0);
  const fall = 1 - smooth01((month - 8.0) / 3.0);
  return clamp(Math.min(rise, fall), 0, 1);
};
const southwestMonsoonRegionalWeight = (lat: number, lon: number, month: number) => {
  const summer = borealSummerWeight(month);
  if (summer <= 0.001) return 1;
  const scsCore = gaussian01(lat, lon, 14.0, 114.5, 5.8, 9.8);
  const easternScsJet = gaussian01(lat, lon, 15.6, 119.6, 4.8, 5.6);
  const westPhilippineSea = gaussian01(lat, lon, 16.5, 123.0, 5.5, 5.5);
  const eastPhilippinePenalty = gaussian01(lat, lon, 17.2, 136.0, 7.0, 18.0) * smooth01((lon - 126.5) / 11.5);
  const maritimeContainment = smooth01((lon - 101.0) / 10.0) * (1 - smooth01((lon - 129.5) / 9.0));
  const latitudeGate = smooth01((lat - 4.5) / 5.5) * (1 - smooth01((lat - 25.0) / 6.5));
  const summerFootprint = clamp(
    (0.58 * scsCore + 0.92 * easternScsJet + 0.38 * westPhilippineSea + 0.24 * maritimeContainment) * latitudeGate
      - 0.85 * eastPhilippinePenalty,
    0,
    1
  );
  return clamp((1 - summer) + summer * summerFootprint, 0, 1);
};

export type SynopticEnvironmentalWindSurface = "ocean_global" | "land_plain" | "land_highland";

export interface SynopticEnvironmentalWindInput {
  lat: number;
  lon: number;
  isLand: boolean;
  elevationM?: number;
  localReliefM?: number;
  backgroundTexture?: number;
  synopticActivity?: number;
  subtropicalHigh?: number;
  westerlyJet?: number;
  midLatWesterlies?: number;
  westerlyTrough?: number;
  monsoonTrough?: number;
  monsoonFlow?: number;
  crossEquatorialFlow?: number;
  meanFlow?: number;
  /** 0 near a coastline, 1 over well-separated open ocean; diagnosed from the product grid. */
  openOcean?: number;
  month?: number;
}


export interface LandEnvironmentalWindCeilingInput {
  elevationM?: number;
  localReliefM?: number;
  coldAirStrength?: number;
  westerlyStrength?: number;
}

/**
 * Terrain-aware ceiling for LAND environmental 10 m wind. Tropical-cyclone circulation is not
 * subject to this limit; SynopticWindField applies it only where the background/environment gate
 * says the point is outside a cyclone circulation.
 *
 * ROUND108 specification:
 * - ordinary land environment stays strictly below 12 kt;
 * - organized cold-air / westerly land flow may reach, but never exceed, 22 kt;
 * - high terrain is progressively slower than low plains at the same synoptic forcing.
 */
export function diagnoseLandEnvironmentalWindCeilingKt(input: LandEnvironmentalWindCeilingInput): number {
  const elevation = Math.max(0, Number(input.elevationM) || 0);
  const relief = Math.max(0, Number(input.localReliefM) || 0);
  const coldAir = clamp(Number(input.coldAirStrength) || 0, 0, 1);
  const westerly = clamp(Number(input.westerlyStrength) || 0, 0, 1);
  const organized = Math.max(coldAir, smooth01((westerly - 0.34) / 0.42));
  const lowlandCeilingKt = 11.8 + (22.0 - 11.8) * organized;
  const elevationLoss = 0.36 * smooth01((elevation - 180) / 2350);
  const reliefLoss = 0.12 * smooth01((relief - 120) / 1350);
  const terrainFactor = clamp(1 - elevationLoss - reliefLoss, 0.48, 1);
  return clamp(lowlandCeilingKt * terrainFactor, 4.0, organized > 0.01 ? 22.0 : 11.8);
}

export interface SynopticEnvironmentalWindTarget {
  region: SynopticEnvironmentalWindSurface;
  target10mMs: number;
  target10mKt: number;
  troughStrength: number;
  monsoonStrength: number;
  westerlyStrength: number;
  subtropicalHighStrength: number;
  /** Environmental 10 m ceiling at this point. Only organized monsoon/westerly flow may exceed 34 kt. */
  ceiling10mKt: number;
}

/**
 * Global system-aware 10 m environmental-wind target for the synoptic product.
 *
 * There are intentionally no hard geographic sea boxes here. Ocean targets are diagnosed from
 * the large-scale atmospheric systems at the sampled point:
 * - open-ocean marine flow is generally stronger than near-coastal flow and most commonly sits
 *   around 16-23 kt;
 * - coherent westerlies / monsoon corridors can rise through the high-wind tail but never above
 *   36 kt;
 * - outside organized westerlies / monsoon flow the environmental ceiling is 34 kt;
 * - only strong calm-slot / trough signatures are allowed to fall into 4-10 kt;
 * - 4 kt is the absolute open-ocean floor outside a tropical-cyclone core.
 *
 * This is a soft coverage target, not a replacement vector. Direction still comes from the
 * resolved environmental pressure / wind systems in SynopticWindField.
 */
export function diagnoseSynopticEnvironmentalWindTarget(input: SynopticEnvironmentalWindInput): SynopticEnvironmentalWindTarget {
  const texture = clamp(Number(input.backgroundTexture) || 0, -1, 1);
  const activity = clamp(Number(input.synopticActivity) || 0, 0, 1);
  const meanFlow = clamp(Number(input.meanFlow) || 0, 0, 1);
  const openOcean = clamp(Number(input.openOcean) || 0, 0, 1);
  const month = clamp(Number(input.month) || 7, 1, 12);
  const subtropicalHigh = clamp(Number(input.subtropicalHigh) || 0, 0, 1);
  const westerly = clamp(Math.max(
    Number(input.westerlyJet) || 0,
    Number(input.midLatWesterlies) || 0,
    0.78 * (Number(input.westerlyTrough) || 0)
  ), 0, 1);
  const monsoon = clamp(Math.max(
    Number(input.monsoonFlow) || 0,
    0.82 * (Number(input.crossEquatorialFlow) || 0),
    0.72 * (Number(input.monsoonTrough) || 0)
  ), 0, 1);
  const effectiveMonsoon = clamp(monsoon * southwestMonsoonRegionalWeight(input.lat, input.lon, month), 0, 1);

  if (input.isLand) {
    const elevation = Math.max(0, Number(input.elevationM) || 0);
    const relief = Math.max(0, Number(input.localReliefM) || 0);
    const highland = smooth01((elevation - 650) / 1800) * 0.72 + smooth01((relief - 300) / 1050) * 0.28;
    const plainBoost = (1 - smooth01((elevation - 260) / 620)) * (1 - 0.55 * smooth01((relief - 180) / 560));
    const targetKt = clamp(
      5.9 + 0.70 * activity + 0.45 * texture + 0.70 * plainBoost - 3.15 * highland,
      highland > 0.45 ? 2.6 : 4.4,
      9.2
    );
    return {
      region: highland > 0.45 ? "land_highland" : "land_plain",
      target10mMs: targetKt * KT_TO_MS,
      target10mKt: targetKt,
      troughStrength: 0,
      monsoonStrength: effectiveMonsoon,
      westerlyStrength: westerly,
      subtropicalHighStrength: subtropicalHigh,
      ceiling10mKt: diagnoseLandEnvironmentalWindCeilingKt({ elevationM: elevation, localReliefM: relief })
    };
  }

  // Open ocean is intentionally faster than the near-coastal marine boundary layer.  This is a
  // continuous distance-from-land effect, not a geographic basin preset: ordinary remote-ocean
  // flow should usually live in the 16-23 kt band before organized jet/monsoon enhancement.
  const openOceanBoost = 5.6 * Math.pow(openOcean, 0.78);
  const ordinaryKt = 13.1 + openOceanBoost + 1.35 * activity + 0.85 * meanFlow + 1.05 * texture
    - 0.55 * subtropicalHigh * subtropicalHigh;

  // Only genuinely organized monsoon / westerly systems may enter the 34-36 kt tail. Moderate
  // scores alter the resolved vector field but do not automatically create widespread gale-force
  // environmental wind.
  const westerlyActive = smooth01((westerly - 0.40) / 0.48);
  const monsoonActive = smooth01((effectiveMonsoon - 0.55) / 0.38);
  const activeFastSystem = Math.max(westerlyActive, monsoonActive);
  const hasExceptionalFastSystem = activeFastSystem >= 0.18;
  const ceiling10mKt = hasExceptionalFastSystem ? 36.0 : 34.0;

  // Low-wind slots remain possible, but require a deep negative mesoscale/synoptic texture and weak
  // organized flow. The larger loss is necessary because the ordinary remote-ocean state is now
  // deliberately faster than in ROUND87.
  const calmTexture = smooth01((-0.60 - texture) / 0.24);
  const calmSystemGate = 1 - smooth01((activeFastSystem - 0.08) / 0.58);
  const troughStrength = clamp(calmTexture * calmSystemGate * (0.76 + 0.24 * (1 - activity)), 0, 1);

  // Westerlies should be recognizably faster than a calm subtropical background without becoming
  // a nearly uniform 30-36 kt sheet. Diagnose a separate westerly-belt target with coherent
  // longitudinal variability, then blend toward it. In a typical active belt the area-mean stays
  // around 17-22 kt, while embedded streaks/troughs remain visibly non-uniform.
  const westerlyWave =
    0.64 * Math.sin((input.lon * 1.45 + input.lat * 0.72 + month * 13.0) * Math.PI / 180)
    + 0.36 * Math.sin((input.lon * 3.1 - input.lat * 0.45 - month * 7.0) * Math.PI / 180);
  const westerlyTargetKt = clamp(
    18.2 + 1.8 * activity + 0.9 * meanFlow + 2.0 * texture + 2.2 * westerlyWave,
    13.5,
    27.0
  );
  const monsoonBoost = 13.0 * Math.pow(monsoonActive, 1.32);
  const troughLoss = 12.2 * troughStrength;
  let targetKt = ordinaryKt * (1 - westerlyActive) + westerlyTargetKt * westerlyActive;
  targetKt += monsoonBoost - troughLoss;

  // A strong subtropical-high core may be relatively quiet while its anticyclonic flanks are
  // represented by the actual vector field. The final ceiling is always enforced after this term.
  targetKt -= 1.0 * Math.pow(subtropicalHigh, 1.8) * (1 - 0.50 * activeFastSystem);
  targetKt = clamp(targetKt, 4.0, ceiling10mKt);

  return {
    region: "ocean_global",
    target10mMs: targetKt * KT_TO_MS,
    target10mKt: targetKt,
    troughStrength,
    monsoonStrength: effectiveMonsoon,
    westerlyStrength: westerly,
    subtropicalHighStrength: subtropicalHigh,
    ceiling10mKt
  };
}

export function msToKt(ms: number): number { return ms * MS_TO_KT; }
