# TyphoonSIM 3.6.6 Update Notes

## 1. Exact target-intensity guard

- The manual target-intensity mode (`maxIntensityLimitEnabled=true`, `autoAdjustIntensity=false`) is now enforced at the hourly-tendency level before eye/eyewall diagnostics and again after later structural modifiers.
- Positive RI/ERI/URI tendency is limited to `(target - currentVmax) / stepHours`, preventing a single 10-minute integration step from crossing the requested target.
- The old near-target atmospheric oscillation no longer permits a +0.4 m/s excursion above the target; small oscillations remain only on the lower side of the requested value.
- Final state clamping remains as a redundant safety invariant. Automatic lifetime-peak mode and playground mode retain their existing semantics.

## 2. URI rate increased by 1.3x

- URI keeps the same 25 h episode, 2 h ramp-in, and 2 h smooth exit.
- The previous 1.75–1.82 m/s/h URI envelope is multiplied by 1.3, giving 2.275–2.366 m/s/h (UI rounded to 2.28–2.37 m/s/h).
- Live simulation and the 120 h forecast mirror use shared URI constants.
- The generic non-playground positive-rate ceiling now permits the URI envelope while retaining the former 2.2 m/s/h ceiling for non-URI behavior.

No track, precipitation, steering, EWRC trigger, land-decay, or environmental-field algorithms were changed.
