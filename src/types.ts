import type { PreSimulationReference } from "./simulation/PreSimulationReference";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum TyphoonCategory {
  TD = "热带低压",
  TS = "热带风暴",
  STS = "强热带风暴",
  TY = "台风",
  STY = "强台风",
  SuperTY = "超强台风",
  ET = "温带气旋",
  RL = "残留低压",
  DS = "已消散"
}


export type TyphoonStructureMode =
  | "tropical_depression"
  | "loose_cdo"
  | "cdo_mature"
  | "dvorak_cmg"
  | "dvorak_cdg"
  | "dvorak_w_ring"
  | "convective_burst"
  | "asymmetric_reburst_wrap"
  | "reburst_eye_opening"
  | "failed_eye_opening"
  | "sheared_convective_burst"
  | "tightening_core"
  | "mature_eyewall"
  | "mature_disk_large_eye"
  | "intense_irregular_pinhole"
  | "ragged_banding_eye"
  | "ewrc_double"
  | "failed_ewrc_standoff"
  | "giant_outer_eyewall"
  | "post_ewrc_broad"
  | "terrain_hollow_bands"
  | "terrain_hollow_fragmented_eyewall"
  | "terrain_clogged_loose"
  | "terrain_displaced_core"
  | "sheared_small_core"
  | "exposed_llcc"
  | "westerly_sheared"
  | "westerly_cloud_stripped"
  | "warm_conveyor_frontal_tail"
  | "subtropical_cyclone"
  | "extratropical_transition"
  | "extratropical_cyclone"
  | "cold_air_remnant_low"
  | "dry_slot_eroding"
  | "dry_leaf"
  | "incense_coil"
  | "dry_rebuilding_core"
  | "moisture_starved_decay"
  | "landfall_disintegrating"
  | "landfall_intact_cdo"
  | "landfall_broken_eyewall"
  | "landfall_displaced_convection"
  | "landfall_outer_rainbands"
  | "brown_ocean_local_burst"
  | "rainband_dominant"
  | "moisture_loaded_broad"
  | "binary_interaction_sheared"
  | "binary_merger_reorganizing";

export interface StationReading {
  name: string;
  windSpeed: number;
  /** Instantaneous simulated surface gust for the current station time step. */
  gustSpeed?: number;
  pressure: number;
  precipitation: number;
  /** Station diagnostics/precipitation physics marker for safe exact-cache reuse. */
  diagnosticVersion?: string;
  maxWindSpeed: number;
  accumPrecip: number;
  /** Storm-surge anomaly above the no-storm water level, metres. */
  stormSurge?: number;
  /** Maximum storm-surge anomaly reached so far in the simulation, metres. */
  maxStormSurge?: number;
  casualties: number;
  warning: string;
}

