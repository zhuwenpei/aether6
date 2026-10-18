const fs = require('fs');
const assert = require('assert');
const report = fs.readFileSync('src/components/TyphoonReportModal.tsx','utf8');
const wiki = fs.readFileSync('src/utils/WikiTrackMapProduct.ts','utf8');

assert(report.includes('setReportType("wiki")'), 'Wiki report type button missing');
assert(report.includes('drawWikiTrackMap'), 'Wiki renderer is not wired into report modal');
assert(report.includes('reportType === "wiki"'), 'Wiki report state branch missing');
assert(report.includes('if (reportType === "wiki") return;') && report.includes('fullResolutionExport'), 'Async Wiki export guard missing');

for (const [name,hex] of Object.entries({
  disturbance:'#1591DE', td:'#6EC1EA', ts:'#4DFFFF', c1:'#FFFFD9', c2:'#FFD98C', c3:'#FF9E59', c4:'#FF738A', c5:'#A188FC'
})) {
  assert(wiki.includes(hex), `Wiki palette missing ${name} ${hex}`);
}
assert(wiki.includes('first + 6') && wiki.includes('target += 6'), 'Track is not sampled at 6-hour cadence');
assert(wiki.includes('getTileUrl("blueMarble"'), 'NASA Blue Marble tile source missing');
assert(wiki.includes('"circle" | "square" | "triangle"'), 'Storm-nature symbol set incomplete');
assert(wiki.includes('ctx.lineTo'), 'Straight best-track line segments missing');
assert(!wiki.includes('bezierCurveTo') && !wiki.includes('quadraticCurveTo'), 'Wiki track must not use smoothed curves');
assert(wiki.includes('rgba(255,255,255,.96)'), 'White Wiki track line missing');
console.log('round53_wiki_track_regression: PASS');
