# ROUND113 CHANGELOG — AETHER 6.0.36

## Second-pass synoptic artifact audit

- Re-audited the marine seam/wedge repairs from ROUND110–112 against the latest user screenshots.
- Removed the remaining hard post-solver environmental activation thresholds around tropical cyclones. The former gate cutoffs at 0.68 / 0.92 traced exact storm-centred radii and could quantize into visible arcs or bands. Marine floor and ceiling enforcement now fade in continuously.
- Removed the fixed 16% artificial ocean minimum-target contribution inside the cyclone-protection region. The target-speed nudge now reaches exactly zero in the protected core while the real environmental vector remains present.
- Land environmental ceilings also fade in continuously instead of switching at a single radial gate.
- Kept the ocean-only residual seam/wedge cleanup from ROUND112, with full-resolution bicubic display interpolation intact.
- Removed the unused synoptic extrema detector from the wind-map renderer. Only the primary tropical-cyclone centre L / pressure marker remains; no other H/L centres are calculated or displayed.