export interface TyphoonState {
  /** Round158: precise, issue-hour scoped sandbox guidance for historical forecast replay. */
  preSimulationReference?: PreSimulationReference;
  /** Round160: cancels earlier forecast pre-simulation guidance from this history hour onward. */
  preSimulationReferenceCleared?: boolean;
  drawnRouteProgressKm?: number;
  lat: number;
  lon: number;
  vmax: number; // m/s
  /** User-selected genesis intensity; used to prevent a freshly placed weak system from jumping stronger immediately. */
  genesisIntensityReference?: number;
  /** Hours after genesis during which positive intensity tendency is capped at the selected genesis intensity. */
  genesisIntensityHoldHours?: number;
  pmin: number;
  direction: number; // degrees
  speed: number; // km/h
  rmw: number; // km
  r7: { ne: number; se: number; sw: number; nw: number };
  r10: { ne: number; se: number; sw: number; nw: number };
  r12: { ne: number; se: number; sw: number; nw: number };
  category: TyphoonCategory;
  /** First operational analysis hour at which the user-selected official storm name becomes displayable. */
  officialNamingHour?: number;
  /** Persistent naming latch: once true, later weakening below TS never reverts the public name to TD. */
  hasBeenOfficiallyNamed?: boolean;
  simHour: number;
  maxR7Limit?: number;
  landed: boolean;
  dissipated: boolean;
  extrTransition: number; // 0 - 1
  ewrcState: "none" | "forming" | "max_decay" | "completed" | "recovering_success" | "recovering_failure" | "penalty_failure";
  ewrcProgress: number; // 0 - 1
  ewrcDuration?: number;
  ewrcWeakenAmount?: number;
  ewrcColdWakeHours?: number;
  ewrcL12LandHours?: number;
  ewrcPenaltyTotalHours?: number;
  ewrcFailurePenaltyHours?: number;
  ewrcIsFailure?: boolean;
  ewrcStartVmax?: number;
  /** RMW at EWRC onset; preserves the observed post-replacement size expansion instead of resetting to a tiny fixed radius. */
  ewrcStartRmw?: number;
  ewrcExtraAdjust?: number;
  ewrcRecoveryDuration?: number;
  ewrcCount?: number;
  /** Number of completed successful eyewall replacement cycles. */
  successfulEwrcCount?: number;
  /** Current environment/lifecycle-adjusted target used when autoAdjustIntensity is enabled. */
  autoIntensityTarget?: number;
  /** Accumulated hours above 65 m/s; used to make extreme intensity hard to sustain outside exceptional environments. */
  extremeIntensityHours?: number;
  rapidIntensifying: boolean;
  forcedRapidIntensification?: boolean;
  rapidIntensificationMode?: "ri" | "eri" | "uri";
  forcedRapidIntensificationMode?: "ri" | "eri" | "uri";
  rapidEpisodeElapsedHours?: number;
  rapidEpisodeDurationHours?: number;
  rapidEpisodeTarget24h?: number; // equivalent CMA-style m/s gain over 24 h
  rapidEpisodeStartRate?: number; // m/s per hour at episode onset, for smooth blending
  rapidEpisodeLastRate?: number;
  rapidEpisodeExitHours?: number;
  rapidEpisodeExitDuration?: number;
  rapidEpisodeAbortRequested?: boolean;
  rapidFavorableHours?: number; // continuously favorable hours before natural RI becomes eligible
  rapidTriggerCooldownHours?: number; // suppress immediate/repeated natural RI retriggers
  intensityRateMemory?: number; // smoothed intensity tendency used to avoid linear ramps
  intensityChange6h?: number;
  intensityChange24h?: number;
  isEyeClogged?: boolean;
  cloggedRecoveryHours?: number;
  cloggedRecoveryTotalHours?: number;
  dryAirPenaltyHours?: number;
  dryAirPenaltyTotalHours?: number;
  shearPenaltyHours?: number;
  shearPenaltyTotalHours?: number;
  upwellingHours?: number; // accumulated slow/spinning hours
  consecutiveUpwellingHours?: number;
  upwellingPersistentPenaltyHours?: number;
  tdHours?: number;
  landTdHours?: number;
  superTyLandHours?: number;
  landHours?: number;
  landContactHours?: number;
  r10LandContactHours?: number;
  vmax6Hours?: number; // accumulated hours at wind force <= 6
  etHours?: number;
  casualties?: number;
  /** Dynamic societal preparedness accumulated from forecast warning lead (0..1). */
  preparednessIndex?: number;
  /** Short-lived surprise from unexpected track/speed changes or an unforecast landfall threat (0..1). */
  forecastSurpriseIndex?: number;
  /** Current forecast lead to the next meaningful landfall threat, if diagnosed. */
  warningLeadHours?: number;
  forecastPath?: Array<{ lat: number; lon: number; vmax: number; pmin: number;
  simHour: number; category: TyphoonCategory; speed: number; intensityDeferred?: boolean; previewOnly?: boolean; landed?: boolean; remnantVortex?: boolean; lowLevelVortexIntegrity?: number; warmWaterHoursAfterSea?: number }>;
  stationReadings?: StationReading[];
  highElevationHours?: number;
  landfallElevation?: number;
  isCoreDisrupted?: boolean;
  passedTaiwanCentral?: boolean;
  passedLuzonMountains?: boolean;
  exitLandSimHour?: number;
  maxLandElevationPassed?: number;
  structuralDamageHours?: number;
  warmWaterHoursAfterSea?: number;
  isStructureDamaged?: boolean;
  structuralDamagePenaltyFactor?: number;
  upwellingLogged?: boolean;
  ewrcCooldownHours?: number;
  shear?: number;
  shearDir?: number;
  upwellingIntensity?: number;
  eyeType?: "none" | "small_round" | "large_round" | "irregular" | "gap" | "eccentric" | "broken";
  eyePhase?: "none" | "forming" | "opening" | "clear" | "clouding" | "blocked" | "replacement_inner" | "replacement_double" | "replacement_new" | "ragged";
  eyeRadiusKm?: number;
  eyeClearance?: number; // 0-1, satellite-visible eye clearing fraction
  eyeBrightnessTempC?: number; // simulated infrared eye brightness temperature
  eyeObstruction?: number; // 0-1, cloud/cirrus blockage inside the eye
  eyewallIntegrity?: number; // 0-1, azimuthal continuity / structural organization
  /** 0..1 fraction of the inner rainband/eyewall that has wrapped into a closed ring. */
  eyewallWrapProgress?: number;
  /** 0..1 persistence memory required before a satellite-visible eye may open. */
  eyeFormationMemory?: number;
  secondaryEyewallStrength?: number; // 0-1 during eyewall replacement
  eyeWarmCore?: number; // 0-1 proxy for subsidence-driven warm-core strength
  eyeAsymmetry?: number; // 0-1 displacement/open-sector severity
  structuralState?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Detailed structural regime used by the coupled intensity/eye/rainfall model. */
  structureMode?: TyphoonStructureMode;
  /** 0..1 compactness of the inner-core angular-momentum / eyewall structure. */
  coreCompactness?: number;
  /** 0..1 transient deep-convective burst activity, allowed to temporarily cloud-fill an eye. */
  convectiveBurstIndex?: number;
  /** 0..1 fraction of precipitation/energy organized in broad spiral bands instead of a compact eyewall. */
  rainbandDominance?: number;
  /** 0..1 efficiency of upper-level mass evacuation / anticyclonic outflow. */
  outflowEfficiency?: number;
  /** 0..1 persistent structural scar left by terrain, shear/dry-air ventilation or a failed EWRC. */
  coreRebuildScar?: number;
  /**
   * 0..1 persistent hollow-core memory created only by a severe inner-core mountain crossing.
   * Unlike the ordinary terrain scar, this does not decay automatically over warm water: the old
   * angular-momentum/eyewall ring has been destroyed, so ordinary convection remains annular or
   * displaced around the void. It can be removed only by the explicit manual core-rebuild burst.
   */
  terrainHollowCoreMemory?: number;
  /** Bearing of the terrain sector that produced the persistent hollow-core disruption. */
  terrainHollowCoreBearingDeg?: number;
  damageOrigin?: "none" | "terrain" | "shear_dry" | "ewrc_failure" | "mixed";
  /** Terrain damage appearance: most crossings clog/loosen the eye; only severe established-eye disruptions become hollow. */
  terrainDamageMorphology?: "clogged_loose" | "hollow_bands" | "displaced_core";
  ewrcFailureMode?: "none" | "inner_collapse_outer_stalls" | "outer_ring_fractures" | "double_eyewall_decay";
  /** 0..1 moisture-rich but poorly ventilated broad-vortex regime, common in monsoon/SCS environments. */
  broadMoisturePlatform?: number;
  /** 0..1 interaction of the inner core with a nearby coastline/land surface; 0 is open ocean, 1 is land/core overlap. */
  coastalCoreInfluence?: number;
  /** 0..1 broadening anomaly of the outer circulation. 0 = climatological size, 1 = strongly expanded. */
  circulationExpansion?: number;
  /** Hours of sustained open-ocean energy uptake used for slow outer-wind-field growth. */
  openOceanEnergyHours?: number;
  /** 0..1 precipitable-water/enthalpy reservoir carried with the cyclone. Rapidly depletes inland. */
  moistureReservoir?: number;
  /** 0..1 diagnosed dry-air intrusion in the outer circulation / environment. */
  dryAirIntrusion?: number;
  /** 0..1 fraction of the dry-air anomaly that has actually breached the protected inner core. */
  dryAirCoreExposure?: number;
  /** 0..1 azimuthal fraction of the cyclone envelope wrapped by coherent dry mid-level inflow. */
  dryAirWrapFraction?: number;
  /** 0..1 integrity of the moist rainband/envelope buffer that shields the inner 50-100 km core. */
  moistEnvelopeIntegrity?: number;
  /** 0..1 retained moist entropy in the inner core; falls only after the moist envelope is breached. */
  innerCoreMoisture?: number;
  /** 0..1 fraction of the primary eyewall circumference that has become dynamically open/eroded. */
  eyewallOpenSectorFraction?: number;
  /** 0..1 azimuthal coverage of deep cold convection in the core/CDO rather than just its peak intensity. */
  deepConvectiveCoverage?: number;
  /** 0..1 persistence of the broad low-level vortex after the compact warm core weakens. */
  lowLevelVortexIntegrity?: number;
  /** 0..1 memory of the broad circulation/rainband envelope built near peak intensity. */
  postPeakEnvelopeMemory?: number;
  /** Highest simulated maximum wind reached so far; used only as structural memory, never as a cap. */
  peakVmaxMemory?: number;
  /** Coarse dry-air lifecycle phase for coupled satellite/rainfall morphology. */
  dryAirLifecyclePhase?: "moist_protected" | "outer_wrap" | "eyewall_breach" | "asymmetric_collapse" | "residual_vortex" | "reorganizing";
  /** 0..1 Tang-Emanuel-style proxy for shear-assisted import of low-entropy mid-level air. */
  dryAirVentilationIndex?: number;
  /** 0..1 continuity of the dry environmental tongue from the outer envelope into the eyewall/core. */
  dryAirCoreConnection?: number;
  /** 0..1 active re-moistening / convective isolation of a previously ventilated core over supportive ocean. */
  dryAirReMoistening?: number;
  /** Bearing of the dominant surviving/recovering deep-convective arc, degrees clockwise from north. */
  dryAirConvectiveArcBearingDeg?: number;
  /** 0..1 evaporatively cooled low-entropy pool beneath/just outside a ventilated eyewall; can shift convergence into an inner rainband. */
  eyewallColdPoolMemory?: number;
  /** 0..1 moist-envelope protection surrounding the eyewall; high values can shield a mature core from peripheral dry air. */
  moistCoreProtection?: number;
  /** Accumulated hours of meaningful inner-core dry-air exposure. */
  dryErosionHours?: number;
  /** Hours since inner-core dry-air exposure dropped back to a recovery regime. */
  dryRecoveryHours?: number;
  /** Persistent bearing of the principal dry slot / erosion tongue, degrees clockwise from north. */
  drySlotBearingDeg?: number;
  /** Diameter of the small post-dry-air rebuilding core, normally about 20-50 km. */
  rebuiltCoreDiameterKm?: number;
  /** 0..1 suppression of deep convection by dry air, cold water, shear or westerlies. */
  convectiveSuppression?: number;
  /** 0..1 progressive post-landfall structural breakup / rainfall dispersion. */
  structuralDisorganization?: number;
  /** Equivalent accumulated hours of normalized inner-core surface-friction/orographic work. */
  terrainFrictionWork?: number;
  /** 0..1 slowly varying memory of high/rugged terrain blocking beneath the inner core. */
  terrainBlockingMemory?: number;
  /** 0..1 wavenumber-1 asymmetry in land/sea aerodynamic drag around the inner core. */
  terrainFrictionAsymmetry?: number;
  /** 0..1 sampled fraction of the RMW/inner-core circulation currently over land. */
  terrainCoreLandFraction?: number;
  /** 0..1 sampled fraction of the inner core currently over >=650 m terrain. */
  terrainMountainFraction?: number;
  /** Maximum sampled elevation beneath the current inner-core circulation (m). */
  terrainMaxCoreElevation?: number;
  /** Bearing toward the strongest sampled rough-land/terrain interaction, degrees clockwise from north. */
  terrainInteractionBearingDeg?: number;
  /** Hours spent in the post-20 m/s moist-plain tropical-storm intensity shelf. */
  plainTsShelfHours?: number;
  /** 0..1 memory of low-relief/moist large-vortex support for the ~18 m/s inland shelf. */
  plainTsShelfMemory?: number;
  /** Hours spent in the residual-vortex low-intensity shelf over persistently cold ocean. */
  coldWaterTsShelfHours?: number;
  /** 0..1 memory of broad low-level circulation support while cold-water forcing suppresses deep convection. */
  coldWaterTsShelfMemory?: number;
  /** Diagnosed dense-core/CDO diameter. Open-ocean mature CDOs are usually ~100-150 km; coastal small/broad asymmetric regimes may fall outside that range. */
  cdoDiameterKm?: number;
  /** Hours since a significant cold-water/westerly suppression episode began. */
  coldWaterExposureHours?: number;
  /** Hours of sustained interaction with the mid-latitude westerly/baroclinic zone. */
  westerlyInteractionHours?: number;
  /** 0..1 retained tropical convective/rainfall memory while the cyclone is entering the westerlies. */
  westerlyRainMemory?: number;
  /** 0..1 slowly evolving northeast cloud/rain-tail organization during recurvature/ET interaction. */
  northeastCloudTailStrength?: number;
  /** 0..1 warm-conveyor/frontal cloud shield associated with ET/baroclinic interaction. */
  warmConveyorBeltStrength?: number;
  /** 0..1 degree to which the tropical cloud canopy has been stripped/displaced northeastward by westerlies. */
  northeastCloudStripping?: number;
  /** 0..1 exposed low-level circulation centre under strong shear or weak deep convection. */
  llccExposure?: number;
  /** 0..1 active one-sided rebuilding burst that rotates cyclonically around the centre before wrapping into a core. */
  asymmetricReburstStrength?: number;
  /** Bearing of the rebuilding convective maximum, degrees clockwise from north. */
  asymmetricReburstBearingDeg?: number;
  /** 0..1 persistent failed-EWRC concentric-eyewall standoff memory. */
  ewrcStandoffStrength?: number;
  /** 0..1 memory of an oversized moat/eye after inner-eyewall collapse with a stalled outer eyewall. */
  giantEyeOuterWallMemory?: number;
  /** 0..1 rare localized post-landfall convective resurgence over very moist low terrain. */
  brownOceanBurstIndex?: number;
  /** 0..1 onshore outer-rainband dominance after landfall while the inner core weakens. */
  landfallOuterRainbandIndex?: number;
  /** 0..1 continuity governor preventing unsupported one-hour inner-core radius/diameter collapses or recoveries. */
  coreGeometryContinuity?: number;
  /** NOAA-Dvorak-style satellite intensity number diagnosed from the simulated non-observed Vmax. */
  dvorakTNumber?: number;
  /** 0..1 low-level ocean-to-inland moisture conveyor retained while part of a broad circulation remains over water. */
  marineMoistureLink?: number;
  /** 0..1 strength of direct binary/multi-cyclone interaction (Fujiwhara / vortex interaction). */
  binaryInteractionStrength?: number;
  /** Additional 200-850-hPa-equivalent shear (kt) induced by nearby tropical vortices. */
  binaryInducedShearKt?: number;
  /** Distance to the dominant interacting tropical cyclone (km). */
  binaryPartnerDistanceKm?: number;
  /** Dominant interacting cyclone identifier. */
  binaryPartnerId?: string;
  /** Hours of post-merger structural/shear reorganization remaining. */
  binaryMergerRecoveryHours?: number;
  /** Number of weaker tropical vortices absorbed by this circulation. */
  absorbedCycloneCount?: number;
  /** Hours remaining in the post-dry-air reduced-burst recovery memory. */
  postDryAirBurstSuppressionHours?: number;
  /** True once the near-coast pre-TC squall-line opportunity has been evaluated for this cyclone. */
  preStormSquallEvaluated?: boolean;
  /** Simulation hour when the single pre-TC squall-line episode begins. */
  preStormSquallStartHour?: number;
  /** Active lifetime of the pre-TC squall-line episode, typically about 3-5 h. */
  preStormSquallDurationHours?: number;
  /** Bearing offset to the right of storm motion for the pre-TC squall line. */
  preStormSquallBearingOffsetDeg?: number;
  /** Propagation speed of the squall line itself, km/h. */
  preStormSquallSpeedKmh?: number;
  lastJoyU?: number;
  lastJoyV?: number;
  isManualSteering?: boolean;
  lastVelocityU?: number;
  lastVelocityV?: number;
  forcedDecayStartVmax?: number;
  forcedDecayTargetVmax?: number;
  forcedDecayElapsedHours?: number;
  forcedDecayDuration?: number;
  forcedDecayIsContinuous?: boolean;
  osmLandName?: string;
  landfallRecords?: Array<{ lat: number; lon: number; vmax: number; simHour: number; region: string }>;
  configSnapshot?: SimulationConfig;
  forcedShear?: number;
  forcedEWRC?: "success" | "failure" | "auto";
  /** User-selected outcome lock for the current EWRC episode. While present, automatic diagnostics may adjust intensity/structure but may not reverse success/failure. */
  manualEwrcOutcomeOverride?: "success" | "failure";
  forcedDryAir?: "core" | "periphery";
  /** Scheduled continental cold-air surge strength: 1=weak, 2=moderate, 3=strong. */
  forcedColdAirStrength?: 1 | 2 | 3;
  /** User-selected cold-air arrival time; the coherent strong-wind leading edge reaches the cyclone centre at this same simulated time. */
  forcedColdAirArrivalHour?: number;
  /** Absolute simulation hour when the user scheduled the cold-air event. */
  forcedColdAirScheduledHour?: number;
  /** Hours since the cold-air strong-wind core reached the cyclone centre (negative time is not stored). */
  coldAirExposureHours?: number;
  /** 0..1 cumulative destruction of the tropical warm core by a stage-3 cold-air outbreak. */
  coldAirWarmCoreDamage?: number;
  /** Irreversible latch: once stage-3 cold air fully destroys the warm core, the tropical cyclone collapses into a non-cyclonic remnant low and can never re-intensify. */
  coldAirWarmCoreDestroyed?: boolean;
  /** User-forced cold-water patch temperature in degrees C (0..30). */
  forcedColdWaterTemperatureC?: number;
  /** Absolute simulation hour when the forced cold-water exposure begins. */
  forcedColdWaterStartHour?: number;
  /** Absolute simulation hour when the forced cold-water exposure ends. */
  forcedColdWaterEndHour?: number;
  /** Requested cold-water exposure duration in simulation hours. */
  forcedColdWaterDurationHours?: number;
  /** User-requested gradual cancellation of dry-air/shear/terrain core penalties. */
  penaltyRecoveryActive?: boolean;
  penaltyRecoveryElapsedHours?: number;
  penaltyRecoveryTotalHours?: number;
  penaltyRecoveryDryAir?: boolean;
  penaltyRecoveryShear?: boolean;
  penaltyRecoveryTerrain?: boolean;
  penaltyRecoveryStage?: "purging" | "realigning" | "rebuilding";
  /** True only for the automatic continuous ERI episode supplied by playground mode over water. */
  playgroundAutoERI?: boolean;
  /** User override that pauses playground's automatic ERI retrigger until manually re-enabled or playground mode is exited. */
  playgroundAutoERIPaused?: boolean;
  manualForcedDecay?: {
    startVmax?: number;
    targetVmax: number;
    elapsedHours?: number;
    duration: number;
  };
}

