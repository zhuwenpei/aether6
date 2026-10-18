# ROUND115 CHANGELOG — AETHER 6.0.38

## Cold-air leading-edge continuity

- Identified the recurring December horizontal stripe as part of the cold-air reference field itself, not only as a post-solver artifact.
- Stage-3 leading-edge feather widened from 0.55° to 4.0° and the strong body was shortened so the >=25 kt marine core remains about 6.5° in latitude.
- The cold-air leading edge now has a small continuous longitudinal phase, anchored to zero at the configured cyclone-contact longitude, so the outbreak remains on-time at the cyclone but no longer advances as a perfectly zonal raster row.
- 0.25° row-to-row stage-3 wind jumps along representative marine-path longitudes are reduced from roughly 13–15 kt to about 2–3 kt.

## Weak-cyclone wind-field repair

- Weak 5–10 m/s disturbances no longer reserve the same >=170 km background-wind protection disk as organized tropical storms/typhoons.
- Below 13.9 m/s, no synthetic R7 outer wind anchor is used; weak vortices decay compactly from their actual RMW.
- Environment-to-cyclone capture radius now scales with organization, preventing a weak low from bending/suppressing background wind over several hundred kilometres.
- Downward Vmax calibration is disabled for very weak systems and introduced gradually with organization, preventing the calibration pass from carving a large circular calm/grey disk out of stronger ambient flow.

## Preserved behavior

- 32 kt nominal strong cold-air target retained.
- >=25 kt strong-cold-air marine footprint remains about 6.5° latitude.
- Cold-air dual-source marine routing and faster Philippine-Sea decay retained.
- Full-resolution wind-map interpolation and prior coastline/seam fixes retained.
