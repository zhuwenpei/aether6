# ROUND120 — genesis forecast continuity, ensemble uncertainty, editable intensity curve and translation-speed calibration

Base: `AETHER_6_0_39_modified_round119_redo.zip`.

## 1. JMA / ensemble genesis forecast no longer stops at 0 h

- A never-yet-TS tropical depression at the 5 m/s analysis floor is no longer treated as an automatic forecast stop while the low-level vortex is still viable.
- The distinction is issue-aware: a former TS that has weakened/dissipated is not reclassified as fresh genesis simply because its current wind is below TS strength.
- JMA and ensemble product generation now use a product-safe materialization helper. Ordinary termination is tried first; only a viable pre-TS genesis issue whose ordinary result is literally 0 h-only receives the residual-integrator fallback.
- Historical product issues only inspect history up to the selected issue time, so future strengthening does not leak backward into the decision.

## 2. Early ensemble intensity is no longer systematically too weak

- Genesis/depression members receive a modest positive organization prior only when SST, shear, moisture and low-level-vortex integrity support development.
- Positive 6-hour intensity-change caps are relaxed for very weak depressions, while genuine weak/failure members remain in the distribution.
- The center-family rate/peak distribution and member development branches are widened, with both stronger-development and failed-development tails retained.

## 3. Genesis / TD uncertainty is substantially larger

- Track regime bifurcation can start within the first few forecast hours for weak genesis systems rather than waiting until day 1–2.
- Initial heading, along-track speed, regime-branch amplitude and synoptic spread all increase as issue intensity falls into TD/genesis range.
- Broad directional disagreement is allowed rather than forcing all members into a narrow early cone.
- TD intensity spread has an additional early-stage term and stronger member-to-member organization diversity.

## 4. Hand-drawn forecast path now supports an editable target-intensity curve

- Added an intensity-chart button to the rough forecast-route toolbar.
- On first open, AETHER displays a calculation overlay, materializes the current hand-drawn route, and derives the default forecast timing, translation speed and intensity curve.
- The semi-transparent SVG editor uses forecast lead time on X and 5–85 m/s on Y.
- Touch/click near the curve creates/reuses a control point; control points are X-locked and can only be dragged vertically.
- Dragging elsewhere scrubs forecast time horizontally without changing intensity.
- Timeline scrubbing and point creation move a larger highlighted marker along the hand-drawn route on the map.
- Includes reset, close and fullscreen/minimize controls.
- T+0 remains the analyzed intensity and cannot be overwritten.
- Editing the route invalidates stale intensity edits. Reopening the chart on an unchanged draft keeps edits.
- Saved curves are persisted in simulation config/history snapshots and applied to deterministic product materialization.
- Ensemble guidance treats the edited curve as a moderately high-weight common reference, not a hard setpoint, preserving member dispersion and physical land/ET constraints.

## 5. Forecast translation-speed calibration

- Ordinary open-ocean forecast speed envelope: 4 km/h slower than the previous calibration.
- Extreme far-ocean slow-steering regime whose old ceiling was 18 km/h is exempt from that -4 km/h change.
- Nearshore and meaningful post-landfall regimes: 5 km/h slower than the previous calibration.
- The extra coast slowdown blends continuously from 460 km offshore to 120 km, avoiding a speed discontinuity.
- Small island chains use a separate speed-only land/coast mask, so they can still affect vortex intensity/structure physics without falsely triggering nearshore/post-landfall translation slowdown.
- Major Philippine islands, Taiwan, Hainan and Japan's main islands remain meaningful land for translation-speed purposes.
- Hand-drawn-route timing receives the same regional calibration while preserving deliberate near-stalls.

## Files changed

- `package.json`
- `scripts/round120_forecast_genesis_intensity_speed_regression.cjs`
- `src/App.tsx`
- `src/components/ForecastImageModal.tsx`
- `src/components/ForecastIntensityCurveEditor.tsx` (new)
- `src/components/MapView.tsx`
- `src/config/DefaultSettings.ts`
- `src/simulation/AetherEnsembleGuidance.ts`
- `src/simulation/DrawnTrackBranch.ts`
- `src/simulation/Engine.ts`
- `src/types.ts`

## Validation

- `tsc --noEmit --noCheck --pretty false`
- `node scripts/round120_forecast_genesis_intensity_speed_regression.cjs`
- `node scripts/round116_live_radii_report_overlay_regression.cjs`
- `node scripts/round117_pressure_windstyle_regression.cjs`
- `node scripts/round119_redo_windbarb_reference_regression.cjs`
- `node scripts/round47_manual_route_authority_regression.cjs`
- `node scripts/round51_guidance_curvature_regression.cjs`

Older regression scripts that hard-code superseded package versions or obsolete source-string signatures are not used as Round 120 acceptance criteria.
