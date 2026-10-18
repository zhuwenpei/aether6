import type { Typhoon, TyphoonState } from "../types";

export interface CyclonePhasePoint {
  simHour: number;
  b: number;
  vtl: number;
  vtu: number;
  label: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep01 = (v: number) => { const x = clamp(v, 0, 1); return x * x * (3 - 2 * x); };
const norm = (v: number | undefined, fallback = 0) => clamp(Number.isFinite(v as number) ? Number(v) : fallback, 0, 1);

/**
 * Hart-style CPS proxy derived from the simulator's structural state.
 * The model does not carry full 900/600/300-hPa geopotential-height fields, therefore these values
 * are diagnostics in CPS coordinates rather than observational/reanalysis Hart parameters.
 */
export function deriveCyclonePhasePoint(state: TyphoonState | Typhoon): CyclonePhasePoint {
  const coldAirRemnantLow = !!state.coldAirWarmCoreDestroyed;
  const et = coldAirRemnantLow ? 0 : norm(state.extrTransition);
  const warm = norm(state.eyeWarmCore, clamp(((state.vmax || 0) - 18) / 45, 0, 1) * (1 - et));
  const asym = norm(state.eyeAsymmetry, et * 0.75);
  const disorg = norm(state.structuralDisorganization, et * 0.7);
  const shear = clamp((state.shear || 0) / 26, 0, 1.5);
  const conveyor = norm(state.warmConveyorBeltStrength, et);
  const stripping = norm(state.northeastCloudStripping, et * 0.7);
  const outflow = norm(state.outflowEfficiency, 0.5);
  const core = norm(state.coreCompactness, warm * 0.8);
  const westerlyHours = clamp((state.westerlyInteractionHours || 0) / 36, 0, 1);

  // B≈0 is symmetric; ~10 is the canonical symmetric/asymmetric divider in Hart CPS.
  const b = clamp(
    1.8 + 6.5 * asym + 8.0 * shear + 23 * Math.pow(et, 1.25) + 9 * conveyor + 6 * disorg,
    0,
    60
  );

  // Positive thermal-wind coordinates indicate warm core in the conventional -VT display.
  // ROUND104 resolves the vertical transition explicitly: the upper warm core is lost first,
  // producing the requested subtropical state (upper cold / lower weak warm), while the lower
  // troposphere turns cold only later as fronts mature.
  const intensityWarmth = clamp(((state.vmax || 0) - 12) / 55, 0, 1);
  const upperColdTransition = smoothstep01(clamp((et - 0.28) / 0.30, 0, 1));
  const lowerColdTransition = smoothstep01(clamp((et - 0.58) / 0.30, 0, 1));
  const vtl = clamp(
    18 + 78 * warm + 22 * intensityWarmth + 12 * core
      - 38 * upperColdTransition - 100 * lowerColdTransition
      - 18 * disorg - 10 * westerlyHours,
    -150,
    250
  );
  const vtu = clamp(
    8 + 82 * warm + 24 * outflow + 12 * intensityWarmth
      - 118 * upperColdTransition - 42 * lowerColdTransition
      - 24 * stripping - 14 * westerlyHours,
    -150,
    250
  );

  let label = "DEEP WARM CORE";
  if (coldAirRemnantLow) label = "WARM CORE DESTROYED / REMNANT LOW";
  else if (et >= 0.80 || (vtl < 0 && vtu < -5)) label = "COLD CORE / EXTRATROPICAL";
  else if (et >= 0.34 || (vtu < -5 && vtl > 0)) label = "SUBTROPICAL · UPPER COLD / LOWER WARM";
  else if (b >= 10 || et >= 0.25) label = "ASYMMETRIC WARM / HYBRID";
  else if (warm < 0.38) label = "SHALLOW WARM CORE";

  return { simHour: state.simHour || 0, b, vtl, vtu, label };
}

export function drawCyclonePhaseSpaceProduct(
  canvas: HTMLCanvasElement,
  typhoon: Typhoon,
  currentHour: number,
  titleName: string
) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const s = W / 1600;

  ctx.fillStyle = "#f6f7f8";
  ctx.fillRect(0, 0, W, H);

  const history = (typhoon.history || []).filter((h) => h.simHour <= currentHour);
  const current = history.length ? history[history.length - 1] : ({ ...typhoon, simHour: currentHour } as TyphoonState);
  const states = history.length ? history : [current];
  const points = states.map(deriveCyclonePhasePoint);
  const now = points[points.length - 1];

  const outerX = 80 * s;
  const outerY = 82 * s;
  const outerW = W - 160 * s;
  const outerH = H - 164 * s;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(outerX, outerY, outerW, outerH);
  ctx.strokeStyle = "#233244";
  ctx.lineWidth = 6 * s;
  ctx.strokeRect(outerX, outerY, outerW, outerH);

  const plotX = outerX + 70 * s;
  const plotY = outerY + 70 * s;
  const sideW = 270 * s;
  const plotW = outerW - sideW - 110 * s;
  const plotH = outerH - 145 * s;
  const xMin = -10, xMax = 60, yMin = -150, yMax = 250;
  const px = (b: number) => plotX + ((b - xMin) / (xMax - xMin)) * plotW;
  const py = (v: number) => plotY + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Background quadrants, similar in information hierarchy to operational CPS plots.
  ctx.fillStyle = "#fff1f3"; ctx.fillRect(px(xMin), py(250), px(10)-px(xMin), py(0)-py(250));
  ctx.fillStyle = "#fff9dc"; ctx.fillRect(px(10), py(250), px(60)-px(10), py(0)-py(250));
  ctx.fillStyle = "#eaf7ff"; ctx.fillRect(px(xMin), py(0), px(60)-px(xMin), py(-150)-py(0));

