// PWA 아이콘 생성 (1회용) — 앱 로고(그라디언트 + 러너 스트로크)를 PNG로 캡쳐
// 실행: cd scripts && node gen-icons.mjs
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';

const glyph=(size,scale)=>`<!doctype html><body style="margin:0">
<div style="width:${size}px;height:${size}px;background:linear-gradient(135deg,#2a78d6,#1c5cab);display:grid;place-items:center">
<svg width="${Math.round(size*scale)}" height="${Math.round(size*scale)}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
<path d="M13 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/><path d="M4 17l3-3 3 1 2-4 3 2 2-1"/><path d="M8.5 21l2.5-5 3 2 1 3"/></svg></div>`;

mkdirSync('../icons',{recursive:true});
const b=await chromium.launch();
const p=await b.newPage();
for(const [file,size,scale] of [
  ['icon-192.png',192,0.62],
  ['icon-512.png',512,0.62],
  ['icon-180.png',180,0.62],
  ['icon-maskable-512.png',512,0.5], // maskable — 세이프존(중앙 80%) 안에 글리프
]){
  await p.setViewportSize({width:size,height:size});
  await p.setContent(glyph(size,scale));
  await p.screenshot({path:'../icons/'+file});
  console.log('generated',file);
}
await b.close();
