# AETHER 5.3.0 M6 — Radar / Record Synoptic Video Fix

## 1. Radar generation reliability

- Removed the variable-path dynamic import of `../utils/VideoRenderEngine` from the radar interpolation path.
- Added `src/utils/TyphoonInterpolation.ts` as a lightweight statically imported interpolation module.
- Main-thread radar still-image rendering now prefers a DOM `HTMLCanvasElement`; worker rendering keeps `OffscreenCanvas`.
- Added staged single-frame radar progress callbacks and periodic main-thread yielding during prognostic integration so the UI no longer remains indefinitely at the initial 6% stage.
- Radar output is initialized with an opaque background before optional map/artifact stages, preventing transparent-canvas exports from appearing as blank PNG files.
- Worker requests strip main-thread progress callbacks before structured cloning.

## 2. Typhoon report: pressure/wind field RECORD video

Added a third video product in the typhoon report video workstation: **气压风场图视频**.

Adjustable parameters include:
- video resolution: 720p / 1080p / 2K;
- FPS: 1–60;
- duration: 2–30 seconds;
- target PNG sequence frame count;
- meteorological grid resolution;
- isobar interval and contour visibility;
- track overlay;
- reference / storm-following / custom map domain;
- map zoom and custom geographic bounds;
- product label.

The export pipeline is deliberately two-stage:
1. calculate/render the complete archived typhoon lifecycle as an in-memory PNG sequence;
2. only after every PNG frame is complete, encode the video from that fixed sequence.

WebCodecs/H.264 is preferred. If H.264/WebCodecs is unavailable or fails, the already generated PNG sequence is reused with MediaRecorder/WebM instead of recomputing meteorological fields.

Historical products use `Record Time` instead of `Forecast Time`.

## Validation performed

Passed:
- `radar_m2_prognostic_regression.cjs`
- `radar_m4_product_regression.cjs`
- `radar_m5_video_workflow_regression.cjs`
- `radar_m6_acceptance_regression.cjs`
- `synoptic_wind_pressure_regression.cjs`
- `round43_drawing_report_regression.cjs`
- `user_requested_radar_synoptic_video_fix_regression.cjs`
- TypeScript syntax/transpile validation for all changed TS/TSX files

A complete Vite production build was not executed in this environment because project dependencies were not present and dependency installation timed out. No application/runtime scripts were launched.
