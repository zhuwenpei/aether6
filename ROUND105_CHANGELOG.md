# AETHER 6.0.28 — ROUND105

## 32 kt strong-cold-air outcome correction

- Stage-3 / 32 kt cold air keeps the existing weakening-rate calibration unchanged.
- Once sustained dry/cold intrusion fully destroys the tropical warm core, the system no longer enters the subtropical -> extratropical transition state machine.
- The cyclone nature switches to `残留低压` / `cold_air_remnant_low`: a diffuse remnant low cloud shield rather than any tropical, subtropical, or extratropical cyclone.
- ET timers and ET stop-numbering criteria are disabled for this destroyed-warm-core branch; ordinary poleward ET remains unchanged.
- Wind products suppress the former eyewall ring and all subtropical/frontal wind corridors, replacing them with a broad, ragged, asymmetric remnant wind field.
- Precipitation products block warm-conveyor/frontal rainfall morphology on this branch so the cloud/rain shield remains remnant-like.
- Forecast hydration carries the remnant-low latch and category, so future wind products cannot reclassify the system as ET.
- Normal 24/28 kt cold-air behavior is intentionally unchanged in this round.

## Regression

- Added `scripts/round105_strong_cold_air_remnant_regression.cjs`.
- Preserved stage-3 cold-air decay constants exactly: impact scale 0.80, base loss 3.20, and warm-core damage time scale 7.6 h.
