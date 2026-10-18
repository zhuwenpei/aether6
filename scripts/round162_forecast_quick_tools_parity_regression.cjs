'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const app=fs.readFileSync('src/App.tsx','utf8');
const sandbox=fs.readFileSync('src/components/ForecastPreSimulation.tsx','utf8');
const ui=fs.readFileSync('src/components/ForecastSandboxTools.tsx','utf8');
const original=app.slice(app.indexOf('          <div className="aether-influence-overlay'), app.indexOf('\n        )}\n\n        {/* 3. Top-Right UI Controls */}',app.indexOf('          <div className="aether-influence-overlay')));
const migrated=ui.slice(ui.indexOf('          <div className="aether-influence-overlay'),ui.indexOf('    {inputDialog&&'));
// Round162 shares the complete 7-category live UI, not a second, reduced UI.
const normalized= s=>s.replace(/\s+aria-label="目标风速"|\s+aria-label="目标风圈"/g,'').replace(/\s+/g,'');
assert.strictEqual(normalized(migrated),normalized(original),'Forecast quick-tool JSX diverged from live modal');
assert(sandbox.includes('configRef.current=next;'),'RAF does not synchronously receive UI parameter changes');
assert(sandbox.includes('if(cursor<endRef.current-1e-5){pauseSandbox();startSandboxFrom(cursor);}'),'Replay interventions must fork');
assert(sandbox.includes('const next={...configRef.current,...patch};'),'Config patches do not merge latest runtime values');
assert(sandbox.includes('onCirculationDuration={setCirculationTransitionDuration}'),'Transition slider missing physical callback');
assert(sandbox.includes('playingRef.current=true;setPlaying(true);'),'Playback mechanism missing');

const hooks={states:[],refs:[],cursor:0};
const JSX={Fragment:Symbol('Fragment'),jsx:(type,props)=>({type,props:props||{}}),jsxs:(type,props)=>({type,props:props||{}})};
const fakeReact={
 useState(initial){const i=hooks.cursor++;if(!(i in hooks.states))hooks.states[i]=typeof initial==='function'?initial():initial;
 return [hooks.states[i],value=>{hooks.states[i]=typeof value==='function'?value(hooks.states[i]):value}];},
 useRef(value){const i=hooks.cursor++;if(!(i in hooks.refs))hooks.refs[i]={current:value};return hooks.refs[i];}
};
const source=ts.transpileModule(ui,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const sandboxModule={exports:{}};
vm.runInNewContext(source,{module:sandboxModule,exports:sandboxModule.exports,require(id){if(id==='react')return fakeReact;
 if(id==='react/jsx-runtime')return JSX;
 if(id==='lucide-react')return {Sparkles:()=>null};
 if(id==='../utils/audio')return {playSndClick(){}};
 throw Error('Unexpected dependency '+id);
},Math,Date,Number,Object,Array,Boolean,Error,Symbol}, {filename:'ForecastSandboxTools.cjs'});
const Quick=sandboxModule.exports.default;
let config={maxIntensityLimit:68,maxIntensityLimitEnabled:false,autoAdjustIntensity:false,
 circulationSizeReferenceKm:380,circulationSizeTransitionHours:0,soundEnabled:false};
const calls=[];
const props=()=>({storm:{id:'s',vmax:68,pmin:900,ewrcState:'none',active:true,dissipated:false},
 config,hour:50,onClose:()=>calls.push(['close']),onApply:(type,option)=>calls.push(['apply',type,option]),
 onConfig:patch=>{config={...config,...patch};calls.push(['config',patch]);},
 onColdAir:(strength,delay)=>calls.push(['coldAir',strength,delay]),
 onColdWater:(temp,duration)=>calls.push(['coldWater',temp,duration]),
 onClearPenalties:()=>calls.push(['clearPenalties']),
 onCirculationTarget:km=>calls.push(['circulationTarget',km]),
 onCirculationDuration:h=>{config.circulationSizeTransitionHours=h;calls.push(['duration',h]);},
 onNotice:(msg,level)=>calls.push(['notice',msg,level])});
const render=()=>{hooks.cursor=0;return Quick(props());};
function descend(node,cb){if(Array.isArray(node)){node.forEach(n=>descend(n,cb));return;}
 if(!node || typeof node!=='object')return;cb(node);descend(node.props?.children,cb);}
function label(node){if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(label).join('');return node?.props?label(node.props.children):'';}
function find(root,tag,text){let found=null;descend(root,n=>{if(!found && n.type===tag && label(n).includes(text))found=n;});return found;}
function click(root,text){const btn=find(root,'button',text);assert(btn,'missing button '+text);btn.props.onClick();return btn;}
let tree=render();
for(const [category,choice,expected] of [
 ['开启眼墙置换','正常开始置换','ewrc'],
 ['干空气卷入','卷入核心','dry_air'],
 ['强风切变','35节极强风切变','shear'],
 ['爆发增强','ERI 极端快速增强','rapid_intensify']
]){
 tree=render();click(tree,category);tree=render();click(tree,choice);
 assert(calls.some(x=>x[0]==='apply'&&x[1]===expected),'no engine callback '+category);
 // Previous action closes modal; remount it (fresh hook state).
 hooks.states=[];hooks.refs=[];
}
for(const [category,actionName,expected] of [
 ['冷空气南下','启动冷空气南下','coldAir'],
 ['冷水区','启动冷水区','coldWater']
]){
 hooks.states=[];hooks.refs=[];
 tree=render();click(tree,category);tree=render();click(tree,actionName);
 assert(calls.some(x=>x[0]===expected),'missing physical climate callback for '+category);
}
hooks.states=[];hooks.refs=[];
tree=render();click(tree,'取消所有惩罚');
assert(calls.some(x=>x[0]==='clearPenalties'),'penalty reset action not wired');
hooks.states=[];hooks.refs=[];
tree=render(); // Target slider lives directly on the live-style main page
const targetRange=[];descend(tree,n=>{if(n.type==='input'&&n.props['aria-label']==='目标风速')targetRange.push(n)});
assert(targetRange.length===1,'main target intensity slider not available');
targetRange[0].props.onChange({target:{value:'82'}});
assert(config.maxIntensityLimit===82 && config.maxIntensityLimitEnabled===true,'target-intensity patch missing');
tree=render();const circ=[];descend(tree,n=>{if(n.type==='input'&&n.props['aria-label']==='目标风圈')circ.push(n)});
assert(circ.length===1,'circulation input missing');circ[0].props.onChange({target:{value:'455'}});
assert(calls.some(x=>x[0]==='circulationTarget'&&x[1]===455),'circulation target not dispatched');
tree=render();const durations=[];descend(tree,n=>{if(n.type==='select'&&n.props.value!==undefined)durations.push(n)});
assert(durations.length>0);durations[0].props.onChange({target:{value:'48'}});
assert(calls.some(x=>x[0]==='duration'&&x[1]===48),'circulation transition time not applied');
console.log('ROUND162 PASS: identical live quick-tool pages; ewrc, dry-air, shear, RI, intensity, circulation radius and duration callbacks; sandbox RAF config sync and playback branch isolation.');
