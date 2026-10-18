import { useEffect, useId, useMemo, useState } from "react";
import type { SimulationConfig, Typhoon } from "../types";
import { getAgencyIntensity } from "../simulation/Engine";

type Props = { typhoon: Typhoon | null; currentHour: number; config: SimulationConfig };

export default function AetherIntensityPanel({ typhoon, currentHour, config }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const clipId = useId().replace(/:/g, "_");
  // A new cyclone must never inherit the old cyclone’s hover card.
  useEffect(() => setHoverIndex(null), [typhoon?.id]);
  const history = typhoon?.history;
  const data = useMemo(() => {
    if (!history?.length) return null;
    // Keep a fixed all-life domain. Rendering is decimated only for SVG cost; the hover source remains full-resolution.
    const full = history.filter((row, idx, arr) => idx === 0 || Number(row.simHour) > Number(arr[idx - 1].simHour));
    if (full.length < 2) return null;
    const agency = config.intensityAgency || (config.agencyStyle === "JMA" ? "JMA" : "CMA");
    const reportingMode = "continuous" as const; // plot raw continuous wind, independent of public bins
    const rows = full.map(row => {
      const ai = getAgencyIntensity(Number(row.vmax || 0), agency, reportingMode);
      // The plotting series is the raw agency-equivalent intensity, not the
      // public staircase (or JMA's display-only 140-kt ceiling).  Public text
      // elsewhere retains its agency-specific reporting rules.
      return { row, ai: { ...ai, value: Math.round(ai.rawValue * 10) / 10 } };
    });
    const stride = Math.max(1, Math.ceil(rows.length / 440));
    const plotted = rows.filter((_, i) => i % stride === 0 || i === rows.length - 1);
    return { rows, plotted, agency };
  }, [history, config.intensityAgency, config.agencyStyle]);

  // The plotted polyline is static between hourly snapshots: cache the geometry instead of
  // rebuilding hundreds of points on every 10-minute physics / React UI commit.
  const geometry = useMemo(() => {
    if (!data) return null;
    const { rows, plotted } = data;
    const w = 320, h = 155, padX = 36, padY = 24;
    const minH = Number(rows[0].row.simHour);
    const maxH = Math.max(minH + 1, Number(rows[rows.length - 1].row.simHour));
    const maxWind = rows.reduce((max, row) => Math.max(max, Number(row.ai.value || 0)), data.agency === "CMA" ? 35 : 70) * 1.08;
    const xy = (entry: typeof rows[number]) => ({
      x: padX + (Number(entry.row.simHour) - minH) / (maxH - minH) * (w - padX - 12),
      y: h - padY - Number(entry.ai.value || 0) / maxWind * (h - padY - 28)
    });
    const points = plotted.map(e => { const p = xy(e); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(" ");
    return { minH, maxH, xy, points, lastPt: xy(plotted[plotted.length - 1]) };
  }, [data]);
  if (!data || !geometry) return null;
  const { rows } = data;
  const { minH, maxH, xy, points, lastPt } = geometry;
  const w = 320, h = 155, padX = 36, padY = 24;
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (Number(rows[mid].row.simHour) < currentHour) lo = mid + 1; else hi = mid; }
  const currentIdx = lo > 0 && Math.abs(Number(rows[lo - 1].row.simHour) - currentHour) < Math.abs(Number(rows[lo].row.simHour) - currentHour) ? lo - 1 : lo;
  // Do not let tooltip hover reveal future data during timeline playback.
  const activeIdx = hoverIndex !== null && hoverIndex <= currentIdx ? hoverIndex : currentIdx;
  const active = rows[Math.max(0, Math.min(rows.length - 1, activeIdx))];
  const activePt = xy(active);
  const currentPt = xy(rows[currentIdx]);
  const cursorX = Math.max(padX, Math.min(w - 12, padX + (currentHour - minH) / (maxH - minH) * (w - padX - 12)));
  const replaying = currentHour < maxH - 0.001;

  const handlePointer = (clientX: number, rect: DOMRect) => {
    const svgX = (clientX - rect.left) / Math.max(1, rect.width) * w;
    const frac = Math.max(0, Math.min(1, (svgX - padX) / (w - padX - 12)));
    const targetHour = minH + frac * (maxH - minH);
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (Number(rows[mid].row.simHour) < targetHour) lo = mid + 1; else hi = mid; }
    const idx = lo > 0 && Math.abs(Number(rows[lo - 1].row.simHour) - targetHour) < Math.abs(Number(rows[lo].row.simHour) - targetHour) ? lo - 1 : lo;
    setHoverIndex(idx <= currentIdx ? idx : null);
  };

  return <div className="storminc-intensity-panel">
    <div className="storminc-panel-title">INTENSITY PROFILE <span>{active.ai.unit.toUpperCase()}</span></div>
    <div className="storminc-intensity-chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Intensity profile"
        onPointerMove={(e) => handlePointer(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHoverIndex(null)}>
        {[0, .25, .5, .75, 1].map(f => <line key={f} x1={padX} x2={w-10} y1={h-padY-f*(h-padY-28)} y2={h-padY-f*(h-padY-28)} className="grid" />)}
        <defs><clipPath id={clipId}><rect x={padX - 2} y={0} width={Math.max(0, cursorX - padX + 2)} height={h}/></clipPath></defs>
        <polyline points={points} fill="none" className="curve" clipPath={`url(#${clipId})`}/>
        <line x1={cursorX} x2={cursorX} y1={24} y2={h-padY} className="aether-chart-playhead" />
        <circle cx={replaying ? currentPt.x : lastPt.x} cy={replaying ? currentPt.y : lastPt.y} r="4" className="dot" />
        {hoverIndex !== null && <><line x1={activePt.x} x2={activePt.x} y1={22} y2={h-padY} className="hover-line" />
        <circle cx={activePt.x} cy={activePt.y} r="4" className="hover-dot" /></>}
        <text x="8" y="18" className="axis-label">WIND SPEED · FULL TRACK</text>
        <text x={padX} y={h-5} className="tick">{Math.round(minH)}h</text>
        <text x={w-42} y={h-5} className="tick">{Math.round(maxH)}h</text>
      </svg>
      {hoverIndex !== null && <div className="storminc-chart-tooltip" style={{ left: `${Math.max(8, Math.min(72, activePt.x / w * 100 - 8))}%` }}>
        <strong>T+{Math.round(Number(active.row.simHour))}H</strong>
        <span>{active.ai.value} {active.ai.unit}</span>
        <span>{Math.round(Number(active.row.pmin || 0))} hPa</span>
      </div>}
    </div>
  </div>;
}
