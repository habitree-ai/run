// REQ-0013 검증 (1회용) — 시작 시각에 캡쳐 시각이 들어가던 문제
// 실행: cd scripts && node _starttime-verify.mjs
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
await new Promise(r=>srv.listen(8353,r));
const BASE='http://127.0.0.1:8353';

const fails=[];
const ok=(c,n,got)=>{console.log(c?'PASS':'FAIL',n,got===undefined?'':'→ '+String(got));if(!c)fails.push(n);};

// 실기록 raw_ocr 발췌. 상단 "07:30"류는 휴대폰 상태바 시계(=캡쳐 시각)이지 러닝 시작이 아니다.
const OCR_MANGLED="07:30 7                     ol = - )\n개 - 05:57\n\n토요일 오전 러닝                        Vg\n3. 04\n킬로미터\n5'30\"          16:45          --\n2m            --               162\n서울특별시, 대한민국\n";
const OCR_MANGLED2="07:31 94                      Jal = @)\n<                             oa.\n= - 06:50\n토요일 오전 러닝                        >\n킬로미터\n1     1                 .\n4'35\"          05:46          --\n";
const OCR_CLEAN="07:07 «4                       al T @)\n<                              000\n오늘 - 06:01\n월요일 오전 러닝                        V4\n3.24\n5'32\"          17:55          --\n2m            --               168\n서울특별시, 대한민국\n";
const OCR_NONE="12:35 94                           all 수요)\n<                          [ XX J]\n일요일 오전 러닝                       V4\n\n3.06\n5'29\"          16:45          --\n5m            =               166\n서울특별시, 대한민국\n";

const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1200,height:900}});
const page=await ctx.newPage();
page.on('pageerror',e=>fails.push('pageerror: '+e.message));
await page.goto(BASE+'/index.html',{waitUntil:'networkidle'});

/* ---- 1. 파서 — '오늘'이 뭉개져도 시작 시각을 건진다 ---- */
const P=t=>page.evaluate(x=>parseRunningText(x,{date:'2026-08-01'}),t);
ok((await P(OCR_MANGLED)).start_time==='05:57',"'개 - 05:57'(오늘 오독)에서 05:57 복구",(await P(OCR_MANGLED)).start_time);
ok((await P(OCR_MANGLED2)).start_time==='06:50',"'= - 06:50'(오늘 오독)에서 06:50 복구",(await P(OCR_MANGLED2)).start_time);
ok((await P(OCR_CLEAN)).start_time==='06:01',"'오늘 - 06:01'은 그대로 (회귀 없음)",(await P(OCR_CLEAN)).start_time);
ok((await P(OCR_NONE)).start_time==null,'시작 줄이 없으면 상태바 시계를 쓰지 않고 비운다',(await P(OCR_NONE)).start_time);
// 거리·페이스·시간은 영향 없어야 한다
const pc=await P(OCR_CLEAN);
ok(pc.distance_km===3.24&&pc.avg_pace_sec_per_km===332,'거리·페이스 파싱 무영향',pc.distance_km+'km / '+pc.avg_pace_sec_per_km);
ok(pc.duration_sec===1075,'시간은 시작 시각과 혼동되지 않는다',pc.duration_sec);

/* ---- 2. 입력 폼 — 캡쳐 시각이 '시작 시각'에 들어가지 않는다 ---- */
await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=c.height=40;c.getContext('2d').fillRect(0,0,40,40);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));
  const dt=new DataTransfer();dt.items.add(new File([blob],'Screenshot_20260726_081700.png',{type:'image/png'}));
  document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt}));
});
await page.waitForTimeout(500);
ok(await page.inputValue('#f_date')==='2026-07-26','날짜 앵커 프리필은 유지',await page.inputValue('#f_date'));
ok(await page.inputValue('#f_time')==='','캡쳐 시각(08:17)이 시작 시각에 들어가지 않음',"'"+await page.inputValue('#f_time')+"'");
// 앵커가 시각을 아예 들고 있지 않아야 한다 — 필드가 없으면 같은 버그를 다시 배선할 수 없다
const anc=await page.evaluate(()=>buildAnchor('Screenshot_20260726_081700.png',null,0));
ok(anc&&anc.date==='2026-07-26'&&!('time'in anc),'앵커는 날짜만 낸다 (시각 필드 없음)',JSON.stringify(anc));
const ancD=await page.evaluate(()=>buildAnchor('IMG_5125.PNG',{createdTime:'2026-08-02T03:36:10.393Z'},0));
ok(ancD&&!('time'in ancD),'드라이브 저장일 앵커도 시각 없음',JSON.stringify(ancD));
await ctx.close();

/* ---- 3. 기존 기록 보정 — 캡쳐에 실제 시작 줄이 있는 것만 ---- */
const REC=(id,date,st,ocr)=>({record_id:id,date,weekday:'토',start_time:st,
  day_part:+String(st).slice(0,2)<12?'오전':'오후',title:'러닝',distance_km:3.04,
  avg_pace_sec_per_km:330,duration_sec:1003,raw_ocr:ocr,schema_version:'2.0'});
const ctx2=await b.newContext({viewport:{width:1200,height:900}});
const p2=await ctx2.newPage();
p2.on('pageerror',e=>fails.push('pageerror(mig): '+e.message));
await p2.addInitScript(r=>localStorage.setItem('run.records.v2',JSON.stringify(r)),[
  REC('m1','2026-08-01','07:30',OCR_MANGLED),   // 05:57로 보정되어야
  REC('m2','2026-08-01','07:31',OCR_MANGLED2),  // 06:50으로 보정되어야
  REC('m3','2026-08-02','12:35',OCR_NONE),      // 캡쳐에 정보 없음 → 그대로 둔다
  REC('m4','2026-07-27','06:01',OCR_CLEAN),     // 이미 옳음 → 그대로
]);
await p2.goto(BASE+'/index.html',{waitUntil:'networkidle'});
await p2.waitForTimeout(600);
const byId=await p2.evaluate(()=>Object.fromEntries(state.records.map(r=>[r.record_id,{t:r.start_time,dp:r.day_part}])));
ok(byId.m1.t==='05:57','보정 — 07:30 → 05:57',byId.m1.t);
ok(byId.m2.t==='06:50','보정 — 07:31 → 06:50',byId.m2.t);
ok(byId.m3.t==='12:35','캡쳐에 시작 줄 없는 기록은 건드리지 않음',byId.m3.t);
ok(byId.m4.t==='06:01','이미 옳은 기록은 그대로',byId.m4.t);
ok(byId.m1.dp==='오전','보정 시 오전/오후도 함께 갱신',byId.m1.dp);
// 저장까지 반영되고, 두 번째 방문에는 다시 돌지 않는다
const saved=await p2.evaluate(()=>JSON.parse(localStorage.getItem('run.records.v2')).find(r=>r.record_id==='m1').start_time);
ok(saved==='05:57','보정 결과가 저장됨',saved);
// 사용자가 값을 되돌린 뒤 다시 부팅해도 보정이 재실행되지 않아야 한다
const again=await p2.evaluate(()=>{
  state.records.find(r=>r.record_id==='m1').start_time='07:30';
  const n=fixCapturedStartTimes();
  return {n,t:state.records.find(r=>r.record_id==='m1').start_time};
});
ok(again.n===0&&again.t==='07:30','한 번만 실행 — 재실행해도 사용자가 정한 값을 덮지 않음',JSON.stringify(again));
await ctx2.close();

await b.close();srv.close();
console.log(fails.length?'\nFAILED: '+fails.length+'\n- '+fails.join('\n- '):'\nALL PASS');
process.exit(fails.length?1:0);
