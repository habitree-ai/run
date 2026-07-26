# 러닝기록 Track A — MVP 설계 (v1)

> 프로젝트: **자동발행** · 초안 착수 문서 · 작성일: 2026-07-24 (KST)
> 확정 방향: **Track A(웹앱 + 구글드라이브)** · 무료 **OCR·수동 우선** · 노션은 무상태 Worker(후순위) · 호스팅 **Cloudflare Pages** · 정본 **JSON(스키마 v1.0)**

---

## 0. 요약

이 문서는 확정된 방향(플랫폼 아키텍처 §10)을 **실제 구현 설계**로 옮긴 것이다. 함께 제공되는 **초안 앱(`app.html`)** 은 이 설계의 핵심 흐름 — 저장소 어댑터, 티어드 추출, 라이브 대시보드, JSON 정본 — 을 **전부 클라이언트에서 동작하는 형태**로 이미 구현했다. 남은 것은 구글/노션 **실연동(OAuth)** 과 **BYOK 비전 티어**다(§8 마일스톤).

---

## 1. 확정 사항

| 항목 | 선택 | 비고 |
|---|---|---|
| 배포 트랙 | **A — 웹앱 + 구글드라이브** | 이미지가 드라이브에 있고, 기존 대시보드 재사용 |
| 무료 추출 | **OCR(브라우저) + 수동 우선** | 키 불필요, 누구나. 정확 티어는 BYOK(P2) |
| 노션 OAuth | 무상태 Worker (P3) | 데이터 저장 안 함 · 토큰 교환만 |
| 호스팅 | **Cloudflare Pages** | 정적 무료, 대역폭 넉넉 · (노션용)Workers |
| 정본 형식 | **JSON (스키마 v1.0)** | 저장소 중립 · 이식 가능 |
| 데이터 소유 | **각 사용자** | 창작자 서버엔 데이터 없음 |

---

## 2. 사용자 플로우

<div class="arch">
  <div class="arch-col"><div class="arch-num">1</div><div class="arch-title">연결</div>
    <div class="arch-box">구글드라이브<br><small>Picker로 폴더</small></div></div>
  <div class="arch-arrow">→</div>
  <div class="arch-col"><div class="arch-num">2</div><div class="arch-title">가져오기</div>
    <div class="arch-box">이미지 선택<br><small>또는 수동</small></div></div>
  <div class="arch-arrow">→</div>
  <div class="arch-col"><div class="arch-num">3</div><div class="arch-title">추출·확인</div>
    <div class="arch-box">OCR/BYOK<br><small>정합성 검증</small></div></div>
  <div class="arch-arrow">→</div>
  <div class="arch-col"><div class="arch-num">4</div><div class="arch-title">누적</div>
    <div class="arch-box">정본 JSON<br><small>사용자 저장소</small></div></div>
  <div class="arch-arrow">→</div>
  <div class="arch-col"><div class="arch-num">5</div><div class="arch-title">대시보드</div>
    <div class="arch-box">KPI·추세<br><small>라이브 집계</small></div></div>
</div>

모든 단계가 **사용자 브라우저 ↔ 사용자 저장소** 사이에서만 일어난다. 창작자 서버는 앱 파일을 내려줄 뿐 데이터 경로에 없다.

---

## 3. 화면 명세 (초안 앱 기준)

| 화면 | 목적 | 핵심 요소 | 상태 |
|---|---|---|---|
| **연결** | 저장소 백엔드 선택 | 구글드라이브(추천)·Notion(준비중)·로컬/데모 · 연결 상태 표시 | 로컬·데모 동작, Drive/Notion 스텁 |
| **기록 추가** | 세션 1건 추가 | 3탭(수동·OCR·불러오기), 페이스↔시간 자동계산, 확인 후 저장 | 수동·OCR·불러오기 동작 |
| **대시보드** | 누적 지표 열람 | KPI(횟수·거리·시간·칼로리·평균페이스·PR), 주간거리, 페이스추이, 최근러닝 | 라이브 집계 동작 |
| **데이터·내보내기** | 정본 관리 | 전체 표·삭제·**정본 JSON 내보내기(=저장소 쓰기)** | 동작 |

---

## 4. 저장소 어댑터 인터페이스

앱 본체는 아래 인터페이스만 알고, 백엔드 구현은 모른다 → 백엔드 추가가 **UI/추출 수정 없이** 이뤄진다.

```js
interface StorageAdapter {
  connect()                 // OAuth/Picker/토큰 — 사용자 인증
  listImages()   -> [ImageRef]     // 미처리 캡쳐 목록
  readDataset()  -> [Record]       // 누적 정본 읽기 (스키마 v1.0)
  writeDataset(records)            // 정본 저장 (read-merge-write)
}
```

