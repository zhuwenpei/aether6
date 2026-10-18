const fs = require('fs');
const assert = require('assert');

const engine = fs.readFileSync('src/simulation/Engine.ts','utf8');
const ensemble = fs.readFileSync('src/utils/EnsembleReferenceProducts.ts','utf8');
const wiki = fs.readFileSync('src/utils/WikiTrackMapProduct.ts','utf8');
const report = fs.readFileSync('src/components/TyphoonReport.tsx','utf8');
const reportModal = fs.readFileSync('src/components/TyphoonReportModal.tsx','utf8');

for (const token of [
  '{ category: "C1" as const, label: "Category 1", minKt: 64, maxKt: 82',
  '{ category: "C2" as const, label: "Category 2", minKt: 83, maxKt: 95',
  '{ category: "C3" as const, label: "Category 3", minKt: 96, maxKt: 112',
  '{ category: "C4" as const, label: "Category 4", minKt: 113, maxKt: 136',
  '{ category: "C5" as const, label: "Category 5", minKt: 137, maxKt: Infinity'
]) assert(engine.includes(token), `missing SSHWS threshold: ${token}`);

assert(engine.includes('getAgencyIntensity(vmaxCmaMs, "JTWC", reportingMode)'), 'SSHWS helper must classify JTWC 1-min intensity');
assert(engine.includes('The public mode follows the simulator\'s JTWC 5-kt reporting bins'), 'JTWC public-bin intent missing');
assert(wiki.includes('getJtwcSshwsAssessment(vmaxMps, "public")'), 'Wiki markers must use centralized JTWC SSHWS assessment');
assert(!wiki.includes('vmaxMps) * 1.94384449'), 'Wiki C1-C5 must not directly convert internal m/s to kt');
assert(ensemble.includes('getJtwcSshwsAssessment(vmaxMps, "public")'), 'ensemble category colors must use JTWC SSHWS assessment');
assert(!ensemble.includes('const KT_PER_MPS'), 'ensemble C1-C5 code should not retain direct m/s->kt category conversion constant');
assert(report.includes('getJtwcSshwsAssessment(maxV, "public")'), 'report impact C1-C5 must use JTWC SSHWS assessment');
assert(reportModal.includes('getAgencyIntensity(Number(p.vmax||0), "JTWC", "continuous")'), 'Patricia-style wind curve must use JTWC 1-min wind');
assert(reportModal.includes('JTWC_SSHWS_BANDS'), 'report category thresholds must come from the centralized SSHWS table');

console.log('round54_jtwc_sshws_regression: PASS');
