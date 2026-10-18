# Round 74 — Ensemble dispersion restoration (AETHER 5.2.25)

## User-visible change

- Restores a visibly useful ensemble track fan after the 5.2.24 target-intensity convergence changes made many cases look almost like a single line.
- Restores intensity/pressure spread while retaining the simulator target-intensity soft constraint and its lead-time convergence.
- Keeps a small number of physically constrained high/low tail members.

## Numerical changes

- Track geometry now uses a dedicated deterministic `PATH-GEOMETRY` RNG stream, decoupling track spread from EWRC, terrain, and intensity random draws.
- Increased coherent cross-track, along-track, translation-speed, and synoptic-regime dispersion, especially after 72 h, without removing the existing curvature/heading guards.
- Target convergence now contracts only target-interpretation error. It no longer multiplies down intrinsic member peak bias or stochastic intensity error.
- A strengthening target remains a soft envelope rather than a hard ceiling; lowered targets retain stronger weakening authority.
- Rare target-response tails increased modestly to preserve several high/low cases in a 49-member perturbation set.

## Regression

`round74_ensemble_dispersion_regression.cjs` reproduces a 49-perturbation-member northward/recurving case and checks that:

- 72/120 h path spread remains two-dimensional and non-collapsed;
- long-range dispersion is not dominated by a single extreme outlier;
- peak-wind and minimum-pressure distributions retain meaningful width;
- the target-centred median remains reasonable; and
- multiple high/low tail members remain present.
