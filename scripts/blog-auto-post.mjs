#!/usr/bin/env node
/**
 * 러닝 기록 → 네이버 블로그 완전 자동 발행 (트랙 B · 관리자 전용)
 * 설계: ../blog_v1.md §5 — dry-run 기본, --publish 시에만 실제 발행.
 *
 * 사용법:
 *   npm install                                  # 최초 1회 (이 폴더에서)
 *   npx playwright install chromium              # 최초 1회
 *   node blog-auto-post.mjs --login              # 최초 1회: 수동 로그인 → 세션만 저장
 *   node blog-auto-post.mjs --json ../running_records.json --images ../기록
 *       [--blog nevertheless-jos] [--category 150] [--limit 1] [--publish]
 *
 * 안전장치: dry-run 기본(발행 직전 정지+스크린샷) · --limit 기본 1(상한 5) ·
 *   건당 5~10초 대기 · 실패/캡차 감지 시 즉시 전체 중단 · 자동 로그인 코드 없음.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '.naver-profile'); // 로그인 세션 (git/vercel 제외)
const OUT_DIR = path.join(__dirname, 'out');                // dry-run 스크린샷

/* 스마트에디터 ONE 셀렉터 — 네이버 DOM 개편 시 여기만 보정 (dry-run 스크린샷으로 회귀 감지).
   해시 클래스는 변하므로 role/텍스트 로케이터를 우선하고, 실패 시 첫 실행 화면을 보며 조정할 것. */
const SEL = {
  editorFrameUrl: /PostWriteForm|postwrite/i,                    // 에디터가 든 프레임 판별
  title: '.se-section-documentTitle .se-text-paragraph',         // 제목 문단
  body: '.se-section-text .se-text-paragraph',                   // 본문 첫 문단
  imageBtn: 'button[data-name="image"]',                         // 툴바 사진 버튼 (fileChooser 유발)
  imageDone: '.se-main-container .se-image-resource',            // 본문에 이미지 삽입 완료
  popupCancel: '.se-popup-button-cancel',                        // "작성 중인 글" 복구 팝업 — 새로 작성
  helpClose: '.se-help-panel-close-button',                      // 도움말 패널 닫기
  publishOpen: 'button:has-text("발행")',                        // 우상단 발행 레이어 열기
  publishConfirm: '[data-testid="seOnePublishBtn"], button[class*="confirm_btn"]:has-text("발행")', // 레이어 내 발행 확정
};

function parseArgs(argv) {
  const a = { images: path.join(__dirname, '..', '기록'), limit: 1, publish: false, login: false, headless: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--login') a.login = true;
    else if (k === '--publish') a.publish = true;
    else if (k === '--headless') a.headless = true;
    else if (k === '--json') a.json = argv[++i];
    else if (k === '--images') a.images = argv[++i];
    else if (k === '--blog') a.blog = argv[++i];
    else if (k === '--category') a.category = argv[++i];
    else if (k === '--limit') a.limit = Math.min(5, Math.max(1, parseInt(argv[++i], 10) || 1)); // 상한 5
    else { console.error(`알 수 없는 옵션: ${k}`); process.exit(1); }
  }
  return a;
}

/* 앱(index.html blogTitle)과 동일한 제목 규칙 */
const blogTitle = (rec) => rec.date.slice(2).replace(/-/g, '.') + ' - ' + (Math.round((rec.distance_km || 0) * 10) / 10).toFixed(1) + 'KM';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 5000 + Math.floor(Math.random() * 5000); // 5~10초

