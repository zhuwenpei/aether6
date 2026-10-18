# AETHER 6.0.39 — Round130 Deep-Ocean Stall Fix

## Symptom

The simulator can remain smooth near coastlines but suffer obvious periodic/long main-thread stalls over the open western North Pacific. The stalls gradually ease after the storm moves west of the Naha/Ryukyu area.

## Root causes

### 1. Live land classification still had a giant-feature hot path

Round129 optimized *distance-to-coast* queries, but the high-frequency boolean `checkPointOnLandGeoJson()` path still used a feature-level RBush followed by Turf point-in-polygon checks.

The live land dataset contains a very large polygon feature whose bounding box spans approximately 65E–180E / 1.27N–73.7N and contains 20,308 coordinates. Consequently, many perfectly open-ocean points in the western North Pacific still selected this giant feature and repeatedly sent the entire polygon through point-in-polygon logic.

This is especially expensive because a single 10-minute physics step can call land classification many times through land-coverage and core-surface samplers.

### 2. The 3-hour forecast update retained a deprecated coast-distance fan-out

Path-only forecast generation called `getForecastMeaningfulLandContext()` on every forecast hour even though that caller only needed a boolean land flag. The helper still calculated distance-to-coast and, in small-island influence regions such as the Ryukyu/Marianas domain, could perform a radial 16-direction search at many radii.

That work is synchronized with forecast issuance and therefore presents as periodic long stalls. It also explains why the problem can improve geographically after entering the Naha/Ryukyu-western side where the meaningful-land context resolves more directly.

## Fixes

### Exact edge RBush for live land containment

`src/simulation/NaturalEarthLoader.ts`

- Added an exact coastline-edge RBush (`landContainmentEdgeTree`).
- Every polygon edge is indexed individually while preserving a shared polygon-part ID for outer rings and holes.
- Replaced the live Turf whole-feature point-in-polygon hot path with exact horizontal ray casting over only nearby candidate edges.
- Boundary points remain classified as land, matching previous live semantics.
- MultiPolygon / holes remain parity-correct.
- Existing fine-grained land-result cache remains intact.

The current dataset produces 68,867 exact indexed containment edges.

Representative candidate work:

| Point | Old candidate coordinates | New ray candidate edges |
|---|---:|---:|
| 26N 155E | 20,308 | 0 |
| 26N 145E | 20,308 | 0 |
| 26N 135E | 20,308 | 0 |
| 20N 155E | 20,308 | 0 |
| 15N 135E | 20,308 | 2 |
| 10N 150E | 20,308 | 0 |

### Provable deep-ocean fast paths

Added `hasLandBoundaryWithinKmGeoJson()` using the exact edge index.

When the storm center is known to be ocean and the exact index proves there is no coastline boundary anywhere inside the full sampling radius, the engine now safely skips sampling that cannot possibly find land:

- `getLandCoverage()` skips its 16-point sampler and returns 0.
- `getCoreSurfaceInteractionMetrics()` skips its 32-point ring sampler and returns the all-ocean result.
- `getMaxElevationInRadius()` skips its 24-point ring sampler and returns no land contact / zero terrain maximum.

These are proof-based exits, not geographic approximations. As soon as any coastline edge enters the relevant radius, the original full nearshore/landfall physics path is used.

### Removed unnecessary forecast coast-distance work

`src/simulation/Engine.ts`

- `getForecastMeaningfulLandContext()` now supports a boolean-only mode that returns immediately after the meaningful-land check, without calculating distance-to-coast.
- Path-only forecast generation only requests this flag when a 3-hour forecast point is actually emitted, instead of once for every simulated forecast hour.
- The old distance-aware behavior remains the default for legacy callers that actually need it.

No deterministic forecast physics, forecast speed whitelist, 10-minute live physics timestep, landfall effects, terrain parameters, or product land semantics were intentionally changed.

## Regression / validation

Passed:

- `tsc --noEmit --noCheck`
- Round120 forecast genesis / intensity / speed regression
- Round121 forecast-speed landmask regression
- Round128 minimum tactile delay + performance regression
- Round129 deep-ocean land-distance performance regression
- Round130 deep-ocean live-land + forecast-stall regression

Round130 also compares the new live parity classifier against the legacy GeoJSON ring classifier on 325 deterministic/fixed samples; all matched.

## Notes

The supplied project archive does not include installed `node_modules`, so a full Vite production build cannot be executed in this environment without restoring dependencies. Static TypeScript parsing and the relevant repository regressions pass.
