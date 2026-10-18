#!/usr/bin/env python3
"""Headless Chromium seven-panel Canvas smoke test. It runs the REAL panel
renderer against 1000 synthetic recorded members. The strike field and coastline
are stubs: this is NOT physics validation, nor a reference-image 1:1 acceptance.
Requires local chromium, Python playwright, Node TypeScript compiler.
"""
import argparse,base64,json,os,subprocess,time
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
p.add_argument('--output',default='validation/ensemble_browser_smoke.png')
a=p.parse_args()
js=subprocess.check_output(['node','-e', '''const fs=require('fs'); const ts=(()=>{try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
process.stdout.write(ts.transpileModule(fs.readFileSync('src/utils/EnsembleIntensityAnalysis.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);'''],cwd=BASE,text=True)
with sync_playwright() as w:
 b=w.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--disable-gpu-sandbox','--no-sandbox'])
 page=b.new_page(viewport={'width':2048,'height':1920},device_scale_factor=1)
 page.goto('about:blank')
 page.evaluate('''() => {window.exports={};window.require=(name)=>{
   if(name.includes('NaturalEarthLoader'))return {productCoastlineGeoJson:{features:[]}};
   if(name.includes('EnsembleTrackTermination'))return {terminateEnsembleTrack:(track,h)=>track.filter(p=>p.leadHour<=h)};
   if(name.includes('StrikeProbabilityField'))return {computeStrikeField:async()=>({nx:101,ny:101,rawProb:new Float32Array(10201).fill(32)})};
   throw Error('unmocked import: '+name);
 };}''')
 page.add_script_tag(content=js)
 page.set_default_timeout(120000)
 info=page.evaluate('''async() => {
  const canvas=document.createElement('canvas');document.body.append(canvas);
  const seed=(i)=>{let x=i+1;return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;}};
  const members=Array.from({length:1000},(_,i)=>{const r=seed(i),branch=i%3-1;
   const track=Array.from({length:61},(_,j)=>{const h=j*6;return {
    simHour:h,leadHour:h,lat:12+h*.045+branch*h*.01+(r()-.5)*3,
    lon:140-h*.05+branch*h*.012+(r()-.5)*3,
    vmax:15+Math.min(h,120)*(.15+i%23*.008),pmin:1005-Math.min(h,120)*(.13+i%11*.011)
   };}); return {id:'m'+i,modelId:'WNV3',color:'#88aaff',control:false,memberNumber:i,maxVmax:50,minPmin:960,track};});
  const progress=[];const started=performance.now();
  await exports.drawEnsembleIntensityAnalysis({canvas,width:1988,members,horizonHours:360,
    issueDate:new Date(2026,9,16,14),title:'SYNTHETIC VALIDATION',agencyCode:'WMC',
    onProgress:p=>progress.push(p)});
  const elapsed=performance.now()-started;
  return {width:canvas.width,height:canvas.height,elapsedMs:elapsed,progress,
    png:canvas.toDataURL('image/png').split(',')[1]};
}''')
 png=base64.b64decode(info.pop('png'))
 Path(a.output).parent.mkdir(parents=True,exist_ok=True)
 Path(a.output).write_bytes(png)
 assert (info['width'],info['height'])==(1988,1871),info
 assert info['progress'][-1]==100,info
 print(json.dumps({'test':'browser seven-panel smoke (synthetic members; mock probability)','result':'PASS','browser':'Chromium','image':a.output,'imageBytes':len(png),**info},ensure_ascii=False,indent=2))
 b.close()
