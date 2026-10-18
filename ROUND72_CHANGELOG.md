# Round 72 — AETHER 5.2.23

- Ensemble guidance now reuses the live Engine inner-core terrain sampler (RMW land fraction, mountain fraction, drag asymmetry, blocking, maximum elevation).
- Added live-like structural damage integration for ensemble centres and members: friction work, structural severity, rebuild scar, quasi-persistent hollow-core memory after destructive mountain crossings, offshore recovery lag, and member-specific low-level-vortex integrity penalties.
- Natural dry-air/shear ventilation and failed EWRCs now feed the same structural-scar memory used by terrain damage instead of disappearing after the instantaneous penalty.
- Member terrain response still retains modest friction/RMW uncertainty; damage is evaluated on each member's own path.
- Wind-radii rendering was inspected only and intentionally not modified in this round.
