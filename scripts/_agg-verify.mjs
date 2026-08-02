// REQ-0011 검증 (1회용) — 횟수 집계가 '기록 수'가 아니라 '달린 날' 기준인지
// 실데이터(드라이브 백업 2026-08-02, 11건 / 9일 · 08-01·08-02가 하루 2건)를 그대로 넣고 확인한다.
// 실행: cd scripts && node _agg-verify.mjs
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname} from 'node:path';

const ROOT=join(process.cwd(),'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json',
  '.webmanifest':'application/manifest+json','.png':'image/png','.css':'text/css'};
const srv=createServer(async(req,res)=>{
  const p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  const f=join(ROOT,p==='/'?'index.html':p.slice(1));
  try{const b=await readFile(f);res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(b);}
  catch(e){res.writeHead(404);res.end('nf');}
});
await new Promise(r=>srv.listen(8349,r));
const BASE='http://127.0.0.1:8349';

const fails=[];
const ok=(c,n,got)=>{console.log(c?'PASS':'FAIL',n,got===undefined?'':'→ '+got);if(!c)fails.push(n);};

const R=(id,date,wd,km,pace,dur)=>({record_id:id,date,weekday:wd,start_time:'07:00',day_part:'오전',
  title:wd+'요일 러닝',location:'서울특별시, 대한민국',distance_km:km,avg_pace_sec_per_km:pace,
  duration_sec:dur,elevation_gain_m:2,cadence_spm:null,avg_heart_rate_bpm:null,has_image:false,schema_version:'2.0'});
const RECS=[
  R('a1','2026-07-24','금',3.27,335,1096), R('a2','2026-07-25','토',3.17,329,1043),
  R('a3','2026-07-26','일',3.18,328,1044), R('a4','2026-07-27','월',3.24,332,1075),
  R('a5','2026-07-28','화',3.03,329,1001), R('a6','2026-07-29','수',3.18,333,1059),
  R('a7','2026-07-31','금',3.01,343,1033),
  R('a8','2026-08-01','토',3.04,330,1003), R('a9','2026-08-01','토',1.25,275,346),   // 하루 2건
  R('b1','2026-08-02','일',1.36,287,392),  R('b2','2026-08-02','일',3.06,329,1005),  // 하루 2건
];
const GOALS={plan:{weekly:{runs:4,distance_km:12},monthly:{runs:15,distance_km:45},yearly:{runs:180,distance_km:540},
    pace_stable:315,pace_record:270},
  target:{weekly:{runs:5,distance_km:15},monthly:{runs:20,distance_km:60},yearly:{runs:240,distance_km:720},
    pace_stable:300,pace_record:240},
  horizon:'2027',start_date:'2026-07-24',updated_at:'2026-07-28T14:16:19.020Z'};

const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1200,height:900}});
const page=await ctx.newPage();
page.on('pageerror',e=>fails.push('pageerror: '+e.message));
await page.addInitScript(([r,g])=>{
  localStorage.setItem('run.records.v2',JSON.stringify(r));
  localStorage.setItem('run.goals.v1',JSON.stringify(g));
},[RECS,GOALS]);
await page.goto(BASE+'/index.html',{waitUntil:'networkidle'});

// 오늘이 2026-08-02(일)이 아니면 주/월 기대치가 달라지므로 확인만 하고 건너뛴다
const today=await page.evaluate(()=>todayISO());
if(today!=='2026-08-02'){console.log('SKIP 기간 검증 — 오늘이',today,'(기대 2026-08-02)');}
else{
  const p=await page.evaluate(()=>goalProgress());
  // 이번 주(07-27~08-02): 기록 8건 · 달린 날 6일 / 이번 달(08): 기록 4건 · 2일 / 올해: 기록 11건 · 9일
  ok(p.weekly.runs===6,'주간 횟수 = 달린 날 6일 (기록 8건 아님)',p.weekly.runs);
  ok(p.monthly.runs===2,'월간 횟수 = 달린 날 2일 (기록 4건 아님)',p.monthly.runs);
  ok(p.yearly.runs===9,'연간 횟수 = 달린 날 9일 (기록 11건 아님)',p.yearly.runs);
  ok(Math.abs(p.weekly.dist-21.17)<0.01,'주간 거리는 전 기록 합산 유지',p.weekly.dist);

  // 요일 점(달린 날 기준)과 게이지가 같은 값을 보여야 한다
  const dots=await page.evaluate(()=>(weekDotsHTML().match(/background:var\(--series-1\)/g)||[]).length);
  ok(dots===p.weekly.runs,'주간 요일 점 개수 = 게이지 횟수',dots+' vs '+p.weekly.runs);

  // 상세 모달의 '횟수'도 같은 기준
  await page.evaluate(()=>openPeriodDetail('week'));
  const modalRuns=await page.locator('.statrow .st').first().locator('.val').textContent();
  ok(modalRuns.trim().startsWith('6'),'주간 상세 모달 횟수 = 6',modalRuns.trim());
  await page.evaluate(()=>closeModal());

  // 공유 요약(카드·링크)도 같은 기준
  const s=await page.evaluate(()=>buildSummary('year'));
  ok(s.n===9,'공유 요약 올해 횟수 = 9',s.n);
}

// 누적 러닝 카드
const a=await page.evaluate(()=>agg());
ok(a.n===9,'누적 러닝 = 달린 날 9일',a.n);
ok(Math.abs(a.d-30.79)<0.01,'누적 거리는 전 기록 합산 유지',a.d);

// 스트릭 — 주간 계획 4회 기준. 07-27~08-02 주는 6일로 달성, 직전 주(07-20~26)는 3일로 미달
const st=await page.evaluate(()=>betaStreak());
ok(st===1,'계획 연속 1주 (직전 주는 3일로 미달)',st);

await b.close();srv.close();
console.log(fails.length?'\nFAILED: '+fails.length+'\n- '+fails.join('\n- '):'\nALL PASS');
process.exit(fails.length?1:0);
