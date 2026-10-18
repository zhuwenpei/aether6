const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.css'), 'utf8');
const marker = 'Round 57: dry-air drawing toolbar must size itself from its actual containing block on phones.';
if (!css.includes(marker)) throw new Error('Round 57 mobile dry-air toolbar fix marker missing');
const tail = css.slice(css.lastIndexOf(marker));
if (!/body\.aether-mobile-ui \.dry-air-toolbar\s*\{[\s\S]*?left:50% !important;/.test(tail)) {
  throw new Error('Dry-air toolbar is not centered at 50%');
}
if (!/width:min\(520px,calc\(var\(--aether-vvw,100vw\) - 16px - env\(safe-area-inset-left,0px\) - env\(safe-area-inset-right,0px\)\)\) !important;/.test(tail)) {
  throw new Error('Dry-air toolbar width must use the exported VisualViewport width');
}
const rule = tail.slice(tail.indexOf('body.aether-mobile-ui .dry-air-toolbar {'));
if (/width:min\(520px,calc\(100vw/.test(rule)) {
  throw new Error('Round 57 override regressed to layout-viewport 100vw sizing');
}
if (!/transform:translateX\(-50%\) !important;/.test(tail)) {
  throw new Error('Dry-air toolbar center transform missing');
}
console.log('Round 57 mobile dry-air toolbar regression: PASS');
