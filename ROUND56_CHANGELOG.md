# Round 56 — detailed offline coastline extension

- Corrected the Round 55 interpretation of the product coastline request: seam hiding is secondary; the primary requirement is **real offline coastline coverage beyond the old product-data rectangle**.
- Preserved the existing high-density Pacific coastline inside `90°E–180°E, 15°S–65°N`.
- Rebuilt the surrounding product belt with intermediate-resolution GSHHS geometry out to at least 20° beyond every side: `70°E–160°W, 35°S–85°N` (the eastward 180–200° sector is stored as `180°W–160°W`).
- Retained a low-resolution global fallback outside that detailed belt so unusually wide products still never reveal an empty dataset boundary.
- Product-land point density in the 20° extension belt increases from roughly **499** (Round 55) to roughly **21,311** coordinates, while the original Pacific detailed plate remains intact.
- Artificial join-edge suppression remains as a secondary outline cleanup only.
- Live simulation coastline data remains on the separate 5° expansion path, so this larger product-only dataset does not increase physics/RBush cost.
