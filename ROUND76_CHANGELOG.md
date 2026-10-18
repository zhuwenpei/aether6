# Round 76 — 5.2.27 live ensemble path/intensity separation

- Live simulation map now calls `buildAetherCenterTrackGuidance`, a geometry-only guidance path.
- Geometry-only guidance does not sample forecast thermodynamics, calculate model/member vmax/pmin, scan terrain cores, advance structural damage, or apply target-intensity constraints.
- Live model-track tooltips no longer present synthetic peak wind/minimum pressure; they explicitly state that intensity is calculated when the ensemble product is generated.
- Full `buildAetherCenterGuidance` and `buildAetherEnsembleMembers` retain the complete intensity/terrain/damage calculation for ensemble product generation.
- Live guidance cache no longer invalidates for dry-air/humidity/shear/intensity-only settings that do not alter geometry.
