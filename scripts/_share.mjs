import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
const ROOT='C:/Dev/run';
const OUT='C:/Users/N100274/AppData/Local/Temp/claude/C--Dev-run/16002896-ea89-4341-bd10-45b40231da35/scratchpad';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json',
  '.webmanifest':'application/manifest+json','.png':'image/png','.css':'text/css'};
const srv=createServer(async(req,res)=>{
  const p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  const f=join(ROOT,p==='/'?'index.html':p.slice(1));
  try{const b=await readFile(f);res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(b);}
  catch(e){res.writeHead(404);res.end('nf');}
});
await new Promise(r=>srv.listen(8359,r));
const B='http://127.0.0.1:8359';
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const mk=(d,km,pace)=>({record_id:'r'+d,date:d,weekday:'일',start_time:'08:17',day_part:'오전',title:'아침 러닝',
  location:'서울특별시 강남구',distance_km:km,avg_pace_sec_per_km:pace,duration_sec:Math.round(km*pace),
  cadence_spm:165,avg_heart_rate_bpm:null,elevation_gain_m:5,route_summary:['강변북로'],source:'nrc',
  has_image:false,schema_version:'2.0'});
/* 이번 주/이번 달 검증용 동적 날짜 — 오늘 + 이번 주 월요일 + 이번 달 1일 */
const now=new Date();
const monday=new Date(now);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
const first=new Date(now.getFullYear(),now.getMonth(),1);
const dyn=[...new Set([iso(now),iso(monday),iso(first)])].map(d=>mk(d,5.5,332));
const REC=[mk('2025-12-20',5,340),mk('2026-03-05',6,335),mk('2026-05-05',3.2,328),
  mk('2026-06-11',7.4,344),mk('2026-07-12',6.7,340),mk('2026-07-26',8.1,348),...dyn];
const thisYearN=new Set(REC.filter(r=>r.date.slice(0,4)===String(now.getFullYear())).map(r=>r.date)).size;
const fails=[],logs=[];
const ok=(c,n)=>{(c?logs:fails).push((c?'PASS ':'FAIL ')+n);console.log(c?'PASS':'FAIL',n);};
const br=await chromium.launch();
const ctx=await br.newContext({viewport:{width:1280,height:900},permissions:[]});
const pg=await ctx.newPage();
const errs=[];
pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});

await pg.goto(B+'/index.html');
await pg.evaluate(r=>localStorage.setItem('run.records.v2',JSON.stringify(r)),REC);
await pg.goto(B+'/index.html',{waitUntil:'networkidle'});

// 1. 요약 값이 화면 값과 같은가
const chk=await pg.evaluate(()=>{
  const sy=buildSummary('year'),sa=buildSummary('all');
  const a=agg();
  return {sy,sa,screenN:a.n,screenD:Math.round(a.d*10)/10,screenT:a.t,
    linkLen:shareUrl(sy).length, linkLenAll:shareUrl(sa).length,
    round:JSON.stringify(decodeShare(encodeShare(sy)))===JSON.stringify(sy),
    bad1:decodeShare('!!!not-base64!!!'),bad2:decodeShare('YWJj'),bad3:decodeShare(''),
    raw:JSON.stringify(sy)};
});
ok(chk.sa.n===chk.screenN&&chk.sa.d===chk.screenD&&chk.sa.t===chk.screenT,'summary(all) matches screen aggregate');
ok(chk.sy.n===thisYearN,`summary(year) filters to this year (${chk.sy.n}/${REC.length}일 중 ${thisYearN} 기대)`);
ok(chk.round,'encode -> decode round trip identical');
ok(chk.bad1===null&&chk.bad2===null&&chk.bad3===null,'corrupt token returns null');
ok(chk.linkLen<500&&chk.linkLenAll<500,`link under 500 chars (${chk.linkLen}/${chk.linkLenAll})`);
// 개인정보가 새지 않는가
const leak=['2026-07-26','2025-12-20','강남','강변북로','08:17','아침 러닝','nrc','record_id'];
const found=leak.filter(t=>chk.raw.includes(t));
ok(found.length===0,'no per-record data in payload'+(found.length?' — leaked: '+found.join(','):''));

