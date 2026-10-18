# ROUND121 — restrict forecast nearshore/post-landfall speed slowdown geography

Base: `AETHER_6_0_39_modified_round120_forecast_genesis_intensity_speed.zip`.

## Requested change

The forecast translation-speed definitions of **near shore** and **post landfall** now apply only to:

- the **Eurasian mainland**;
- **Taiwan**;
- **Hainan**;
- the **Philippine archipelago**.

All other land remains active for the physical terrain/intensity model, but no longer activates the Round-120 coastal/post-land translation-speed slowdown.

## Implementation

- Replaced the Round-120 negative small-island exclusion concept, for speed calibration purposes, with a positive whitelist of selected country polygon components from the simulation country GeoJSON.
- Eurasian-mainland handling includes the continental Asian polygons used by the simulation, the Korean Peninsula, the Malay Peninsula, the Russian Far East mainland and the wrapped Chukotka mainland piece.
- China keeps its large mainland polygon and its separate Hainan polygon.
- Taiwan and all Philippine polygons are explicitly included.
- Russia excludes Sakhalin/Kuril/Arctic detached-island components from the speed mask.
- Malaysia includes only Peninsular Malaysia and excludes Borneo.
- Japan, Ryukyu, Indonesia/Borneo, Papua New Guinea, Australia, Pacific islands and other detached land do not contribute to the 120/460 km coast-distance slowdown blend.
- Product/track `landed` semantics remain separate: a forecast crossing Japan can still be recognized as a land crossing for products/physics; it simply does not trigger this translation-speed rule.
- Initial post-landfall speed memory is reconstructed only from recent historical land points that lie in the new whitelist. Terrain damage from a prior Japan/Indonesia/Australia crossing therefore cannot leak into the speed slowdown state.

## Files changed

- `src/simulation/Engine.ts`
- `scripts/round121_forecast_speed_landmask_regression.cjs`
- `package.json`
- `ROUND121_CHANGELOG.md`

## Validation

- `node scripts/round121_forecast_speed_landmask_regression.cjs`
- `node scripts/round120_forecast_genesis_intensity_speed_regression.cjs`
- TypeScript isolated transpile check for `src/simulation/Engine.ts`
