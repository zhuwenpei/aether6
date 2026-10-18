# ROUND88 CHANGELOG — AETHER 6.0.11

## Version
- `6.0.10` → `6.0.11`

## Fix: newly placed ocean typhoon immediately pauses when Play is pressed

### Root cause
ROUND87 added a central-pressure sanity guard in `TyphoonEngine.stepSimulation()` but used a helper named `clamp(...)` that does not exist in `Engine.ts`.

The first 10-minute physics step therefore reached the pressure-update block and threw a runtime `ReferenceError: clamp is not defined`. `App.tsx` correctly stopped the fixed-step loop for safety, which appeared to the user as an immediate automatic pause after Play.

### Fix
- Replaced both undefined `clamp(...)` calls in the pressure sanity path with explicit bounded expressions:
  - current `pmin`: `850–1045 hPa`
  - newly integrated `pmin`: `850–1045 hPa`
- The pressure corruption protection from ROUND87 remains intact; only the invalid helper call was removed.
- No typhoon intensity, steering, wind-radii, environment, landfall, or product physics were otherwise changed in this round.

## Regression coverage
Added `scripts/round88_first_play_regression.cjs`.

It verifies:
- new storms are still created `active: true` and `dissipated: false`;
- the first-step pressure path contains no undefined `clamp()` call;
- the pressure sanity bounds remain present;
- the existing simulation-step error logging / toast safety path remains present;
- focused TypeScript semantic checking reports no `TS2304`, `TS2448`, `TS2454`, or `TS2552` errors in `Engine.ts`.

## Self-test results
- `node scripts/round88_first_play_regression.cjs` — PASS
- `node scripts/round87_global_environment_coast_landfall_transition_regression.cjs` — PASS
- `node scripts/circulation_size_transition_regression.cjs` — PASS
- `node scripts/user_wind_radii_live_fix_regression.cjs` — PASS
- `node scripts/radar_product_removal_regression.cjs` — PASS
- `node scripts/synoptic_wind_pressure_regression.cjs` — PASS
