# AETHER 6.0.39 — Round134

Based on Round133. Scope: restore original forecast-product lead-time choices, replace artificial intensity-curve intermediate values with true sparse user controls, and remove the startup-to-terms visual gap. Round129–131 performance changes and 10-minute live physics cadence are unchanged.

## 1. Forecast products use original Round132 horizons

- Revert only the Round133 additions to the **JMA** and **CMA/standard** forecast image selectors (144, 168, 192, 216 and 240 hours).
- Both selectors again offer the original **24/48/72/96/120 h** choices; JMA's original 24-hour label and description are restored.
- Restore the original JMA description without the Round133 extension warning.
- A persisted `forecast_forecastHours` from the Round133 extension is normalized to a valid option (120 h) on initialization, so stale localStorage cannot cause an invisible 240-hour generation.
- Existing other independently-defined product/video/ensemble lead choices are not changed.
- The **hand-drawn intensity editor still supports 0–240 h**, calculated only when explicitly opened, not during the normal physics loop.

## 2. Actual sparse, piecewise-linear hand-authored intensity curve

Original issue: the manual editor stored all baseline model samples (typically at hourly / 3-hourly timestamps), then modified two samples. Even if the user added only two points, the intervening baseline samples were serialized as real control points. The path and actual physical manual target therefore followed the old default model between those edits, rather than the expected straight line.

- Add `src/utils/manualForecastIntensityCurve.ts` as the shared deterministic interpolation helper.
- Maintain **only user-created control points** as editable state. The T+0 analysis intensity is a fixed implicit start anchor. Default model samples remain as a separate grey dashed reference curve, not hidden manual handles.
- When a user adds T+24h=30 m/s and T+72h=70 m/s, T+36h=40, T+48h=50, T+60h=60 exactly, regardless of original model samples.
- The cyan visible curve uses the same piecewise-linear interpolation as `Engine.ts`'s `getManualForecastIntensityTarget`.
- The saved `manualForecastIntensityCurve` contains **only** T+0 plus the user-authored anchors. Model samples for intermediate lead times are no longer persisted as manual constraints.
- Edit points can be created at **any 1-hour lead** by touching the curve, not just on the precomputed forecast sample timestamps. Touching an existing point edits that same hour; pointer vertical drag retains the hour as before.
- Beyond the last authored point, the curve holds its last manual intensity, matching the engine's existing last-point extrapolation. Reset clears all user controls and reveals the untouched baseline again.
- If the physical forecast begins at T+1h, the editor prepends the actual storm's analysis state as T+0 to establish a truthful initial anchor. Irreversible dissipation protections remain unchanged.

## 3. Seamless launch → disclaimer

- Previously, the disclaimer was mounted only when `launchFinished` became true, **after** the splash had faded. This allowed the underlying app/black background to show briefly.
- If terms are not yet accepted, mount `AetherTermsModal` immediately **underneath** the higher-z-index opaque launch overlay. As the launch fades it reveals the ready disclaimer with no intervening empty frame.
- The disclaimer still requires explicit acceptance; the startup/author screen timing and background-restore skip behavior are unchanged.

## Validation

- TypeScript parse/transpilation: `tsc --noEmit --noCheck -p tsconfig.json` PASS (full package-dependent typecheck/build not available without dependencies).
- Standalone TypeScript module compiled with full type checking (tsc) and tested numerically.
- `scripts/round134_sparse_intensity_launch_product_regression.cjs`: PASS — test reference oscillations, exact interpolation, non-3-hour handle positions, serialized anchor count, restored product choices and seamless splash mounting.
- Existing regressions Round120/121/128/129/130/131/132/133: PASS. Round133 assertion for extended **product** horizons updated to honor the user's Round134 reversal; all other Round133 requirements remain validated.
- No full Vite build/device browser QA performed here because the uploaded archive lacks node_modules. Verify author→terms transition and touch editing on mobile after deployment.