// 2. 주/월 범위 (REQ-0014)
const wm=await pg.evaluate(()=>{
  const sw=buildSummary('week'),sm=buildSummary('month');
  return {sw,sm,
    roundW:JSON.stringify(decodeShare(encodeShare(sw)))===JSON.stringify(sw),
    roundM:JSON.stringify(decodeShare(encodeShare(sm)))===JSON.stringify(sm),
    lenW:shareUrl(sw).length,lenM:shareUrl(sm).length,
    rawW:JSON.stringify(sw),rawM:JSON.stringify(sm)};
});
const dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
ok(wm.sw.sc==='w'&&wm.sw.m.length===7,'week summary: sc=w, 7 slots');
ok(wm.sm.sc==='m'&&wm.sm.m.length===dim,`month summary: sc=m, ${dim} slots`);
ok(wm.sw.gp&&wm.sw.gp.length===2&&wm.sw.gt&&wm.sw.gt.length===2,'week carries weekly plan/target');
ok(wm.sm.gp&&wm.sm.gp.length===2,'month carries monthly plan/target');
ok(wm.sw.n>=1&&wm.sw.m.some(v=>v>0),'week has seeded runs');
ok(wm.sm.n>=1&&wm.sm.m.some(v=>v>0),'month has seeded runs');
ok(Math.abs(wm.sw.m.reduce((a,b)=>a+b,0)-wm.sw.d)<0.4,'week daily bars sum ≈ total distance');
ok(Math.abs(wm.sm.m.reduce((a,b)=>a+b,0)-wm.sm.d)<1.6,'month daily bars sum ≈ total distance');
ok(wm.roundW&&wm.roundM,'week/month round trip identical');
ok(wm.lenW<500&&wm.lenM<600,`week/month link length ok (${wm.lenW}/${wm.lenM})`);
const found2=leak.filter(t=>wm.rawW.includes(t)||wm.rawM.includes(t));
ok(found2.length===0,'no per-record data in week/month payload'+(found2.length?' — leaked: '+found2.join(','):''));
console.log('  week payload:',wm.rawW);

// 3. 데이터 안전성 — 남의 링크를 열어도 내 기록이 변하지 않는다 (최우선)
const before=await pg.evaluate(()=>localStorage.getItem('run.records.v2'));
const foreign=await pg.evaluate(()=>{
  const s={v:1,sc:'a',n:999,d:4321.5,t:1234567,ap:300,bp:280,st:7,gp:null,gt:null,
    m:[10,20,30,40,50,60,70,80,90,100,110,120],at:'2026-07-28'};
  return '#s='+encodeShare(s);
});
await pg.goto(B+'/index.html'+foreign,{waitUntil:'networkidle'});
await pg.waitForTimeout(700);
const after=await pg.evaluate(()=>localStorage.getItem('run.records.v2'));
ok(before===after,'foreign share link does not touch my records');
ok((await pg.locator('.sharedban').count())===1,'shared banner shown');
ok((await pg.locator('.totalrow .val').first().textContent()).includes('999'),'shared view renders foreign summary');
ok((await pg.locator('nav.rail').isVisible())===false,'rail hidden in shared view');

// 4. 기존 링크 하위호환 — sc:'y' 구형 요약(REQ-0004 형식)이 그대로 열린다
const legacy=await pg.evaluate(()=>{
  const s={v:1,sc:'y',n:120,d:640.5,t:230400,ap:330,bp:290,st:3,gp:[180,540],gt:[240,720],
    m:[40,50,60,55,65,70,45,58,62,48,50,37],at:'2026-08-15'};
  return '#s='+encodeShare(s);
});
await pg.goto(B+'/index.html'+legacy,{waitUntil:'networkidle'});
await pg.waitForTimeout(700);
const legacyTxt=await pg.locator('#stage').textContent();
ok(legacyTxt.includes('올해 횟수')&&legacyTxt.includes('월별 거리'),'legacy year link renders with yearly labels');

// 5. 주 범위 읽기 전용 뷰 — 요일별 차트·주간 게이지 (공유 뷰에서는 goals가 없어 앱으로 복귀 후 생성)
await pg.goto(B+'/index.html',{waitUntil:'networkidle'});
await pg.evaluate(r=>localStorage.setItem('run.records.v2',JSON.stringify(r)),REC);
await pg.goto(B+'/index.html',{waitUntil:'networkidle'});
const wUrl=await pg.evaluate(()=>'#s='+encodeShare(buildSummary('week')));
await pg.goto(B+'/index.html'+wUrl,{waitUntil:'networkidle'});
await pg.waitForTimeout(700);
const wTxt=await pg.locator('#stage').textContent();
ok(wTxt.includes('요일별 거리'),'week shared view: daily-of-week chart title');
ok(wTxt.includes('주간 횟수')||!wm.sw.gp[0],'week shared view: weekly goal gauge');
ok(wTxt.includes('주차'),'week shared view: period label shows week');
await pg.screenshot({path:join(OUT,'share-view-week-pc.png'),fullPage:true});

