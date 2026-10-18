/* Tests SDK loader callback, credential URL, error fallback and abort with a fake DOM. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const src=fs.readFileSync(path.join(__dirname,'../src/components/TyphoonNetworkSimulator.tsx'),'utf8');
const start=src.indexOf('async function loadPetalMapsApi('),end=src.indexOf('export default function TyphoonNetworkSimulator(',start);
assert(start>0&&end>start,'Petal loader not found');
const out=ts.transpileModule(src.slice(start,end)+'\nexports.loadPetalMapsApi=loadPetalMapsApi;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function loaderEnv({fail=false,existing=null,abortBefore=false}={}){
 const window={HWMapJsSDK:existing,setTimeout,clearTimeout};let lastTag=null,removed=false;
 const document={createElement:()=>({remove(){removed=true}}),head:{appendChild(tag){lastTag=tag;if(fail){setImmediate(()=>tag.onerror());return;}
  setImmediate(()=>{const u=new URL(tag.src);window.HWMapJsSDK={HWMap:function HWMap(){}};
   if(typeof window[u.searchParams.get('callback')]==='function')window[u.searchParams.get('callback')]();});}}};
 const mod={};vm.runInNewContext(out,{exports:mod,window,document,setTimeout,clearTimeout,Math,Date,Error});
 const controller=new AbortController();if(abortBefore)controller.abort();
 return {load:mod.loadPetalMapsApi,window,controller,src:()=>lastTag?.src,removed:()=>removed};
}
(async()=>{
 let n=0;const check=async(name,fn)=>{await fn();n++;console.log('PASS',name)};
 await check('official SDK key encoded + callback resolves',async()=>{
  const env=loaderEnv();const api=await env.load('key+/=&测试',env.controller.signal);
  assert.equal(typeof api.HWMap,'function');const url=new URL(env.src());
  assert.equal(url.hostname,'mapapi.cloud.huawei.com');assert.equal(url.searchParams.get('key'),'key+/=&测试');
  assert(url.searchParams.get('callback').startsWith('aetherPetalReady_'));
 });
 await check('preloaded SDK reused without reloading script',async()=>{
  const sdk={HWMap:function HWMap(){}};const env=loaderEnv({existing:sdk});
  assert.equal(await env.load('abc',env.controller.signal),sdk);assert.equal(env.src(),undefined);
 });
 await check('script error rejects and cleans up',async()=>{
  const env=loaderEnv({fail:true});await assert.rejects(env.load('abc',env.controller.signal),/SDK 加载失败/);assert(env.removed());
 });
 await check('aborting during request rejects',async()=>{
  const env=loaderEnv();const promise=env.load('abc',env.controller.signal);env.controller.abort();await assert.rejects(promise,/地图切换已取消/);
 });
 console.log(`PETAL SDK LOADER ${n}/${n} PASS`);
})().catch(e=>{console.error(e);process.exitCode=1});
