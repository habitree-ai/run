import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
const ROOT='C:/Dev/run';
const OUT='C:/Users/N100274/AppData/Local/Temp/claude/C--Dev-run/c9ff260f-755f-4d87-91f9-47ec6f6b7576/scratchpad';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'};
const srv=createServer(async(req,res)=>{const p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  const f=join(ROOT,p==='/'?'index.html':p.slice(1));
  try{const b=await readFile(f);res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(b);}catch(e){res.writeHead(404);res.end('nf');}});
await new Promise(r=>srv.listen(8361,r));
const mk=(d,km,pace)=>({record_id:'r'+d,date:d,weekday:'일',start_time:'08:17',title:'러닝',location:'서울',
  distance_km:km,avg_pace_sec_per_km:pace,duration_sec:Math.round(km*pace),cadence_spm:165,avg_heart_rate_bpm:null,
  elevation_gain_m:5,route_summary:[],source:'nrc',has_image:false,schema_version:'2.0'});
const REC=[mk('2025-12-20',5,340),mk('2026-03-05',6,335),mk('2026-05-05',3.2,328),mk('2026-06-11',7.4,344),mk('2026-07-12',6.7,340),mk('2026-07-26',8.1,348)];
const br=await chromium.launch();const pg=await (await br.newContext({viewport:{width:1280,height:900}})).newPage();
await pg.goto('http://127.0.0.1:8361/index.html');
await pg.evaluate(r=>localStorage.setItem('run.records.v2',JSON.stringify(r)),REC);
await pg.goto('http://127.0.0.1:8361/index.html',{waitUntil:'networkidle'});
for(const sc of ['year','all']){
  const b64=await pg.evaluate(async s=>{const b=await drawShareCard(buildSummary(s));
    return await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(b);});},sc);
  await writeFile(join(OUT,'card-'+sc+'.png'),Buffer.from(b64.split(',')[1],'base64'));
}
await br.close();srv.close();console.log('ok');
