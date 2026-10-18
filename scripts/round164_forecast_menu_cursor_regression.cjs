'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const js=ts.transpileModule(fs.readFileSync('src/components/ForecastPreSimulation.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
}).outputText.replace(/import\.meta\.url/g, '"http://localhost/"'); // VM fixture: Vite worker URL is unavailable in CommonJS
const hooks={states:[],refs:[],slot:0,effects:[]};
const react={
  useState(init){const idx=hooks.slot++;if(!(idx in hooks.states))hooks.states[idx]=typeof init==='function'?init():init;
    return [hooks.states[idx],v=>{hooks.states[idx]=typeof v==='function'?v(hooks.states[idx]):v;}]},
  useRef(init){const idx=hooks.slot++;if(!(idx in hooks.refs))hooks.refs[idx]={current:init};return hooks.refs[idx]},
  useEffect(fn){hooks.slot++;hooks.effects.push(fn)}
};
const jsx={Fragment:'fragment',jsx:(type,props)=>({type,props:props||{}}),jsxs:(type,props)=>({type,props:props||{}})};
const constructors={};
for(const name of ['MapView','VirtualJoystick','ControlDrawer','AetherMobileChrome','AetherDesktopChrome','ForecastSandboxTools'])constructors[name]=function Component(){};
let raf;
const FakeEngine=class{
  constructor(){}restorePrngState(){}syncPrngToHour(){}capturePrngState(){return 1;}
  stepSimulation([storm],cfg,h){const history=[...storm.history];
    if(Math.abs(h-Math.round(h))<1e-6)history.push({...storm,simHour:h,lat:20+(h-80),vmax:50-(h-80)});
    return {updatedTyphoons:[{...storm,simHour:h,lat:20+(h-80),vmax:50-(h-80),history}]};}
};
const moduleObj={exports:{}};
const env={module:moduleObj,exports:moduleObj.exports,require(id){
  if(id==='react')return react;
  if(id==='react/jsx-runtime')return jsx;
  if(id==='lucide-react')return Object.fromEntries(['Check','X','Play','Pause','RotateCcw','Route'].map(k=>[k,()=>null]));
  if(id==='../simulation/Engine')return{TyphoonEngine:FakeEngine,reweightLiveWindRadiiForPreference:x=>x};
  if(id==='../simulation/CirculationSizeTransition')return{resolveCirculationSizeTransition:()=>({referenceKm:380})};
  if(id==='../simulation/PreSimulationReference')return{buildPreSimulationReference:()=>({})};
  if(id==='../utils/SimulationArchive')return{createSimulationArchiveBlob(){},readSimulationArchiveFile(){}};
  if(id==='../simulation/ForecastSandboxInterventions')return{applyForecastSandboxIntervention:ty=>ty,clearForecastSandboxPenalties:ty=>ty};
  if(id.startsWith('./'))return{default:constructors[id.slice(2)]};
  throw Error('unsupported '+id);
},
 structuredClone,Date,Math,Number,Array,Object,Boolean,Error,Map,Set,console,
 window:{addEventListener(){},removeEventListener(){}},performance:{now:()=>0},
 requestAnimationFrame(fn){raf=fn;return 1;},cancelAnimationFrame(){},
 document:{fullscreenElement:null,documentElement:{requestFullscreen(){}}}
};
vm.runInNewContext(js,env,{filename:'ForecastPreSimulation.js'});
const storm={id:'cursor',lat:20,lon:135,vmax:50,pmin:950,speed:20,active:true,dissipated:false,
  simHour:80,history:[{simHour:80,lat:20,vmax:50,lon:135}],r7:{},r10:{},r12:{}};
const props={initial:storm,issueHour:80,config:{},layers:{},seed:'test',startDate:new Date('2026-07-01'),
  onConfirm(){},onCancel(){}};
const render=()=>{hooks.slot=0;hooks.effects=[];return moduleObj.exports.default(props);};
function find(node,predicate){if(Array.isArray(node)) {for(const n of node){const v=find(n,predicate);if(v)return v;}return null;}
  if(!node||typeof node!=='object')return null;
  if(predicate(node))return node;
  return find(node.props?.children,predicate);}
const control=(node,kind)=>find(node,n=>n.type===constructors[kind]);
function expectHour(node,h,label){const view=control(node,'MapView');assert(view,`${label}: missing map`);
  assert.equal(view.props.currentHour,h,`${label}: replay cursor moved`);
  assert(Math.abs(view.props.typhoons[0].lat-(20+h-80))<1e-5,`${label}: map storm replaced by latest state`);}
let view=render();hooks.effects.forEach(e=>e());
const play=find(view,n=>n.type==='button'&&n.props['aria-label']==='播放预模拟');assert(play);
play.props.onClick();render();
for(let t=100;t<=700;t+=100)raf(t); // 8x simulation, enough for 81h/82h history
view=render();assert(control(view,'MapView').props.currentHour>82,'test did not generate future hours');
const seek=find(view,n=>n.type==='input'&&n.props['aria-label']==='预模拟时间回放');assert(seek);
seek.props.onChange({target:{value:'81'}});
view=render();expectHour(view,81,'before menu');
const chrome=control(view,'AetherDesktopChrome');chrome.props.onInfluence();
view=render();expectHour(view,81,'quick tools opened');
let tools=control(view,'ForecastSandboxTools');assert(tools);tools.props.onClose();
view=render();expectHour(view,81,'quick tools closed');
control(view,'AetherDesktopChrome').props.onSettings();
view=render();expectHour(view,81,'settings opened');
let drawer=control(view,'ControlDrawer');assert(drawer.props.isOpen);drawer.props.onClose();
view=render();expectHour(view,81,'settings closed');
control(view,'AetherDesktopChrome').props.onMoreOpen();
view=render();expectHour(view,81,'more opened');
// Editing a past point intentionally forks at that SAME point, not the previous
// branch's unrendered live hour; closing tools must keep the selected cursor.
control(view,'AetherDesktopChrome').props.onInfluence();
view=render();tools=control(view,'ForecastSandboxTools');
tools.props.onConfig({rapidIntensifyEnabled:false});
view=render();expectHour(view,81,'branch setting edited at historic node');
tools.props.onClose();
view=render();expectHour(view,81,'forked tools closed');
assert.equal(control(view,'MapView').props.historicalPlayback,true,'editing should remain paused');
console.log('ROUND164 CURSOR PASS: paused historical replay stays at selected hour when opening/closing quick tools, settings and More.');
