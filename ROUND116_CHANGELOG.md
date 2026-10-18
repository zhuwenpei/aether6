# ROUND116 CHANGELOG — AETHER 6.0.39

## Live synoptic wind-radii refresh

- Wind/pressure products now follow the current simulation/timeline hour between separate generations instead of keeping the issue hour from the first image.
- Each manual image/video generation snapshots the current issue hour when the user starts generation, so the frame remains deterministic during the render while the next generation uses the newest live state.
- Live issue resolution now accepts the integer timeline hour for a continuous physical state partway through that hour; it no longer falls back to an older hourly history snapshot merely because `typhoon.simHour` is fractional.
- Forecast materialization cache keys now include the mutable issue-state signature, including RMW and r7/r10/r12, plus a compact forecast-geometry signature. Editing circulation/wind radii at the same issue hour therefore invalidates the old cached forecast.

## CMA intensity report

- Removed the red horizontal separator between the CMA data-report header and the curve panels. Spacing is retained.

## Synoptic historical-path overlay

- Historical-path display now draws only the track and its nodes.
- Removed the automatically added dashed r7/r10/r12 circles that appeared when historical path was enabled.
