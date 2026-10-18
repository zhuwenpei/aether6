# Technical basis — TyphoonSIM 3.6.7

## Probability-cone geometry

The visible defect in the prior NMC-style cone came from treating a curved, widening uncertainty tube as one ordered left-edge/right-edge outline.  On sufficiently curved tracks, offset edges can locally fold, swap orientation or self-intersect; a normal Canvas fill can then cancel or skip part of the intended interior.

3.6.7 renders the cone as a visual union instead.  Consecutive cross-track sections are connected with opaque trapezoids, and the projected uncertainty disk at every forecast section is filled into the same off-screen mask.  The section normal is kept continuous from one forecast point to the next.  The mask is then tinted once and composited onto the map.  This construction guarantees connectivity through bends, produces a pointed zero-radius analysis root, and lets the final forecast disk provide a naturally rounded terminal area without alpha accumulation.

## Annotation placement

The supplied NMC reference demonstrates that callouts are not restricted to two rails normal to the forecast track: boxes may sit before or after their corresponding point along the track direction when that produces a cleaner diagram.  3.6.7 therefore uses four local directions (left/right/ahead/behind), long-distance candidate rings and deterministic grid snapping.

The primary placement pass treats box overlap, path occlusion, leader-through-box and leader-line crossing as hard constraints.  Direction-use balancing and a preferred long leader distance are then scored among valid candidates.  A relaxed crossing pass exists only as a last resort for very dense custom layouts; box overlap remains prohibited.

These changes are presentation-only and do not alter the forecast model.
