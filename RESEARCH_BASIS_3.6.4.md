# Research basis — TyphoonSIM 3.6.4

## Supplied visual references
The NMC forecast renderer was recalibrated directly against the three images supplied for this task: one TyphoonSIM output and two real-world NMC-style 120-hour probability forecast charts. The supplied references are the basis for the visual geometry, spacing, callout cadence, palette and chart composition in this release.

Pixel inspection of the supplied references identified the dominant base-map colours as approximately:
- ocean: RGB(223, 241, 251) / `#DFF1FB`
- land: RGB(255, 236, 206) / `#FFECCE`
- probability-cone appearance over ocean: approximately RGB(178, 164, 177), reproduced by the renderer with `rgba(129,81,97,0.48)` over the ocean base.

The comparison also showed that the probability region begins essentially at the analysis point, opens slowly at short range, broadens progressively through the medium range and terminates in a rounded far-end envelope. Accordingly, 3.6.4 replaces the previous non-zero-root linear-width rule with a zero-root, lead-time-knot model. The numerical knot values are a visual calibration for this simulator, not a claim to reproduce an undisclosed operational NMC uncertainty algorithm.

## Final layout and cadence calibration
The supplied real-world reference images are approximately 1295×1103 pixels, substantially taller than the simulator's former generic 4:3 forecast canvas. The standard NMC renderer therefore keeps the user-selected horizontal resolution but derives its height from a 1295:1103 product aspect ratio.

The references also separate *track point density* from *information-box density*: forecast track points are visibly denser, while the labelled milestones follow a regular 12-hour schedule. The final 3.6.4 renderer uses 6-hour forecast dots and 12-hour information boxes through 120 h, including the +84 h and +108 h milestones.

## Public NMC product cross-check
Public NMC typhoon product pages were used only to cross-check product semantics such as the existence of 120-hour path probability products, common issue cycles and tropical-cyclone intensity-category presentation. The simulator does not copy official identity elements.

Public pages consulted during the redesign:
- NMC mobile typhoon path probability product page: `https://m.nmc.cn/publish/typhoon/probability-img2.html`
- NMC typhoon public web product: `https://typhoon.nmc.cn/web.html`

## Safety against visual impersonation
The generated chart intentionally omits official institution logos, institution names, production badges and approval/audit numbers. The goal is to reproduce the chart *information design* requested by the user without presenting the simulator output as an official bulletin.

## Performance
Only rendering/layout work changed. The previous iterative spring-style annotation solver was replaced with a bounded deterministic candidate scorer. No time-step size, forecast-track calculation, intensity physics, environmental fields or precipitation mechanisms were modified.
