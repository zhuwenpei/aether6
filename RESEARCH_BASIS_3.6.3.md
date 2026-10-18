# Research basis — TyphoonSIM 3.6.3

## JMA track-map reference

The supplied JMA/RSMC Tokyo-style track image was treated as the visual source of truth for the local JMA basemap palette. Pixel inspection of the uploaded reference yields the dominant map colors:

- sea RGB(23,103,200) = `#1767C8`
- land RGB(91,154,90) = `#5B9A5A`

These values are also already used by `TyphoonReportModal`, so 3.6.3 unifies the live map with the report renderer.

JMA's public typhoon-route documentation describes the route-map convention (analysis points and solid/dashed periods), confirming that this is an operational track-chart style rather than a general-purpose street basemap:

- https://www.data.jma.go.jp/typhoon/route_map/bstv2026.html

## Leaflet pane layering

Leaflet documents that map panes control layer ordering via z-index; default tile layers are below vector paths, markers and popups. Custom panes are the supported way to place a basemap vector layer beneath operational overlays:

- https://leafletjs.com/examples/map-panes/
- https://leafletjs.com/reference

3.6.3 therefore places filled local land geometry in a dedicated low-z pane and keeps cyclone paths/radii/stations in their higher existing panes.

## Performance approach

The optimization intentionally avoids any change to simulation physics. It targets rendering only:

- one static Natural Earth vector geography dataset;
- non-interactive Canvas rendering for those paths;
- no network tile work for local JMA/black-gray/Himawari basemaps;
- shared palette lookup across live map and video export.
