# ROUND106 CHANGELOG

## Synoptic wind/pressure map artifact fix

- Investigated the narrow tongue / streamer artifact that could appear on the wind-field contour fill near the eyewall.
- Root cause: the display-only wind texture enrichment pass in `src/utils/SynopticWindPressureMap.ts` could advect steep inner-core gradients too aggressively, stretching eyewall colors into a false filament.
- Fix: added a local wind-speed envelope diagnostic around each raster sample.
- Fix: texture warping now fades out automatically in strong-gradient / inner-core regions.
- Fix: reduced warp travel distance and displacement amplitude.
- Fix: final display-only textured wind is clamped to the nearby local envelope so it cannot paint an unrealistic hot/cold tongue detached from the diagnosed wind field.
- Scope: this only changes the rendered synoptic wind-field product appearance; it does **not** alter the simulation wind physics, storm intensity, pressure evolution, or underlying analysed wind field.
