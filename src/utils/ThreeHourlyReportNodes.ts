/** R214 report-only cadence: every curve vertex comes from an actual stored
 * three-hour simulation observation. Never synthesize hourly, ten-minute, or
 * jitter vertices. Preserve a non-aligned final observation as the terminal
 * report value, without interpolating intermediate knots. */
export function threeHourlyReportNodes<T>(rows: readonly T[], hourOf:(row:T)=>number):T[] {
  const sorted=rows.filter(row=>Number.isFinite(hourOf(row))).slice().sort((a,b)=>hourOf(a)-hourOf(b));
  if(sorted.length<=2)return sorted;
  const first=hourOf(sorted[0]);
  const result:T[]=[sorted[0]];
  let next=first+3;
  for(let i=1;i<sorted.length-1;i++){
    const hour=hourOf(sorted[i]);
    if(hour+1e-6<next)continue;
    // Only stored observations, no interpolated or noisy samples.
    // For an irregular archive, use the earliest actual observation at/after each slot.
    result.push(sorted[i]);
    next=first+3*(Math.floor((hour-first)/3)+1);
  }
  const last=sorted[sorted.length-1];
  if(last!==result[result.length-1])result.push(last);
  return result;
}
