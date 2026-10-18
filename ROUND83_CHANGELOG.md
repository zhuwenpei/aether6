# ROUND83 CHANGELOG

## Version
- Bump package version to `6.0.6`.

## Wind-radius transition timing fix
- Added a single authoritative `CirculationSizeTransition` resolver shared by App and Engine.
- A 72-hour circulation-size change now resolves against the fixed-step simulation clock instead of the throttled integer UI clock.
- During a scheduled 3/6/12/24/36/48/72-hour size transition, the 3-hour wind-radius analysis uses the exact time-resolved reference and no longer stacks the normal 52% wind-radius low-pass on top of the requested transition duration.
- The exact mode is retained through the first 3-hour issuance after the requested deadline so the requested transition cannot finish early or keep chasing the target after its deadline.

## Timeline branch isolation fix
- A committed timeline seek now restores the archived circulation-size transition configuration for that hour.
- Future-branch `circulationSizeReferenceKm`, transition target, start hour, duration and from-value can no longer leak backward into a newly created historical branch.
- Circulation-size control edits are persisted into the current history issue snapshot, so rewinding to the exact edit hour reproduces the intended transition schedule.
- Only timeline-sensitive circulation-size controls are restored; unrelated live UI preferences such as sound or basemap are not rolled back.

## Regression / self-test
- `node scripts/circulation_size_transition_regression.cjs` — PASS
  - 72 h transition remains near its starting value after 3 h
  - midpoint at 36 h is correct
  - target is reached at 72 h
  - future branch target is replaced by archived target on rewind
- `node scripts/user_wind_radii_live_fix_regression.cjs` — PASS
- `node scripts/radar_product_removal_regression.cjs` — PASS
- `node scripts/synoptic_wind_pressure_regression.cjs` — PASS
- TypeScript transpile checks for `App.tsx`, `Engine.ts` and `CirculationSizeTransition.ts` — PASS