export interface Typhoon {
  /** Historical path geometry cache revision; absent in pre-Round185 archives. */
  historyRevision?: number;
  /** Editable three-hour meteorological history; version 1 accepted for legacy archives only. */
  realisticMotion?:
    | { version: 1; seed: string; strength: 'low' | 'mid' | 'high';
        original: Array<{simHour:number;lat:number;lon:number;speed:number;direction:number}> }
    | { version: 2; seed: string; strength: 'low' | 'mid' | 'high';
        original: Array<{simHour:number;lat:number;lon:number;
          values:Record<string,number>;radii:Record<string,Record<string,number>>}> };
  /** Optional ephemeral issue seed; history remains the authoritative persistent reference. */
  preSimulationReference?: PreSimulationReference;
  /** Round160: cancels earlier forecast pre-simulation guidance from this history hour onward. */
  preSimulationReferenceCleared?: boolean;
  drawnRouteProgressKm?: number;
  id: string;
  name: string;
  /** Public YYNN storm identifier. The YY prefix is regenerated from the simulated genesis year. */
  officialNumber?: string;
  /** 1-based ordinal inside the current simulated typhoon season. */
  seasonOrdinal?: number;
  /** Absolute season simulation hour at genesis. */
  seasonStartHour?: number;
  /** Absolute season simulation hour at dissipation/manual termination. */
  seasonEndHour?: number;
  /** UI-only timeline visibility flag used while inspecting a time before this cyclone existed. */
  timelineHidden?: boolean;
  lat: number;
  lon: number;
  vmax: number;
  /** User-selected genesis intensity; keeps the initial weak vortex from jumping stronger immediately. */
  genesisIntensityReference?: number;
  /** Positive-intensity hold period after genesis, in hours. */
  genesisIntensityHoldHours?: number;
  pmin: number;
  direction: number;
  speed: number;
  rmw: number;
  r7: { ne: number; se: number; sw: number; nw: number };
  r10: { ne: number; se: number; sw: number; nw: number };
  r12: { ne: number; se: number; sw: number; nw: number };
  active: boolean;
  category: TyphoonCategory;
  /** First operational analysis hour at which the user-selected official storm name becomes displayable. */
  officialNamingHour?: number;
  /** Persistent naming latch: once true, later weakening below TS never reverts the public name to TD. */
  hasBeenOfficiallyNamed?: boolean;
  landed: boolean;
  dissipated: boolean;
  extrTransition: number; // 0 - 1
  ewrcState: "none" | "forming" | "max_decay" | "completed" | "recovering_success" | "recovering_failure" | "penalty_failure";
  ewrcProgress: number;
  ewrcDuration?: number;
  ewrcWeakenAmount?: number;
  ewrcColdWakeHours?: number;
  ewrcL12LandHours?: number;
  ewrcStartVmax?: number;
  /** RMW at EWRC onset; used by the time-varying eye/RMW lifecycle. */
  ewrcStartRmw?: number;
  ewrcExtraAdjust?: number;
  ewrcRecoveryDuration?: number;
  ewrcPenaltyTotalHours?: number;
  ewrcFailurePenaltyHours?: number;
  ewrcIsFailure?: boolean;
  rapidIntensifying: boolean;
  forcedRapidIntensification?: boolean;
  rapidIntensificationMode?: "ri" | "eri" | "uri";
  forcedRapidIntensificationMode?: "ri" | "eri" | "uri";
  rapidEpisodeElapsedHours?: number;
  rapidEpisodeDurationHours?: number;
  rapidEpisodeTarget24h?: number; // equivalent CMA-style m/s gain over 24 h
  rapidEpisodeStartRate?: number; // m/s per hour at episode onset, for smooth blending
  rapidEpisodeLastRate?: number;
  rapidEpisodeExitHours?: number;
  rapidEpisodeExitDuration?: number;
  rapidEpisodeAbortRequested?: boolean;
  rapidFavorableHours?: number; // continuously favorable hours before natural RI becomes eligible
  rapidTriggerCooldownHours?: number; // suppress immediate/repeated natural RI retriggers
  intensityRateMemory?: number; // smoothed intensity tendency used to avoid linear ramps
  intensityChange6h?: number;
  intensityChange24h?: number;
  isEyeClogged?: boolean;
  cloggedRecoveryHours?: number;
  cloggedRecoveryTotalHours?: number;
  dryAirPenaltyHours?: number;
  dryAirPenaltyTotalHours?: number;
  shearPenaltyHours?: number;
  shearPenaltyTotalHours?: number;
  history: TyphoonState[];
  forecastPath?: Array<{ lat: number; lon: number; vmax: number; pmin: number;
  simHour: number; category: TyphoonCategory; speed: number; intensityDeferred?: boolean; previewOnly?: boolean; landed?: boolean; remnantVortex?: boolean; lowLevelVortexIntegrity?: number; warmWaterHoursAfterSea?: number }>;
  maxR7Limit?: number; // maximum r7 limit in km
  upwellingHours?: number; // accumulated slow/spinning hours
  tdHours?: number;
  landTdHours?: number;
  superTyLandHours?: number;
  landHours?: number;
  landContactHours?: number;
  r10LandContactHours?: number;
  vmax6Hours?: number; // accumulated hours at wind force <= 6
  etHours?: number;
  casualties?: number;
  /** Dynamic societal preparedness accumulated from forecast warning lead (0..1). */
  preparednessIndex?: number;
  /** Short-lived surprise from unexpected track/speed changes or an unforecast landfall threat (0..1). */
  forecastSurpriseIndex?: number;
  /** Current forecast lead to the next meaningful landfall threat, if diagnosed. */
  warningLeadHours?: number;
  simHour?: number;
  stationReadings?: StationReading[];
  highElevationHours?: number;
  landfallElevation?: number;
  isCoreDisrupted?: boolean;
  passedTaiwanCentral?: boolean;
  passedLuzonMountains?: boolean;
  exitLandSimHour?: number;
  maxLandElevationPassed?: number;
  structuralDamageHours?: number;
  warmWaterHoursAfterSea?: number;
  isStructureDamaged?: boolean;
  structuralDamagePenaltyFactor?: number;
  upwellingLogged?: boolean;
  ewrcCooldownHours?: number;
  ewrcCount?: number;
  /** Number of completed successful eyewall replacement cycles. */
  successfulEwrcCount?: number;
  /** Current environment/lifecycle-adjusted target used when autoAdjustIntensity is enabled. */
  autoIntensityTarget?: number;
  /** Accumulated hours above 65 m/s; used to make extreme intensity hard to sustain outside exceptional environments. */
  extremeIntensityHours?: number;
  consecutiveUpwellingHours?: number;
  upwellingPersistentPenaltyHours?: number;
  shear?: number;
  shearDir?: number;
  upwellingIntensity?: number;
  eyeType?: "none" | "small_round" | "large_round" | "irregular" | "gap" | "eccentric" | "broken";
  eyePhase?: "none" | "forming" | "opening" | "clear" | "clouding" | "blocked" | "replacement_inner" | "replacement_double" | "replacement_new" | "ragged";
  eyeRadiusKm?: number;
  eyeClearance?: number;
  eyeBrightnessTempC?: number;
  eyeObstruction?: number;
  eyewallIntegrity?: number;
  /** 0..1 fraction of the inner rainband/eyewall that has wrapped into a closed ring. */
  eyewallWrapProgress?: number;
  /** 0..1 persistence memory required before a satellite-visible eye may open. */
  eyeFormationMemory?: number;
  secondaryEyewallStrength?: number;
  eyeWarmCore?: number;
  eyeAsymmetry?: number;
  structuralState?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Detailed structural regime used by the coupled intensity/eye/rainfall model. */
  structureMode?: TyphoonStructureMode;
  /** 0..1 compactness of the inner-core angular-momentum / eyewall structure. */
  coreCompactness?: number;
  /** 0..1 transient deep-convective burst activity, allowed to temporarily cloud-fill an eye. */
  convectiveBurstIndex?: number;
  /** 0..1 fraction of precipitation/energy organized in broad spiral bands instead of a compact eyewall. */
  rainbandDominance?: number;
  /** 0..1 efficiency of upper-level mass evacuation / anticyclonic outflow. */
  outflowEfficiency?: number;
  /** 0..1 persistent structural scar left by terrain, shear/dry-air ventilation or a failed EWRC. */
  coreRebuildScar?: number;
  /** 0..1 persistent severe mountain-crossing hollow-core memory; automatic warm-water recovery cannot erase it. */
  terrainHollowCoreMemory?: number;
  /** Bearing of the terrain sector that produced the persistent hollow-core disruption. */
  terrainHollowCoreBearingDeg?: number;
  damageOrigin?: "none" | "terrain" | "shear_dry" | "ewrc_failure" | "mixed";
  /** Terrain damage appearance: most crossings clog/loosen the eye; only severe established-eye disruptions become hollow. */
  terrainDamageMorphology?: "clogged_loose" | "hollow_bands" | "displaced_core";
  ewrcFailureMode?: "none" | "inner_collapse_outer_stalls" | "outer_ring_fractures" | "double_eyewall_decay";
  /** 0..1 moisture-rich but poorly ventilated broad-vortex regime, common in monsoon/SCS environments. */
  broadMoisturePlatform?: number;
  /** 0..1 interaction of the inner core with a nearby coastline/land surface; 0 is open ocean, 1 is land/core overlap. */
  coastalCoreInfluence?: number;
  /** 0..1 broadening anomaly of the outer circulation. 0 = climatological size, 1 = strongly expanded. */
  circulationExpansion?: number;
  /** Hours of sustained open-ocean energy uptake used for slow outer-wind-field growth. */
  openOceanEnergyHours?: number;
  /** 0..1 precipitable-water/enthalpy reservoir carried with the cyclone. Rapidly depletes inland. */
  moistureReservoir?: number;
  /** 0..1 diagnosed dry-air intrusion in the outer circulation / environment. */
  dryAirIntrusion?: number;
  /** 0..1 fraction of the dry-air anomaly that has actually breached the protected inner core. */
  dryAirCoreExposure?: number;
  /** 0..1 azimuthal fraction of the cyclone envelope wrapped by coherent dry mid-level inflow. */
  dryAirWrapFraction?: number;
  /** 0..1 integrity of the moist rainband/envelope buffer that shields the inner 50-100 km core. */
  moistEnvelopeIntegrity?: number;
  /** 0..1 retained moist entropy in the inner core; falls only after the moist envelope is breached. */
  innerCoreMoisture?: number;
  /** 0..1 fraction of the primary eyewall circumference that has become dynamically open/eroded. */
  eyewallOpenSectorFraction?: number;
  /** 0..1 azimuthal coverage of deep cold convection in the core/CDO rather than just its peak intensity. */
  deepConvectiveCoverage?: number;
  /** 0..1 persistence of the broad low-level vortex after the compact warm core weakens. */
  lowLevelVortexIntegrity?: number;
  /** 0..1 memory of the broad circulation/rainband envelope built near peak intensity. */
  postPeakEnvelopeMemory?: number;
  /** Highest simulated maximum wind reached so far; used only as structural memory, never as a cap. */
  peakVmaxMemory?: number;
  /** Coarse dry-air lifecycle phase for coupled satellite/rainfall morphology. */
  dryAirLifecyclePhase?: "moist_protected" | "outer_wrap" | "eyewall_breach" | "asymmetric_collapse" | "residual_vortex" | "reorganizing";
  /** 0..1 Tang-Emanuel-style proxy for shear-assisted import of low-entropy mid-level air. */
  dryAirVentilationIndex?: number;
  /** 0..1 continuity of the dry environmental tongue from the outer envelope into the eyewall/core. */
  dryAirCoreConnection?: number;
  /** 0..1 active re-moistening / convective isolation of a previously ventilated core over supportive ocean. */
  dryAirReMoistening?: number;
  /** Bearing of the dominant surviving/recovering deep-convective arc, degrees clockwise from north. */
  dryAirConvectiveArcBearingDeg?: number;
  /** 0..1 evaporatively cooled low-entropy pool beneath/just outside a ventilated eyewall; can shift convergence into an inner rainband. */
  eyewallColdPoolMemory?: number;
  /** 0..1 moist-envelope protection surrounding the eyewall; high values can shield a mature core from peripheral dry air. */
  moistCoreProtection?: number;
  /** Accumulated hours of meaningful inner-core dry-air exposure. */
  dryErosionHours?: number;
  /** Hours since inner-core dry-air exposure dropped back to a recovery regime. */
  dryRecoveryHours?: number;
  /** Persistent bearing of the principal dry slot / erosion tongue, degrees clockwise from north. */
  drySlotBearingDeg?: number;
  /** Diameter of the small post-dry-air rebuilding core, normally about 20-50 km. */
  rebuiltCoreDiameterKm?: number;
  /** 0..1 suppression of deep convection by dry air, cold water, shear or westerlies. */
  convectiveSuppression?: number;
  /** 0..1 progressive post-landfall structural breakup / rainfall dispersion. */
  structuralDisorganization?: number;
  /** Equivalent accumulated hours of normalized inner-core surface-friction/orographic work. */
  terrainFrictionWork?: number;
  /** 0..1 slowly varying memory of high/rugged terrain blocking beneath the inner core. */
  terrainBlockingMemory?: number;
  /** 0..1 wavenumber-1 asymmetry in land/sea aerodynamic drag around the inner core. */
  terrainFrictionAsymmetry?: number;
  /** 0..1 sampled fraction of the RMW/inner-core circulation currently over land. */
  terrainCoreLandFraction?: number;
  /** 0..1 sampled fraction of the inner core currently over >=650 m terrain. */
  terrainMountainFraction?: number;
  /** Maximum sampled elevation beneath the current inner-core circulation (m). */
  terrainMaxCoreElevation?: number;
  /** Bearing toward the strongest sampled rough-land/terrain interaction, degrees clockwise from north. */
  terrainInteractionBearingDeg?: number;
  /** Hours spent in the post-20 m/s moist-plain tropical-storm intensity shelf. */
  plainTsShelfHours?: number;
  /** 0..1 memory of low-relief/moist large-vortex support for the ~18 m/s inland shelf. */
  plainTsShelfMemory?: number;
  /** Hours spent in the residual-vortex low-intensity shelf over persistently cold ocean. */
  coldWaterTsShelfHours?: number;
  /** 0..1 memory of broad low-level circulation support while cold-water forcing suppresses deep convection. */
  coldWaterTsShelfMemory?: number;
  /** Diagnosed dense-core/CDO diameter. Open-ocean mature CDOs are usually ~100-150 km; coastal small/broad asymmetric regimes may fall outside that range. */
  cdoDiameterKm?: number;
  /** Hours since a significant cold-water/westerly suppression episode began. */
  coldWaterExposureHours?: number;
  /** Hours of sustained interaction with the mid-latitude westerly/baroclinic zone. */
  westerlyInteractionHours?: number;
  /** 0..1 retained tropical convective/rainfall memory while the cyclone is entering the westerlies. */
  westerlyRainMemory?: number;
  /** 0..1 slowly evolving northeast cloud/rain-tail organization during recurvature/ET interaction. */
  northeastCloudTailStrength?: number;
  /** 0..1 warm-conveyor/frontal cloud shield associated with ET/baroclinic interaction. */
  warmConveyorBeltStrength?: number;
  /** 0..1 degree to which the tropical cloud canopy has been stripped/displaced northeastward by westerlies. */
  northeastCloudStripping?: number;
  /** 0..1 exposed low-level circulation centre under strong shear or weak deep convection. */
  llccExposure?: number;
  /** 0..1 active one-sided rebuilding burst that rotates cyclonically around the centre before wrapping into a core. */
  asymmetricReburstStrength?: number;
  /** Bearing of the rebuilding convective maximum, degrees clockwise from north. */
  asymmetricReburstBearingDeg?: number;
  /** 0..1 persistent failed-EWRC concentric-eyewall standoff memory. */
  ewrcStandoffStrength?: number;
  /** 0..1 memory of an oversized moat/eye after inner-eyewall collapse with a stalled outer eyewall. */
  giantEyeOuterWallMemory?: number;
  /** 0..1 rare localized post-landfall convective resurgence over very moist low terrain. */
  brownOceanBurstIndex?: number;
  /** 0..1 onshore outer-rainband dominance after landfall while the inner core weakens. */
  landfallOuterRainbandIndex?: number;
  /** 0..1 continuity governor preventing unsupported one-hour inner-core radius/diameter collapses or recoveries. */
  coreGeometryContinuity?: number;
  /** NOAA-Dvorak-style satellite intensity number diagnosed from the simulated non-observed Vmax. */
  dvorakTNumber?: number;
  /** 0..1 low-level ocean-to-inland moisture conveyor retained while part of a broad circulation remains over water. */
  marineMoistureLink?: number;
  /** 0..1 strength of direct binary/multi-cyclone interaction (Fujiwhara / vortex interaction). */
  binaryInteractionStrength?: number;
  /** Additional 200-850-hPa-equivalent shear (kt) induced by nearby tropical vortices. */
  binaryInducedShearKt?: number;
  /** Distance to the dominant interacting tropical cyclone (km). */
  binaryPartnerDistanceKm?: number;
  /** Dominant interacting cyclone identifier. */
  binaryPartnerId?: string;
  /** Hours of post-merger structural/shear reorganization remaining. */
  binaryMergerRecoveryHours?: number;
  /** Number of weaker tropical vortices absorbed by this circulation. */
  absorbedCycloneCount?: number;
  /** Hours remaining in the post-dry-air reduced-burst recovery memory. */
  postDryAirBurstSuppressionHours?: number;
  /** True once the near-coast pre-TC squall-line opportunity has been evaluated for this cyclone. */
  preStormSquallEvaluated?: boolean;
  /** Simulation hour when the single pre-TC squall-line episode begins. */
  preStormSquallStartHour?: number;
  /** Active lifetime of the pre-TC squall-line episode, typically about 3-5 h. */
  preStormSquallDurationHours?: number;
  /** Bearing offset to the right of storm motion for the pre-TC squall line. */
  preStormSquallBearingOffsetDeg?: number;
  /** Propagation speed of the squall line itself, km/h. */
  preStormSquallSpeedKmh?: number;
  lastJoyU?: number;
  lastJoyV?: number;
  isManualSteering?: boolean;
  lastVelocityU?: number;
  lastVelocityV?: number;
  forcedDecayStartVmax?: number;
  forcedDecayTargetVmax?: number;
  forcedDecayElapsedHours?: number;
  forcedDecayDuration?: number;
  forcedDecayIsContinuous?: boolean;
  osmLandName?: string;
  landfallRecords?: Array<{ lat: number; lon: number; vmax: number; simHour: number; region: string }>;
  configSnapshot?: SimulationConfig;
  forcedShear?: number;
  forcedEWRC?: "success" | "failure" | "auto";
  /** User-selected outcome lock for the current EWRC episode. While present, automatic diagnostics may adjust intensity/structure but may not reverse success/failure. */
  manualEwrcOutcomeOverride?: "success" | "failure";
  forcedDryAir?: "core" | "periphery";
  /** Scheduled continental cold-air surge strength: 1=weak, 2=moderate, 3=strong. */
  forcedColdAirStrength?: 1 | 2 | 3;
  /** User-selected cold-air arrival time; the coherent strong-wind leading edge reaches the cyclone centre at this same simulated time. */
  forcedColdAirArrivalHour?: number;
  /** Absolute simulation hour when the user scheduled the cold-air event. */
  forcedColdAirScheduledHour?: number;
  /** Hours since the cold-air strong-wind core reached the cyclone centre (negative time is not stored). */
  coldAirExposureHours?: number;
  /** 0..1 cumulative destruction of the tropical warm core by a stage-3 cold-air outbreak. */
  coldAirWarmCoreDamage?: number;
  /** Irreversible latch: once stage-3 cold air fully destroys the warm core, the tropical cyclone collapses into a non-cyclonic remnant low and can never re-intensify. */
  coldAirWarmCoreDestroyed?: boolean;
  /** User-forced cold-water patch temperature in degrees C (0..30). */
  forcedColdWaterTemperatureC?: number;
  /** Absolute simulation hour when the forced cold-water exposure begins. */
  forcedColdWaterStartHour?: number;
  /** Absolute simulation hour when the forced cold-water exposure ends. */
  forcedColdWaterEndHour?: number;
  /** Requested cold-water exposure duration in simulation hours. */
  forcedColdWaterDurationHours?: number;
  /** User-requested gradual cancellation of dry-air/shear/terrain core penalties. */
  penaltyRecoveryActive?: boolean;
  penaltyRecoveryElapsedHours?: number;
  penaltyRecoveryTotalHours?: number;
  penaltyRecoveryDryAir?: boolean;
  penaltyRecoveryShear?: boolean;
  penaltyRecoveryTerrain?: boolean;
  penaltyRecoveryStage?: "purging" | "realigning" | "rebuilding";
  /** True only for the automatic continuous ERI episode supplied by playground mode over water. */
  playgroundAutoERI?: boolean;
  /** User override that pauses playground's automatic ERI retrigger until manually re-enabled or playground mode is exited. */
  playgroundAutoERIPaused?: boolean;
  manualForcedDecay?: {
    startVmax?: number;
    targetVmax: number;
    elapsedHours?: number;
    duration: number;
  };
}

