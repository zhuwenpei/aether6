# ROUND94 CHANGELOG — AETHER 6.0.17

## Scope
This round only reverts ROUND93 item 3: the intensity-dependent wind-eye centering/rounding changes. All other ROUND93 features remain intact.

## Reverted wind-eye changes
`src/simulation/TropicalCycloneVortex.ts` restores the pre-ROUND93 inner-core asymmetry behavior:

- Removed `matureEyeSymmetry`, `innerEyeRoundGate`, and `pressureDistortionRetention`.
- Restored the previous pressure-shape expression and bounds (`0.70–1.38`).
- Removed `eyeCenteredTranslationGate`; translation asymmetry again uses the original radial weighting.
- Removed `innerEyeAsymmetryRetention`; shear-induced wave-1 asymmetry again uses the pre-ROUND93 formula.

As a result, increasing cyclone intensity no longer receives the extra ROUND93-only forcing that artificially centers and rounds the eye in the wind-pressure product.

## Explicitly retained from ROUND93
- Equal-intensity product pressure micro-variation remains enabled.
- Cold-water quick-tool event remains enabled.
- Circulation-size target remains 0 km to no hard upper limit.
- Eastward coastline extension remains enabled.
- Wind-pressure map remains coastline-only with country borders removed.

## Validation
- Added `scripts/round94_eye_revert_regression.cjs` to verify the ROUND93 eye-only gates are absent and the exact pre-ROUND93 pressure/translation/shear formulas are restored while pressure micro-variation remains present.
