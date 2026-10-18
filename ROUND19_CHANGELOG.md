# AETHER 4.1.5 · Round 19 — geometry integration, precipitation acceleration and neutral UI

Base: user-provided Round 18 project. Reference: user-provided Round 4 `Mobile_Satellite_Ensemble_Rework_patched_round4_cloudrestored_devfix` archive. This package is a complete source project, not a binary build.

## Forecast track only: selective legacy port

`src/simulation/AetherEnsembleGuidance.ts` carries over the earlier version's correlated shared/model smooth cross- and along-track knot geometry, plus its smoother member-specific turning, long-range lead-dependent spread and slight path bends. They are blended into Round 17/18's issue-specific ridge/trough scenario clusters, persistent member steering integration and optional remerging. Legacy *geometry* draws use independent seeded RNG streams so their addition does not shift the newer model/member intensity random draws. Genesis-enhanced dispersion, land/ocean state, offshore recovery/reintensification, dry-air and eyewall-replacement intensity logic are retained, not replaced by Round 4's intensity forecast. Control member is still identical to its model center, and every path originates at the analysis point. The named agencies are **synthetic simulator families**, not agency forecasts fetched from operational centers.

## Rainfall product speed

`src/utils/ObservedRainfallMap.ts`: calculation lattice scaled down from Round 18's previous 310–430 columns to 238–370 depending on requested export size, with fewer unnecessary rows; raster and vector coast outputs retain requested export resolution by bilinear resampling. Conservative coarse spatial snapshot buckets, per-snapshot precomputed inputs, and square-distance fast rejection avoid physically impossible expensive rain-model calls. The color-raster renderer now precomputes per-column interpolation coordinates and palette RGB and skips thresholds outside the actual scalar field range instead of marching every contour level. This is a **speed/resolution trade-off**; very small rain maxima can be less resolved, and full-track integral is still computed from nonnegative time samples rather than replacing it with the shorter-window product. Progress and cancellation are retained. No measured millisecond/FPS speedup is asserted.

## Cyclonic radar circulation

`src/simulation/PrecipitationModel.ts`: bearing is clockwise-positive from geographic north, so the Northern Hemisphere inward arc and time-dependent disturbance bearing must both decrease as they rotate cyclonically. Corrected the inner radar spiral, propagating ring disturbance and an incense-coil phase whose time sign was formerly clockwise. Southern Hemisphere tangential moisture-wind circulation reverses direction. This is a corrected model-sign convention, not assimilation of live weather radar.

## Desktop drawing and navigation

`src/components/MapView.tsx`: during drawing, middle-button panning previews a single Leaflet map-pane transform and commits just one map pan on release. This avoids multiple raster rebuilds and prevents middle-button cyclone relocation/click fallthrough. Saved live user-drawn route is invisible outside edit mode, but it remains in simulation configuration; editing shows draft vertices and route. In desktop draw mode, held +/- and numeric keypad keys preview fractional zoom through compositor animation and commit one Leaflet zoom at release; quick taps get a fractional step. Existing wheel-based cyclone-speed changes remain; editable text inputs do not have keys intercepted.

## Information, profile and visuals

Agency/reporting-mode changes invalidate cached historical map markers and update current center tooltip/popup content. `src/components/AetherIntensityPanel.tsx` plots the actual unbinned agency-converted `rawValue`, including values beyond JMA's presentation ceiling; other public labels still use their selected agency reporting convention. Hover detail is only displayed with the pointer over the chart. `src/index.css` applies a neutral charcoal, frosted major-surface theme with translucent neutral buttons across dialogs, dock, status panel, chart, controls and map popups; radar/IR/product meteorological colors remain unchanged. Repeated per-button backdrop blurs are deliberately avoided to limit GPU cost; a reduced-transparency fallback is included.

## Validation and known limits

- Syntax-transpile checks for every `src/**/*.ts(x)` source file and a PostCSS parse of the stylesheet passed.
- `round19_regression`, `round18_regression`, `aether_guidance_numeric_regression`, `round17_guidance_heading_regression`, `round17_cloud_guidance_regression`, `drawn_track_desktop_regression`, `release_4_1_5_regression`, `hurricane_tracker_port_regression`, `release_ui_regression`, and `tutorial_usage_physics_regression` passed in the supplied Node environment.
- `scripts/round18_regression.cjs` now tests the expected compositor pan instead of asserting the removed per-frame `map.panBy` string.
- Some older static regression scripts already fail unmodified in Round 18 (legacy assertions for removed/renamed product buttons or refactored weather diagnostics); these are not presented as passed Round 19 tests.
- Browser Vite build, full TypeScript typecheck, actual performance/FPS measurements, visual interaction on Windows and pixel-level 24 h/full-track comparative renders were **not** completed in this environment because project dependencies were not installed. Additional real-device validation is necessary.
