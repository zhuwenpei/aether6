# ROUND82 CHANGELOG

## Version
- Bump package version from `6.0.4` / base archive `6.0.0` to `6.0.5`.

## 1. Ocean environmental-wind coverage repaired
- Removed the earlier idea of globally multiplying environmental wind.
- Reworked the synoptic product background-wind calibration in `src/simulation/SynopticWindField.ts` so the field now restores **missing effective environmental flow** rather than indiscriminately amplifying all winds.
- Added basin-aware background targets:
  - open ocean / western Pacific baseline kept near **13–17 kt**,
  - East China Sea near **10–15 kt**,
  - South China Sea near **5–10 kt** outside monsoon surges,
  - SCS monsoon corridors can strengthen substantially when the monsoon signal is present.
- Low-wind troughs are still allowed, but their depth and areal extent are reduced so they no longer dominate huge ocean areas.
- Added a post-boundary-layer **background-flow restoration pass** so missing open-ocean background wind is re-injected after solver drag / wake effects have weakened it too much.

## 2. Land environmental-wind preset corrected to follow terrain intent
- Land preset logic was inverted before: exposed / high terrain could end up stronger than nearby plains.
- Added a deterministic terrain-aware land background target so:
  - plains / lowlands stay around **5–10 kt**,
  - higher terrain and strong local relief are **weaker**, not stronger.
- This better matches the requested “high elevation lower, low elevation higher” land-environment behavior.

## 3. Low-wind slots intruding into typhoon circulation fixed
- Added `backgroundRestoreGate()` / storm-protection radii so terrain-wake suppression and background-flow restoration both know when they are near a tropical cyclone core.
- Terrain wakes are now attenuated strongly over ocean and strongly reduced near cyclone cores, preventing narrow coastline-driven low-wind wedges from cutting into the TC circulation.
- This specifically targets the user-reported “插进台风环流风的低风槽” artifact.

## 4. Typhoon circulation compacted
- Tightened the vortex structure in `src/simulation/TropicalCycloneVortex.ts`:
  - reduced fallback / derived `r7`, `r10`, `r12` broadening,
  - reduced damage-driven wind-core broadening,
  - tightened quadrant stretch behavior,
  - moved far-field decay much closer to the storm,
  - reduced the broad outer asymmetry inflation.
- Net effect: TC wind fields should be **smaller and less diffuse**, closer to the user’s 913 hPa reference behavior.

## 5. CMA wind radii hidden after real landfall, but preserved over tiny islands
- Added `shouldHideCmaWindRadiiAfterLandfall()` in `src/simulation/Engine.ts`.
- CMA wind circles now hide once the center is on meaningful land, while remaining visible for tiny-island crossings that are intentionally excluded operationally.
- Applied to:
  - live map rendering in `src/components/MapView.tsx`,
  - video export in `src/utils/VideoRenderEngine.ts`.
- The underlying wind-radii calculation still continues; only the display is hidden as requested.

## Self-test / verification
### Syntax / transpile checks
- `typescript.transpileModule(...)` check on:
  - `src/simulation/SynopticWindField.ts`
  - `src/simulation/TropicalCycloneVortex.ts`
  - `src/simulation/Engine.ts`
  - `src/components/MapView.tsx`
  - `src/utils/VideoRenderEngine.ts`
- Result: **PASS**

### Numeric sanity check
- `node --experimental-strip-types /tmp/aether_round82_vortex_test.mjs`
- Result: **PASS**
- Validated:
  - center pressure still matches `pmin`,
  - far-field wind decays much more quickly than the inner-core wind,
  - quadrant-radius anchor behavior remains in a reasonable range.

### Manual code-path verification
- Confirmed the new CMA hide helper is wired into both **live map** and **video** paths.
- Confirmed environmental background restoration and wake attenuation are both gated by storm distance.
