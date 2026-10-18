# ROUND109 CHANGELOG — AETHER 6.0.32

## Synoptic wind-field raster quality restore

- Reverted the aggressive grid-tied wind-colour raster downsampling introduced for performance, because it produced visible blockiness / mosaic artifacts in eyewalls and broad wind bands.
- Restored full display-space interpolation for wind-field rendering: the wind raster is again sampled at the actual map pixel resolution before being drawn.
- Kept the no-quality-loss optimizations from ROUND107/108 that do not degrade visual fidelity, including reusable raster/ImageData buffers, contour buffer reuse, bicubic no-allocation sampling, duplicate-vector-sample removal, lattice-anchored solve grids and direct WebCodecs video encoding.
- Re-enabled high-quality canvas interpolation on the final draw path so tiny residual size mismatches no longer show stair-stepped magnification.
- Net effect: wind-field maps and videos recover the pre-ROUND107 smooth interpolated look while preserving safe cache/performance improvements that do not reduce quality.
