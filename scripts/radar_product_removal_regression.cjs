const fs = require('fs');
const path = require('path');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const read = (p) => fs.readFileSync(p, 'utf8');

assert(!fs.existsSync('src/radar'), 'standalone radar product subsystem still exists');
const forecast = read('src/components/ForecastImageModal.tsx');
const video = read('src/components/VideoExportModal.tsx');
const station = read('src/components/StationReportModal.tsx');
const pkg = JSON.parse(read('package.json'));

for (const [name, src] of [['ForecastImageModal', forecast], ['VideoExportModal', video], ['StationReportModal', station]]) {
  assert(!src.includes('../radar/'), `${name} still imports radar product code`);
  assert(!src.includes('radar_reflectivity'), `${name} still exposes radar_reflectivity product state`);
  assert(!src.includes('雷达回波图'), `${name} still exposes radar image entry`);
  assert(!src.includes('雷达回波视频'), `${name} still exposes radar video entry`);
}
for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
  assert(!/^test:radar-m|^debug:radar-m/.test(name), `obsolete radar regression script remains: ${name}`);
  if (name !== 'test:radar-removed') assert(!String(cmd).includes('src/radar/'), `script ${name} still targets radar subsystem`);
}
assert(/^6\.0\./.test(pkg.version), 'package version must remain on the 6.0.x radar-removal baseline');
console.log('radar product removal regression: PASS');
