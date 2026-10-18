# AETHER 4.3.20 / Round 38 — Radar morphology realism

- Reworked the near-surface/basic-reflectivity morphology to reduce idealized concentric-ring and pinwheel appearance while keeping radar physics decoupled from IR cloud-top brightness.
- Added finite storm-relative radar rainband packets with explicit radial endpoints, narrow azimuthal widths, broken mesoscale texture and detached outer cells. These packets do **not** follow cyclone translation heading.
- Made the broad stratiform/CDO radar shield genuinely non-circular: low-order moist lobes, dry-air notches, shear-dependent preferred sectors and slowly evolving coherent gaps now change the rain-shield geometry instead of merely adding pixel noise.
- Added azimuthally deformed eyewall radius/width plus coherent sector breaks. Healthy eyewalls remain mostly continuous; increasing shear, dry-air intrusion, LLCC exposure, open-sector fraction and structural damage progressively create realistic weak/gapped sectors.
- Localized high-dBZ eyewall towers into a few coherent azimuthal sectors. 55–65 dBZ remains a sparse compact-core/convective-burst exception rather than a continuous ring.
- Strengthened finite outer-rainband embedded cells modestly so mature storms can show localized 30–45+ dBZ arcs hundreds of kilometres from the eye without forming repeated full annuli.
- Removed the radar-product renderer's second synthetic motion-locked vortex (concentric band radii + logarithmic spiral arms). Station/tracking radar images now use the exact same `computeGroundRadarReflectivity()` physical field as the live map, with only sub-dBZ/low-dBZ deterministic sampling texture for gridded-composite appearance.
- Product sampling texture is ground-fixed rather than time-randomized, preventing artificial flicker in radar videos.
- Added `scripts/round38_radar_realism_regression.cjs` covering heading invariance, outer-band fragmentation, dry-sector asymmetry, clear-eye preservation and sparse extreme echoes.