function findImage(rec, imagesDir) {
  const yymmdd = rec.date.slice(2).replace(/-/g, '');
  const names = [rec.original_filename, ...['png', 'jpg', 'jpeg'].flatMap((e) => [`${rec.record_id}.${e}`, `${yymmdd}.${e}`])];
  for (const n of names) {
    if (!n) continue;
    const p = path.join(imagesDir, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function launch(headless) {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless, viewport: { width: 1400, height: 900 }, locale: 'ko-KR',
  });
}

async function doLogin() {
  const ctx = await launch(false); // 로그인은 항상 헤드풀
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://nid.naver.com/nidlogin.login');
  console.log('브라우저에서 직접 로그인해 주세요 (자동 입력 없음). 로그인이 확인되면 저장 후 종료합니다…');
  await page.waitForURL((u) => !String(u).includes('nid.naver.com'), { timeout: 300000 }); // 최대 5분 대기
  await sleep(1500);
  await ctx.close();
  console.log(`로그인 세션을 저장했습니다 → ${PROFILE_DIR}`);
}

function editorFrame(page) {
  return page.frames().find((f) => SEL.editorFrameUrl.test(f.url())) || page.mainFrame();
}

async function dismissPopups(ed) {
  for (const sel of [SEL.popupCancel, SEL.helpClose]) {
    try { await ed.locator(sel).first().click({ timeout: 2500 }); } catch { /* 없으면 무시 */ }
  }
}

async function postOne(page, rec, imgPath, opt) {
  const url = `https://blog.naver.com/${encodeURIComponent(opt.blog)}?Redirect=Write` + (opt.category ? `&categoryNo=${encodeURIComponent(opt.category)}` : '');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  const cur = page.url();
  if (cur.includes('nid.naver.com')) throw new Error('로그인이 필요합니다 — 먼저 `node blog-auto-post.mjs --login`을 실행하세요.');
  if (/captcha|보안|restrict/i.test(cur)) throw new Error(`보안/캡차 페이지 감지 (${cur}) — 자동화를 중단합니다. 수동으로 확인하세요.`);

  const ed = editorFrame(page);
  await ed.waitForSelector(SEL.title, { timeout: 30000 });
  await dismissPopups(ed);

  const title = blogTitle(rec);
  await ed.click(SEL.title);
  await page.keyboard.type(title, { delay: 60 });

  await ed.click(SEL.body); // 커서를 본문으로
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    ed.click(SEL.imageBtn),
  ]);
  await chooser.setFiles(imgPath);
  await ed.waitForSelector(SEL.imageDone, { timeout: 60000 }); // 업로드 완료 대기
  await sleep(1500);

  if (!opt.publish) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const shot = path.join(OUT_DIR, `dryrun_${rec.date}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`  [dry-run] 발행 직전 정지 — 스크린샷: ${shot}`);
    return null;
  }

  await ed.locator(SEL.publishOpen).last().click(); // 발행 레이어 (카테고리는 URL로 사전 지정)
  await sleep(1200);
  await ed.locator(SEL.publishConfirm).last().click();
  await page.waitForURL(/logNo=|\/\d{9,}/, { timeout: 30000 }); // 발행 확인 (PostView)
  const m = page.url().match(/logNo=(\d+)|\/(\d{9,})/);
  return (m && (m[1] || m[2])) || 'unknown';
}

async function main() {
  const opt = parseArgs(process.argv);
  if (opt.login) return doLogin();

  if (!opt.json) { console.error('필수: --json <running_records.json 경로> (또는 --login)'); process.exit(1); }
  const jsonPath = path.resolve(opt.json);
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const records = Array.isArray(data) ? data : data.records || [];
  if (!opt.blog) { console.error('필수: --blog <블로그 ID> (예: --blog nevertheless-jos)'); process.exit(1); }

  const targets = records
    .filter((r) => r && r.date && !r.blog_posted_at)
    .map((r) => ({ rec: r, imgPath: findImage(r, path.resolve(opt.images)) }))
    .filter((t) => t.imgPath)
    .slice(0, opt.limit);
  const skipped = records.filter((r) => r && r.date && !r.blog_posted_at).length - targets.length;
  console.log(`대상 ${targets.length}건 (미발행 중 이미지 미매칭 ${skipped}건 제외) · ${opt.publish ? '실제 발행' : 'dry-run'} · limit ${opt.limit}`);
  if (!targets.length) return;

  fs.copyFileSync(jsonPath, jsonPath + '.bak'); // 원본 백업
  const ctx = await launch(opt.headless);
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    for (const { rec, imgPath } of targets) {
      console.log(`- ${blogTitle(rec)} ← ${path.basename(imgPath)}`);
      const logNo = await postOne(page, rec, imgPath, opt);
      if (opt.publish) {
        rec.blog_posted_at = new Date().toISOString();
        if (logNo && logNo !== 'unknown') rec.blog_log_no = logNo;
        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2)); // 건별 즉시 저장 — 중간 실패에도 발행분 유실 없음
        console.log(`  발행 완료 (logNo=${logNo}) — JSON 갱신`);
      }
      await sleep(jitter());
    }
    console.log(opt.publish
      ? '완료. 갱신된 JSON을 앱의 [JSON 가져오기]로 불러오면 발행 배지가 반영됩니다.'
      : '완료(dry-run). out/ 스크린샷을 확인 후 --publish로 실행하세요.');
  } catch (e) {
    console.error(`중단: ${e.message}`); // 중복 발행 방지 — 실패 시 이후 건 진행하지 않음
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
}

main();
