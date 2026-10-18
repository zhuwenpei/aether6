"""Browser reproduction of Leaflet's SVG.Path add lifecycle (detached initial path update)."""
import json
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
  page=browser.new_page(viewport={"width":400,"height":500},device_scale_factor=2)
  page.set_content('''<html><head><style>body{margin:0;background:#9bd1fb}svg{width:400px;height:500px} .tn-geo-lead {stroke:#292929;stroke-width:1.25px;fill:white;paint-order:stroke fill;font:600 10.5px Arial} .tn-geo-cyclone-spin {transform-box:fill-box;transform-origin:center;animation:spin 2s linear infinite}@keyframes spin{to{transform:rotate(-360deg)}}</style></head><body><svg id="mapSvg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><g id="mainGroup"></g></svg></body></html>''')
  page.add_script_tag(content='''
  const TEST_SVG_NS='http://www.w3.org/2000/svg';
  const map={root:document.querySelector('#mainGroup')};
  window.L={circleMarker:function(at,opts){
    const handlers={};
    const marker={_path:document.createElementNS(TEST_SVG_NS,'path'),_point:{x:at[0],y:at[1]},
      _updatePath:function(){this._path.setAttribute('d',`M ${this._point.x},${this._point.y}h1`)},
      on:function(event,fn){handlers[event]=fn;return this},
      addTo:function(map){this._updatePath();map.root.appendChild(this._path);return this},
      setLatLng:function(pos){this._point={x:pos[0],y:pos[1]};this._updatePath();return this},
      remove:function(){handlers.remove?.();this._path.remove()}};
    return marker;
  }};
  window.__map=map;
  ''')
  page.add_script_tag(content=(ROOT/'validation/round204_test_helpers.js').read_text())
  values=page.evaluate('''() => {
    const {geographicLead,geographicCyclone}=window.__networkSvgTest;
    const cma=geographicLead(__map,[160,145],{},6,15);
    const cyclone=geographicCyclone(__map,[195,260],{},{});
    cyclone._networkGlyph.querySelector('circle').setAttribute('fill','#ff00cc');
    const svg=document.querySelector('#mapSvg');
    const text=svg.querySelector('g.tn-geo-glyph text');
    const icon=svg.querySelector('g.tn-geo-glyph image');
    const eye=svg.querySelector('g.tn-geo-glyph circle');
    const initial={text:!!text,caption:text?.textContent,icon:!!icon,href:icon?.getAttribute('href'),eye:!!eye,fill:eye?.getAttribute('fill'),count:svg.querySelectorAll('g.tn-geo-glyph').length};
    cma.setLatLng([200,155]); cyclone.setLatLng([230,280]);
    const reposition={captionX:text?.getAttribute('x'),iconX:icon?.getAttribute('x'),eyeCx:eye?.getAttribute('cx')};
    const replacement=document.createElementNS('http://www.w3.org/2000/svg','g');
    svg.appendChild(replacement); replacement.appendChild(cma._path); replacement.appendChild(cyclone._path);
    cma.setLatLng([210,165]); cyclone.setLatLng([240,290]);
    const reattached=cma._networkGlyph.parentNode===replacement&&cyclone._networkGlyph.parentNode===replacement;
    cma.remove(); cyclone.remove();
    const cleanup=svg.querySelectorAll('g.tn-geo-glyph').length===0;
    return {initial,reposition,reattached,cleanup};
  }''')
  assert values['initial']['text'] and values['initial']['icon'] and values['initial']['eye'],values
  assert values['initial']['caption']=='6h/15级',values
  assert values['initial']['href']=='/network-icons/cyclone-blue.png',values
  assert values['initial']['fill']=='#ff00cc',values
  assert values['initial']['count']==2,values
  assert values['reposition']=={'captionX':'171','iconX':'214.5','eyeCx':'230'}, values
  assert values['reattached'] and values['cleanup'],values
  print('PASS R204 Chromium: initial insertion, 6h label, PNG, strength eye, position update, pane reattach, remove')
  print(json.dumps(values,ensure_ascii=False))
  # Visual smoke: re-render after lifecycle assertions, using the bundled icon
  # as a data URL to avoid external/network dependencies in the test sandbox.
  icon_data=base64.b64encode((ROOT/'public/network-icons/cyclone-blue.png').read_bytes()).decode('ascii')
  page.evaluate("""(iconUrl)=>{
    const {geographicLead,geographicCyclone}=window.__networkSvgTest;
    geographicLead(__map,[150,165],{},12,15);
    const cyclone=geographicCyclone(__map,[225,285],{},{});
    cyclone._networkGlyph.querySelector('circle').setAttribute('fill','#e600df');
    cyclone._networkGlyph.querySelector('image').setAttribute('href',iconUrl);
  }""",'data:image/png;base64,'+icon_data)
  page.screenshot(path=str(ROOT/'validation/round204_svg_glyph_visible_chromium.png'))
  browser.close()
