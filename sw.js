/* 러닝 누적기록 서비스워커 — 오프라인 조회 + 홈 화면 설치.
   페이지(HTML)는 network-first(배포 즉시 반영), 정적 자산은 cache-first. */
const VER='run-v2'; /* 모바일 개편 — 구 캐시(구 index.html 오프라인 폴백) 폐기 */
const CORE=['./','index.html','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(VER).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k!==VER).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET'||new URL(req.url).origin!==location.origin)return; /* 드라이브 API·CDN은 그대로 통과 */
  if(req.mode==='navigate'){
    e.respondWith(fetch(req)
      .then(r=>{const cp=r.clone();caches.open(VER).then(c=>c.put(req,cp));return r;})
      .catch(()=>caches.match(req).then(r=>r||caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(r=>r||fetch(req).then(nr=>{
    if(nr.ok){const cp=nr.clone();caches.open(VER).then(c=>c.put(req,cp));}
    return nr;
  })));
});
