# Round 17: evolving satellite convection / synthetic ensemble steering

Base: AETHER 4.1.5 Round 16 desktop + drawn-path + glass UI. Round 16 desktop controls, map and saved-state mechanisms are retained.

## Satellite structure
- Added `src/simulation/ConvectiveDynamics.ts`: 60×60 scalar moisture / updraft diagnostic, integrated over 9 simulated hours using 12 semi-Lagrangian steps per frame. The field is forced by vortex circulation, convergence, storm moisture / precipitation diagnostics, shear, dry-air direction, land/terrain sector and orographic lifting. Bilinearly sample the same computed field for every satellite pixel. Finite time-dependent noise only seeds the tracer; individual isolated static blob positions are not used.
- Cloud render uses a bounded 8-entry dynamic-field cache and bounded 12-tile image cache. Both synchronous and cancellable asynchronous rendering use the same resolved field. The cloud product is still produced on demand; this change does not run high-resolution raster generation in every map animation frame.
- Organized WNP storms have only a mild **southern**, not permanently NE, rainband prior; stronger symmetrical storms suppress the climatological prior while ambient shear / moisture can still generate actual sector differences. Broadened and increased feeder-band count, with distinct canopy and intermittent embedded convective tops. No equally intense ring is required at all angles.
- Mature CDO is a continuous shield with advected updraft variation instead of fixed high-intensity Gaussian blobs, four stationary extreme cold arcs or a forced magenta disk. Cold top palette retains OTT enhancement discontinuities, and exceptionally cold points require exceptional updrafts.
- Eyewall replacement narrows/suppresses secondary eyewall and moat, weakens the old eyewall in the decay phase and limits magenta to rare bursts.
- On land the central shield decays faster than the wider moist rainbands. Existing terrain, dry air, core continuity and evolving advected fields control displacement, fracture and regeneration. Rainband anvil / active tower IR temperatures remain visibly colored; they do not all become grey solely because maximum surface wind declines.

## Ensemble guidance
- Each issuance generates a coherent, seed-reproducible synoptic ridge/trough timing ambiguity. Related model families share partial uncertainties but are not assigned permanently fixed east/west answers. Differing steering velocities are **integrated over lead time** and can change heading, rather than shifting identical tracks side by side.
- Members may sample their own scenario branch, onset time, steering amplitude and correlated time-varying initial condition error. Original deterministic reference path, analysis-time identity, node cadence and ensemble counts are unchanged.
- IMPORTANT: organization labels such as ECMWF, GEFS etc. denote **simulated model families**, not live or archived official output. Spread, position and any forecast confidence are not verified operational forecasts.

## Validation and limits
- Relevant tests: `npm run test:round17-cloud`, `npm run test:round17-heading`, `npm run test:hurricane-tracker-port`, `npm run test:aether-guidance-numeric`, `npm run test:drawn-track`, `npm run test:release-4.1.5`.
- Three 220×220 diagnostic preview raster files were generated separately for ocean, land and EWRC and visually inspected. These low-resolution diagnostic renders are not the full browser product.
- **Not a full non-parameterized atmospheric solver.** A satellite product cannot become a physically resolved, non-programmatic cloud-resolving model using the current AETHER state alone; that would require 3-D meteorological fields, data assimilation, cloud microphysics, high-resolution NWP and substantial compute. Round 17 replaces static positional cloud stickers with an evolving parameterized *advected* scalar field and physically informed diagnostics, not actual satellite observations. It is not appropriate for operational weather guidance.
- Dependencies were not installed in this sandbox, so a complete Vite build, browser comparison at native resolution, and target-machine FPS measurement are **not claimed**. Some older bundled regression scripts target removed 4.1.4 features and are not suitable as 4.1.5 release gates.
