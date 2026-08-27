// 1회용 검증 — 기록 탭 표/카드에 시작 시각이 표시되는지 (cd scripts && node _time-verify.mjs)
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname} from 'node:path';

const ROOT=join(process.cwd(),'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png'};
const srv=createServer(async(req,res)=>{
  const p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  const f=join(ROOT,p==='/'?'index.html':p.slice(1));
  try{const b=await readFile(f);res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(b);}
  catch(e){res.writeHead(404);res.end('nf');}
});
await new Promise(r=>srv.listen(8349,r));
const BASE='http://127.0.0.1:8349';
const OUT=process.argv[2]||'out';

const recs=[
  {record_id:'a1',date:'2026-08-25',weekday:'화',start_time:'06:03',day_part:'오전',title:'화요일 오전 러닝',distance_km:5.12,avg_pace_sec_per_km:330,duration_sec:1690,source:'manual',has_image:false,created_at:'2026-08-25T07:00:00Z',updated_at:'2026-08-25T07:00:00Z',schema_version:'2.0'},
  {record_id:'a2',date:'2026-08-25',weekday:'화',start_time:'19:40',day_part:'오후',title:'화요일 저녁 러닝',distance_km:3.30,avg_pace_sec_per_km:345,duration_sec:1138,source:'manual',has_image:false,created_at:'2026-08-25T21:00:00Z',updated_at:'2026-08-25T21:00:00Z',schema_version:'2.0'},
  {record_id:'a3',date:'2026-08-23',weekday:'일',start_time:null,day_part:null,title:'시각 없는 기록',distance_km:4.00,avg_pace_sec_per_km:340,duration_sec:1360,source:'manual',has_image:false,created_at:'2026-08-23T09:00:00Z',updated_at:'2026-08-23T09:00:00Z',schema_version:'2.0'},
];
const fails=[];
const ok=(c,n)=>{console.log((c?'PASS ':'FAIL ')+n);if(!c)fails.push(n);};
const b=await chromium.launch();
for(const [w,h,kind] of [[1280,900,'table'],[390,844,'card']]){
  const ctx=await b.newContext({viewport:{width:w,height:h}});
  const page=await ctx.newPage();
  page.on('pageerror',e=>fails.push('pageerror: '+e.message));
  await page.goto(BASE+'/index.html',{waitUntil:'networkidle'});
  await page.evaluate(r=>{localStorage.setItem('run.records.v2',JSON.stringify(r));localStorage.setItem('run.onboarded','1');},recs);
  await page.reload({waitUntil:'networkidle'});
  await page.evaluate(()=>show('records'));
  await page.waitForTimeout(400);
  const sel=kind==='table'?'table.data tbody tr td:nth-child(3)':'.reccard .rc-d';
  const texts=await page.locator(sel).allTextContents().then(a=>a.map(s=>s.replace(/\s+/g,' ').trim()));
  console.log(kind,texts);
  ok(texts.length===3,kind+': 3 rows rendered');
  if(kind==='table'){
    ok(texts[0]==='06:03'&&texts[1]==='19:40','table: 시작 column shows 06:03, 19:40');
    ok(texts[2]==='—','table: 시작 column shows — when start_time null');
    const hd=await page.locator('table.data thead th').allTextContents();
    ok(hd[2].trim()==='시작'&&hd[3].trim()==='제목','table: 시작 header between 날짜 and 제목');
  }else{
    ok(texts.some(t=>t.includes('2026-08-25 (화) 19:40')),'card: 19:40 shown after weekday');
    ok(texts.some(t=>t.includes('2026-08-25 (화) 06:03')),'card: 06:03 shown');
    ok(texts.some(t=>/^2026-08-23 \(일\)/.test(t)&&!/\d{2}:\d{2}/.test(t)),'card: no time when start_time null');
  }
  await page.screenshot({path:join(OUT,'time-'+kind+'.png'),fullPage:false});
  await ctx.close();
}
await b.close();srv.close();
console.log(fails.length?'FAILS: '+fails.join(' | '):'ALL PASS');
process.exit(fails.length?1:0);