// 6. 손상된 해시는 평소 앱으로 부팅
await pg.goto(B+'/index.html#s=zzzz!!!broken',{waitUntil:'networkidle'});
await pg.waitForTimeout(400);
ok((await pg.locator('.sharedban').count())===0&&(await pg.locator('h2.vh').first().textContent())==='대시보드','broken hash boots normal app');

// 7. 공유 모달 — 토글 4개, 범위 전환, 카드 생성
await pg.goto(B+'/index.html',{waitUntil:'networkidle'});
await pg.click('button[title="요약 링크·카드 이미지 공유"]');
await pg.waitForTimeout(1200);
ok((await pg.locator('.rangetog button[data-sc]').count())===4,'modal has 4 scope buttons');
ok((await pg.locator('#shareNote').textContent()).includes('날짜'),'default note mentions no dates');
const l1=await pg.locator('#shareLink').inputValue();
await pg.click('.rangetog button[data-sc="week"]');
await pg.waitForTimeout(900);
const l2=await pg.locator('#shareLink').inputValue();
ok(l1!==l2,'scope toggle changes link');
ok((await pg.locator('#shareNote').textContent()).includes('일자별'),'week note mentions daily totals');
ok((await pg.locator('#sharePrev img').count())===1,'week card preview rendered');
await pg.screenshot({path:join(OUT,'share-modal-pc.png')});
const card=await pg.evaluate(async()=>{
  const r={};
  for(const sc of ['week','month','year','all']){
    const b=await drawShareCard(buildSummary(sc));
    const bmp=await createImageBitmap(b);
    r[sc]={type:b.type,w:bmp.width,h:bmp.height,kb:Math.round(b.size/1024)};
  }
  return r;
});
for(const sc of ['week','month','year','all'])
  ok(card[sc].type==='image/png'&&card[sc].w===1080&&card[sc].h===1080,`card(${sc}) 1080x1080 png (${card[sc].kb}KB)`);

// 카드 이미지를 파일로 떨궈 눈으로 본다 (주/월/올해)
const {writeFile}=await import('node:fs/promises');
for(const sc of ['week','month','year']){
  const b64=await pg.evaluate(async s=>{
    const b=await drawShareCard(buildSummary(s));
    return await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(b);});
  },sc);
  await writeFile(join(OUT,`share-card-${sc}.png`),Buffer.from(b64.split(',')[1],'base64'));
}

// 8. 모바일 390px — 주 공유 뷰 + 모달
const m=await ctx.newPage();
m.on('pageerror',e=>errs.push('mob pageerror: '+e.message));
await m.setViewportSize({width:390,height:844});
await m.goto(B+'/index.html'+wUrl,{waitUntil:'networkidle'});
await m.waitForTimeout(600);
await m.screenshot({path:join(OUT,'share-view-week-mob.png'),fullPage:true});
const mUrl=await pg.evaluate(()=>'#s='+encodeShare(buildSummary('month')));
await m.goto(B+'/index.html'+mUrl,{waitUntil:'networkidle'});
await m.waitForTimeout(600);
const mobW=await m.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
ok(mobW,'month shared view: no horizontal scroll at 390px');
await m.screenshot({path:join(OUT,'share-view-month-mob.png'),fullPage:true});
await m.goto(B+'/index.html',{waitUntil:'networkidle'});
await m.evaluate(r=>localStorage.setItem('run.records.v2',JSON.stringify(r)),REC);
await m.goto(B+'/index.html',{waitUntil:'networkidle'});
await m.click('button[title="요약 링크·카드 이미지 공유"]');
await m.waitForTimeout(1200);
await m.screenshot({path:join(OUT,'share-modal-mob.png')});

await br.close();srv.close();
console.log('\n--- errors ---');console.log(errs.length?errs.join('\n'):'none');
console.log('--- result:',fails.length?'FAIL\n'+fails.join('\n'):'ALL PASS');
process.exit(fails.length?1:0);
