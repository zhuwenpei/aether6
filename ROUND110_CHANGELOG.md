# ROUND110 CHANGELOG — AETHER 6.0.33

## Synoptic wind-field artifact deep fix

- Removed two remaining binary low-level wind direction switches across the modeled monsoon-trough and ITCZ axes. Those `lat < axis` branches produced 6–8 m/s one-row vector jumps and could appear as long quasi-horizontal/curved color seams after the fluid solve. They now turn continuously across finite-width convergence zones.
- Removed the ROUND108 pre-solver hard cap on land/island environmental vectors. Capping a slow island cell before semi-Lagrangian advection allowed the solver to transport that artificial low momentum hundreds of kilometres downstream. The land environmental ceiling is still enforced after the solve, where it cannot seed an ocean wake.
- Added cyclone-capture diagnostics so the post-solver 12/22 kt land-environment ceiling is applied only to genuine far-field environmental flow, not a broad tropical-cyclone circulation crossing land.
- Made the coastline continuity filter surface-aware: ocean cells overwhelmingly average ocean neighbours and no longer inherit slow land/island vectors with equal weight.
- Added a bounded ocean-wake recovery guard using the pre-solver environmental+TC vector as the reference. Real terrain wakes remain possible, but a narrow island wake can no longer erase most of an otherwise resolved cyclone/marine wind field.
- No wind-map resolution, bicubic interpolation, contour resolution, video resolution, or codec quality was reduced. ROUND109 full display-space interpolation remains enabled.
