// REQ-0010 검증 (1회용) — 날씨 아이콘: 두 엔드포인트 · 캐시 적중 · 오프라인 내성 · 반응형
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
await new Promise(r=>srv.listen(8348,r));
const BASE='http://127.0.0.1:8348';

const fails=[];
const ok=(c,n)=>{console.log(c?'PASS':'FAIL',n);if(!c)fails.push(n);};

const RECS=[
  {record_id:'wx_arch_h',date:'2026-06-01',weekday:'월',start_time:'06:00',title:'아카이브 시각',
   location:'서울특별시, 대한민국',distance_km:3.1,avg_pace_sec_per_km:330,duration_sec:1023,schema_version:'2.0'},
  {record_id:'wx_arch_d',date:'2026-06-02',weekday:'화',start_time:null,title:'아카이브 날짜폴백',
   location:'서울특별시, 대한민국',distance_km:4.2,avg_pace_sec_per_km:340,duration_sec:1428,schema_version:'2.0'},
  {record_id:'wx_recent',date:'2026-07-28',weekday:'화',start_time:'07:00',title:'최근 예보API',
   location:'서울특별시, 대한민국',distance_km:5.0,avg_pace_sec_per_km:335,duration_sec:1675,schema_version:'2.0'},
  // 4단계가 실제로 갈리는지 — 서울 실측 코드가 0/51/75/2 인 날 (WMO: 맑음/비/눈/흐림)
  ...Object.entries({'2026-01-08':'맑음','2026-01-09':'비','2026-01-10':'눈','2026-01-11':'흐림'}).map(([d,l],i)=>
    ({record_id:'wx_b'+i,date:d,weekday:'월',start_time:null,title:'버킷 '+l,
      location:'서울특별시, 대한민국',distance_km:2+i,avg_pace_sec_per_km:330,duration_sec:900,schema_version:'2.0'}))];
const BUCKETS={'2026-01-08':'clear','2026-01-09':'rain','2026-01-10':'snow','2026-01-11':'cloud'};

const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:900}});
const page=await ctx.newPage();
const errs=[];
page.on('pageerror',e=>errs.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error')errs.push('console.error: '+m.text());});
let wxCalls=[];
page.on('request',r=>{if(r.url().includes('open-meteo.com'))wxCalls.push(r.url());});

const seed=async p=>{await p.evaluate(rs=>localStorage.setItem('run.records.v2',JSON.stringify(rs)),RECS);};

await page.goto(BASE+'/index.html',{waitUntil:'networkidle'});
await seed(page);
await page.reload({waitUntil:'networkidle'});
await page.click('nav.rail button[data-view="records"]');
await page.waitForSelector('.wx',{timeout:12000}).catch(()=>{});
await page.waitForTimeout(1200);

// 1. 세 기록 모두 아이콘을 얻는다 (아카이브 hourly / 아카이브 daily / 예보 past_days)
ok(await page.locator('.wx').count()===RECS.length,'전 기록 아이콘 표시 ('+RECS.length+'건)');
const titles=await page.locator('.wx').evaluateAll(ns=>ns.map(n=>n.getAttribute('title')));
ok(titles.every(t=>['맑음','흐림','비','눈'].includes(t)),'4단계 라벨만 사용: '+titles.join(','));

// 2. 두 엔드포인트가 각각 호출됐다
ok(wxCalls.some(u=>u.includes('archive-api')),'archive-api 호출');
ok(wxCalls.some(u=>u.includes('/v1/forecast')),'forecast(past_days) 호출');

// 3. 캐시가 저장되고 시각 키/날짜 키가 구분된다
const cache=await page.evaluate(()=>JSON.parse(localStorage.getItem('run.weather.v1')||'{}'));
console.log('   cache:',JSON.stringify(cache));
ok(!!cache['2026-06-01T06'],'시작 시각 있는 기록 → 시각 키(2026-06-01T06)');
ok(!!cache['2026-06-02'],'시작 시각 없는 기록 → 날짜 키(2026-06-02)');
ok(!!cache['2026-07-28T07'],'최근 기록 → 시각 키(2026-07-28T07)');
for(const [d,b] of Object.entries(BUCKETS))
  ok(cache[d]===b,`4단계 매핑 ${d} → ${b} (실제 ${cache[d]})`);

// 4. 레코드 스키마는 건드리지 않는다
const recAfter=await page.evaluate(()=>JSON.parse(localStorage.getItem('run.records.v2')));
ok(recAfter.every(r=>!('weather' in r)&&r.schema_version==='2.0'),'레코드 스키마 무변경(v2.0, weather 필드 없음)');

// 5. 재방문 시 추가 호출이 없다 (캐시 적중)
wxCalls=[];
await page.reload({waitUntil:'networkidle'});
await page.click('nav.rail button[data-view="records"]');
await page.waitForTimeout(1500);
ok(await page.locator('.wx').count()===RECS.length,'재방문에도 아이콘 유지');
ok(wxCalls.length===0,'재방문 시 날씨 호출 0건 (실제 '+wxCalls.length+')');

// 6. 오프라인 — 캐시가 없어도 목록이 정상 렌더된다
const off=await ctx.newPage();
const offErrs=[];
off.on('pageerror',e=>offErrs.push(e.message));
await off.goto(BASE+'/index.html',{waitUntil:'networkidle'});
await seed(off);
await off.evaluate(()=>localStorage.removeItem('run.weather.v1'));
await ctx.setOffline(true);
await off.reload({waitUntil:'domcontentloaded'});
await off.click('nav.rail button[data-view="records"]');
await off.waitForTimeout(1200);
ok(await off.locator('.reccard, table.data tbody tr').count()>0,'오프라인에서도 목록 렌더');
ok(await off.locator('.wx').count()===0,'오프라인에선 아이콘만 생략');
ok(offErrs.length===0,'오프라인 에러 없음: '+offErrs.join('|'));
await ctx.setOffline(false);

// 7. 반응형 스크린샷 (390 모바일 카드 / 1280 표)
await page.screenshot({path:'out/wx-desktop.png'});
const m=await ctx.newPage();
await m.setViewportSize({width:390,height:844});
await m.goto(BASE+'/index.html',{waitUntil:'networkidle'});
await m.click('nav.tabbar button[data-view="records"]'); // 390px에선 레일 대신 하단 탭바
await m.waitForTimeout(1500);
ok(await m.locator('.reccard .wx').count()===RECS.length,'모바일 카드(390px)에도 아이콘 전건');
await m.screenshot({path:'out/wx-mobile.png'});

ok(errs.length===0,'JS 에러 없음: '+errs.join('|'));
await b.close();srv.close();
console.log('\n--- result:',fails.length?('FAILURES\n'+fails.join('\n')):'ALL PASS');
process.exit(fails.length?1:0);
