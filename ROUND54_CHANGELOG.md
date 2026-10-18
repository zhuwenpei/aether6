# Round 54 — JTWC / SSHWS category normalization

- Centralized all user-facing Category 1–5 classification on `getJtwcSshwsAssessment()`.
- AETHER internal `vmax` remains the CMA-like 2-minute physical wind. C1–C5 is no longer calculated by directly multiplying that value by 1.943844.
- C1–C5 now first resolves the simulator JTWC 1-minute intensity through `getAgencyIntensity(..., "JTWC", "public")`, including the JTWC-style 5-kt public reporting bins, then applies official SSHWS thresholds: C1 64–82 kt, C2 83–95 kt, C3 96–112 kt, C4 113–136 kt, C5 >=137 kt.
- Updated Wiki track markers, ensemble category coloring/intensity charts, ACE calculation, lifecycle/Patricia report winds, and the report impact Category labels to use the JTWC intensity path.
- Added Round 54 regression coverage to prevent future direct internal-m/s-to-kt C1–C5 classification regressions.
