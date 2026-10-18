# AETHER 6.0.39 — Round133

Baseline: Round132. Scope: mobile drawn-forecast framework editor, manual intensity guidance, image preview actions, launch sequence and mobile page lifecycle. No changes to live 10-minute physics step or Round131's on-demand forecast gate.

## 1. Phone toolbar clipped beyond left edge

- The forecast framework toolbar and intensity editor are now rendered via React `createPortal(..., document.body)`. This removes them from the mobile `#typhoon-app-container` paint-contained context which can clip an otherwise fixed overlay.
- The floating toolbar uses `--aether-vvw` (real VisualViewport width) rather than Android's sometimes much wider `100vw` layout viewport, with side safe-area margins and predictable fixed positioning.
- The intensity editor has viewport-aware phone sizing, and fullscreen mode gets separate sizing rules. Desktop styling is preserved.

## 2. Full editable intensity horizon and stronger manual authority

- Explicit user request to open the hand-drawn forecast intensity editor now computes full 1-hour physical guidance for **240 h**, rather than 120 h. This is on demand only, not in the live simulation loop.
- The editor always offers a 0–240 h axis (3-hourly points). If physical guidance terminates early, any synthetic continuation is a floor-level editing reference only; it **does not revive** a cyclone in the formal physical forecast.
- The manual-target pull increases from `0.42 + 0.30 * smoothstep(h/24)` to `0.88 + 0.10 * smoothstep(h/18)`. Land and extratropical penalties are reduced, and the correction ceiling increases from `4.2 down / 3.2 up` to `9.0 down / 8.0 up` m/s per hour of integration. Irreversible warm-core-destruction protection remains.
- CMA/JMA image-product selectors now offer extended 144/168/192/216/240 h forecasts. JMA >120 h is explicitly marked as a **simulation extension, not official JMA forecast lead time**. The regular live overlay stays on the separate on-demand 120-hour/3-hour preview path.

## 3. Remove all product 'open in a new tab' actions

- Removed the control and related URL/blob behavior from the forecast product preview (`ForecastImageModal`) and report preview (`TyphoonReportModal`).
- The footer now presents just cancel/close and download, retaining real file downloads.
- No `_blank`, `window.open`, or '在新标签页打开' behavior remains in `src/`.

## 4. Author splash card

- The centered author card now shows **only** `Bilibili 晚风渡山月`. The earlier English subtitle, decorative rule and author-prefix line are removed from rendered content.
- The author card appears on each actual new app startup instead of being hidden by a one-time-per-install localStorage key.

## 5. Background/foreground transition

- Ordinary `visibilitychange` and BFCache `pageshow` events do not reset launch state.
- Reload after a browser background tab discard (`document.wasDiscarded`), browser back/forward restoration, or session-scoped pending-background suspension skips the startup overlay and returns to the application immediately.
- Session-based suspension marker clears on foreground return so a real subsequent foreground page reload still displays the regular launch.

## Validation

- `tsc --noEmit --noCheck -p tsconfig.json`: PASS (syntax/transpilation-level only; not full strict type validation).
- Round120, Round121, Round128, Round129, Round130, Round131, Round132: PASS.
- New `scripts/round133_mobile_curve_product_launch_regression.cjs`: PASS.
- `src` search for new-tab actions: 0 matches.
- `npm run build` and browser/device visual verification: **not run**; the provided ZIP does not include `node_modules`/Vite. Install dependencies then run the build in an environment with package registry access.

## Manual phone QA to follow up

1. Draw forecast framework in portrait and landscape. Verify all four toolbar buttons stay within the visual screen bounds, including when browser address bar expands/collapses.
2. Open and fullscreen the intensity chart; scrub/edit T+144, T+192 and T+240, apply; generate an extended forecast product and confirm the guidance is visibly stronger but still respects physical dissipation.
3. Generate a forecast image and a report image: verify only close/cancel and download buttons remain, with no new tab.
4. Fresh reload: centered author text appears exactly; switch to another phone app then return: no AETHER/author splash.
