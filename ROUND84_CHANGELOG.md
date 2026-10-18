# ROUND84 CHANGELOG

## Version
- Bump package version from `6.0.6` to `6.0.7`.

## Fix: synoptic wind-pressure product `env is not defined`
- Fixed a scope regression introduced by the regional environmental-wind calibration.
- `oceanBackgroundMinimumMs()` no longer receives a stage-local `env` object that is unavailable during the second grid pass.
- Stage 1 now caches only the two environmental scores actually required by the regional ocean-wind preset: `monsoonFlow` and `crossEquatorialFlow`.
- Stage 2 reads those cached scalar fields directly. This avoids both the runtime ReferenceError and an unnecessary second full environment-state lookup over the grid.

## Verification
- TypeScript transpile check for `src/simulation/SynopticWindField.ts`: PASS.
- Static scope check confirms no second-pass call references an undefined `env`.
- Existing synoptic product regression script executed after updating its accepted package-version baseline.
