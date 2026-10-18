/** NMC IMAGE ONLY. Neither function may be called by the live or ordinary
 * deterministic forecast, JMA, ensemble, video, or the pre-simulation engine. */
import type { TyphoonCategory } from '../types';

type Fix={simHour:number;vmax:number;pmin:number;category:TyphoonCategory;landed?:boolean;
  preSimulationGuided?:boolean;isStructureDamaged?:boolean;shear?:number;dryAirIntrusion?:number};
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
const smooth=(x:number)=>{const t=clamp(x,0,1);return t*t*(3-2*t);};
function category(v:number,original:TyphoonCategory):TyphoonCategory{
  if(['温带气旋','残留低压','已消散'].includes(original))return original;
  return (v>=51?'超强台风':v>=41.5?'强台风':v>=32.7?'台风':v>=24.5?'强热带风暴':v>=17.2?'热带风暴':'热带低压') as TyphoonCategory;
}
function adjust<T extends Fix>(p:T,wind:number):T{
  if(!Number.isFinite(wind)||Math.abs(wind-p.vmax)<1e-7)return p;
  return {...p,vmax:wind,pmin:p.pmin+(p.vmax-wind)*1.15,category:category(wind,p.category)};
}
/** The early-genesis NMC issue should NOT claim precision about an eventual
 * explosive/near-coast peak. ONLY damp its positive intensification and upper
 * peak, keeping independently predicted dry-air dips/returns (no old temporal
 * low-pass and no rewriting of the deterministic trajectory). */
export function limitNmcGenesisPeak<T extends Fix>(forecast:T[],genesisAgeHours:number,currentWind:number):T[]{
  if(forecast.length<2||!Number.isFinite(genesisAgeHours)||genesisAgeHours>=36)return forecast;
  const ordered=[...forecast].sort((a,b)=>a.simHour-b.simHour);
  // Forecast age, not merely current TC classification, defines the issue:
  // a newly named 40 m/s typhoon can still have a very uncertain future peak.
  const genesis=clamp((36-genesisAgeHours)/36,0,1)*
    (.30+.70*clamp((48-currentWind)/35,0,1));
  const peakCeiling=Math.max(currentWind,62-5.5*genesis);
  let prevWind=currentWind,prevTime=0;
  const firstLand=ordered.find(p=>p.landed && p.simHour>0)?.simHour ?? Infinity;
  const output=ordered.map(p=>{
    if(p.simHour<=1e-5)return p;
    const dt=Math.max(.01,p.simHour-prevTime);
    const positive=Math.max(0,p.vmax-currentWind);
    const nearShore=p.landed || firstLand-p.simHour<=18 && firstLand-p.simHour>=-6;
    const damp=genesis*(nearShore?.26:.17)*smooth(positive/22);
    let target=Math.min(peakCeiling,p.vmax-damp*positive);
    // Only the positive tendency is made conservative. Abrupt core decay and
    // later recovery retain their real physical trend; no gaussian averaging.
    const maxIncrease=(nearShore?.54:.88)*dt;
    target=Math.min(target,prevWind+maxIncrease);
    if(p.landed && prevTime>0 && ordered.some(q=>q.simHour===prevTime&&q.landed))target=Math.min(target,prevWind);
    target=Math.max(5,target);
    prevTime=p.simHour;prevWind=target;
    return adjust(p,target);
  });
  const mapped=new Map(ordered.map((p,i)=>[p,output[i]]));
  return forecast.map(p=>mapped.get(p)!);
}
/** Exact NMC-plate peak constraint, applied AFTER the normal/pre-simulation-
 * corrected intensity solution and ONLY to the published product. The selected
 * peak must occur at a reportable NMC fix; neither a large advisory weight nor
 * an approximate 'try to reach' hint is sufficient. If physical time/land
 * constraints make it impossible, reject the request rather than export a
 * misleading plate with an silently missed peak. */
