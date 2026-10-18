const fs=require('fs');
const p='src/utils/MapProjection.ts';
const src=fs.readFileSync(p,'utf8');
function ok(cond,msg){if(!cond){console.error('FAIL:',msg);process.exitCode=1}else console.log('PASS:',msg)}
ok(src.includes('const localScale = worldSize / (2 * Math.PI);'),'LAEA pixel scale is exactly the requested zoom scale');
ok(!src.includes('safeMinimumScale'),'LAEA has no automatic minimum-scale override');
ok(!src.includes('safeDiskRadius'),'LAEA has no edge-driven zoom clamp');
ok(!src.includes('halfDiagonalPx'),'canvas aspect ratio cannot alter LAEA zoom');
ok(!src.includes('Math.max(requestedScale'),'LAEA never auto-zooms to hide the finite projection edge');
ok(!src.includes('/ Math.cos(phi0)'),'LAEA scale remains independent of moving storm latitude');
