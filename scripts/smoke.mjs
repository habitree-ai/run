// 스모크 테스트 (1회용) — 정적 서버 + Playwright로 핵심 UX 경로 검증
// 실행: cd scripts && node smoke.mjs
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
await new Promise(r=>srv.listen(8347,r));
const BASE='http://127.0.0.1:8347';

const fails=[],logs=[];
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1200,height:900}});
const page=await ctx.newPage();
page.on('pageerror',e=>fails.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error')logs.push('console.error: '+m.text());});

const ok=(cond,name)=>{(cond?logs:fails).push((cond?'PASS ':'FAIL ')+name);if(cond)console.log('PASS',name);else console.log('FAIL',name);};

await page.goto(BASE+'/index.html',{waitUntil:'networkidle'}).catch(e=>fails.push('goto: '+e.message));

// 1. 대시보드 렌더 + 시드
ok(await page.locator('h2.vh').first().textContent()==='대시보드','dashboard renders');
ok((await page.locator('#recentList').textContent()).includes('2026-07-26'),'seed record visible');

// 2. 서비스워커 등록
const sw=await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return !!r;});
ok(sw,'service worker registered');

// 3. 뷰 전환
for(const [v,t] of [['add','기록 추가'],['goals','목표 · 달성도'],['data','데이터 · 내보내기']]){
  await page.click(`nav.rail button[data-view="${v}"]`);
  ok((await page.locator('h2.vh').first().textContent()).includes(t),'view '+v);
}

// 4. 데이터 뷰 검색·필터·정렬
await page.fill('#dq','없는검색어zzz');
ok((await page.locator('#dataWrap').textContent()).includes('조건에 맞는'),'filter no-match message');
ok(!(await page.locator('#dreset').getAttribute('class')||'').includes('hide'),'reset link visible');
await page.fill('#dq','일요일');
ok((await page.locator('#dataWrap').textContent()).includes('2026-07-26'),'filter match');
await page.click('#dreset');
ok((await page.locator('#dcount').textContent()).includes('1건'),'filter reset');
await page.click('th.sortable >> text=거리');
ok((await page.locator('th.sortable').filter({hasText:'거리'}).textContent()).includes('▼'),'sort indicator');

// 5. 월 필터
await page.selectOption('#dym','2026-07');
ok((await page.locator('#dataWrap').textContent()).includes('2026-07-26'),'month filter');

// 6. 테마 토글 → 저장 → 새로고침 유지
await page.click('#themeBtn');
ok(await page.evaluate(()=>document.documentElement.getAttribute('data-theme'))==='dark','theme toggles dark');
ok(await page.evaluate(()=>localStorage.getItem('run.theme.v1'))==='dark','theme persisted');
ok(await page.evaluate(()=>document.querySelector('#metaTheme').content)==='#0d0d0d','meta theme-color synced');
await page.reload({waitUntil:'networkidle'});
ok(await page.evaluate(()=>document.documentElement.getAttribute('data-theme'))==='dark','theme survives reload');
await page.screenshot({path:'out/smoke-dark.png',fullPage:false});

// 7. 문서 페이지도 테마 유지
await page.goto(BASE+'/guide.html',{waitUntil:'domcontentloaded'});
ok(await page.evaluate(()=>document.documentElement.getAttribute('data-theme'))==='dark','guide.html inherits theme');
await page.evaluate(()=>localStorage.setItem('run.theme.v1','light'));

// 8. 클립보드 이미지 붙여넣기 → 기록 추가 전환
await page.goto(BASE+'/index.html',{waitUntil:'networkidle'});
await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=c.height=40;c.getContext('2d').fillRect(0,0,40,40);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));
  const dt=new DataTransfer();dt.items.add(new File([blob],'Screenshot_20260726_081700.png',{type:'image/png'}));
  document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt}));
});
await page.waitForTimeout(400);
ok((await page.locator('h2.vh').first().textContent()).includes('기록 추가'),'paste switches to add view');
ok(await page.locator('#photoPrev img').count()===1,'paste shows preview');
ok(await page.inputValue('#f_date')==='2026-07-26','paste filename anchor prefills date');

// 9. 직접 입력 링크 → 오늘 날짜 프리필
await page.click('nav.rail button[data-view="dashboard"]');
await page.click('nav.rail button[data-view="add"]');
await page.click('#manualLink a');
ok(!!(await page.inputValue('#f_date')),'manual entry prefills today');

// 10. 모바일 뷰포트 스크린샷
const m=await ctx.newPage();
await m.setViewportSize({width:390,height:844});
await m.goto(BASE+'/index.html',{waitUntil:'networkidle'});
await m.screenshot({path:'out/smoke-mobile.png'});

// 11. manifest 접근
const mf=await page.evaluate(async()=>{const r=await fetch('manifest.webmanifest');return r.ok?(await r.json()).name:null;});
ok(mf==='러닝 누적기록','manifest served');

await b.close();srv.close();
console.log('\n--- console errors ---');logs.filter(l=>l.startsWith('console.error')).forEach(l=>console.log(l));
console.log('--- result:',fails.length?('FAILURES\n'+fails.join('\n')):'ALL PASS');
process.exit(fails.length?1:0);
