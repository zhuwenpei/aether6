# ROUND119 REDO — wind-barb reference matching

Base: AETHER_6_0_39_modified_round118_redo.zip (clean baseline; previous ROUND119 changes discarded).

This redo recalibrates HMON/HWRF wind barbs by comparing the program-generated 2048×1365 image with the supplied 1024×811 Tropical Tidbits reference after normalizing for image resolution.

Changes:
- Reduce reference-style barb opacity from near-solid black to semi-transparent dark gray.
- Reduce effective symbol scale to a reference-sized value rather than keeping the previous oversized 3× geometry.
- Increase target barb population and candidate pool so the field no longer looks sparse after collision rejection.
- Reduce collision padding and allow a smaller adaptive fallback scale, preserving more valid nearby barbs without overlap.
- Keep the R2 low-discrepancy irregular placement: no regular row/column grid is reintroduced.
- Keep discrete hard wind-speed colour bins from ROUND118 redo unchanged.

Files changed:
- src/utils/SynopticWindPressureMap.ts