export interface ForecastFrameworkPoint {
  lat: number;
  lon: number;
}

export interface ForecastIntensityControlPoint {
  /** Forecast lead time in hours from the issue time. */
  leadHour: number;
  /** User-authored target maximum sustained wind, m/s. */
  vmax: number;
}

export interface ManualDryAirRegion {
  id: string;
  points: ForecastFrameworkPoint[];
  intensity: number;
  softness?: number;
  label?: string;
}

export interface ManualShearRegion {
  id: string;
  points: ForecastFrameworkPoint[];
  /** Target vertical wind shear inside the hand-drawn region, in kt. */
  shearKt: number;
  softness?: number;
  label?: string;
}

export interface SimulationConfig {
  /** Deprecated archive-only flag (R186/R187); ignored by simulation in R188. */
  realisticMotionEnabled?: boolean;
  /** 3.7.8 debug gate: exposes the independent synoptic atmosphere/ocean preset panels. */
  newEnvironmentPanelsEnabled?: boolean;
  /** 3.7.8: use the new synoptic atmosphere/ocean fields for TC thermodynamics and forecast guidance. */
  newEnvironmentPhysicsEnabled?: boolean;
  /** New 120 h synoptic atmosphere preset identifier. */
  newAtmosPreset?: string;
  /** New 120 h atmosphere clock offset relative to simulation time, in hours. */
  newAtmosTimeOffsetHours?: number;
  /** Advance the new atmosphere clock with simulation time. */
  newAtmosTimeFlowEnabled?: boolean;
  /** Simulation-hour anchor captured when the new atmosphere clock is frozen. */
  newAtmosFrozenBaseHour?: number;
  /** Multiplicative amplitude applied to synoptic anomalies while preserving the climatological base. */
  newAtmosAnomalyScale?: number;
  /** Multiplicative factor for new-environment forecast steering only. */
  newAtmosSteeringScale?: number;
  /** Multiplicative factor for diagnosed new-environment vertical shear. */
  newAtmosShearScale?: number;
  /** Additive 700-hPa RH bias in percentage points. */
  newAtmosHumidityBias?: number;
  /** New 120 h ocean preset identifier. */
  newOceanPreset?: string;
  /** New ocean clock offset relative to simulation time, in hours. */
  newOceanTimeOffsetHours?: number;
  /** Advance the new ocean clock with simulation time. */
  newOceanTimeFlowEnabled?: boolean;
  /** Simulation-hour anchor captured when the new ocean clock is frozen. */
  newOceanFrozenBaseHour?: number;
  /** Additive SST bias in degrees C for the new ocean database. */
  newOceanSstBias?: number;
  /** Multiplicative factor for new-ocean OHC. */
  newOceanOhcScale?: number;
  /** Mesoscale warm/cold feature amplitude multiplier. */
  newOceanMesoscaleScale?: number;
  agencyStyle?: "CMA" | "JMA";
  intensityAgency?: "CMA" | "JMA" | "JTWC";
  intensityReportingMode?: "public" | "continuous";
  trackStyle?: "CMA" | "JMA";
  trackDotStyle?: "CMA" | "JMA";
  windRadiiStyle?: "CMA" | "JMA";
  centerStyle?: "CMA" | "JMA";
  mechanismStyle?: "CMA" | "JMA";
  subtropicalHighEnabled: boolean;
  subtropicalHighStrength: number; // 0% - 200% (0 - 2)
  subtropicalHighLat: number; // 18 - 45
  subtropicalHighLon: number; // 120 - 150
  subtropicalHighWestExtent: number; // 110 - 140
  subtropicalHighNSSize?: number; // 0.5 - 2.0 (North-South size multiplier)
  subtropicalHighEWSize?: number; // 0.5 - 2.0 (East-West size multiplier, independent of ridge-point longitude)
  westerliesEnabled: boolean;
  westerliesStrength: number; // 0% - 200% (0 - 2)
  westerliesLat: number; // 28 - 45
  westerliesTroughLon: number; // 110 - 140
  westerliesTroughDepth: number; // 0 - 2
  betaDriftEnabled: boolean;
  betaDriftScale: number; // 0 - 2
  monsoonTroughEnabled: boolean;
  eastWaveEnabled: boolean;
  shearPreset?: string; // 'global_low', 'january', 'february', ..., 'december'
  shearScale: number; // 0 - 2
  shear?: number;
  dryAirStrength?: number;
  sstBase?: number;
  sstPivotLat?: number;
  humidityScale: number; // 0 - 2
  outflowScale: number; // 0 - 2
  dryAirEnabled: boolean;
  randomNoise: number; // 0 - 1
  sstAnomaly: number; //
  sstNorthSouthGradient?: number; // 0% - 100% (0 - 1.0)
  ohcScale: number; // 0 - 2
  warmPoolEnabled: boolean;
  coldEddyEnabled: boolean;
  airSeaCoupling: number; // 0 - 1
  ewrcTrigger: "auto" | "off" | "force";
  rapidIntensifyEnabled: boolean;
  landDecayEnabled: boolean;
  terrainDecayEnabled: boolean;
  categoryColors?: Record<string, string>;
  landfallDecayAdjustment: number;
  landProximityDecayAdjustment: number;
  landTdDissipateMode?: "6h" | "never";
  nonLandDissipateMode?: "normal" | "manual";
  etEnabled: boolean;
  seed: string;
  joystickSensitivity: number;
  joystickStrength: number;
  joystickDx: number; // joystick current horizontal offset -1 to 1
  joystickDy: number; // joystick current vertical offset -1 to 1
  joystickDragging?: boolean;
  /** Desktop input choice, persisted across seasons. */
  controlMode?: "joystick" | "draw";
  drawnTrackRoute?: ForecastFrameworkPoint[];
  drawnTrackSpeedKmh?: number;
  /** Whether the on-screen joystick handle springs back to neutral when released. Defaults to false. */
  joystickReturnToCenter?: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  soundMode?: "mahjong" | "mouse";
  cityDensity?: number; // 0 to 100
  followMainTyphoon: boolean;
  maxIntensityLimitEnabled?: boolean;
  maxIntensityLimit?: number; // m/s; exact target when autoAdjustIntensity=false, lifetime peak target when true
  autoAdjustIntensity?: boolean; // when enabled, derive a time-varying attainable target from environment/EWRC lifecycle
  circulationSizeReferenceKm?: number; // soft reference: force-7 mean radius at 62 m/s (0 km or greater; no hard upper limit)
  /** Optional transition duration for a newly requested circulation-size reference. 0 = immediate. */
  circulationSizeTransitionHours?: number;
  /** Simulation hour at which the current circulation-size transition began. */
  circulationSizeTransitionStartHour?: number;
  /** Effective reference at the beginning of the current transition. */
  circulationSizeTransitionFromKm?: number;
  /** Requested final circulation-size reference for the current transition. */
  circulationSizeTransitionTargetKm?: number;
  /** Forecast-only soft lifetime peak reference. It never hard-caps the live cyclone. */
  forecastPeakIntensityEnabled?: boolean;
  forecastPeakIntensityReference?: number; // m/s; soft deterministic forecast aspiration
  manualForecastRouteEnabled?: boolean;
  manualForecastRoute?: ForecastFrameworkPoint[];
  /** Enable the hand-edited forecast intensity curve attached to the manual forecast framework. */
  manualForecastIntensityEnabled?: boolean;
  /** Dense 3-hour target curve (m/s) created by the forecast intensity editor. */
  manualForecastIntensityCurve?: ForecastIntensityControlPoint[];
  manualDryAirRegions?: ManualDryAirRegion[];
  manualDryAirDrawIntensity?: number; // 0 - 1
  manualShearRegions?: ManualShearRegion[];
  manualShearDrawKt?: number; // kt
  /** Optional heading blend for the user-drawn forecast framework. Missing values default to a strong 0.92 reference pull; freshly drawn large-scale routes use at least 0.97. */
  manualForecastRouteWeight?: number; // 0 - 0.992
  intensificationRate?: number; // 0 - 2
  upwellingFactor?: number; // -1 to 1 or -50 to 50
  stationLabels?: boolean;
  capsuleSize?: number;
  showTopBar?: boolean;
  /** Device UI mode. auto prefers the old mobile-oriented UI skin on narrow / coarse-pointer devices. */
  mobileUiMode?: "auto" | "legacy" | "desktop";
  coastlineSource?: string;
  steeringBiasU?: number;
  steeringBiasV?: number;
  speed?: number;
  /** Keep multiple completed cyclones in one continuous simulated season. */
  seasonModeEnabled?: boolean;
  /** Historic completed-track rendering mode. */
  historicalTrackDisplay?: "hidden" | "visible" | "translucent";
  /** Draw operational analysis dots on completed historic cyclone tracks. */
  historicalTrackDots?: boolean;
  /** First/next index in the 140-name ESCAP/WMO naming table. */
  typhoonNamingStartIndex?: number;
  typhoonNamingCursor?: number;
  /** User-edited labels for naming-table slots. */
  typhoonNamingOverrides?: Record<string, string>;
  /** User-selected location used by the lightweight desktop simulation advisory. */
  localAdvisoryLat?: number;
  localAdvisoryLon?: number;
  localAdvisoryLabel?: string;
}

