# TyphoonSIM 3.6.5 Update Notes

## NMC probability-cone terminal geometry
- Replaced the former single cubic far-end closure with an explicit half-ellipse sampled in the terminal track tangent/normal frame.
- The new closure preserves both envelope edges, stays monotonic around turns, and cannot fold over itself when the final forecast segment changes direction.
- Cone width knots, forecast track physics and intensity physics are unchanged.

## NMC callout layout
- Standard information boxes now use a hard no-overlap rule instead of accepting overlapping candidates with a large penalty.
- Forecast-time order alternates boxes across two sides of the track with a nearly constant long normal offset.
- Candidate rings expand progressively and use regular along-track offsets; an open-slot fallback still enforces no overlap.
- Leader lines are intentionally longer, and the speech-bubble pointer is lengthened to keep each box visibly tied to its forecast node.

## Himawari-9 replay
- Slightly increased the line width of the JMA 15 m/s and 25 m/s wind-area circles.
- Six-hour wind-area freezing and centre-following behaviour are unchanged.

## JMA offline map
- Fixed the live Leaflet container background rule that forced `#07111F !important` over the selected offline-vector ocean colour.
- JMA offline mode now actually displays the same `#1767C8` ocean colour already used by the JMA track-report reference palette.
- Land/coast colours and Natural Earth geometry are unchanged.

No simulation-engine, forecast-track, intensity, EWRC, rainfall or station-physics changes were made in this release.
