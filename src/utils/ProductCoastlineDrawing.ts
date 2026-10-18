import { isProductCoastlineSeamSegment } from "../simulation/NaturalEarthLoader";

export type LonLat = [number, number];

/**
 * Stroke one coastline ring while omitting artificial source-plate join edges.  Round 56 now
 * supplies real intermediate-resolution coastline geometry throughout the full +20 degree
 * product belt; this is only a secondary outline cleanup, not a substitute for map coverage.
 * Filling still uses the complete closed ring.
 */
export function strokeProductCoastlineRing(
  ctx: CanvasRenderingContext2D,
  ring: readonly (readonly number[])[],
  project: (lat: number, lon: number) => { x: number; y: number }
): void {
  if (!ring || ring.length < 2) return;
  ctx.beginPath();
  let penDown = false;
  let drew = false;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    if (!a || !b || a.length < 2 || b.length < 2) continue;
    const aa: LonLat = [Number(a[0]), Number(a[1])];
    const bb: LonLat = [Number(b[0]), Number(b[1])];
    if (!Number.isFinite(aa[0]) || !Number.isFinite(aa[1]) || !Number.isFinite(bb[0]) || !Number.isFinite(bb[1])) continue;
    if (isProductCoastlineSeamSegment(aa, bb)) {
      penDown = false;
      continue;
    }
    const pa = project(aa[1], aa[0]);
    const pb = project(bb[1], bb[0]);
    if (!Number.isFinite(pa.x) || !Number.isFinite(pa.y) || !Number.isFinite(pb.x) || !Number.isFinite(pb.y)) {
      penDown = false;
      continue;
    }
    if (!penDown) ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    penDown = true;
    drew = true;
  }
  if (drew) ctx.stroke();
}
