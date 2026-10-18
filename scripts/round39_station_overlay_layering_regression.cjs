const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const station = fs.readFileSync(path.join(root, 'src/components/StationHistory.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

function requireCheck(ok, message) {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

requireCheck(/import\s+\{\s*createPortal\s*\}\s+from\s+["']react-dom["']/.test(station),
  'StationHistory imports createPortal from react-dom');
requireCheck(/return\s+createPortal\s*\(\s*\(/.test(station),
  'station workspace is rendered through a React portal');
requireCheck(/\),\s*document\.body\s*\);/.test(station),
  'station workspace portal targets document.body/root stacking context');
requireCheck(/#typhoon-gis-viewport\s*\{[^}]*contain\s*:\s*layout\s+paint\s+style\s*;?[^}]*\}/s.test(css),
  'MapView paint containment remains enabled for map-render performance');
requireCheck(/aether-glass-overlay fixed inset-0 z-\[9999\]/.test(station),
  'station workspace keeps its full-screen high-z overlay after portaling');

if (!process.exitCode) console.log('Round 39 station overlay layering regression passed.');
