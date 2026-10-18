const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');const assert=require('node:assert/strict');
let ts;try{ts=require('typescript');}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}
const source=fs.readFileSync(path.join(__dirname,'../src/utils/TyphoonNetworkData.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
vm.runInNewContext(js,{exports:mod.exports,module:mod,require:()=>({getWindForceCategory:x=>Math.round(x/3),materializeForecastPath:()=>[]})});
const params=process.argv.slice(2);if(params.length<1)throw Error('Requires actual existing archive paths as arguments.');
const results=[];
for(const file of params){
 const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
 const storm=parsed.data.typhoons[0];const input=JSON.stringify(storm.history);
 const hist=mod.exports.threeHourlyNetworkHistory(storm);
 assert(hist.length>=1);
 assert.equal(hist[0].simHour,storm.history[0].simHour);
 assert.equal(hist.at(-1).simHour,storm.history.at(-1).simHour);
 assert.equal(JSON.stringify(storm.history),input);
 assert(hist.every((p,i)=>i===0||p.simHour>hist[i-1].simHour));
 assert(hist.slice(1,-1).every(x=>Math.abs(x.simHour/3-Math.round(x.simHour/3))<1e-4));
 results.push({name:storm.name,originalHours:storm.history.length,networkFixes:hist.length,first:hist[0].simHour,last:hist.at(-1).simHour,preserved:true});
}
console.log(JSON.stringify(results,null,2));
