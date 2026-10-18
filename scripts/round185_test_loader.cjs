/** Standalone TypeScript test loader. The full UI build needs npm dependencies, but pure
 * numeric modules can be validated offline using the available TypeScript compiler. */
const fs=require('node:fs'), path=require('node:path'), Module=require('node:module');
let ts;try{ts=require('typescript');}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}
require.extensions['.ts'] = function(mod,filename){
 const source=fs.readFileSync(filename,'utf8');
 const out=ts.transpileModule(source,{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 if(out.diagnostics?.some(d=>d.category===1))throw new Error(filename+': '+out.diagnostics.map(d=>d.messageText).join('; '));
 mod._compile(out.outputText,filename);
};
module.exports={load:(name)=>require(path.join(__dirname,'..',name)),ts};
