# Technical basis — TyphoonSIM 3.6.6

## Exact target constraint

A target expressed as a hard upper bound should be applied to the numerical tendency before the integration update, not only clipped after the state has already been used by intermediate diagnostics. With a 10-minute step, the maximum physically admissible positive rate is the remaining intensity gap divided by the step duration. Applying that bound before eye/eyewall diagnostics prevents transient above-target values from affecting structure, while a second late guard protects against future positive modifiers.

The previous ±0.4 m/s near-target oscillation was inconsistent with the UI wording “目标强度” when automatic peak adjustment is disabled. 3.6.6 keeps sub-target variability but removes the above-target half of that envelope.

## URI scaling

The requested change is implemented as a direct multiplicative scaling of the established URI hourly-rate envelope by 1.3. Duration and ramp timing are intentionally unchanged so only intensification speed changes. Shared constants are used by live and forecast branches to avoid divergent URI behavior.
