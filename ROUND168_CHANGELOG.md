# AETHER 6.0.44 — Round168

Base: AETHER 6.0.43 / Round167. Complete project, no external runtime assets removed.

## 1. Restore physical shore/terrain mechanisms in the isolated sandbox

**Root cause:** Round167 moved `TyphoonEngine.stepSimulation` to a new module Worker, but Natural Earth's mutable `landGeoJson`, `countriesGeoJson` and their segment-level spatial indexes are separate module globals in every Worker. The main window's `loadNaturalEarthData()` did **not** initialize the Worker's copies. Since old procedural GSHHG fallback is empty, landfall classification, land coverage, friction, high terrain and related cyclone physics were effectively treated as open ocean inside the Worker.

- Worker now **awaits its own** `loadNaturalEarthData()` before the first 10-minute integration step. It builds the same spatial indexes as the main simulator.
- Readiness is verified using loader status AND a land/ocean sanity check at Shanghai and in the open Pacific; a failure reports an error **and prevents physics from advancing** rather than quietly using all-ocean conditions.
- Async load uses a start serial so pause/stop/new starts cannot unexpectedly restart a canceled run. The pre-existing Worker physics stepping rate, PRNG capture, incremental history snapshots, and main-thread fallback are unchanged.
- The geography and terrain model itself has not been replaced or approximated.

## 2. Restore meaningful pre-simulation intensity influence

- Increased the normal geographically aligned pre-simulation wind/pressure guidance weight from approx **44.8% to 81.6% over water** (cap 82%). Over land it is approx **58.7%** (previously approx 26.9%), and is subject to the same inland decay guards.
- These weights apply to forecast guidance only. They do not overwrite actual simulated wind/pressure, PRNG, or the manually drawn intensity mode.
- Retained positional matching, the early-strong-peak plateau, physically bounded wind-rate changes, the explicit exception for abnormal changes already present in the sandbox, and pressure/category continuity.
- Slower real-world cyclones may still use geographically valid reference data for a **limited grace interval** beyond the old fixed sandbox clock horizon (max 48 hours, depending on reference length), but must remain within 180 km and a bounded phase difference. No route data is invented beyond the last actual sandbox position.
- NMC-only conservative genesis intensity switch remains independent. Turning it off still selects the Round164-style high-authority intensity policy, without reverting spatial alignment.

## 3. Delete the dedicated JTWC forecast *image* product

- Removed the JTWC product tab, settings, Canvas render routing, PNG naming and `src/utils/JtwcForecastProduct.ts`.
- If localStorage still specifies the deleted `jtwc_forecast` style, the product center safely reopens in **NMC** rather than a blank product.
- Unrelated existing JTWC 1-minute wind unit conversions, general agency selections, reports and ensemble diagnostics are retained; these are **not** the deleted forecast image feature.

## Verification

- New `scripts/round168_coast_worker_strength_remove_jtwc_regression.cjs` exercises the Worker geography readiness barrier and canceled-start pause race, material intensity influence and pressure response, inland weakening, bounded reference reissue, JTWC removal and NMC switch isolation.
- Round167 legacy regression updated for the intentionally deleted JTWC graphic and the Worker's required independent geography readiness. NMC one-node extratropical-stop test retained.
- Passed: Round158, Round161, Round163 physics/render/UI, Round164 spatial/cursor, Round165, Round166, revised Round167, Round168, Round144 complete archive, Round121 coastal speed, Round129 deep-water land distance.
- Changed TypeScript and TSX files passed isolated TypeScript source transformation/syntax checks.
- The pre-existing Round130 deep-water live forecast performance script **timed out** within the available execution window; it is not claimed as passed.
- The source bundle does not include `node_modules` and a complete Vite production build or full browser end-to-end test was **not** performed. Real devices should verify Worker network loading and simulated landfall end-to-end.
