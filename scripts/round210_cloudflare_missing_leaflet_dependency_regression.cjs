/** R210: verify the R209 Cloudflare failure is corrected without altering bun.lock. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { builtinModules } = require('node:module');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const components = [
  'src/cloudCompositor/components/Step1Target.tsx',
  'src/cloudCompositor/components/Step2Typhoon.tsx',
  'src/cloudCompositor/components/SmartWMSTileLayer.tsx'
];
const bridgeName = 'src/cloudCompositor/lib/LeafletReactLite.tsx';
const bridge = read(bridgeName);
const packageJson = JSON.parse(read('package.json'));
const manifest = {...packageJson.dependencies, ...packageJson.devDependencies};
let count = 0;
function check(label, ok) { assert.ok(ok,label); console.log(`PASS ${label}`); count++; }
for (const file of components) {
  const source = read(file);
  check(`${path.basename(file)} no unresolved react-leaflet`, !/from\s*['"]react-leaflet['"]/.test(source));
  check(`${path.basename(file)} imports local Leaflet bridge`, source.includes("from '../lib/LeafletReactLite'"));
}
check('local bridge exists', fs.existsSync(path.join(root,bridgeName)));
check('bridge creates actual Leaflet map', /L\.map\(elementRef\.current/.test(bridge));
check('bridge releases map on unmount', /nextMap\.remove\(\)/.test(bridge));
check('bridge exposes map context', /MapContext\.Provider/.test(bridge) && /export function useMap/.test(bridge));
check('bridge creates WMS tiles with Leaflet', /L\.tileLayer\.wms\(/.test(bridge));
check('bridge puts WMS tiles on actual map', /\.addTo\(map\)/.test(bridge));
check('bridge releases WMS tiles', /map\.removeLayer\(layer\)/.test(bridge));
check('bridge attaches forwarded refs', /ref\.current\s*=\s*nextMap/.test(bridge) && /ref\.current\s*=\s*layer/.test(bridge));
check('bridge clears refs on cleanup', /ref\.current\s*=\s*null/.test(bridge));
check('bridge preserves WMS options', /L\.tileLayer\.wms\(layerUrl, layerOptions\)/.test(bridge));
check('react and leaflet remain dependencies', Boolean(manifest.react && manifest.leaflet));
check('react-leaflet removed from manifest', !Object.hasOwn(packageJson.dependencies,'react-leaflet'));
check('react-leaflet absent from Bun frozen lock', !read('bun.lock').includes('\"react-leaflet\"'));
check('react-leaflet not needed as external', !/react-leaflet/.test(read('vite.config.ts')));
check('NMC prebuild untouched', packageJson.scripts.prebuild === 'node scripts/prepare_nmc_provinces.mjs');
check('low-memory Vite transform retained', /minify:\s*false/.test(read('vite.config.ts')) && /cssMinify:\s*false/.test(read('vite.config.ts')));
check('Bun frozen lock still present', fs.existsSync(path.join(root,'bun.lock')));
const builtins = new Set(builtinModules.map(x=>x.replace(/^node:/,'')));
const missing = [];
const external = new Set();
function walk(dir) {
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,ent.name);
    if (ent.isDirectory()) {walk(p); continue;}
    if (!/\.(?:ts|tsx|js|jsx)$/.test(ent.name)) continue;
    const src=fs.readFileSync(p,'utf8');
    // Recognize top-level ESM imports / dynamic imports, not comments or quoted examples.
    const re=/^\s*(?:import\s+(?:(?:type\s+)?[\w*{},\s]+\s+from\s+)?|export\s+(?:type\s+)?(?:[\w*{},\s]+\s+from\s+))['"]([^'"]+)['"]/gm;
    let m;
    while ((m=re.exec(src))) {
      const spec=m[1];
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) continue;
      const pkg=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
      if(builtins.has(pkg)||spec.startsWith('node:'))continue;
      external.add(pkg);
      if(!manifest[pkg])missing.push(`${path.relative(root,p)}: ${pkg}`);
    }
  }
}
walk(path.join(root,'src'));
check('source package imports all declared', missing.length===0);
check('entire source no react-leaflet dependency', !external.has('react-leaflet'));
console.log(`R210 Cloudflare dependency regression: ${count}/${count} PASS; checked ${external.size} external packages`);
