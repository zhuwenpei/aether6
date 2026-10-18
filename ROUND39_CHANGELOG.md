# AETHER 4.3.20 — Round 39 station-page overlay layering fix

## Problem

On mobile, opening the station history workspace (and its radar/report/emergency sub-pages) could leave the simulation map's persistent top bar, bottom transport controls, and virtual joystick visibly painted above the station page.

## Root cause

`#typhoon-gis-viewport` intentionally uses `contain: layout paint style` for map-render performance. The station workspace was mounted as a fixed-position descendant of `MapView`. Paint containment creates a local stacking/painting context, so even the station page's `z-[9999]` could not outrank persistent chrome rendered as siblings outside the contained map subtree.

## Fix

`StationHistory` now renders its complete full-screen workspace through `createPortal(..., document.body)`. This moves the station workspace and all nested station radar/report/emergency pages into the root stacking context while retaining the map viewport's paint containment optimization.

No simulation physics, radar algorithms, path logic, timeline logic, or station diagnostics were changed.

## Validation

Added `scripts/round39_station_overlay_layering_regression.cjs` / `npm run test:round39-overlay` to assert that:

- `StationHistory` uses a React DOM portal targeting `document.body`;
- the full-screen station overlay keeps its high z-index;
- the map viewport's `contain: layout paint style` performance optimization remains intact.
