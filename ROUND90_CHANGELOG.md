# ROUND90 CHANGELOG

## Version
- Bump version to `6.0.13`.

## 1. Westerly-belt environmental wind reduced and de-uniformized
- Reworked `SynopticEnvironmentalWindModel.ts` so active westerlies no longer receive the old large additive speed boost.
- A strong westerly belt now blends toward a dedicated target field whose typical area mean is around **17–22 kt**.
- Added two coherent longitudinal wave components plus background texture so the belt contains realistic faster/slower streaks instead of a nearly uniform slab.
- Reduced the direct user-configured westerly surface-vector increment in `SynopticConfiguredSystems.ts`; the control now primarily changes steering / streak structure rather than double-counting speed on top of the environmental target.
- The existing global 36 kt hard ceiling is retained. Westerlies may still contain locally faster streaks, but the normal belt is no longer pushed toward 30–36 kt everywhere.

## 2. Horizontal latitude-cut artifact removed
- Root cause: `SynopticWindField.ts` switched geostrophic pressure-gradient wind on abruptly at `|lat| >= 8°`.
- This created a perfectly horizontal wind-speed discontinuity that remained visible in still products and video frames.
- Replaced the binary latitude switch with a continuous tropical fade:
  - geostrophic contribution begins gradually outside the deep tropics,
  - Coriolis `f` is regularized near the equator,
  - the pressure-gradient contribution is blended continuously instead of appearing on one grid row.
- No exact latitude boundary remains in this path.

## 3. 24/36/48/72 h wind-radii transition race fixed
- Root cause: when the user changed the circulation-size target while the selector was still `立即`, the live circles were resized immediately. Selecting `72 h` afterward queued a React-state rollback, but the simulation ref could still contain the already-resized target circles if Play was pressed immediately.
- `pendingCirculationSizeOriginRef` now preserves an **exact per-cyclone pre-edit R7/R10/R12 snapshot**, not only the old reference-km value.
- When a long duration is selected at the same simulation instant, those original wind circles are restored synchronously to `typhoonsRef.current` before the transition metadata is committed.
- This removes the Play-button race and prevents a nominal 72 h transition from beginning with circles already near their final target.
- If simulation time has advanced since the edit, the code falls back to the scale-based current-state conversion rather than restoring stale radii.

## Verification
### ROUND90 regression
- Westerly target sample mean: **18.82 kt**
- Standard deviation: **1.14 kt**
- Sample range: **15.97–20.70 kt**
- 72 h transition:
  - +3 h effective reference: **360.81 km** from a 360→520 km request
  - +12 h: **371.85 km**
  - +36 h: **440 km**
  - +72 h: **520 km**
- Result: **PASS**

### Existing regressions
- `circulation_size_transition_regression.cjs`: PASS
- `round89_environment_zoom_regression.cjs`: PASS
- `synoptic_wind_pressure_regression.cjs`: PASS
- `round88_first_play_regression.cjs`: PASS
- `round87_global_environment_coast_landfall_transition_regression.cjs`: PASS
- `round85_synoptic_wind_regression.cjs`: PASS
- `user_wind_radii_live_fix_regression.cjs`: PASS
- `radar_product_removal_regression.cjs`: PASS

### Syntax checks
- TypeScript transpile checks passed for all files changed in this round.
- Full `tsc --noEmit` cannot complete in the supplied source bundle because frontend dependencies / type declarations such as React, Leaflet and Vite are not installed; the failures are missing-module errors rather than diagnostics from the ROUND90 edits.
