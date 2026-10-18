# ROUND124_CHANGELOG

## 1. Land / snapped temporary station eye-passage V curve

Fixed several mechanisms that could make a temporary or land station lose the characteristic V-shaped wind minimum when the eye passed only a few kilometres inland:

- Station land/sea classification cache is now keyed by **name + coordinates**, rather than name alone.
- Temporary stations no longer reuse archived built-in station readings simply because OSM resolves the temporary point to the same city name. Temporary station history is reconstructed at its **actual coordinates**.
- The “nearest land” action now actually moves the temporary observation coordinate to the nearest detected land point and updates its name/marker, instead of only renaming an ocean point.
- Removed the abrupt station-eye center-wind jump at **32.7 m/s**. The ragged-eye center ratio now transitions continuously across TS/typhoon intensity thresholds.
- Added a decaying station-diagnostic eye-passage memory floor over land, based on eye-formation / eyewall / warm-core memory, with stronger persistence near the coast. This affects the station wind cross-section only and does not recreate a satellite-visible eye or alter cyclone physics.
- The live fixed-station eye-ratio display was also made continuous at 32.7 m/s, and the old hard mainland eye-filling penalty was removed.
- Station diagnostic version was bumped to `round124-eye-v2`, so older saved station rows are re-diagnosed instead of silently preserving the pre-fix wind curve.

## 2. JMA Best Track / Himawari-8 replay information cadence

- Added a dedicated **3-hour scalar analysis state** for replay information such as pressure, maximum wind, category, motion and analysis location.
- Himawari-8 observation panel now holds those scalar values for 3 hours before refreshing.
- JMA Best Track pressure/status information uses the same 3-hour analysis cadence.
- Visible replay clocks now advance in **1-hour steps only**, always displayed at `xx:00`; fractional video frames no longer show intermediate minutes or advance the hour at `:30`.
- **Wind-radii refresh behavior is intentionally unchanged.** Himawari wind-area rows continue to read from the existing independent issued-radii state, and the drawn JMA radii still use the pre-existing `steppedJmaWindRadiiState()` mechanism.
- Track/center motion remains smooth; only bulletin-like scalar information is stepped.

## 3. HMON / HWRF reference wind barbs

- Increased wind-barb opacity for both new reference styles from `0.46` to `0.64`.
- Increased the entire barb glyph uniformly by **18%**, preserving the ROUND123 REDO feather/pennant proportions.
- Increased stroke thickness for improved visibility.
- Grid spacing and the reference color palette are unchanged.

## Files changed

- `src/simulation/Engine.ts`
- `src/components/StationHistory.tsx`
- `src/components/MapView.tsx`
- `src/utils/VideoRenderEngine.ts`
- `src/utils/SynopticWindPressureMap.ts`
- `scripts/round122_redo_synoptic_reference_regression.cjs`
- `scripts/round123_redo_barb_glyph_regression.cjs`
- `scripts/round124_station_replay_barb_regression.cjs`
- `package.json`
