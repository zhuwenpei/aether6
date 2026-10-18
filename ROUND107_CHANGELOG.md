# ROUND107 CHANGELOG — AETHER 6.0.30

## Synoptic wind-field/video performance

- Added a render-session cache shared by every frame of synoptic forecast and record videos.
- Forecast physics is now materialized once for the complete video horizon and every frame only interpolates the cached path state; repeated `materializeForecastPath()` integration from the issue time has been removed.
- Cold-air contact anchors reuse the same session forecast cache and are cached for the issue cycle.
- Wind raster canvas/ImageData and pressure-contour scalar buffers are reused across frames to reduce allocation/GC pressure.

## Zoom-aware computation domain

- Removed the mandatory 6-degree calculation halo from the wind-field solver when the caller supplies a smaller safe halo.
- The map renderer now derives the numerical halo from the actual visible span, grid spacing and selected map zoom.
- A ~2.1-degree minimum halo remains for pressure-gradient stencils and terrain-wake memory; zoomed-out maps retain a larger halo up to 5.5 degrees.
- Adaptive padding is part of the field-cache key.

## Drawing-stage performance

- Wind color-fill sampling now follows meteorological grid density instead of always evaluating all 1348×940 template pixels.
- At the standard 0.25-degree / 1× reference view, 1080p rendering reduces display wind samples by roughly 85% while retaining about five display samples per solved grid cell; higher output resolutions automatically raise the display sampling density.
- The ROUND106 inner-core artifact guard now diagnoses its local speed envelope from the solved 3×3 scalar grid instead of nine extra bicubic vector samples per display pixel.
- Pressure contour oversampling reduced from 2× to 1.5× on standard/coarse grids and from 1.5× to 1.25× on fine grids; the contour buffer is reused between frames.
- H/L extrema detection performs the cheap 8-neighbour extremum test before the expensive ~2-degree contrast scan and only visits visible-grid indices.
- Fine coastline rings are bounding-box culled before projection/stroking, skipping geometry outside the visible map.

No simulation intensity, storm motion, cold-air weakening rate, or underlying wind/pressure physics was intentionally changed.
