/**
 * Reduce interactive chart rendering without reducing the archived observations exported to
 * station reports. Keep first/last samples and each bucket's extrema for every plotted metric.
 * Work is linear and the result remains in chronological order.
 */
export function downsampleStationChartData<T extends { time: number; wind: number; pressure: number;
  precipitation: number; stormSurge: number }>(rows: readonly T[], limit = 420): T[] {
  if (rows.length <= limit || limit < 12) return [...rows];
  const metrics = ["wind", "pressure", "precipitation", "stormSurge"] as const;
  const buckets = Math.max(1, Math.floor((limit - 2) / (metrics.length * 2)));
  const keep = new Set<number>([0, rows.length - 1]);
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = 1 + Math.floor(bucket * (rows.length - 2) / buckets);
    const end = 1 + Math.floor((bucket + 1) * (rows.length - 2) / buckets);
    for (const metric of metrics) {
      let lo = start, hi = start;
      for (let i = start + 1; i < end; i++) {
        if (Number(rows[i][metric]) < Number(rows[lo][metric])) lo = i;
        if (Number(rows[i][metric]) > Number(rows[hi][metric])) hi = i;
      }
      keep.add(lo);
      keep.add(hi);
    }
  }
  return [...keep].sort((a, b) => a - b).map(i => rows[i]);
}
