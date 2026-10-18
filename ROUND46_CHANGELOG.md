# Round 46 — Ensemble residual framing / centre-path geometry

## Pressure spaghetti / dual-cycle residual guidance
- `calculateForecastPath` now has an opt-in diagnostic continuation mode.
- Ordinary/live forecast guidance still stops at the existing operational termination criteria.
- `pressure_spaghetti_basin` and `paired_cycle_pressure` request the continuation path, allowing the residual low-level vortex to continue until `< 8 m/s` or the 168 h product horizon.
- These two products carry a second, ordinary stop-numbering reference path used **only** for map bounds. Residual-member tails no longer zoom the map out or drag the viewport away from the normal forecast area.

## Model-centre triangular-kink fix
- Added a node-level heading/curvature guard to AETHER model-centre tracks.
- Native 3-hour polyline nodes are retained; no Bezier/Catmull-Rom/display smoothing is introduced.
- Large one-node turns are bounded, and opposite-sign consecutive sharp turns are more strongly suppressed to prevent small triangular hooks while preserving broad recurvature and route-induced stalls.

## Validation
- Added `scripts/round46_ensemble_residual_kink_regression.cjs`.
- Round 42–46 regressions pass after the change.
