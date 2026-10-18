# Round 44 — Video special profiles / Himawari 8 hourly track

- JMA Best Track is now an explicit special replay profile with its own settings page instead of being only a bundle of ordinary style parameters.
- Himawari observation replay migrated to a dedicated Himawari-8 profile/settings page; legacy `himawari9_observation` saved settings are migrated automatically.
- Both special pages expose map-range/zoom controls and retain the full output section: aspect ratio, resolution, H.264/H.265 codec, bitrate, duration and frame rate.
- Ordinary agency/map/layer tuning panels are hidden while a special replay profile is active, so special products cannot accidentally drift into an incoherent parameter combination.
- Himawari-8 historical path now advances only on completed integer-hour vertices. It uses straight `lineTo` segments with miter joins and no fractional-frame tail / spline path.
- Himawari-8 replay continues through extratropical transition. ET is no longer treated as a TD downgrade; the path continues in a dedicated ET colour, the panel reports `温帯低気圧(ET)`, tropical wind-area circles are suppressed after completed transition, and an ET transition message/legend key is shown.
- Added `scripts/round44_video_profiles_regression.cjs`.
