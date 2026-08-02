// REQ-0012 검증 (1회용) — 페이스 3km 하한 · 대시보드 최상단 누적/지금/추세 한눈에
// 실행: cd scripts && node _dash-verify.mjs
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
await new Promise(r=>srv.listen(8350,r));
const BASE='http://127.0.0.1:8350';

const fails=[];
const ok=(c,n,got)=>{console.log(c?'PASS':'FAIL',n,got===undefined?'':'→ '+got);if(!c)fails.push(n);};

const R=(id,date,wd,km,pace,dur)=>({record_id:id,date,weekday:wd,start_time:'07:00',day_part:'오전',
  title:wd+'요일 러닝',location:'서울특별시, 대한민국',distance_km:km,avg_pace_sec_per_km:pace,
  duration_sec:dur,elevation_gain_m:2,has_image:false,schema_version:'2.0'});
// 실데이터(2026-08-02) — 1.25km·1.36km 짧은 러닝 2건이 평균·최고 기록을 흔들던 상황
const RECS=[R('a1','2026-07-24','금',3.27,335,1096),R('a2','2026-07-25','토',3.17,329,1043),
  R('a3','2026-07-26','일',3.18,328,1044),R('a4','2026-07-27','월',3.24,332,1075),
  R('a5','2026-07-28','화',3.03,329,1001),R('a6','2026-07-29','수',3.18,333,1059),
  R('a7','2026-07-31','금',3.01,343,1033),R('a8','2026-08-01','토',3.04,330,1003),
  R('a9','2026-08-01','토',1.25,275,346),R('b1','2026-08-02','일',1.36,287,392),
  R('b2','2026-08-02','일',3.06,329,1005)];
const GOALS={plan:{weekly:{runs:4,distance_km:12},monthly:{runs:15,distance_km:45},yearly:{runs:180,distance_km:540},pace_stable:315,pace_record:270},
  target:{weekly:{runs:5,distance_km:15},monthly:{runs:20,distance_km:60},yearly:{runs:240,distance_km:720},pace_stable:300,pace_record:240},
  horizon:'2027',start_date:'2026-07-24',updated_at:'2026-07-28T14:16:19.020Z'};

const b=await chromium.launch();
const open=async(w,h)=>{
  const ctx=await b.newContext({viewport:{width:w,height:h}});
  const page=await ctx.newPage();
  page.on('pageerror',e=>fails.push('pageerror: '+e.message));
  await page.addInitScript(([r,g])=>{localStorage.setItem('run.records.v2',JSON.stringify(r));
    localStorage.setItem('run.goals.v1',JSON.stringify(g));},[RECS,GOALS]);
  await page.goto(BASE+'/index.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(400);
  return {ctx,page};
};

/* ---- 1. 페이스는 3km 이상만 ---- */
const {ctx,page}=await open(1280,900);
const a=await page.evaluate(()=>agg());
// 3km↑ 9건의 거리 가중 평균 = 332초(5'32"). 전 기록이면 328초(5'28")로 짧은 러닝이 끌어내린다
ok(Math.round(a.avgPace)===332,"누적 평균 페이스 = 3km↑ 가중평균 5'32\"",Math.round(a.avgPace));
const ps=await page.evaluate(()=>paceStatus());
ok(ps.best===328,"최고 기록 = 3km↑ 중 최고 5'28\" (1.25km의 4'35\" 아님)",ps.best);
const s=await page.evaluate(()=>buildSummary('year'));
ok(s.bp===328,'공유 카드 최고 기록도 같은 기준',s.bp);
ok(Math.round(s.ap)===332,'공유 카드 평균 페이스도 같은 기준',Math.round(s.ap));
const wkPace=await page.evaluate(()=>periodPace(isoWeekKey,isoWeekKey(todayISO())));
// 이번 주 3km↑ 6건 가중평균 = 333초. 전 기록이면 326초로 짧은 러닝이 끌어내린다
ok(wkPace===333,'기간 대표 페이스도 3km↑ 기준',wkPace);
ok(Math.abs(a.d-30.79)<0.01,'거리 합계는 짧은 러닝 포함 유지',a.d);
ok(a.t===10097,'시간 합계도 짧은 러닝 포함 유지',a.t);

/* ---- 2. 추세는 그래프만 — 거리 막대차트 제거 ---- */
ok(await page.locator('#ch-dist').count()===0,'거리 막대차트 제거됨');
ok(await page.locator('#ch-cum').count()===1,'추세에 누적 차트 있음');
ok(await page.locator('#ch-pace').count()===0,'페이스 추세 차트 제거됨');
ok(await page.locator('.nowtrend').count()===1,'지금·추세 2단 레이아웃');

/* ---- 3. 데스크톱 첫 화면에 누적·지금·추세가 함께 ---- */
const inFold=async(p,sel,vh)=>p.evaluate(([s,h])=>{
  const el=document.querySelector(s);if(!el)return false;
  const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=h;},[sel,vh]);
ok(await inFold(page,'.totalrow',900),'첫 화면에 누적');
ok(await inFold(page,'.nowtrend .hero',900),'첫 화면에 지금(원형)');
ok(await inFold(page,'#ch-cum',900),'첫 화면에 추세(누적 그래프)');
const cols=await page.evaluate(()=>getComputedStyle(document.querySelector('.nowtrend')).gridTemplateColumns.split(' ').length);
ok(cols===2,'데스크톱은 2단',cols+'단');
ok(!(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)),'가로 스크롤 없음(데스크톱)');
await ctx.close();

/* ---- 4. 모바일 — 누적+지금이 첫 화면 · 1단 · 가로 스크롤 없음 ---- */
const m=await open(390,844);
ok(await inFold(m.page,'.totalrow',844),'모바일 첫 화면에 누적');
ok(await inFold(m.page,'.nowtrend .minirow',844),'모바일 첫 화면에 지금(미니카드까지)');
const mcols=await m.page.evaluate(()=>getComputedStyle(document.querySelector('.nowtrend')).gridTemplateColumns.split(' ').length);
ok(mcols===1,'모바일은 1단',mcols+'단');
ok(!(await m.page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)),'가로 스크롤 없음(모바일)');
await m.ctx.close();

await b.close();srv.close();
console.log(fails.length?'\nFAILED: '+fails.length+'\n- '+fails.join('\n- '):'\nALL PASS');
process.exit(fails.length?1:0);
