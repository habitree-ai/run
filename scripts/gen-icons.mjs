// PWA 아이콘 생성 (1회용) — 앱 로고(그라디언트 + 러너 스트로크)를 PNG로 캡쳐
// 실행: cd scripts && node gen-icons.mjs
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';

const glyph=(size,scale)=>`<!doctype html><body style="margin:0">
<div style="width:${size}px;height:${size}px;background:linear-gradient(135deg,#2a78d6,#1c5cab);display:grid;place-items:center">
<svg width="${Math.round(size*scale)}" height="${Math.round(size*scale)}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
<circle cx="16.5" cy="4" r="1.6" fill="#fff" stroke="none"/><path d="M15 7l-3.5 5.5"/><path d="M10.5 8.5L14 6.5L17.5 8"/><path d="M11.5 12.5L15 15.5L13.5 20.5"/><path d="M11.5 12.5L7.5 15.5L4 14"/></svg></div>`;

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
