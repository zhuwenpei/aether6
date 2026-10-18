const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth01 = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};

export interface ZonalResidualSeamFilterOptions {
  nx: number;
  ny: number;
  u: Float32Array;
  v: Float32Array;
  referenceU: Float32Array;
  referenceV: Float32Array;
  landMask: Uint8Array;
  /** 0 = preserve as-is, 1 = fully eligible for seam repair. */
  eligibility?: Float32Array;
}

export interface ZonalResidualSeamFilterDiagnostics {
  repairedCells: number;
  maxCorrectionMs: number;
  maxDetectedCrossRowResidualJumpMs: number;
}

/**
 * Remove narrow, horizontally coherent numerical seams from the *residual* boundary-layer wind.
 *
 * Important: this does not smooth the meteorological reference field. We subtract the already
 * composed environment + TC vector first, diagnose only residual anomalies introduced by the
 * iterative/post-solver chain, and repair a cell only when the residual changes much more across
 * latitude than along the row. Genuine TC gradients/rainband asymmetry are therefore retained in
 * referenceU/referenceV instead of being mistaken for a seam.
 */
export function suppressZonalResidualSeams(options: ZonalResidualSeamFilterOptions): ZonalResidualSeamFilterDiagnostics {
  const { nx, ny, u, v, referenceU, referenceV, landMask, eligibility } = options;
  const srcU = new Float32Array(u);
  const srcV = new Float32Array(v);
  const dstU = new Float32Array(u);
  const dstV = new Float32Array(v);
  let repairedCells = 0;
  let maxCorrectionMs = 0;
  let maxDetectedCrossRowResidualJumpMs = 0;

  const residual = (k: number): [number, number] => [srcU[k] - referenceU[k], srcV[k] - referenceV[k]];

  // Use rows 2-3 cells away as the cross-row reference. A visible product seam is usually 1-3
  // solver rows thick; sampling only j±1 would let the middle of a three-row stripe self-validate.
  for (let j = 3; j < ny - 3; j++) {
    for (let i = 2; i < nx - 2; i++) {
      const k = j * nx + i;
      if (landMask[k]) continue;
      const gate = eligibility ? clamp(eligibility[k], 0, 1) : 1;
      if (gate < 0.03) continue;

      const [ru, rv] = residual(k);
      const residualMagnitude = Math.hypot(ru, rv);
      if (residualMagnitude < 0.65) continue;

      let vertU = 0, vertV = 0, vertW = 0;
      for (const [dj, w] of [[-3, 0.75], [-2, 1.0], [2, 1.0], [3, 0.75]] as const) {
        const q = (j + dj) * nx + i;
        if (landMask[q]) continue;
        const [qu, qv] = residual(q);
        vertU += qu * w;
        vertV += qv * w;
        vertW += w;
      }
      if (vertW < 1.5) continue;
      vertU /= vertW;
      vertV /= vertW;
      const verticalResidualMagnitude = Math.hypot(vertU, vertV);
      const crossRowJump = Math.hypot(ru - vertU, rv - vertV);
      maxDetectedCrossRowResidualJumpMs = Math.max(maxDetectedCrossRowResidualJumpMs, crossRowJump);
      if (crossRowJump < 1.15) continue;

      const [rlu, rlv] = residual(k - 1);
      const [rru, rrv] = residual(k + 1);
      const alongRowVariation = 0.5 * (
        Math.hypot(ru - rlu, rv - rlv) + Math.hypot(ru - rru, rv - rrv)
      );
      // A seam is coherent along longitude and abrupt across latitude. Broad/curved meteorological
      // structures normally have comparable gradients in both directions, so they fail this test.
      const anisotropy = clamp(1 - alongRowVariation / Math.max(0.45, crossRowJump * 0.82), 0, 1);
      if (anisotropy < 0.16) continue;

      // Crucial anti-bleed guard: only modify the row whose residual is more anomalous than the
      // surrounding rows. This prevents clean rows immediately north/south of a seam from being
      // pulled toward the bad band.
      const residualExcess = residualMagnitude - verticalResidualMagnitude;
      if (residualExcess < 0.55) continue;
      const anomalyGate = smooth01((residualExcess - 0.45) / 2.65) * smooth01((crossRowJump - 0.85) / 2.8);
      const repair = clamp(gate * anisotropy * anomalyGate * 0.90, 0, 0.86);
      if (repair < 0.025) continue;

      const targetU = referenceU[k] + ru * (1 - repair) + vertU * repair;
      const targetV = referenceV[k] + rv * (1 - repair) + vertV * repair;
      const correction = Math.hypot(targetU - srcU[k], targetV - srcV[k]);
      if (correction < 0.03) continue;
      dstU[k] = targetU;
      dstV[k] = targetV;
      repairedCells++;
      maxCorrectionMs = Math.max(maxCorrectionMs, correction);
    }
  }

  u.set(dstU);
  v.set(dstV);
  return { repairedCells, maxCorrectionMs, maxDetectedCrossRowResidualJumpMs };
}
