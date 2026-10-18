# ROUND85 CHANGELOG

## Version
- `6.0.7` → `6.0.8`

## 1. Coastline-following high-wind ribbon: deeper physical + renderer fix
The remaining coast-outline wind was traced to more than one source:

- **Land-only pressure adjustment was still binary at the shoreline.** The first land cell could receive continental/diurnal pressure forcing while the adjacent sea cell did not, creating an artificial cross-shore pressure jump and a narrow coast-parallel acceleration band.
- **Terrain form forcing could also begin at the first land cell.** This made unresolved coastline height changes behave too much like a wall.
- **The renderer still bicubic-interpolated scalar wind speed directly.** Catmull-Rom interpolation could overshoot at sharp sea/land gradients and create a visible high-wind outline even when the source cells did not contain that maximum.

Fixes:
- Added `buildLandInteriorWeight()` and a one-sided inland transition. Land-only pressure and terrain form forcing now fade in after the airflow crosses the coast.
- Removed cross-shore drag/reduction neighbourhood averaging. Marine momentum is no longer smeared into a coastline ribbon.
- First coastal land cells use a marine-to-land boundary-layer transition, then progressively acquire full land drag/reduction inland.
- Terrain wake seeding now requires resolved land-interior weight, so the coastline itself cannot act as a mountain wake source.
- `SynopticWindPressureMap.ts` now interpolates `u10/v10` first, derives speed from the vector, and clamps the reconstructed speed to the surrounding source-cell speed envelope.

## 2. “Vacuum-cleaner” cyclone effect removed
The previous composition still used the conceptual equivalent of:

`environment * (1 - shield) + vortex`

That explicitly removed environmental momentum around the cyclone and could create annular/sector calms before the flow entered the circulation.

Fix:
- Added `src/simulation/WindVectorBlend.ts`.
- Environmental flow now **turns progressively into the cyclone circulation**.
- Incoming environmental speed is retained during the turn; opposite vectors are not allowed to cancel into an artificial calm ring.
- The cyclone gradually takes control of direction and magnitude toward the inner core.

## 3. Squashed cyclone shape reduced
- Mature tropical cyclones now use tighter quadrant-stretch limits.
- Elliptical/shear asymmetry is reduced for strong tropical cores.
- Translation asymmetry is reduced as the core strengthens.
- Boundary-layer solver now receives a size-aware cyclone protection radius.
- Inside that radius, numerical diffusion, terrain wake, terrain deflection, background coupling and divergence projection are reduced, while ordinary surface drag remains active.

This keeps genuine land friction but avoids a mature offshore cyclone being numerically flattened into a one-sided wall.

## 4. Environmental wind coverage rebuilt around explicit 10 m targets
Added `src/simulation/SynopticEnvironmentWindPreset.ts`.

The environment preset is now explicitly a **10 m wind target**, rather than a slab-wind target that later gets reduced again by the 10 m transfer. This was a major reason apparently valid 13–17 kt background settings still ended up below 12 kt in the final product.

Target behavior:
- Open ocean / western North Pacific: normally **13–17 kt**.
- Low-wind grooves are retained only for strong, narrow negative background anomalies; they are no longer allowed to occupy large areas.
- East China Sea: **10–15 kt**.
- South China Sea without monsoon: **5–10 kt**.
- South China Sea monsoon corridor: may approach **30 kt**.
- Land plains: **5–10 kt**.
- High terrain: lower than nearby plains.

After the boundary-layer solve, missing background flow is restored toward the 10 m target outside cyclone-dominated regions. This restores genuinely missing environmental wind instead of multiplying all winds globally.

## 5. Environment-wind self-test averages
Representative deterministic 10 m background-target sampling, excluding cyclone circulation:

| Region | Average | P10–P90 | Min–Max |
|---|---:|---:|---:|
| Western North Pacific open ocean | **15.22 kt** | 14.88–15.62 | 12.57–15.78 |
| Philippine Sea | **14.94 kt** | 14.59–15.48 | 12.28–15.71 |
| East China Sea | **12.83 kt** | 12.67–13.03 | 12.58–13.10 |
| South China Sea, no monsoon | **7.38 kt** | 7.11–7.64 | 6.34–7.75 |
| South China Sea, monsoon corridor | **25.95 kt** | 22.29–29.50 | 22.02–29.68 |

The isolated ~12.3–12.6 kt minima in open ocean are the intentionally retained narrow low-wind grooves; the lower decile remains well above 14 kt, so they cannot form a broad `<12 kt` ocean background.

Land sanity check:
- representative lowland/plain average: **8.20 kt**
- representative highland average: **5.43 kt**

## 6. Regression / self-test
Passed:
- `node scripts/round85_synoptic_wind_regression.cjs`
  - basin background-wind averages/ranges
  - anti-vacuum opposite-vector test
  - progressive environment-to-cyclone capture
  - mature-core symmetry bound
  - synthetic flat-coast no-acceleration-ribbon test
  - renderer bounded-vector-interpolation static guard
- `node scripts/synoptic_wind_pressure_regression.cjs`
- `node scripts/user_wind_radii_live_fix_regression.cjs`
- `node scripts/radar_product_removal_regression.cjs`
- `node scripts/circulation_size_transition_regression.cjs`
- TypeScript syntax/transpile check on all modified wind-field modules: PASS
