# ROUND111 CHANGELOG — AETHER 6.0.34

## Synoptic wind-field artifact hardening

This round continues the ROUND110 artifact repair using the additional user screenshots captured from 6.0.32. It keeps all ROUND110 fixes and addresses the remaining mechanisms that could produce isolated high-wind wedges, vertical seams and terrain-linked streaks.

### Environment-to-cyclone capture

- Fixed a major radial-capture bug in `WindVectorBlend.ts`. The former blend was 72% controlled by vortex/background strength and only 28% by radial distance, so a strong vortex could keep capturing environmental flow even at and beyond the nominal capture radius.
- Capture is now strictly multiplied by the radial envelope and is exactly zero at/beyond `captureOuterKm`.
- Replaced root-sum-square background+vortex speed inflation with a bounded transition that preserves the diagnosed vortex speed across the operational circulation and returns smoothly to background flow only in the outermost capture annulus.
- Removed the artificial long one-sided high-wind jet/wedge created when organized monsoon/cross-equatorial flow overlapped a cyclone quadrant.

### Environmental target inside the cyclone

- The global environmental speed target remains a far-field coverage target, but its artificial minimum-speed nudge now fades inside tropical-cyclone protection radii.
- The actual environmental vector is still present and can steer/deform the storm; only the artificial speed-floor enforcement is suppressed near the cyclone.

### Cross-equatorial seam

- Removed the remaining hard `lon > center` zonal-vector switch in the cross-equatorial-flow generator.
- The zonal turn now occurs continuously across a ~3 degree corridor, eliminating another possible narrow vertical stripe in high-resolution wind products.

### Coast/island numerical transport

- Added ocean-target surface-aware semi-Lagrangian sampling in the boundary-layer solver. When an ocean back-trajectory straddles land, it preferentially samples ocean momentum instead of repeatedly transporting friction-reduced island wind downstream.
- Onshore marine inflow into land remains unchanged, preserving landfall physics.
- ROUND110 terrain-wake limiting, surface-aware coast smoothing and post-solver land-wind ceilings are retained.

### Quality

- No wind-grid resolution, display raster resolution, bicubic interpolation quality, contour resolution or video encoding quality was reduced.
