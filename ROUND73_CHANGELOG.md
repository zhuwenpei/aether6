# Round 73 — AETHER 5.2.24

- When the dedicated manual forecast-peak override is disabled, ensemble guidance now continues to respect the live simulator's manually configured intensity target in both strengthening and weakening cases.
- The live target is implemented as a soft, time-evolving envelope rather than a hard member clip; SST/shear/dry-air, terrain, EWRC and structural-memory physics remain authoritative.
- Target-related stochastic intensity error contracts with lead time instead of continuing to expand indefinitely. Ordinary members retain a nonzero long-range error floor.
- Roughly 5.5% high-tail and 5.5% low-tail members retain wider response/error envelopes to preserve a few physically filtered extreme cases.
- Targets >=115 m/s remain playground mode and do not become hidden ensemble ceilings.
- Added Round 73 numeric regression for target anchoring, time contraction, spread preservation, high/low tails and lowered-target weakening.