  ctx.strokeStyle = "#d8dee6";
  ctx.lineWidth = 1.1 * s;
  ctx.font = `${18*s}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = "#7a8794";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let y = -150; y <= 250; y += 50) {
    ctx.beginPath(); ctx.moveTo(plotX, py(y)); ctx.lineTo(plotX+plotW, py(y)); ctx.stroke();
    ctx.fillText(String(y), plotX-12*s, py(y));
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let x = 0; x <= 60; x += 10) {
    ctx.beginPath(); ctx.moveTo(px(x), plotY); ctx.lineTo(px(x), plotY+plotH); ctx.stroke();
    ctx.fillText(String(x), px(x), plotY+plotH+12*s);
  }

  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 3*s;
  ctx.beginPath(); ctx.moveTo(px(10), plotY); ctx.lineTo(px(10), plotY+plotH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(plotX, py(0)); ctx.lineTo(plotX+plotW, py(0)); ctx.stroke();

  ctx.font = `700 ${20*s}px Arial, sans-serif`;
  ctx.fillStyle = "#c3264f"; ctx.textAlign = "left"; ctx.fillText("DEEP WARM CORE", plotX+12*s, plotY+18*s);
  ctx.fillStyle = "#c77618"; ctx.textAlign = "right"; ctx.fillText("SUBTROPICAL / HYBRID · UPPER COLD", plotX+plotW-12*s, plotY+18*s);
  ctx.fillStyle = "#1582b7"; ctx.textAlign = "right"; ctx.fillText("COLD CORE (EXTRATROPICAL)", plotX+plotW-12*s, plotY+plotH-34*s);

  ctx.save();
  ctx.translate(plotX-48*s, plotY+plotH/2);
  ctx.rotate(-Math.PI/2);
  ctx.fillStyle = "#314255";
  ctx.font = `700 ${18*s}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("Parameter -VTₗ : Lower-Tropospheric Thermal Wind (proxy)", 0, 0);
  ctx.restore();
  ctx.fillStyle = "#1689b8";
  ctx.font = `700 ${18*s}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("Parameter B : Thermal Asymmetry (proxy)", plotX+plotW/2, plotY+plotH+49*s);

  // Use a rolling tail so old long-lived storms remain legible.
  const tail = points.slice(-96);
  ctx.strokeStyle = "#d41424";
  ctx.lineWidth = 4*s;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  tail.forEach((p, i) => i ? ctx.lineTo(px(p.b), py(p.vtl)) : ctx.moveTo(px(p.b), py(p.vtl)));
  ctx.stroke();

  tail.forEach((p, i) => {
    if (i !== tail.length-1 && Math.round(p.simHour) % 6 !== 0) return;
    const isNow = i === tail.length-1;
    ctx.beginPath(); ctx.arc(px(p.b), py(p.vtl), (isNow ? 9 : 5)*s, 0, Math.PI*2);
    ctx.fillStyle = isNow ? "#111827" : "#ef4444"; ctx.fill();
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2*s; ctx.stroke();
    if (!isNow && Math.round(p.simHour) % 12 === 0) {
      ctx.fillStyle = "#525f6d"; ctx.font = `${12*s}px ui-monospace, monospace`; ctx.textAlign = "left";
      ctx.fillText(String(Math.round(p.simHour)), px(p.b)+7*s, py(p.vtl)-8*s);
    }
  });

  const sideX = plotX + plotW + 34*s;
  ctx.fillStyle = "#607080"; ctx.font = `700 ${15*s}px ui-monospace, monospace`; ctx.textAlign = "left";
  ctx.fillText("CURRENT STATUS", sideX, plotY+8*s);
  ctx.fillStyle = "#b91c2f"; ctx.font = `800 ${27*s}px Arial, sans-serif`;
  ctx.fillText(now.label, sideX, plotY+42*s, sideW-18*s);
  ctx.fillStyle = "#394b5d"; ctx.font = `${17*s}px ui-monospace, monospace`;
  ctx.fillText(`B (Asym): ${now.b.toFixed(1)}`, sideX, plotY+90*s);
  ctx.fillText(`-VTₗ: ${now.vtl.toFixed(1)}`, sideX, plotY+120*s);
  ctx.fillText(`-VTᵤ: ${now.vtu.toFixed(1)}`, sideX, plotY+150*s);
  ctx.fillText(`T+${Math.round(now.simHour)} h`, sideX, plotY+180*s);

  ctx.fillStyle = "#172536"; ctx.font = `800 ${26*s}px Arial, sans-serif`; ctx.textAlign = "left";
  ctx.fillText(`CYCLONE PHASE SPACE: ${titleName.toUpperCase()}`, outerX+22*s, outerY-26*s);
  ctx.fillStyle = "#64748b"; ctx.font = `${14*s}px Arial, sans-serif`; ctx.textAlign = "right";
  ctx.fillText("Hart-style structural diagnostic · TyphoonSIM proxy (not reanalysis)", outerX+outerW, outerY-25*s);
  ctx.fillStyle = "#94a3b8"; ctx.font = `${12*s}px Arial, sans-serif`;
  ctx.fillText("SIMULATION ONLY", outerX+outerW-12*s, outerY+outerH-14*s);
}
