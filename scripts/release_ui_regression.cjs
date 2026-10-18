const fs = require('fs');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
// Round 27 explicitly retires the entire left status-card component.
assert(!fs.existsSync('src/components/TyphoonStatusCard.tsx'), 'retired status card still exists');
const app = fs.readFileSync('src/App.tsx','utf8');
const splash = fs.readFileSync('src/components/AetherLaunchSequence.tsx','utf8');
const terms = fs.readFileSync('src/components/AetherTermsModal.tsx','utf8');
const jtwc = fs.readFileSync('src/utils/JtwcForecastProduct.ts','utf8');
const nmc = fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
assert(!app.includes('<TyphoonStatusCard') && app.includes('<AetherDesktopChrome'), 'top chrome should replace retired left panel');
assert(app.includes('loadNaturalEarthData()') && app.includes('initializationReady'), 'startup initialization is not coupled to launch sequence');
assert(splash.includes('<svg') && !/\.png|\.jpe?g/i.test(splash), 'launch screen must stay vector-only');
assert(splash.includes('开发者：Bilibili 晚风渡山月。'), 'author card text mismatch');
assert(terms.includes('禁止倒卖程序') && terms.includes('禁止用于非法用途'), 'required terms prohibitions missing');
assert(jtwc.includes('...coneLeft, ...coneRight, ...terminalArc') && jtwc.includes('coneCenters'), 'JTWC cone is not included in map fitting');
assert(jtwc.includes('terminalArc') && jtwc.includes('ctx.ellipse') && jtwc.includes('polygon = [...coneLeft'), 'JTWC cone does not render a complete swept/closed uncertainty area');
assert(nmc.includes('minTrackY - maxRegularH / 2 - trackGap') && nmc.includes('maxTrackY + maxRegularH / 2 + trackGap'), 'NMC callout rails are not track-relative');
console.log('release_ui_regression: PASS');
