# Round 53 — Wiki-style tropical cyclone track report

- Added a new **Wiki风格台风路径图** product to the typhoon report workstation.
- Rendering conventions mirror Wikimedia/Wikipedia tropical-cyclone track maps:
  - approximately 6-hour best-track nodes;
  - straight white line segments (no Bezier/Catmull-Rom interpolation);
  - SSHWS-style intensity colors using the supplied current palette;
  - circle = tropical cyclone, square = subtropical cyclone when such a state exists, triangle = extratropical/remnant/disturbance;
  - NASA Blue Marble-style satellite basemap with ESRI imagery fallback through the existing shared tile cache.
- Added robust Natural Earth fallback drawing so the report remains usable when remote map imagery cannot be loaded.
- Auto-framing now uses the complete 6-hour lifecycle track, including dateline-safe longitude unwrapping and regional context padding.
- Wiki preview/export is asynchronous and abortable; full-resolution export waits for map tiles instead of capturing an incomplete frame.
- Added Round 53 regression coverage for report wiring, six-hour cadence, palette, symbols, Blue Marble source and straight-line rendering.
