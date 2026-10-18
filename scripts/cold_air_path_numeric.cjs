const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
const smooth=v=>{const x=clamp(v);return x*x*(3-2*x);};
const gaussian=(lon,center,sigma)=>{
  let d=lon-center;
  while(d>180)d-=360;
  while(d<-180)d+=360;
  return Math.exp(-0.5*Math.pow(d/Math.max(.25,sigma),2));
};
const union=(...ws)=>{
  let miss=1;
  for(const w of ws)miss*=1-clamp(w);
  return clamp(1-miss);
};
const frontPhase=(lon)=>.24*Math.sin((lon-121)*.42)+.12*Math.sin((lon-118)*.19);
function route(lat,lon,isLand=false,landInterior=0){
  const highGate=1-smooth((lat-45)/5);
  const lowGate=smooth((lat-5)/6);
  const northProgress=smooth((lat-31)/9);
  const bohaiCenter=123.4-3.8*northProgress;
  const westJapanCenter=126.3+4.5*northProgress;
  const bohai=gaussian(lon,bohaiCenter,2.25)*highGate;
  const westJapan=.56*gaussian(lon,westJapanCenter,2.15)*highGate;
  const northern=union(bohai,westJapan);
  const northZ=(.18*bohai-.18*westJapan)/Math.max(1e-6,bohai+westJapan);

  const ecsCenter=124.3+.15*clamp(lat-27,-3,4);
  const ecs=gaussian(lon,ecsCenter,3.7);
  const merge=1-smooth((lat-29)/5);
  const pre=northern*(1-merge)+union(northern*.72,ecs)*merge;
  const preZ=northZ*(1-merge);

  const southProgress=clamp((25-lat)/13);
  const taiwanCenter=119.6-2.8*southProgress;
  const bashiCenter=122.1-4.2*southProgress;
  const taiwan=.95*(1-.12*smooth((18-lat)/8))*gaussian(lon,taiwanCenter,1.65+1.25*southProgress);
  const bashi=.92*(1-.08*smooth((16-lat)/8))*gaussian(lon,bashiCenter,1.8+1.45*southProgress);
  const scs=union(taiwan,bashi);

  const eastPhilCenter=125.8+6*southProgress;
  const eastPhilDecay=1-.94*smooth((24-lat)/12);
  const eastPhil=.78*eastPhilDecay*gaussian(lon,eastPhilCenter,2.7+.6*southProgress);
  const downstream=union(scs,eastPhil);
  const downstreamZ=(-.24*scs+.20*eastPhil)/Math.max(1e-6,scs+eastPhil);

  const split=1-smooth((lat-24.5)/4);
  let weight=pre*(1-split)+union(pre*.55,downstream)*split;
  let zonal=preZ*(1-split)+downstreamZ*split;
  weight*=lowGate;
  if(isLand){
    weight*=.18+.22*(1-clamp(landInterior));
    zonal*=.8;
  }
  return {weight:clamp(weight),zonal:clamp(zonal,-.36,.32),bohai,westJapan,taiwan,bashi,scs,eastPhil};
}

function stage3WeightedKt(lat,lon,frontLat=24,validHour=30,contactLon=121){
  const effectiveFront=frontLat+clamp(frontPhase(lon)-frontPhase(contactLon),-.55,.55);
  const behind=lat-effectiveFront;
  const leading=4.0, body=4.4, rear=4.2;
  if(behind < -leading || behind > body+rear)return 0;
  let mer=0;
  if(behind<0)mer=.94*smooth((behind+leading)/leading);
  else if(behind<=body)mer=.94+.06*Math.sin(Math.PI*clamp(behind/body));
  else mer=.94*(1-smooth((behind-body)/rear));
  const r=route(lat,lon,false,0);
  const latGate=smooth((lat-5)/6)*(1-smooth((lat-52)/7));
  const texture=clamp(.96+.035*Math.sin((lon-108)*.23+(lat-effectiveFront)*.31+validHour*.028)
    +.020*Math.sin((lon-118)*.11-(lat-effectiveFront)*.19-validHour*.017),.90,1);
  const weight=clamp(mer*r.weight*latGate*texture);
  const southProgress=smooth((35-lat)/23);
  const channelWeight=Math.max(r.taiwan,r.bashi);
  const target=Math.min(32,32*(1-.14*southProgress)*(1+.06*channelWeight));
  return target*weight;
}

function maxStage3AtLat(lat,frontLat=24,validHour=30){
  let best=0,bestLon=0;
  for(let lon=108;lon<=136.0001;lon+=.05){
    const v=stage3WeightedKt(lat,lon,frontLat,validHour);
    if(v>best){best=v;bestLon=lon;}
  }
  return {kt:best,lon:bestLon};
}

module.exports={clamp,smooth,route,frontPhase,stage3WeightedKt,maxStage3AtLat};
