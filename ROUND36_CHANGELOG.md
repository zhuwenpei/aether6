# AETHER 4.3.19 / Round 36

- Forecast translation speed is now reconciled with actual geographic displacement at every forecast integration step.
- User-drawn forecast frameworks affect translation speed through bounded curvature/alignment physics while ignoring arbitrary waypoint spacing.
- AETHER deterministic centre guidance and every ensemble member now diagnose their own translation speed/bearing from native 3-hour track geometry; model/member speed differences remain independent.
- Forecast image callouts and ensemble products expose movement-speed diagnostics.
- Active joystick control in the westerlies retains stronger north/south authority while preserving realistic eastward advection and a 65 km/h total-speed guard.
- Removed the long-track gray/white halo caused by accumulation of thousands of barely-visible white Canvas hit targets; multi-model separator underlays are now dark rather than white.
