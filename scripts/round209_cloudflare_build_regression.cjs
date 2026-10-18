const fs = require('fs');
const assert = require('assert');
const path = require('path');
const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
const checks = [
  ['Tailwind explicit sources', css.includes('@import "tailwindcss" source(none)')],
  ['Scan src', css.includes('@source "./"')],
  ['Scan entry HTML', css.includes('@source "../index.html"')],
  ['No massive build-time minification', /minify:\s*false/.test(vite)],
  ['No CSS minification peak', /cssMinify:\s*false/.test(vite)],
  ['No gzip reporting peak', /reportCompressedSize:\s*false/.test(vite)],
  ['No sourcemaps', /sourcemap:\s*false/.test(vite)],
  ['NMC prebuild preserved', JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).scripts.prebuild === 'node scripts/prepare_nmc_provinces.mjs'],
  ['Network module preserved', fs.existsSync(path.join(root,'src/components/TyphoonNetworkSimulator.tsx'))],
  ['NMC module preserved', fs.existsSync(path.join(root,'src/utils/NmcForecastProduct.ts'))],
];
for (const [name, result] of checks) { assert(result, name); console.log('PASS',name); }
console.log(`${checks.length}/${checks.length} PASS`);
