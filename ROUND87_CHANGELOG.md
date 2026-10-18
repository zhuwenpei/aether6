# ROUND87 CHANGELOG — AETHER 6.0.10

## Version
- `6.0.9` → `6.0.10`

## 1. Replaced geographic environmental-wind presets with one global, system-aware ocean model
- Removed `src/simulation/SynopticEnvironmentWindPreset.ts` entirely.
- Added `src/simulation/SynopticEnvironmentalWindModel.ts`.
- Ocean environmental wind is no longer selected by hard East China Sea / South China Sea / Philippine Sea boxes.
- The global marine target is now constrained to **4–35 kt** outside tropical-cyclone circulation.
- Ordinary marine flow is designed to occupy the majority of the field at **10–16 kt**.
- The **16–35 kt** tail comes from diagnosed/adjustable westerlies, monsoon corridors, cross-equatorial flow and other genuinely active large-scale flow.
- The **4–10 kt** tail is restricted to sufficiently deep low-wind/trough slots under weak organized flow.
- A post-boundary-layer 4 kt floor and far-from-TC 35 kt environmental ceiling prevent the fluid solve from recreating huge dead zones or unrealistically fast environmental flow.

## 2. User-adjustable synoptic systems now visibly drive the wind/pressure product
- Added `src/simulation/SynopticConfiguredSystems.ts` and wired it into `SynopticWindField.ts`.
- Subtropical-high controls create a smooth NH clockwise anticyclonic surface circulation and positive MSLP anomaly.
- Westerly controls create a meandering west-to-east belt with trough/ridge pressure-wave structure.
- Monsoon controls create a seasonally migrating low-level monsoon/convergence band instead of a fixed latitude strip.
- `SynopticEnvironment.ts` base monsoon trough also receives a seasonal latitude shift keyed to the selected month/shear preset, so the underlying synoptic environment and the configured-system layer move consistently.
- Legacy steering-level monsoon flow in `Engine.ts` was also changed from a fixed `<16°N` rule to a seasonally migrating axis.

## 3. Westerly interaction / deformation and gradual ET representation
- `TropicalCycloneVortex.ts` now accepts a diagnosed westerly-strength signal from the wind-field environment.
- Entering strong westerlies adds baroclinic/elliptical/comma-like deformation to the product field.
- Weak/decaying cyclones deform more strongly; intense warm-core cyclones retain greater axisymmetry.
- The existing finite-time `extrTransition` lifecycle in `Engine.ts` remains authoritative for gradual conversion into an extratropical cyclone; the new westerly deformation is a continuous structural response rather than an instant category switch.

## 4. Coastline-outline strong-wind / video pulsing fix
Several remaining causes were addressed together:
- First land cells no longer retain 100% marine roughness. Surface drag begins immediately at the shoreline at a modest strength and ramps inward continuously.
- Terrain pressure/slope forcing still remains suppressed at the first shoreline cells, so a sea-to-land height jump cannot act like a mountain wall.
- Solver slope forcing is explicitly multiplied by the land-interior weight; raw ETOPO coastline slopes no longer enter the solver directly.
- Immediate offshore terrain-wake forcing is almost completely removed and is zeroed at the coastline band.
- Time-dependent turbulence/noise is suppressed at the coastline band.
- The deterministic multi-scale noise field now interpolates in **time** as well as space. Previously `floor(hour / timestep)` replaced the whole random field every 1.5/3/6 h, which produced the visible pulse/on-off behavior in videos.
- A narrow vector continuity filter remains bounded by neighboring source wind speeds, so it cannot create a new coastal maximum.

## 5. Landfall circulation expansion fix
- Removed the previous large landfall pressure-core broadening in `TropicalCycloneVortex.ts` (`>=1.45x RMW / >=48 km`).
- Landfall pressure RMW is now kept close to the existing dynamical RMW and damage is only allowed a very small extra broadening.
- In `Engine.ts`, meaningful landfall is no longer allowed to increase `circulationExpansion`; the pre-landfall envelope may persist briefly but its size anomaly can only hold/contract while the center is over substantial land.
- Small operationally ignored islands remain exempt from this basin-scale landfall contraction logic.
- Wind-field Vmax calibration remains tighter on land than over sea.

## 6. 72 h / long wind-circle transition no longer jumps or stair-steps
Two independent issues were fixed:
- **UI order bug:** if the user changed the size while the duration selector was still “immediate”, then selected 72 h afterward, the old code had already consumed the target. The app now retains the pre-edit origin and converts that edit into a true timed transition when a duration is selected.
- **3-hour staircase bug:** a user-requested timed size transition now recalculates wind radii on every fixed physics step while active. Normal operational wind-radii publication still follows the 3-hour clock when no manual timed transition is active.
- Timeline/history snapshot isolation from ROUND83 remains intact.

## 7. Pressure sanity guard
- Current/forecast product pressure and model-update pressure are clamped to a physically bounded range before reuse.
- This prevents a corrupted/archive value such as the observed `Min_MSLP: -1821 hPa` from feeding back through the wind/pressure product.

## Self-test results
All of the following passed:
- `node scripts/synoptic_wind_pressure_regression.cjs`
- `node scripts/round85_synoptic_wind_regression.cjs`
- `node scripts/round86_circulation_radii_reference_regression.cjs`
- `node scripts/round87_global_environment_coast_landfall_transition_regression.cjs`
- `node scripts/circulation_size_transition_regression.cjs`
- `node scripts/user_wind_radii_live_fix_regression.cjs`
- `node scripts/radar_product_removal_regression.cjs`
- TypeScript syntax/transpile check on all modified TS/TSX modules: PASS

### Representative July no-TC environmental target-field averages
These are diagnostic spatial averages of the **background 10 m environmental target field**, not hard regional presets and not including a tropical cyclone vortex:

| Diagnostic sample area | Mean | P10 | Median | P90 | Min | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Western North Pacific | 15.50 kt | 11.67 | 12.26 | 28.64 | 10.35 | 29.35 |
| Philippine Sea | 16.04 kt | 11.92 | 12.40 | 28.72 | 10.35 | 29.20 |
| East China Sea | 11.72 kt | 11.04 | 11.78 | 12.32 | 10.66 | 12.71 |
| South China Sea | 14.30 kt | 11.98 | 12.35 | 20.83 | 11.24 | 29.14 |
| Subtropical NW Pacific | 14.95 kt | 11.57 | 12.24 | 28.23 | 10.99 | 29.35 |
| Westerly belt | 24.98 kt | 12.06 | 28.81 | 33.73 | 10.84 | 34.48 |

Across the tropical/subtropical diagnostic ocean sample in this test case:
- **4–10 kt:** 0.1%
- **10–16 kt:** 88.8%
- **16–35 kt:** 11.1%

The low-wind tail is intentionally episodic. A dedicated deep-trough case produces ~4.25 kt, while organized monsoon and westerly test cases reach ~29.3 kt and ~33.5 kt respectively.

Additional numerical checks:
- Seasonal monsoon axis at 130°E: **January ~7.75°N**, **July ~15.25°N**.
- Westerly deformation anisotropy: weak TC **1.577**, strong TC **1.303**, confirming weaker systems deform more readily.
