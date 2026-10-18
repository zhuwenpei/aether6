# ROUND89 CHANGELOG — AETHER 6.0.12

## Version
- `6.0.11` → `6.0.12`

## 1. Environmental-wind ceiling and open-ocean trend
- Added a strict global marine environmental-wind ceiling of **36 kt**.
- Outside organized westerly or monsoon flow, the marine environmental-wind ceiling is **34 kt**.
- Reworked ordinary-ocean background targets so wind increases continuously with distance from meaningful land rather than through geographic basin presets.
- Most well-separated open ocean now clusters in the requested **16–23 kt** range, while near-coastal marine flow is generally weaker.
- Deep low-wind troughs can still fall into **4–10 kt**, with the existing 4 kt marine floor preserved.
- Westerly and monsoon systems remain the only large-scale background systems permitted to occupy the 34–36 kt tail.

### Implementation
- `src/simulation/SynopticEnvironmentalWindModel.ts`
  - added `openOcean` input;
  - added per-cell `ceiling10mKt`;
  - ordinary marine target now receives a continuous offshore boost;
  - 34 kt normal-system / 36 kt organized-monsoon-or-westerly caps.
- `src/simulation/SynopticWindField.ts`
  - added `buildOpenOceanWeight()` using a grid distance transform from land;
  - feeds open-ocean weight into environmental target diagnosis;
  - applies the 34/36 kt ceiling both before TC blending and again after the boundary-layer solve;
  - retains the 4 kt environmental floor outside cyclone capture zones.

## 2. Synoptic wind-pressure map zoom range greatly expanded
The wind-pressure product map zoom selector now has **16 levels** instead of 5:

`0.40×, 0.50×, 0.60×, 0.75×, 0.90×, 1.00×, 1.15×, 1.30×, 1.50×, 1.75×, 2.00×, 2.50×, 3.00×, 3.50×, 4.00×, 5.00×`

- Minimum range expanded from 0.75× to **0.40×** for much wider regional views.
- Maximum range expanded from 2.00× to **5.00×** for close-up core views.
- `follow_storm`, `reference`, and `custom` framing all accept the larger range.
- The same setting continues to drive both still-image generation and synoptic wind-field video generation.

## Self-test results
### ROUND89 environmental / zoom regression
- ordinary coastal sample mean: **14.39 kt**
- mid-ocean sample mean: **17.36 kt**
- remote-ocean sample mean: **19.45 kt**
- remote-ocean P10 / P50 / P90: **18.83 / 19.48 / 20.05 kt**
- remote ordinary samples >=16 kt: **100.0%**
- deep low-wind trough test: **5.96 kt**
- strong westerly test: **36.00 kt**
- strong monsoon test: **33.56 kt**
- map zoom levels: **16**, range **0.40×–5.00×**
- result: **PASS**

### Existing regressions
- `round85_synoptic_wind_regression.cjs` — PASS
- `round87_global_environment_coast_landfall_transition_regression.cjs` — PASS
- `round88_first_play_regression.cjs` — PASS
- `synoptic_wind_pressure_regression.cjs` — PASS
- `circulation_size_transition_regression.cjs` — PASS

### TypeScript transpile sanity
- `SynopticEnvironmentalWindModel.ts` — PASS
- `SynopticWindField.ts` — PASS
- `SynopticWindPressureMap.ts` — PASS
- `ForecastImageModal.tsx` — PASS
