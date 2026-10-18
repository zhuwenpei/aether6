const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');

const app=fs.readFileSync('src/App.tsx','utf8');
if(app.includes('if (km < 12) return prev;')) throw new Error('forecast route still rejects nearby stall points');
if(!app.includes('Repeated/very close waypoints are an')) throw new Error('forecast-route nearby-node behavior missing');

const map=fs.readFileSync('src/components/MapView.tsx','utf8');
if(!map.includes('const mobileDrawing = touchFirst && (isForecastRouteDrawing);')) throw new Error('forecast-route mobile gesture parity missing');
if(/isDryAirDrawing|isShearDrawing|dryAirDraft|shearDraft/.test(map)) throw new Error('removed dry-air/shear placement code still present in MapView');
if(!map.includes('stackedNearby')) throw new Error('nearby forecast-node visual acknowledgement missing');

const css=fs.readFileSync('src/index.css','utf8');
if(!css.includes('aether-mobile-tools-overflow')) throw new Error('mobile tools overlay styling missing');

const report=fs.readFileSync('src/components/TyphoonReportModal.tsx','utf8');
if(!report.includes('双曲线强度报告') || !report.includes('三曲线生命周期')) throw new Error('double/triple curve labels not corrected');
const sciStart=report.indexOf('function drawScientificPanel');
const sciEnd=report.indexOf('type LifecyclePoint',sciStart);
if(report.slice(sciStart,sciEnd).includes('landfall')) throw new Error('scientific curve panels still draw landfall annotations');
const patStart=report.indexOf('function drawPatriciaStyleLifecycleReport');
const patEnd=report.indexOf('function pressureTrackColor',patStart);
if(report.slice(patStart,patEnd).includes('landfall')) throw new Error('three-curve lifecycle still draws landfall lines');

const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
const a=engine.indexOf('function frameworkDistanceKm');
const b=engine.indexOf('/**\n * User forecast frameworks are usually drawn',a);
if(a<0||b<0) throw new Error('unable to locate route-tempo functions');
const snippet=`const clamp01=(v)=>Math.max(0,Math.min(1,v));\nfunction smoothstep01(value){const x=clamp01(value);return x*x*(3-2*x);}\n${engine.slice(a,b)}\nmodule.exports={getForecastFrameworkSpacingSpeedFactor};`;
const js=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};new Function('module','exports',js)(mod,mod.exports);
const f=mod.exports.getForecastFrameworkSpacingSpeedFactor;
const normal=[{lat:15,lon:120},{lat:15,lon:121},{lat:15,lon:122},{lat:15,lon:123},{lat:15,lon:124}];
const stall=[{lat:15,lon:120},{lat:15,lon:121},{lat:15,lon:122},{lat:15,lon:122},{lat:15,lon:122},{lat:15,lon:122.01},{lat:15,lon:123},{lat:15,lon:124}];
const omission=[{lat:15,lon:120},{lat:15,lon:121},{lat:15,lon:123.4},{lat:15,lon:124.4},{lat:15,lon:125.4}];
const n=f(normal,.5), s=f(stall,.5), o=f(omission,.5);
if(!(n>.90&&n<1.10)) throw new Error(`normal route tempo distorted: ${n}`);
if(!(s<.38)) throw new Error(`close-point stall too weak: ${s}`);
if(!(o>.88&&o<1.13)) throw new Error(`single omitted waypoint too sensitive: ${o}`);
console.log('round43_drawing_report_regression: PASS',`normal=${n.toFixed(2)}`,`stall=${s.toFixed(2)}`,`omission=${o.toFixed(2)}`);
