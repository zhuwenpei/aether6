# Round 75 — Adaptive verification spread, performance recovery, mountain decay (AETHER 5.2.26)

- Ensemble track spread now responds to verification against archived forecast snapshots. Repeated position + heading agreement contracts the plume progressively; a persistent stable heading-regime failure (for example an unexpected NE recurvature against a westward forecast) widens the plume and increases coherent sway. Parallel/same-heading position offsets do not trigger the failure regime.
- Ensemble intensity dispersion is modestly wider while preserving the target-intensity soft-envelope logic and physically driven land/dry/shear/structure differences.
- Future ensemble eyewall-replacement-cycle (EWRC) simulation and all ensemble EWRC metadata were removed. Existing generic structural damage state remains the source of any already-realised core damage.
- Terrain performance regression fixed: synchronous live-map centre guidance no longer invokes the 33-point Engine inner-core terrain sampler or coast-distance scans while offshore. On-land centre guidance uses a lightweight 8-azimuth inner/outer sampler. Full near-coast terrain diagnosis remains enabled for explicitly generated ensemble members.
- Large ensemble generation yields to the browser every 25 members instead of every 100 members, reducing long main-thread stalls.
- High-mountain landfall damage was strengthened and recovery delayed. Mountain blocking/friction can sever the inner core, leave hollow-core/rebuild memory and continue suppressing intensity for the first offshore nodes after a crossing.
- Map centre-guidance cache no longer keys off EWRC progress and retains a bounded 64-issue window, improving timeline scrubbing through recent 3-hour cycles.
