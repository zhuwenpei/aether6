# AETHER 4.3.20 / Round 37

- Increased the authority of the user-drawn large-scale forecast framework. Newly saved routes use at least 0.88 route weight; the engine default is 0.84 and the cap is 0.97.
- This higher route weight only changes the deterministic/reference trajectory. Ensemble model/member spread continues to use its independent synoptic, cross-track, along-track, timing and cluster perturbations; it is not scaled by `manualForecastRouteWeight`.
- User waypoint spacing now contributes a bounded relative translation-speed cue. The route's own robust median segment spacing is the reference, so wider local gaps gently favour faster movement and tighter local spacing gently favours slower movement.
- Waypoint spacing is never converted to a fixed number of hours. Environmental steering remains the absolute translation-speed anchor; spacing only modifies the relative pace along the hand-drawn framework.
- Existing curvature, route/environment alignment and westerly-capture speed controls remain active.
