# ROUND114 CHANGELOG — AETHER 6.0.37

## Residual zonal seam repair

- Further delayed the artificial marine minimum-speed target inside the outer tropical-cyclone circulation. The actual environmental vector is unchanged; only the product coverage speed floor is kept out of the storm until true far-field flow.
- Applied the same far-field-only rule to the post-boundary-layer background minimum restoration.
- Added `WindFieldArtifactFilter.ts`, which diagnoses narrow zonal seams only in the residual between the solved 10 m wind and the already-composed meteorological reference field.
- The filter repairs a cell only when the residual is coherent along longitude but changes abruptly across latitude, and when the current row is more anomalous than rows 2–3 grid cells away.
- Tropical-cyclone inner capture is protected by an eligibility mask, so eyewall/radial gradients and genuine wind-radius structure are not smoothed.
- Existing full-resolution bicubic display interpolation, terrain/coast fixes, primary-only L label behavior, and cold-air/ET physics are retained.
