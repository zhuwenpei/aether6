/* Round182 targeted NMC memory/content + cooperative vector drawing regression. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const root = path.join(__dirname,'..');
const nmc = fs.readFileSync(path.join(root,'src/utils/NmcForecastProduct.ts'),'utf8');
const modal = fs.readFileSync(path.join(root,'src/components/ForecastImageModal.tsx'),'utf8');
const safety=fs.readFileSync(path.join(root,'src/utils/NmcRenderSafety.ts'),'utf8');
const transpile = (text,file) => {
 const js=ts.transpileModule(text,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}});
 assert.equal(js.diagnostics?.length||0,0,`invalid TypeScript in ${file}`);
 return js.outputText;
};
for(const [file,code] of [['NmcForecastProduct.ts',nmc],['NmcRenderSafety.ts',safety],['ForecastImageModal.tsx',modal]]){
 const sf=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.equal(sf.parseDiagnostics.length,0,`${file}: ${sf.parseDiagnostics.map(x=>x.messageText)}`);
}
assert(nmc.includes('function* drawBaseMapSteps'));
assert(nmc.includes('export async function drawNmcForecastProductCooperative'));
assert(nmc.includes('export function hasNmcRenderedContent'));
assert(modal.includes('previewAbortRef.current?.abort()'));
assert(modal.includes('canvas.width = 1;'));
assert(modal.includes('if (!hasNmcRenderedContent(canvas)) throw'));
assert(modal.includes('await renderImage(1280)'), 'single low-resolution retry');
assert(modal.includes('nmcRenderedSize'), 'actual output size shown');
assert(modal.includes('chooseSafeNmcWidth(selectedRes.width, detectNmcDeviceClass(!!mobileMode))'));
const mod={exports:{}};
new Function('require','module','exports',transpile(safety,'NmcRenderSafety.ts'))(require,mod,mod.exports);
const f=mod.exports.chooseSafeNmcWidth;
assert.equal(f(7680,{mobile:true,deviceMemoryGb:2})<=1790,true,'low-RAM phone output capped');
assert.equal(f(7680,{mobile:true})<=2200,true,'unknown iOS RAM capped');
assert.equal(f(7680,{mobile:false,deviceMemoryGb:4})<=4100,true,'desktop output capped unless high-RAM');
assert.equal(f(7680,{mobile:false,deviceMemoryGb:8}),7680,'8K retained for explicitly high-RAM desktop');
assert.equal(f(640,{mobile:true}),640,'small preview never enlarged');
console.log('ROUND182 NMC safety static + numeric: PASS');
