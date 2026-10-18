# ROUND108 CHANGELOG — AETHER 6.0.31

## Land environmental wind correction

- Lowered ordinary land environmental-wind targets while leaving tropical-cyclone winds untouched.
- Added a far-field-only terrain-aware land 10 m wind ceiling.
- Ordinary land environment is capped strictly below 12 kt (11.8 kt lowland maximum).
- Organized cold-air / westerly land environment may reach but never exceed 22 kt.
- Both ceilings decrease continuously with elevation and local relief, so low plains remain windier than high plateaus/mountains under equal forcing.
- The cap is applied only outside tropical-cyclone capture/protection regions; landfalling cyclone wind is still controlled by the cyclone vortex, terrain and boundary-layer physics.

## No-quality-loss synoptic-product performance work

- Anchored the moving synoptic solver grid to the global step-degree lattice. Adjacent video frames now reuse exact terrain/coast sample coordinates over overlapping areas, improving terrain/GIS cache hit rate without changing grid resolution.
- Removed duplicate bicubic u/v sampling from every wind-color raster sample.
- Rewrote Catmull-Rom bicubic sampling with scalar temporaries instead of five short-lived arrays per call; formula and clamping are unchanged.
- Avoid repeated Canvas backing-store reallocations when consecutive video frames use the same output resolution.
- Typhoon full-lifecycle video now uses a direct Canvas -> WebCodecs path when available, preserving the exact legacy meteorological-frame mapping while eliminating PNG encode -> Blob -> PNG decode -> second Canvas copy. The PNG path remains as compatibility fallback.
- No solver iterations, meteorological grid resolution, contour oversampling, color-raster sampling density, output resolution or codec quality setting was reduced.
