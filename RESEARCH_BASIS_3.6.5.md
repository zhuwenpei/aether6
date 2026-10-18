# Technical basis — TyphoonSIM 3.6.5

This release is a targeted rendering correction based on the supplied NMC/JMA/Himawari references and the 3.6.4 implementation. No tropical-cyclone physics or forecast integration was changed.

## NMC far-end geometry
The 3.6.4 cone used a single cubic Bezier curve to close the far end. On a strongly curving final track segment, pushing both Bezier control points forward can produce excessive bulging or a locally folded-looking terminal edge. 3.6.5 instead constructs the terminal closure in the final track's local tangent/normal coordinate frame and samples a half-ellipse from the left envelope edge to the right envelope edge. This keeps the end rounded while avoiding self-intersection and preserves the existing lead-time width function.

## NMC callout placement
The previous candidate scorer allowed overlap as a very large penalty, so a dense layout could still select an overlapping candidate if every candidate was penalized. 3.6.5 changes overlap to a hard exclusion. Boxes are placed in forecast-time order on alternating sides of the track, using a regular sequence of normal distances and along-track offsets. A wider open-slot fallback also preserves the no-overlap rule. The normal offset and bubble pointer are lengthened so the leader visually associates each box with its node without crowding the track.

## JMA offline ocean colour
The JMA palette constant was already `#1767C8`, matching the sampled route-chart ocean colour. However, the global `.leaflet-container { background: #07111F !important; }` rule overrode MapView's per-basemap inline background. Removing `!important` from the background declaration allows the JMA local vector ocean colour to render as intended while retaining `#07111F` as the fallback for online/dark modes.

## Himawari-9 wind areas
Only the stroke width of the 15 m/s and 25 m/s JMA wind-area circles was increased slightly. Six-hour geometry freezing, offset diagnosis and centre-following are unchanged.
