'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const source=ts.transpileModule(fs.readFileSync('src/components/ForecastPreSimulation.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/import\.meta\.url/g, '"http://localhost/"'); // VM fixture: Vite worker URL is unavailable in CommonJS
const hooks={states:[],refs:[],slot:0,effects:[],updates:new Map()};
const react={useState(init){const n=hooks.slot++;if(!(n in hooks.states))hooks.states[n]=typeof init==='function'?init():init;return [hooks.states[n],v=>{hooks.states[n]=typeof v==='function'?v(hooks.states[n]):v;hooks.updates.set(n,(hooks.updates.get(n)||0)+1)}]},useRef(init){const n=hooks.slot++;if(!(n in hooks.refs))hooks.refs[n]={current:init};return hooks.refs[n]},useEffect(fn){hooks.slot++;hooks.effects.push(fn)}};
const fakeJSX={Fragment:'fragment',jsx:(type,props)=>({type,props:props||{}}),jsxs:(type,props)=>({type,props:props||{}})};
let raf=null;let elapsed=0;const engineCalls=[];
const fakeTyphoonEngine=class {
 constructor(){} restorePrngState(){}syncPrngToHour(){}capturePrngState(){return 1;}
 stepSimulation([storm],cfg,h){engineCalls.push({cfg:{...cfg},hour:h,forcedDryAir:storm.forcedDryAir,forcedShear:storm.forcedShear});return {updatedTyphoons:[{...storm,simHour:h,vmax:storm.vmax+0.2,history:[...storm.history,{simHour:h,vmax:storm.vmax+0.2}]}]};}
};
const ctor={};const fakeComponent=name=>(ctor[name]=function Component(){});
for(const name of ['MapView','VirtualJoystick','ControlDrawer','AetherMobileChrome','AetherDesktopChrome','ForecastSandboxTools'])fakeComponent(name);
const moduleObj={exports:{}};
const ctx={module:moduleObj,exports:moduleObj.exports,require(id){
 if(id==='react')return react;
 if(id==='react/jsx-runtime')return fakeJSX;
 if(id==='lucide-react')return Object.fromEntries(['Check','X','Play','Pause','RotateCcw','Route'].map(x=>[x,()=>null]));
 if(id==='../simulation/Engine')return {TyphoonEngine:fakeTyphoonEngine,reweightLiveWindRadiiForPreference:x=>x};
 if(id==='../simulation/CirculationSizeTransition')return {resolveCirculationSizeTransition:config=>({referenceKm:config.circulationSizeReferenceKm||380})};
 if(id==='../simulation/PreSimulationReference')return {buildPreSimulationReference:()=>({})};
 if(id==='../utils/SimulationArchive')return {createSimulationArchiveBlob(){},readSimulationArchiveFile(){}};
 if(id==='../simulation/ForecastSandboxInterventions')return {applyForecastSandboxIntervention(ty,type,option){return {...ty,[type==='dry_air'?'forcedDryAir':'forcedShear']:type==='dry_air'?option:Number(option)};},clearForecastSandboxPenalties:x=>x};
 if(id.startsWith('./'))return {default:ctor[id.slice(2)]||fakeComponent(id.slice(2))};
 throw Error('unmocked import '+id);
},
 structuredClone,Date,Math,Number,Array,Object,Boolean,Error,Map,Set,console,
 window:{addEventListener(){},removeEventListener(){}},performance:{now:()=>elapsed},
 requestAnimationFrame(fn){raf=fn;return 1},cancelAnimationFrame(){},
 document:{fullscreenElement:null,documentElement:{requestFullscreen(){}}}
};
vm.runInNewContext(source,ctx,{filename:'ForecastPreSimulation.js'});
const Simulation=moduleObj.exports.default;
const storm={id:'test',lat:20,lon:135,vmax:50,pmin:950,speed:20,direction:300,rmw:30,active:true,dissipated:false,history:[{simHour:80,lat:20,lon:135,vmax:50}],r7:{ne:200,nw:200,se:200,sw:200},r10:{ne:100,nw:100,se:100,sw:100},r12:{ne:50,nw:50,se:50,sw:50}};
const props={initial:storm,issueHour:80,config:{maxIntensityLimitEnabled:false,maxIntensityLimit:60,circulationSizeReferenceKm:380},layers:{},seed:'test',randomState:12,startDate:new Date('2026-07-01'),onConfirm(){},onCancel(){},mobileChrome:false};
function render(){hooks.slot=0;hooks.effects=[];return Simulation(props)}
const find=(node,kind)=>{if(Array.isArray(node)){for(const a of node){const n=find(a,kind);if(n)return n;}return null}
 if(!node||typeof node!=='object')return null;
 if(node.type===kind)return node;
 return find(node.props?.children,kind)};
let view=render();hooks.effects.forEach(fn=>fn());assert(raf);
const all=[];const visit=n=>{if(Array.isArray(n))return n.forEach(visit);if(!n||typeof n!=='object')return;if(n.type==='button')all.push(n);visit(n.props?.children)};visit(view);
const play=all.find(b=>b.props['aria-label']==='播放预模拟');assert(play);play.props.onClick();
for(let i=1;i<=60;i++){elapsed=i*16;const cb=raf;cb(elapsed);}
const physical=engineCalls.length,presented=hooks.updates.get(0)||0;
assert(physical>25,'not enough real 10-minute integration steps: '+physical);
assert(presented>0 && presented<15,'React/Leaflet presentation not throttled: '+presented);
assert(physical>presented*3,'physics resolution accidentally coarsened');
console.log(`ROUND163 RENDER PASS: ${physical} unchanged physics steps, ${presented} React storm updates over 960 ms.`);
