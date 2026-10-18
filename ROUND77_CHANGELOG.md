# Round 77 — AETHER 5.2.28

## Deferred forecast-intensity reconstruction

- Live simulation now keeps the deterministic standard forecast as geometry-only guidance. Future `vmax`/`pmin` are explicitly deferred and are not integrated on the simulation thread.
- Ensemble live guidance remains path-only; member intensity is calculated only when an ensemble product is requested.
- Every hourly cyclone history point is now a complete forecast reconstruction seed. The archived state begins from the complete live cyclone state, excluding only recursive `history`, so terrain damage, hollow-core memory, dry-air/shear penalties, recovery state, RI state and future state additions are retained automatically.
- The live cyclone also carries the current `configSnapshot`, so the current forecast can be reconstructed between hourly archive points.
- Configuration snapshots retain the target-intensity controls, forecast-peak toggle/reference, hand-drawn forecast route, hand-drawn dry-air/shear forcing and other simulation controls.
- Target-intensity and forecast-peak edits update the issue configuration without needlessly rebuilding standard forecast geometry.
- Forecast image products reconstruct full intensity from the selected historical state/config and the archived forecast geometry. The NMC-style product path now spreads the complete archived cyclone state instead of reconstructing from only latitude/longitude/intensity/pressure.
- JTWC and video forecast rendering hydrate deferred intensity at product/render time. Video hydration is cached per archived state so it is not repeated for every frame in the same hour.
- Live civil-warning estimates remain lightweight: when future forecast intensity is deferred they project the current analysed intensity along the stored path rather than invoking the forecast intensity engine.
