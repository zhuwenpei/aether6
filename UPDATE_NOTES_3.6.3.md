# TyphoonSIM 3.6.3 Update Notes

## Offline / online basemap organization

- The live simulation basemap selector is now split into **离线底图** and **联网底图**.
- Offline basemaps: `JMA`, `黑灰`, `向日葵9号`.
- Network basemaps remain in the online group. `空白无地图` is kept with the remaining choices but does not issue tile requests.

## JMA map palette correction

The JMA vector basemap now matches the JMA track-report palette used by `TyphoonReportModal` and the supplied reference image:

- ocean: `#1767C8` (RGB 23, 103, 200)
- land: `#5B9A5A` (RGB 91, 154, 90)
- coastline: `#D9E5D2`

The previous simulation-map palette (`#1963CE` / `#59965B` with dark-green coast) is no longer used.

## Himawari-9 offline basemap

A new `himawari` local-vector basemap is available. It uses the same cloud-free map palette as the `ひまわり9号 観測風` replay renderer:

- ocean: `#252F47`
- land: `#4A614B`
- coastline: `#111A1B`
- administrative border: `rgba(15,24,24,0.72)`

No satellite/cloud raster is added by this basemap.

## Layer-order repair

Local filled land polygons no longer live in Leaflet's ordinary vector overlay pane. The map creates:

- `basemapVectorPane` at z-index 180 for local basemap land/borders;
- `coastlinePane` at z-index 330 for optional coastline overlays;
- cyclone wind radii/path/guidance/stations continue at their existing higher panes.

This prevents land polygons from covering track, forecast, wind radii, markers, or station information.

## Performance

- Static Natural Earth basemap/coastline geometry now uses dedicated Leaflet Canvas renderers instead of relying on thousands of SVG paths in the normal overlay pane.
- Local-vector palette definitions are centralized and shared by the live map and video renderer, avoiding duplicate style branches and accidental network-tile preload for local maps.
- The physics engine, 10-minute integration step, precipitation mechanisms, forecast calculations and simulation-state cadence are unchanged.
