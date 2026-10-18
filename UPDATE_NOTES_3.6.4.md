# TyphoonSIM 3.6.4 Update Notes

## NMC 120-hour track probability forecast rebuild

This release rebuilds the standard NMC-style 120-hour forecast graphic from the supplied comparison images. It does **not** change the simulation engine, forecast-track physics, intensity integration or precipitation physics.

### Probability cone
- The analysis position is now a true pointed root (`0 h = 0°` half-width), removing the old artificial circular bulge at the start.
- Cone half-width grows through calibrated lead-time knots from 0 to 120 h instead of the former linear `0.032 * hour + 0.45°` rule.
- Interpolation uses smoothstep transitions and a geographic normal to the forecast track so turns do not produce abrupt width kinks.
- The far end is closed with a rounded cap rather than a flat or malformed polygon edge.
- Map framing uses the exact same uncertainty-width function as the rendered cone and also includes the analysed/history track.

### Forecast cadence and point styling
The standard information-box cadence is now:

`0 / +12 / +24 / +36 / +48 / +60 / +72 / +84 / +96 / +108 / +120 h`

Forecast path dots are denser than the callouts and are drawn every 6 hours through 120 h. Dots use the corresponding tropical-cyclone intensity colour, a restrained white rim and a solid fuchsia forecast track. The present position is rendered as a track point instead of an extra cyclone pictogram.

### Forecast information boxes
- Rebuilt as pale blue-white rounded speech-bubble boxes with a small integrated pointer and thin dark border.
- Leader lines remain visually tied to their exact forecast point.
- Text consists of issue-relative date/time, maximum wind in m/s plus Beaufort-style level, and the cyclone category.
- Wind force at/above 61.3 m/s is displayed as `17级以上`.
- Default density restores the +36 h and +60 h callouts present in the supplied operational-style references.
- Placement uses deterministic candidate scoring against map edges, track segments, other boxes and leader lines. This replaces the previous high-iteration spring layout and makes export more stable and less CPU-heavy.

### Composition and palette
- Rebalanced header/map/footer proportions to give the map body more space, and changed the standard NMC canvas from the generic 4:3 product ratio to approximately `1295:1103`, matching the supplied reference composition.
- Geographic grid and axis labels are simplified to the restrained business-chart style.
- Ocean/land palette is calibrated to the supplied references (`#DFF1FB` / `#FFECCE`).
- Probability-cone fill uses `rgba(129,81,97,0.48)`, which reproduces the observed mauve overlay over the map colours.
- Bottom legend is reorganised into the uncertainty explanation plus six intensity categories.
- Four-digit internal identifiers such as `2612` are normalised to the ordinal storm number in the title while the internal storm identifier can still be used elsewhere in the application.

### Institutional identity
The standard generated graphic deliberately does **not** reproduce an official logo, official institution name, production badge or audit/approval number.