| 어댑터 | 상태 | 구현 방식 |
|---|---|---|
| **LocalFileAdapter** | ✅ 동작 | 메모리 + JSON 내보내기/불러오기(= 정본 파일). 사용자가 직접 소유 |
| **DriveAdapter** | ⏳ 설계 | OAuth `drive.file` + Google Picker로 폴더 부여 · 정본 `running_records.json`(앱 폴더/선택 폴더) · 읽기=이미지 목록+정본, 쓰기=정본 갱신 · 신규 이미지는 **앱 열 때 스캔** |
| **NotionAdapter** | ⏳ 설계 | 템플릿 복제 + OAuth(무상태 Worker) 또는 내부토큰 · 레코드=DB 페이지 · 노션 뷰가 대시보드 |

---

## 5. 추출 엔진 명세 (티어드)

| 티어 | 방식 | 상태 | 비고 |
|---|---|---|---|
| **수동** | 폼 입력(필수: 날짜·거리, 페이스/시간 상호 계산) | ✅ | 항상 가능한 기준·보정 |
| **OCR(무료)** | Tesseract.js(kor+eng) → 파서 → 폼 프리필 → 확인 저장 | ✅ | 엔진 지연 로드, 실패 시 수동 폴백 |
| **BYOK(정확)** | 사용자 AI 키로 비전 추출 | ⏳ P2 | Claude(`anthropic-dangerous-direct-browser-access`)/Gemini · 키는 사용자 브라우저에만 · 케이던스·심박·고도까지 |

**정합성 검증(공통):** 페이스 × 거리 ≈ 시간(허용오차) · 값 범위 sanity(페이스 2\~15분, 심박 60\~220 등) · 중복 방지(`record_id` 또는 날짜+시각+거리).

---

## 6. 기술 스택 · 배포

- **클라이언트**: 현 초안은 단일 HTML(자기완결). 실서비스는 모듈 분리 권장(`adapters/`, `extract/`, `ui/`, `dashboard/`).
- **의존성 최소화**: 코어는 **무(無)CDN**(오프라인·사내망 견딤). **OCR만** Tesseract를 지연 로드(선택 기능).
- **배포**: **Cloudflare Pages**(정적) + (노션용)**Workers**(무상태 OAuth 교환). OAuth `client_id`는 공개 OK, `secret`은 Worker에만.
- **저장**: 전적으로 사용자 저장소. **창작자 서버엔 사용자 데이터가 없음**(유출 표면 0).
- **비밀키**: 정적 앱에 창작자 키 임베드 금지. BYOK만.

---

## 7. 초안(`app.html`) 현황 — 동작 vs 스텁

| 기능 | 상태 |
|---|---|
| 백엔드 선택 UI(연결 화면) | ✅ 동작 |
| 로컬·데모 모드(데모 9건) | ✅ 동작 |
| 수동 입력 + 페이스/시간 자동계산 | ✅ 동작 |
| 이미지 OCR(Tesseract) → 폼 프리필 | ✅ 동작(엔진 로드 시) |
| 데이터셋 JSON 불러오기 | ✅ 동작 |
| 라이브 대시보드(KPI·주간·페이스·최근) | ✅ 동작 |
| 정본 JSON 내보내기(= 저장소 쓰기) | ✅ 동작 |
| 라이트/다크 · 반응형 | ✅ 동작 |
| 구글드라이브 실연동(OAuth+Picker) | ⏳ 스텁(설명) |
| 노션 실연동(Worker OAuth) | ⏳ 스텁(설명) |
| BYOK AI 비전 | ⏳ P2 |

---

## 8. 마일스톤

| 단계 | 내용 | 상태 |
|---|---|---|
| **M1** | 로컬·수동·OCR·라이브 대시보드·JSON 정본 (초안 앱) | ✅ 완료 |
| **M2** | BYOK 비전 티어(Claude/Gemini, 키는 사용자) | 대기 |
| **M3** | Drive OAuth 실연동(Picker·드라이브 정본·앱 열 때 스캔) | 대기 |
| **M4** | Notion 어댑터(무상태 Worker OAuth·템플릿·뷰) | 대기 |
| **M5** | 배포(Cloudflare Pages)·기본 OAuth 검증·문서·개인정보처리방침 | 대기 |

---

## 9. 결정 필요 · 오픈 이슈

1. **정본 파일 위치**: 앱 전용 폴더(자동·깔끔) vs 사용자 지정 폴더(가시적) — 권장: 선택 폴더 내 `running_records.json`.
2. **OCR 언어팩**: kor+eng 로딩 시간 최적화(캐시·경량화) 여부.
3. **BYOK 우선 제공 AI**: Claude(브라우저 직접 호출 지원) vs Gemini.
4. **브랜드·도메인**: 서비스명/도메인 확정.
5. **M2/M3 순서**: 정확도(BYOK) 먼저 vs 실연동(Drive) 먼저 — 권장: **M3(Drive) 먼저**로 "내 드라이브에서 바로" 경험 완성.

---

*자동발행 프로젝트 · Track A MVP 설계 v1 · 초안 앱 app.html 동반 · 스키마 v1.0*
