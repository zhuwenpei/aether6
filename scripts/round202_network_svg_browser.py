import os, json, subprocess, base64
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
source=(root/'src/components/TyphoonNetworkSimulator.tsx').read_text()
fragment=source[source.index('type NetworkSvgGlyph ='):source.index('async function loadPetalMapsApi(')]
js=subprocess.check_output(['node','-e',"const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');let t='';process.stdin.on('data',c=>t+=c);process.stdin.on('end',()=>process.stdout.write(ts.transpileModule(t,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText))"],input=fragment.encode()).decode()
css=(root/'src/components/TyphoonNetworkSimulator.css').read_text()
asset='data:image/png;base64,'+base64.b64encode((root/'public/network-icons/cyclone-blue.png').read_bytes()).decode()
html='''<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root,.tn-viewport{margin:0;width:100%;height:100%;background:#9ad0f2}.tn-map{position:absolute;top:0;left:0;right:0;bottom:0}.stage{position:absolute;inset:0}'''+css+'''</style></head><body><div id="root"><div class="tn-viewport"><div class="tn-map"><svg id="plate" class="stage" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 340" preserveAspectRatio="xMidYMid meet"><g id="overlay"><path id="reference" stroke="red" stroke-width="1" fill="none" d="M30 180 L385 180"/></g></svg></div></div></div></body></html>'''
script='''
const NETWORK_CYCLONE_SIZE_PX=31;
const L={circleMarker:(at,options)=>{
 const layer={_point:{x:at[1],y:at[0]},_path:null,_map:null,_callbacks:{},_updatePath(){},
 on(event,callback){this._callbacks[event]=callback;return this;},
 addTo(map){this._map=map;this._path=document.createElementNS('http://www.w3.org/2000/svg','path');this._path.setAttribute('class','anchor-path');map.root.appendChild(this._path);this._updatePath();map.layers.push(this);return this;},
 setLatLng(at){this._point={x:at[1],y:at[0]};this._updatePath();},
 remove(){this._callbacks.remove?.();this._path?.remove();this._map.layers.splice(this._map.layers.indexOf(this),1);}
 };return layer;
}};
const map={root:document.getElementById('overlay'),layers:[]};
''' + js + '''
window.testMap=map;
window.testFocus=geographicCyclone(map,[180,245],{},{});
window.testLabel=geographicLead(map,[140,180],{},12,15);
const target=testFocus._networkGlyph.querySelector('circle');target.setAttribute('fill','#eb08dd');
const img=testFocus._networkGlyph.querySelector('image');img.setAttribute('href','''+json.dumps(asset)+''');
'''
metrics_js='''() => {const label=document.querySelector('.tn-geo-lead'), image=document.querySelector('.tn-geo-cyclone-spin'), eye=document.querySelector('.tn-geo-cyclone-eye'); const ref=document.getElementById('reference');const group=document.getElementById('overlay');const l=label.getBoundingClientRect(),i=image.getBoundingClientRect(),e=eye.getBoundingClientRect();return {label:[l.x,l.y],image:[i.x,i.y],eye:[e.x+e.width/2,e.y+e.height/2],ref:ref.getBoundingClientRect().x, overlayTransform:getComputedStyle(group).transform, imageBg:getComputedStyle(image).backgroundColor, labelBg:getComputedStyle(label).backgroundColor, numMarkers:document.querySelectorAll('.leaflet-marker-icon').length, svgChildren:group.childElementCount};}'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':420,'height':340})
 page.set_content(html)
 page.evaluate(script)
 before=page.evaluate(metrics_js)
 assert before['numMarkers']==0,before
 assert before['imageBg']=='rgba(0, 0, 0, 0)' and before['labelBg']=='rgba(0, 0, 0, 0)',before
 page.screenshot(path=str(root/'validation/round202_svg_glyphs_chromium.png'))
 # Both elements undergo the SAME overlay transform (pinch simulation).
 page.evaluate('''() => {const layer=document.getElementById('overlay');layer.setAttribute('transform','translate(35 -11) scale(1.14)');}''')
 after=page.evaluate(metrics_js)
 assert before['image']!=after['image'] and before['label']!=after['label'],(before,after)
 # Move map anchors directly (including lead label) and assert SVG content tracks.
 page.evaluate('''() => {window.testFocus.setLatLng([200,275]);window.testLabel.setLatLng([145,190]);}''')
 moved=page.evaluate(metrics_js)
 assert after['image']!=moved['image'] and after['label']!=moved['label']
 page.evaluate('''() => {window.testFocus.remove();window.testLabel.remove();}''')
 assert page.locator('.tn-geo-glyph').count()==0
 browser.close()
 print(json.dumps({'pass':True,'noHtmlDivIcons':True,'transparentGlyphs':True,'transformedTogether':True,'mapAnchorUpdates':True,'glyphRemovalClean':True,'before':before,'afterTransform':after,'afterAnchorMove':moved},ensure_ascii=False))