export interface ActiveLayers {
  newSubtropicalHigh?: boolean;
  newMonsoonTrough?: boolean;
  newMonsoonLow?: boolean;
  newItcz?: boolean;
  newWesterlyJet?: boolean;
  newWesterlyTrough?: boolean;
  newWesterlyRidge?: boolean;
  newCutoffLow?: boolean;
  newUpperColdLow?: boolean;
  newTropicalHigh?: boolean;
  newContinentalHigh?: boolean;
  newLowLatEasterlies?: boolean;
  newMidLatWesterlies?: boolean;
  newCrossEquatorialFlow?: boolean;
  newMonsoonFlow?: boolean;
  newMeanFlow?: boolean;
  newBetaEffect?: boolean;
  newDryAir?: boolean;
  newWindShear?: boolean;
  newSstDetailed?: boolean;
  newOhcDetailed?: boolean;
  baseMap: "dark" | "jma" | "blackGray" | "himawari" | "stormTerrain" | "satellite" | "terrain" | "light" | "googleSatellite" | "googleStreet" | "blueMarble" | "bingSatellite" | "none";
  border: boolean;
  coastline: boolean;
  sst: boolean;
  ohc: boolean;
  windShear?: boolean;
  shear?: boolean;
  strongDryAir?: boolean;
  strongWindShear?: boolean;
  pressure: boolean;
  height500: boolean;
  subHigh: boolean;
  westerlies: boolean;
  wind850: boolean;
  wind500: boolean;
  wind200: boolean;
  steering: boolean;
  track: boolean;
  windRadii: boolean;
  forecast: boolean;
  forecastCone: boolean;
  /** Persistently display the confirmed user-drawn large-scale forecast framework. */
  drawnForecastRoute?: boolean;
  /** Hurricane Tracker-style pseudo multi-model tracks (ICON/GFS/EURO/HMNI parameter families). */
  hurricaneTrackerModels?: boolean;
  /** Hurricane Tracker Storm shader display branch. */
  maxWindSpeedAccumulated?: boolean;
  weatherStations?: boolean;
  capsuleSize?: number;
  stationLabels?: boolean;
  cursor?: boolean;
  showTopBar?: boolean;
  showCenterPoint?: boolean;
  showNews?: boolean;
  rasterResolution: number;
}

export interface EventLog {
  id: string;
  time: Date;
  simHour: number;
  type: "info" | "success" | "warning" | "danger";
  message: string;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "danger";
}

