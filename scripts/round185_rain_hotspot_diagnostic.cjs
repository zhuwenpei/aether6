/** Diagnostic-only Round185 rainfall hotspot baseline. No physics coefficients
 * are modified or re-tuned by this script. Re-run after terrain sanitization. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/simulation/EtopoTerrain.ts'),'utf8');
const prefix=source.split('const PACKED_BASE64 =')[1].split('let decoded:')[0];
const chunks=[...prefix.matchAll(/"([A-Za-z0-9+/=]+)"/g)].map(x=>x[1]);
assert.ok(chunks.length>200,'packed ETOPO proxy data must be present');
const buffer=Buffer.from(chunks.join(''),'base64');
const rows=281,cols=361;
assert.equal(buffer.byteLength,rows*cols*2);
const a=new Uint16Array(rows*cols);
for(let i=0;i<a.length;i++)a[i]=buffer.readUInt16LE(i*2);
const val=(lat,lon)=>a[Math.round((lat+10)*4)*cols+Math.round((lon-90)*4)];
const spots=[
 ['浙闽沿海',27,120.25],['长江口外海',30.75,122],['台湾中央山脉',23.75,121.5],
 ['吕宋中央山脉',16,121.75],['日本阿尔卑斯',35.5,136]
];
let suspicious=0,checked=0,coastJump=0,coastPairs=0;
for(let y=1;y<rows-1;y++)for(let x=1;x<cols-1;x++){
 const i=y*cols+x,c=a[i];
 const neighbours=[a[i-cols-1],a[i-cols],a[i-cols+1],a[i-1],a[i+1],a[i+cols-1],a[i+cols],a[i+cols+1]];
 const m=[...neighbours].sort((b,d)=>b-d),median=(m[3]+m[4])/2;
 if(c-median>1100&&neighbours.filter(n=>n===0).length>=2)suspicious++;
 checked++;
 const right=a[i+1];if((c===0)!=(right===0)){
  coastPairs++;if(Math.abs(c-right)/(27.8*Math.max(.15,Math.cos((y*.25-10)*Math.PI/180)))>34)coastJump++;
 }
}
assert.ok(suspicious>100,'baseline must reproduce suspicious terrain spikes before claiming a fix');
console.log('ROUND185 terrain / rainfall diagnostic (baseline, NOT a fix)');
console.log(`  packed grid: ${cols} × ${rows}; proxy spikes: ${suspicious}; raw-zero coastal jumps >34 m/km: ${coastJump}/${coastPairs}`);
for(const [label,lat,lon] of spots)console.log(`  ${label}: ${lat}°N ${lon}°E = ${val(lat,lon)} m proxy`);
console.log('  STATUS: detection reproduced; proper cleaning/physics recalibration still pending.');