export function shapeNmcPeakIntensity<T extends Fix>(forecast:T[],requestedPeak:number,issueWindOverride?:number):T[]{
  if (!Number.isFinite(requestedPeak)) return forecast;
  if (!forecast.length){
    if(Number.isFinite(issueWindOverride) && requestedPeak>Number(issueWindOverride)+1e-6)
      throw new RangeError('正式预报已停编，没有未来时次可达到指定 NMC 峰值');
    return forecast;
  }
  const sorted=[...forecast].sort((a,b)=>a.simHour-b.simHour);
  if(sorted.some(p=>!Number.isFinite(p.vmax)||!Number.isFinite(p.simHour)))return forecast;
  const issueWind=Number.isFinite(issueWindOverride)?Number(issueWindOverride):sorted[0].vmax;
  const target=clamp(requestedPeak,5,95);
  if (target < issueWind-1e-6) throw new RangeError('指定 NMC 峰值不能低于起报时已有的最大风速');
  const firstLead=sorted.findIndex(p=>p.simHour>1e-6);
  if(firstLead<0){
    if(Math.abs(target-issueWind)>1e-6)throw new RangeError('正式预报没有未来时次，无法达到指定巅峰强度');
    return forecast;
  }
  const lastTime=sorted[sorted.length-1].simHour;
  const upRate=1.1,downRate=1.65; // default physical bounds (m/s/h); no inland intensification
  const nonTerminal=sorted.filter(p=>p.simHour>0 && !p.landed &&
    !['温带气旋','残留低压','已消散'].includes(p.category));
  if(target>issueWind+1e-6&&!nonTerminal.length)
    throw new RangeError('有效预报时段已登陆或转为非热带系统，无法在海上达到指定巅峰强度');
  // Maximum physically attainable wind at each instant, with NO inland rise.
  const maxReach:number[]=new Array(sorted.length);
  let possible=issueWind,prevTime=0;
  for(let i=0;i<sorted.length;i++){
    const p=sorted[i];const dt=Math.max(0,p.simHour-prevTime);
    if(!p.landed && p.simHour>0)possible+=upRate*dt;
    maxReach[i]=possible;
    prevTime=p.simHour;
  }
  const isIssued=(h:number)=>h<=72+1e-5
    ?Math.abs(h/12-Math.round(h/12))<1e-4
    :Math.abs((h-72)/24-Math.round((h-72)/24))<1e-4;
  // The final irregularly discontinued fix is also an actually rendered fix.
  const preferred=nonTerminal.filter(p=>isIssued(p.simHour)||Math.abs(p.simHour-lastTime)<1e-5);
  const positions=preferred.length?preferred:nonTerminal;
  if(!positions.length){
    if(sorted.some(p=>p.vmax>target+1e-6))
      throw new RangeError('已停编系统的现有强度超过指定峰值，无法重塑');
    return forecast;
  }
  const naturalPeak=sorted.reduce((best,p)=>p.vmax>best.vmax?p:best,{simHour:0,vmax:issueWind} as T);
  const feasible=positions.filter(p=>maxReach[sorted.indexOf(p)]+1e-7>=target);
  if(target>issueWind+1e-6&&!feasible.length){
    const ceiling=Math.max(issueWind,...positions.map(p=>maxReach[sorted.indexOf(p)]));
    throw new RangeError(`指定峰值 ${target.toFixed(0)} m/s 无法在本次正式预报时段内按自然增强速率达到（可达约 ${Math.floor(ceiling)} m/s）；请延长预报时效或调低峰值`);
  }
  // Prefer a reportable fix already closest to the unaltered physical peak
  // in INTENSITY, not just one nearby in clock time. This minimizes the
  // amount of invented adjustment (especially with 6-hour internal fixes
  // but 12/24-hour labels). Clock distance only breaks near-intensity ties.
  const chosen=(feasible.length?feasible:positions).reduce((a,b)=>
    b.vmax>a.vmax+0.25 ? b :
    a.vmax>b.vmax+0.25 ? a :
    Math.abs(b.simHour-naturalPeak.simHour)<Math.abs(a.simHour-naturalPeak.simHour)?b:a);
  const peakIndex=sorted.indexOf(chosen),peakTime=chosen.simHour;
  // Round175: an actively RAISED peak over a confirmed sandbox track must not
  // collapse back to the sandbox's old absolute wind in the next 12h label.
  // The sandbox is the shape/track reference; its original intensity is NOT a
  // destination that the manual correction must converge to. Keep genuine
  // extraordinary core damage exempt, and leave lowering a peak or unguided
  // physical forecasts governed by their own native weakening tendencies.
  const naturalMaximum=Math.max(issueWind,...sorted.map(p=>p.vmax));
  const supportedRaisedPeak=target>naturalMaximum+0.5 &&
    sorted.some(p=>p.preSimulationGuided===true);
  // The hard peak is a ceiling, NOT a compulsory moment when the storm
  // begins to weaken. In Round171 the entire forecast was time-warped onto
  // the selected peak and its post-peak amplitude was re-scaled. That can
  // invent an abrupt 60 -> 48 -> 28 m/s decline over warm open water even
  // while the already pre-simulation-guided physics is still strengthening.
  //
  // Keep the original physical/approved-sandbox intensity at its OWN time.
  // Introduce only a POSITIVE correction needed at the reportable peak fix.
  // For a lower requested maximum, simply clip at the new ceiling: subtracting
  // a negative bell correction would invent weakening in a rising baseline.
  // Ramp any positive correction in before that fix, then carry it as an OFFSET:
  // this retains subsequent physical tendencies (including genuine shear,
  // dry-air, landfall and recovery), rather than forcing a bell-shaped storm.
  // Clipping to target makes a sustained/late stronger typhoon a plateau,
  // NOT a fictitious fast collapse. For a raised, confirmed pre-simulation
  // peak, Round175 additionally limits a subsequent artificial slide toward
  // the old sandbox ABSOLUTE wind, without masking exceptional new core damage.
  // All other weather products are untouched.
  const peakOriginalWind=chosen.vmax;
  const peakCorrection=Math.max(0,target-peakOriginalWind);
  const rawDesired=sorted.map(p=>{
    const phase=clamp(p.simHour/Math.max(.01,peakTime),0,1);
    const gradualCorrection=peakCorrection*smooth(phase);
    return p.vmax+(p.simHour<=peakTime ? gradualCorrection : peakCorrection);
  });
  const desired=rawDesired.map(v=>clamp(v,5,target));
  if(sorted[0].simHour<=1e-6)desired[0]=issueWind;
  desired[peakIndex]=target;
  // Backward feasibility envelope: require a gradual rise early enough to
  // actually hit the desired value, with flat/declining wind over land.
  let need=target;
  for(let i=peakIndex-1;i>=0;i--){
    const next=sorted[i+1],dt=Math.max(0,next.simHour-sorted[i].simHour);
    need-=next.landed?0:upRate*dt;
    if(sorted[i].simHour>0)desired[i]=Math.max(desired[i],need);
  }
  let prev=issueWind,time=0;
  const out=sorted.map((p,i)=>{
    if(p.simHour<=1e-6)return adjust(p,issueWind);
    const dt=Math.max(.001,p.simHour-time);
    const high=p.landed?prev:prev+upRate*dt;
    // When the user raises a pre-simulation-guided peak, retain its additional
    // intensity through the first post-peak reporting periods. Otherwise a
    // native sandbox/physics junction (or fast-moving landfall) can make a
    // 52 -> 40 -> 30 -> 15 m/s sequence in consecutive 12h callouts even if
    // the simulated storm had been approximately steady before weakening.
    // Apply a bounded, time-continuous decay INSTEAD OF fixing any point to
    // the original sandbox's exact wind. The rate gradually relaxes: farther
    // inland/late forecasts may still weaken and dissipate, and no fix can
    // re-intensify on land. This branch never affects non-NMC products.
    const afterPeak=p.simHour>peakTime+1e-6;
    // Structural damage caused by routine landfall should still follow the
    // gradual inland decay rule. Only NEW offshore core collapse, extreme
    // shear or a major dry-air intrusion bypasses that rule.
    const newOffshoreCoreDamage=!!p.isStructureDamaged && !p.landed &&
      !sorted[Math.max(0,i-1)]?.isStructureDamaged;
    const severeCoreChange=newOffshoreCoreDamage ||
      Number(p.shear)>=28 || Number(p.dryAirIntrusion)>=.7;
    const stopped=['温带气旋','残留低压','已消散'].includes(p.category);
    const smoothGuidedDecay=supportedRaisedPeak && afterPeak &&
      !severeCoreChange && !stopped;
    const elapsed=Math.max(0,(time+p.simHour)/2-peakTime);
    const smoothDownRate=p.landed
      ? Math.min(.95,.42+.006*elapsed)
      : Math.min(.65,.28+.006*elapsed);
    const allowedDownRate=smoothGuidedDecay?Math.min(downRate,smoothDownRate):downRate;
    const wind=clamp(desired[i],Math.max(5,prev-allowedDownRate*dt),Math.min(target,high));
    prev=wind;time=p.simHour;
    return adjust(p,wind);
  });
  if(Math.abs(Math.max(issueWind,...out.map(p=>p.vmax))-target)>1e-4)
    throw new RangeError('指定峰值与登陆/预报时次约束冲突，已阻止导出未达峰值的预报图');
  const mapped=new Map(sorted.map((p,i)=>[p,out[i]]));
  return forecast.map(p=>mapped.get(p)!);
}
