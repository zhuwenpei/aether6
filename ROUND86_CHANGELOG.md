# ROUND86 CHANGELOG

## Version
- `6.0.8` → `6.0.9`

## 1. Typhoon circulation tightened slightly
- Added a small compactness bias to the tropical-cyclone vortex so the 10 m circulation is slightly smaller than 6.0.8 rather than continuing to spread too broadly.
- Tightened the far-field fade modestly; the inner core and `Vmax` behavior are retained.

## 2. Wind radii are now soft physical guidance, not a hard stencil
- `R7 / R10 / R12` all participate in the vortex-size solution.
- Added `softWindRadiiShapeScale()` so each wind-circle level contributes most strongly near its own radial band, while still cooperating to describe one continuous circulation.
- Quadrant radii influence asymmetry and size, but only part of their diagnosed anomaly is applied; pressure-gradient / boundary-layer dynamics remain primary.
- Replaced the old hard-style `max(gradient wind, wind-radii target)` composition with a log-space blend between:
  - pressure-gradient wind, and
  - the wind-radii reference curve.
- The exact R7/R10/R12 radii therefore no longer force exact 34/50/64-kt contours.

## 3. Numerical behavior check
Representative test storm:
- R7 NE reference: **260 km**
- diagnosed 34-kt edge: **238 km**
- 10 m wind at the exact R7 reference: **12.15 m/s**, rather than being hard-forced to 13.9 m/s.

When all wind radii are enlarged by 25%:
- R7 NE reference: **325 km**
- diagnosed 34-kt edge: **272 km**

This verifies that wind circles materially affect circulation size, but the response is intentionally less than 1:1.

## 4. Regression / self-test
Passed:
- `node scripts/round86_circulation_radii_reference_regression.cjs`
- `node scripts/round85_synoptic_wind_regression.cjs`
- `node scripts/synoptic_wind_pressure_regression.cjs`
- `node scripts/circulation_size_transition_regression.cjs`
- `node scripts/user_wind_radii_live_fix_regression.cjs`
- `node scripts/radar_product_removal_regression.cjs`
- TypeScript transpile check for `TropicalCycloneVortex.ts`
