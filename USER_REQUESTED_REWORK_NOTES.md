# AETHER 4.1.5 — User-requested desktop/mobile rework

This package contains the requested September 2026 rework on top of AETHER 4.1.5.

## Main changes

1. Product rendering snapshots the selected product style at generation start, preventing asynchronous A/B product mismatches.
2. Institution/ensemble guidance now uses smooth multi-scale bends, regime changes and constrained motion instead of formulaic radial/fan geometry.
3. Manual dry-air, wind-shear, EWRC and related interventions no longer reset each other when applied at the same simulation time; the intervention panel is also widened/responsive.
4. Report/workstation chrome uses a restrained neutral palette while preserving semantic destructive colors such as red terminate controls.
5. The intensity profile uses the full storm lifetime, with SVG decimation only for rendering performance.
6. Expanded timeline is centered, responsive and visually aligned with the main command dock.
7. Performance work includes intensity-path decimation, cached/idle terrain rendering and avoiding obsolete heavy product renders after product selection changes.
8. Forecast line/cone styling is changed toward the supplied STORM_INC reference: cyan dashed guidance, dark navy uncertainty cone, white lead dots/labels.
9. Multi-member ensemble paths are more opaque/legible.
10. Operational terrain overlay now selects major relief/mountain massifs and sharp ridge/contour boundaries instead of a broad blurry yellow height wash.
11. Satellite spiral texture now uses periodic angular geometry across the atan2 branch cut, reducing straight seams/segmentation artifacts.
12. Track/intensity hover cards use a compact neutral STORM_INC-style visual treatment.
13. Primary intensity readouts honor the selected reporting agency/unit rather than assuming knots globally.
14. Collapsed left status card receives a visible reopen placement above desktop/mobile map chrome.
15. Full-lifetime rainfall products suppress the extreme-point marker; China framing follows the affected heavy-rain swath with a bounded fallback.
16. Satellite structure rendering now models lifecycle organization, shear-relative core tilt/eye filling, dry slots, dry-leaf/incense-coil damage and persistent rebuilding scars.
17. Phone UI is rebuilt below the 900px breakpoint as a compact version of the desktop workstation language, with fixed header/status, compact command dock and responsive modal/report layouts.

## Validation

Passing static/regression checks:
- `node scripts/user_requested_rework_regression.cjs`
- `node scripts/release_4_1_5_regression.cjs`
- `node scripts/release_ui_regression.cjs`
- `node scripts/aether_desktop_rework_regression.cjs`
- `node scripts/aether_v5_quality_regression.cjs`
- `node scripts/hurricane_tracker_port_regression.cjs`
- `node scripts/aether_guidance_numeric_regression.cjs`

The supplied source package does not contain `node_modules`, so a full local Vite production build/browser runtime validation was not performed in this environment.
