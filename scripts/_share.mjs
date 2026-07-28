import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
const ROOT='C:/Dev/run';
const OUT='C:/Users/N100274/AppData/Local/Temp/claude/C--Dev-run/c9ff260f-755f-4d87-91f9-47ec6f6b7576/scratchpad';
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
const mk=(d,km,pace)=>({record_id:'r'+d,date:d,weekday:'일',start_time:'08:17',day_part:'오전',title:'아침 러닝',
  location:'서울특별시 강남구',distance_km:km,avg_pace_sec_per_km:pace,duration_sec:Math.round(km*pace),
  cadence_spm:165,avg_heart_rate_bpm:null,elevation_gain_m:5,route_summary:['강변북로'],source:'nrc',
  has_image:false,schema_version:'2.0'});
const REC=[mk('2025-12-20',5,340),mk('2026-03-05',6,335),mk('2026-05-05',3.2,328),
  mk('2026-06-11',7.4,344),mk('2026-07-12',6.7,340),mk('2026-07-26',8.1,348)];
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
ok(chk.sy.n===5,'summary(year) filters to this year (5 of 6)');
ok(chk.round,'encode -> decode round trip identical');
ok(chk.bad1===null&&chk.bad2===null&&chk.bad3===null,'corrupt token returns null');
ok(chk.linkLen<500&&chk.linkLenAll<500,`link under 500 chars (${chk.linkLen}/${chk.linkLenAll})`);
// 5. 개인정보가 새지 않는가
const leak=['2026-07-26','2025-12-20','강남','강변북로','08:17','아침 러닝','nrc','record_id'];
const found=leak.filter(t=>chk.raw.includes(t));
ok(found.length===0,'no per-record data in payload'+(found.length?' — leaked: '+found.join(','):''));
console.log('  payload:',chk.raw);

// 3. 데이터 안전성 — 남의 링크를 열어도 내 기록이 변하지 않는다 (최우선)
const before=await pg.evaluate(()=>localStorage.getItem('run.records.v2'));
const foreign=await pg.evaluate(()=>{
  const s={v:1,sc:'a',n:999,d:4321.5,t:1234567,ap:300,bp:280,st:7,gp:null,gt:null,
    m:[10,20,30,40,50,60,70,80,90,100,110,120],at:'2026-07-28'};
  return '#s='+encodeShare(s);
});
await pg.goto(B+'/index.html'+foreign,{waitUntil:'networkidle'});
await pg.waitForTimeout(700); // 해시만 바뀐 이동은 hashchange -> reload 경로를 탄다
const after=await pg.evaluate(()=>localStorage.getItem('run.records.v2'));
ok(before===after,'foreign share link does not touch my records');
ok((await pg.locator('.sharedban').count())===1,'shared banner shown');
ok((await pg.locator('.totalrow .val').first().textContent()).includes('999'),'shared view renders foreign summary');
ok((await pg.locator('nav.rail').isVisible())===false,'rail hidden in shared view');
ok((await pg.locator('#storagePill').isVisible())===false,'storage pill hidden in shared view');
await pg.screenshot({path:join(OUT,'share-view-pc.png'),fullPage:true});

// 링크를 닫고 앱을 열면 내 데이터가 그대로
await pg.goto(B+'/index.html',{waitUntil:'networkidle'});
await pg.waitForTimeout(400);
ok((await pg.evaluate(()=>state.records.length))===REC.length,'my records intact after visiting share link');

// 2. 손상된 해시는 평소 앱으로 부팅
await pg.goto(B+'/index.html#s=zzzz!!!broken',{waitUntil:'networkidle'});
await pg.waitForTimeout(400);
ok((await pg.locator('.sharedban').count())===0&&(await pg.locator('h2.vh').first().textContent())==='대시보드','broken hash boots normal app');

// 4/6. 공유 모달 + 카드
await pg.goto(B+'/index.html',{waitUntil:'networkidle'});
await pg.click('button[title="요약 링크·카드 이미지 공유"]');
await pg.waitForTimeout(1200);
const card=await pg.evaluate(async()=>{
  const b=await drawShareCard(buildSummary('year'));
  const bmp=await createImageBitmap(b);
  return {type:b.type,size:b.size,w:bmp.width,h:bmp.height};
});
ok(card.type==='image/png'&&card.w===1080&&card.h===1080,`card is 1080x1080 png (${card.w}x${card.h}, ${Math.round(card.size/1024)}KB)`);
ok((await pg.locator('#sharePrev img').count())===1,'modal preview rendered');
ok((await pg.locator('#shareLink').inputValue()).includes('#s='),'modal link filled');
await pg.screenshot({path:join(OUT,'share-modal-pc.png')});
// 범위 전환
const l1=await pg.locator('#shareLink').inputValue();
await pg.click('.rangetog button[data-sc="all"]');
await pg.waitForTimeout(900);
const l2=await pg.locator('#shareLink').inputValue();
ok(l1!==l2,'scope toggle changes link');

// 카드 이미지를 파일로 떨궈 눈으로 본다
const b64=await pg.evaluate(async()=>{
  const b=await drawShareCard(buildSummary('year'));
  return await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(b);});
});
const {writeFile}=await import('node:fs/promises');
await writeFile(join(OUT,'share-card.png'),Buffer.from(b64.split(',')[1],'base64'));

// 모바일
const m=await ctx.newPage();
m.on('pageerror',e=>errs.push('mob pageerror: '+e.message));
await m.setViewportSize({width:390,height:844});
await m.goto(B+'/index.html'+foreign,{waitUntil:'networkidle'});
await m.waitForTimeout(600);
await m.screenshot({path:join(OUT,'share-view-mob.png'),fullPage:true});
await m.goto(B+'/index.html',{waitUntil:'networkidle'});
await m.evaluate(r=>localStorage.setItem('run.records.v2',JSON.stringify(r)),REC);
await m.goto(B+'/index.html',{waitUntil:'networkidle'});
await m.click('button[title="요약 링크·카드 이미지 공유"]');
await m.waitForTimeout(1200);
await m.screenshot({path:join(OUT,'share-modal-mob.png')});

await br.close();srv.close();
console.log('\n--- errors ---');console.log(errs.length?errs.join('\n'):'none');
console.log('--- result:',fails.length?'FAIL\n'+fails.join('\n'):'ALL PASS');
