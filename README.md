# 미디어 리터러시 · 팩트체크 학습 플랫폼 (VAPM v5.0)

중·고등학생이 **스스로 팩트체크 체크리스트를 설계**하고, **그 체크리스트만을 근거로**
AI가 미디어 자료를 채점한 결과를 자기 판단과 견주어 검토하는 AI 활용 탐구형 학습 플랫폼입니다.

> **v5.0에서 바뀐 점 (전면 개편):** v4.0의 **교사 기준 보정을 완전히 제거**했습니다.
> 예전에는 교사 채점을 정답지로 삼아 그 차이(보정값)를 AI 점수에 더했는데, 그러면 학생이
> "AI 점수"라고 보는 값이 실은 교사 기준에 정박된 값이라 **AI의 판단을 자기 판단과 견주어
> 검토하는 수업 활동이 성립하지 않았습니다.**
>
> v5.0은 점수 산출 근거를 **학생이 만든 체크리스트 하나로 단일화**하고, 채점 단위도
> "5대 검증 행동"에서 **"체크리스트 항목 하나하나"** 로 바꿨습니다. 총점은 항목 점수의
> 단순 합계(원점수)이고, 등급은 백분율로 판정합니다. 교사는 이제 **자료를 등록하는 역할**만 합니다.
>
> 변경의 교육적 배경은 [ALGORITHM.md §2](./ALGORITHM.md#2-왜-교사-기준-보정을-없앴을까),
> 이전 버전(v4.0)의 작동 방식은 [ALGORITHM.md 부록 A](./ALGORITHM.md#부록-a-이전-버전-v40--교사-기준-보정-방식)에 보존되어 있습니다.

이 문서는 "이 프로그램이 점수를 **어떻게** 매기고, **왜** 그렇게 매기는지"를 비전공자도
이해할 수 있게 풀어서 설명하고, **다른 사람이 똑같이 만들어 쓸 수 있도록** Firebase 구축과
Google 로그인 설정까지 단계별로 안내합니다.

---

## 📚 목차

1. [한눈에 보기](#-한눈에-보기)
2. [기술 스택](#-기술-스택)
3. [5대 검증 행동(V1~V5)이란?](#-5대-검증-행동v1v5이란)
4. **[① 체크리스트가 점수의 유일한 근거가 되는 과정](#-1-체크리스트가-점수의-유일한-근거가-되는-과정)**
5. **[② AI 항목별 채점 — 요청·응답과 N/A 처리](#-2-ai-항목별-채점--요청응답과-na-처리)**
6. **[③ 점수 산출식 — 원점수·만점·백분율·등급·과락](#-3-점수-산출식--원점수만점백분율등급과락)**
7. **[④ 미디어 자료 — 등록 주체와 접근 격리](#-4-미디어-자료--등록-주체와-접근-격리)**
8. **[⑤ 직접 구축하기 — Firebase / Firestore / Storage](#-5-직접-구축하기--firebase--firestore--storage)**
9. **[⑥ Google 로그인(OAuth) 허용 과정](#-6-google-로그인oauth-허용-과정)**
10. [환경 변수 · 로컬 실행 · 배포](#-환경-변수--로컬-실행--배포)
11. **[수업 활동 — 4단계 순차 게이트](#-수업-활동--4단계-순차-게이트)**
12. [Firestore 데이터 구조](#-firestore-데이터-구조-vapm-50)
13. [v4.0 → v5.0 마이그레이션](#-v40--v50-마이그레이션)
14. **[v5.0 데이터 초기화 (관리자용)](#-v50-데이터-초기화-관리자용)**
15. [부록 — 레거시 매핑 / 프로젝트 구조](#-부록)

---

## 🔭 한눈에 보기

학생은 다음 흐름을 따라갑니다.

```
① 체크리스트 만들기          미디어를 의심할 질문 + 1~5점 루브릭을 직접 작성
        │                   (각 질문은 5대 검증 행동으로 자동 분류 — 표시용 라벨)
        ▼
② 미디어 자료 준비           선생님이 올린 공통 자료 / 우리 모둠 조장이 올린 자료
        │                   표제·부제·본문·이미지·작성일·언론사
        ▼
③ 팩트체크 실행              AI(Gemini)가 체크리스트 항목을 하나씩 적용해
        │                   항목마다 1~5점 + 근거. 단서 없는 항목은 N/A + 사유
        ▼
④ 결과 확인                  원점수 / 만점 / 백분율  예) "38점 / 50점 만점 (76%)"
                            + 백분율 기준 신뢰 등급 + 항목 과락 경고
                            + N/A 사유 + ★ AI가 확인하지 못한 것 고지
```

핵심 아이디어 한 줄: **"AI가 우리 체크리스트 항목을 하나씩 적용해 매긴 1~5점을 그대로
더한 것이 총점"** — 보정도 가중치도 없어 학생이 손으로 검산할 수 있습니다.

v4.0에 있던 **기준 다듬기(모델링)**, **수용/정교화**, **마스터리**, **피드백 카드**,
**교사 정답지 평가** 단계는 모두 제거되었습니다.

---

## 🧰 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Vite 5 + React 18 + React Router 6 (JSX, TypeScript 아님) |
| 스타일 | Tailwind CSS, Pretendard |
| 인증 | Firebase Authentication (Google OAuth) |
| 데이터베이스 | Cloud Firestore |
| 파일 저장 | Firebase Storage (썸네일·첨부 이미지) |
| AI | Google Gemini API — **반드시 Netlify Function 프록시 경유** |
| 호스팅 | Netlify (GitHub 연동 자동 배포) |

> ⚠️ Gemini 호출은 `netlify/functions/gemini.js` 서버 함수를 통해서만 이뤄집니다.
> 그래서 로컬에서 AI 기능까지 테스트하려면 `vite dev`가 아니라 **`netlify dev`(8888 포트)** 가 필요합니다.

---

## 🧩 5대 검증 행동(V1~V5)이란?

> ⚠️ **v5.0에서 5대 검증 행동은 점수 계산에서 빠졌습니다.** 지금은 ① 체크리스트 항목에
> 라벨을 달고 ② 지표별 평균을 표시하는 **분석·비교 용도**로만 쓰입니다. 점수는 체크리스트
> 항목 단위로만 계산됩니다.

학생이 미디어 자료를 만났을 때 실제로 수행해야 하는 5가지 행동입니다.
학생이 만든 자유로운 질문이 어느 행동에 해당하는지 자동 분류해, "우리 체크리스트가
어떤 검증 행동을 놓치고 있는지" 스스로 점검할 수 있게 합니다.

| 코드 | 검증 행동 | 무엇을 확인하나 |
|------|-----------|----------------|
| **V1** | 출처 확인 (Source Check) | 매체 도메인의 진위, 위장 사이트 여부, 운영 이력·평판 |
| **V2** | 저자 확인 (Author Check) | 작성자 이력·소속, 봇/자동화 계정 신호 |
| **V3** | 콘텐츠 교차 확인 (Content Cross-check) | 다른 신뢰 매체·공공기관 보도와 일치, 통계 원자료 추적 |
| **V4** | 이미지·영상 확인 (Visual Verification) | 사진·영상 재사용·딥페이크·AI 생성 신호, 역이미지 검색 |
| **V5** | 감정 반응 점검 (Emotional Reaction Check) | 자극적 어휘·클릭베이트·감정 유도 (메타인지) |
| (V6) | 사용자 정의 | 위 5가지 어디에도 안 맞는 항목의 임시 보관함 |

> 정의·프롬프트 원본: `src/utils/hpfm.js`의 `DIMENSION_INFO`, `netlify/functions/gemini.js`의 `VERIFICATION_GUIDE`.

---

## 🟦 ① 체크리스트가 점수의 유일한 근거가 되는 과정

v5.0에서 점수를 만드는 재료는 **딱 하나, 학생이 만든 체크리스트**입니다.
교사 채점도, 보정값도, 가중치도 개입하지 않습니다.

### 1단계 — 학생이 질문과 루브릭을 작성

`ChecklistEditor.jsx`에서 항목마다 **평가 질문**과 **1~5점 루브릭**(각 점수의 의미)을 씁니다.

```jsonc
{
  "question": "이 사이트 주소가 진짜 언론사 주소인가?",
  "rubric": {
    "1": "도메인이 알려진 매체를 흉내 낸 주소",
    "3": "처음 보는 매체지만 운영 정보는 있음",
    "5": "도메인·운영 주체·연락처가 모두 확인됨"
  }
}
```

루브릭은 **선택 입력**이지만, 채워 두면 프롬프트에 그대로 실려 AI가 그 서술을 기준으로
채점합니다. 즉 **루브릭이 구체적일수록 AI 채점이 학생 기준에 가까워집니다.**

### 2단계 — 질문을 5대 검증 행동으로 자동 분류 (표시용 라벨)

저장하는 순간 AI(Gemini `map` 모드)가 각 질문을 V1~V5 중 하나로 분류하고, 어디에도 맞지
않으면 V6로 둡니다. **이 분류는 점수 계산에 쓰이지 않습니다.** 하는 일은 두 가지뿐입니다.

1. 체크리스트/결과 화면에 "이 질문은 V3(콘텐츠 교차 확인)" 배지 표시
2. 결과·대시보드의 **지표별 평균** 산출 (`aggregateItemsToDimensions`)

분류 결과는 `mappingCache.js`가 질문 텍스트를 키로 캐시해, 같은 질문을 두 번 AI에 묻지
않습니다(무료 쿼터 보호). 질문을 고치면 그 항목만 다시 분류됩니다.

### 3단계 — 커버리지 점검

대시보드는 체크리스트 항목의 dimension 분포를 보고 **비어 있는 검증 행동**을 경고합니다.

> "이 체크리스트엔 V3(콘텐츠 교차 확인)를 묻는 항목이 없어요 — 그 영역은 **아예 채점되지 않습니다.**"

v4.0에서는 이런 경우 "AI 평가가 지배적으로 적용된다"고 안내했지만, v5.0에서는 체크리스트에
없는 것은 **그냥 채점되지 않습니다.** 표현이 정직해진 것이자, 학생이 자기 도구의 빈틈을
직접 메우도록 유도하는 장치입니다.

---

## 🟩 ② AI 항목별 채점 — 요청·응답과 N/A 처리

### 요청 — 미디어 1건 + 체크리스트 전체를 한 번에

팩트체크를 실행하면 미디어와 체크리스트 항목이 Netlify Function을 거쳐 Gemini의
`evaluate` 모드로 전달됩니다. **미디어당 호출은 1회**입니다(항목 수와 무관).

```jsonc
// POST /.netlify/functions/gemini
{
  "mode": "evaluate",
  "media": {
    "title": "...", "subtitle": "...", "content": "...",
    "publisher": "○○일보", "publishedAt": "2026-03-04",
    "link": "https://...", "imageUrl": "https://..."
  },
  "items": [
    { "question": "이 사이트 주소가 진짜 언론사 주소인가?", "rubric": { "1": "...", "5": "..." } },
    { "question": "사진이 다른 사건 거 아닌가?", "rubric": null }
  ]
}
```

### 응답 — 항목별 점수·근거, 또는 N/A와 그 사유

```jsonc
{ "items": [
    { "index": 0, "score": 4, "reason": "도메인과 운영 주체가 본문에 명시되어 있음", "redFlags": [] },
    { "index": 1, "score": null, "na": true,
      "reason": "이미지가 첨부되지 않았고 본문에도 사진 언급이 없어 판단할 단서가 없었어요." }
] }
```

**설계 의도:**
- **항목 전체를 한 번에** 묶어 호출 → 호출 횟수를 미디어당 1회로 고정, 무료 쿼터 보호.
- 모둠에서는 같은 **미디어 + 체크리스트 내용**을 **single-flight**(`factcheck_runs` 트랜잭션)로
  1명만 호출하고 결과를 공유 → N명이 같은 자료를 봐도 호출은 1회.
  (runKey에 **질문 텍스트 해시**가 포함되어, 체크리스트를 고치면 새 실행으로 인식됩니다.)
- `temperature: 0.2`, `responseMimeType: "application/json"`, flash 계열은 `thinkingBudget: 0` →
  결정적이고 일관된 JSON 확보.
- 실패 시 **지수 백오프 재시도**(최대 3회) → 일시적 429/503에 견딤.
- 코드: `buildEvaluatePrompt()`, `normalizeItemEvaluation()`, `callGemini()` in `netlify/functions/gemini.js`.

### N/A — 추측하지 않고 비워 둔다

자료 안에 판단 단서가 없는 항목은 점수를 **지어내지 않고** `score: null, na: true`로 두고,
**왜 판단할 수 없었는지**를 학생이 읽을 수 있게 남깁니다.

- AI가 응답에서 아예 빠뜨린 항목도 **평균값으로 채우지 않고** N/A 처리합니다.
  (v4.0에서는 누락 차원을 다른 차원의 평균으로 메웠는데, 근거 없는 점수를 만드는 셈이라 없앴습니다.)
- N/A 항목은 **원점수에서도 만점에서도 제외**됩니다 (③ 참고).
- 결과 화면은 N/A 항목마다 사유를 그대로 노출하고, "직접 조사해보라"고 안내합니다.
- 코드: `normalizeItemResults()` in `src/utils/hpfm.js`.

### ⚠️ AI의 인식 한계를 숨기지 않는다

AI는 **입력된 언론사·작성일·링크를 검증 없이 사실로 전제**하고 채점합니다. 웹 검색을 하지
않으므로 그 매체가 실재하는지, 날짜가 맞는지, 링크가 살아 있는지 확인할 수 없습니다.

프롬프트에도 이 제약을 명시해, AI가 "○○일보에 확인한 결과"처럼 **실제로 하지 않은 검증을
했다고 쓰지 않도록** 지시합니다. 그리고 결과 화면에는 다음 고지가 **항상** 표시됩니다.

> "AI는 입력된 출처 정보를 그대로 전제하고 판단했으며, 해당 매체가 실재하는지,
> 작성일이 정확한지는 확인하지 못했습니다."

**이건 버그가 아니라 수업에서 다루는 학습 내용입니다.** 숨기면 학생이 AI가 하지도 않은
검증을 했다고 착각하게 되고, 그건 이 수업이 막으려는 바로 그 습관입니다.
코드: `AiLimitNotice` in `src/pages/student/ResultPage.jsx`, `MediaForm.jsx`, `FactCheckPage.jsx`.

---

## 🟨 ③ 점수 산출식 — 원점수·만점·백분율·등급·과락

### 산출식 (전부입니다)

```
원점수  = Σ (각 항목의 점수)                    // N/A 항목은 더하지 않음
만점    = 채점된 항목 수 × 5                    // N/A 항목은 분모에서도 제외
백분율  = 원점수 ÷ 만점 × 100                   // 소수 1자리
```

평균도, 가중치도, 보정도 없습니다. 코드: `computeChecklistScore()` in `src/utils/hpfm.js`.

**왜 합계인가:**
1. **검산 가능성** — "왜 34점이죠?" → "4+3+5+2+... 다 더하면 34점." 학생이 손으로 확인할 수
   있습니다. 검산할 수 있어야 의심할 수도 있고, 그게 비판적 사고의 출발점입니다.
2. **도구와 결과의 직결** — 체크리스트가 허술하면 점수도 허술하게 나옵니다. 그 인과가 보여야
   학생이 자기 도구를 고칩니다. 중간에 보정이 끼면 이 인과가 흐려집니다.
3. **분석적 루브릭(analytic rubric)** — 항목별 독립 채점 후 합산은 교육평가의 표준 채점 방식입니다.

### N/A를 만점에서 빼는 이유

> 항목 10개 중 2개가 N/A → 만점은 50점이 아니라 **40점**

N/A를 만점에는 넣고 점수를 0으로 치면, "AI가 판단할 수 없었다"는 사실이 곧 **감점**이 됩니다.
그건 자료의 신뢰도 문제가 아니라 **AI의 능력 한계**이므로 자료에 책임을 지울 수 없습니다.

### ⚠️ 원점수는 모둠 간 비교에 쓸 수 없다

문항 수가 모둠마다 다르므로 만점도 다릅니다.

> 6문항 모둠 **28점** vs 12문항 모둠 **40점** → 원점수는 후자가 높지만 백분율은 **93% vs 67%**

앱은 원점수와 백분율을 항상 함께 표시하고, 팩트체크 화면·결과 화면 양쪽에 이 안내를 띄웁니다.

### 신뢰 등급 (band) — 백분율 기준

| 백분율 | 등급(key) | 의미 |
|---|---|---|
| **80% 이상** | `high` (신뢰 높음) | 체크리스트 기준을 대체로 충족 |
| **60 ~ 80%** | `caution` (주의) | 일부 항목 추가 확인 필요 |
| **40 ~ 60%** | `low` (신뢰 낮음) | 비판적 점검 강력 권장 (팩트체크 경고) |
| **40% 미만** | `veryLow` (매우 낮음) | 신뢰하기 어려움 |

> **왜 원점수가 아니라 백분율인가:** 만점이 모둠마다 다르므로 절대 점수 컷은 의미가 없습니다.
> 백분율은 문항 수와 무관하게 "기준을 얼마나 충족했는가"를 나타내는 **준거참조
> (criterion-referenced)** 지표입니다. (v4.0의 "40점 이상" 컷은 만점 50점 고정이라 성립했습니다.)

- 코드: `PERCENT_BANDS`, `percentBand()` in `src/utils/hpfm.js`.

### 항목 과락 (v4.0에서 계승)

**어떤 항목이 2점 미만**이면 총점과 무관하게 별도 경고(`itemAlert` + `alertIndexes`)를 띄웁니다.

> 예: 10개 항목 중 9개가 4점인데 "이 사이트 진짜야?"만 1점 → 총점 37/50 (74%, 주의)이지만
> **"이 항목이 심각하게 미흡" 경고**가 따로 표시됩니다.

합계는 개별 결함을 가립니다. 출처가 가짜면 나머지가 아무리 좋아도 그 자료는 신뢰할 수
없으므로, "총점 등급 + 개별 과락"의 이중 기준을 함께 봅니다.
- 코드: `ITEM_FLOOR` in `src/utils/hpfm.js`.

### 지표별 평균 (표시 전용)

항목 점수를 5대 검증 행동으로 묶어 평균낸 값을 결과 화면 사이드바와 대시보드에 표시합니다.
**총점 계산에는 전혀 관여하지 않습니다.** V6(사용자 정의) 항목과 N/A 항목은 이 평균에서
제외됩니다(`Number(null) === 0` 함정을 피하려 null 체크를 먼저 합니다).
- 코드: `aggregateItemsToDimensions()`, `averageDimensionMaps()` in `src/utils/hpfm.js`.

---

## 🟧 ④ 미디어 자료 — 등록 주체와 접근 격리

v5.0에서 자료 등록 주체가 둘로 늘고, 자료 스키마가 확장되었습니다.

### 스키마

| 필드 | 설명 |
|---|---|
| `title` | 표제 **(필수)** |
| `subtitle` | 부제 |
| `content` | 본문 **(필수)** |
| `imageUrl` | 이미지 (v4.0의 `thumbnailUrl`을 대체 — 읽을 때는 `mediaImageUrl()`이 둘 다 봄) |
| `publishedAt` | 작성일 `"YYYY-MM-DD"` 문자열 — **검증하지 않음** |
| `publisher` | 언론사 — **검증하지 않음** |
| `link` | 원본 링크 — **검증하지 않음** |
| `registeredBy` | `"teacher"` \| `"group"` |
| `groupId` | 모둠 등록 시 그 모둠 id (교사 자료는 `null`) |
| `isRequired` | 교사 등록 자료는 `true` (학급 공통 필수) |
| `uploadedBy` / `uploadedByName` | 등록자 uid / 표시 이름 |

> `publisher`·`publishedAt`·`link`를 검증하지 않는 것은 **의도된 설계**입니다. 등록 폼과 결과
> 화면 양쪽에서 "이 값은 검증되지 않으며 AI도 그대로 전제한다"고 명시합니다(②의 고지 참고).

### 등록 주체와 열람 범위

| 등록 주체 | 등록·수정·삭제 | 열람·평가 | 화면 |
|---|---|---|---|
| **교사** (`registeredBy: "teacher"`) | 교사만 | **전 학급** — 모든 모둠 | `/teacher/upload`, `/teacher/edit/:id` |
| **모둠** (`registeredBy: "group"`) | 그 모둠 **조장**만 (`groups/{gid}.leaderUid`) | **그 모둠만** | `/student/group-media` |

조장 판정은 화면에서도 하지만, **실제 경계는 `firestore.rules`** 입니다. 다른 모둠은 데이터
자체를 읽을 수 없습니다.

### ⚠️ 규칙은 쿼리 필터가 아니다 (중요한 구현 제약)

Firestore 보안 규칙은 결과를 걸러주지 않습니다. **목록 쿼리가 읽을 수 없는 문서를 하나라도
포함하면 쿼리 전체가 실패**합니다. 그래서 클라이언트는 반드시 좁혀서 조회합니다.

```js
listTeacherMediaItems()      // where("registeredBy", "==", "teacher")
listGroupMediaItems(groupId) // where("groupId", "==", groupId)   ← 모둠 작업실일 때만 호출
listMediaItemsByUploader(uid)// where("uploadedBy", "==", uid)    ← 교사 대시보드
```

`where` + `orderBy` 조합은 복합 인덱스를 요구해 배포 단계가 늘어나므로, **정렬은 클라이언트에서**
처리합니다(학급 단위라 문서 수가 적습니다). 코드: `src/services/firestore.js`.

### 이미지 저장 경로

교사·모둠 자료 모두 `media_thumbnails/{uid}/` 에 업로드합니다(`uploadMediaImage`).
Storage 규칙이 "본인 uid 경로에만 쓰기, 10MB 이하 이미지"라 조장이 올려도 그대로 통과하며,
**`storage.rules` 변경은 필요하지 않습니다.**


## 🟪 ⑤ 직접 구축하기 — Firebase / Firestore / Storage

이 프로그램을 복제해 운영하려면 **Firebase 프로젝트 1개**(Auth + Firestore + Storage)와
**Gemini API 키**, 그리고 배포용 **Netlify**가 필요합니다. 아래 순서대로 따라 하세요.

### 0단계 — 코드 받기

```bash
git clone <이 저장소 URL>
cd mediadatacheck
npm install
```

### 1단계 — Firebase 프로젝트 만들기

1. [Firebase 콘솔](https://console.firebase.google.com) → **프로젝트 추가**.
2. 프로젝트 생성 후 **웹 앱(`</>`) 추가** → 표시되는 `firebaseConfig` 6개 값을 메모해 둡니다
   (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).
   → 이 값들은 나중에 `.env`의 `VITE_FIREBASE_*`에 넣습니다.

### 2단계 — Authentication(로그인) 켜기

1. **빌드 → Authentication → 시작하기**.
2. **Sign-in method** 탭 → **Google** 사용 설정 → 지원 이메일 지정 → 저장.
   (상세 OAuth 설정은 [⑥장](#-6-google-로그인oauth-허용-과정) 참고.)
3. **Settings → 승인된 도메인**에 `localhost`, 배포 도메인(`<사이트>.netlify.app`),
   커스텀 도메인을 추가합니다. (여기 없는 도메인에서는 로그인 팝업이 차단됩니다.)

### 3단계 — Firestore 만들기

1. **빌드 → Firestore Database → 데이터베이스 만들기** → **Native 모드** → 리전 선택(예: `asia-northeast3` 서울).
2. 처음엔 "프로덕션 모드"로 시작해도 됩니다(규칙은 4단계에서 배포).

### 4단계 — Storage 만들기

1. **빌드 → Storage → 시작하기** → 위와 같은 리전.
2. 썸네일·팩트체크 첨부 이미지가 여기에 저장됩니다.

### 5단계 — 보안 규칙 배포 ⚠️ (가장 자주 빠뜨리는 단계)

이 저장소에는 `firestore.rules`와 `storage.rules` 파일이 들어 있지만, **파일만 있다고
규칙이 적용되지 않습니다. 반드시 Firebase에 배포해야** 실제 권한이 바뀝니다.

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # 위에서 만든 프로젝트 선택
firebase deploy --only firestore:rules,storage:rules
```

> 모둠 기능이나 권한 오류(`permission-denied`)가 나면 십중팔구 **규칙 미배포**가 원인입니다.

#### 적용되는 Firestore 규칙 (`firestore.rules` 전문)

핵심 원칙: **학생은 자기 데이터(`users/{본인uid}`)만**, **미디어 등록은 교사(공통 자료) 또는
모둠 조장(모둠 자료)만**, **모둠 데이터는 멤버만** 읽고 씁니다.

> ⚠️ 아래 규칙에서 `media_items`의 `read`는 **쿼리를 걸러주지 않습니다.** 모둠 자료가 섞인
> 전체 목록 쿼리는 통째로 실패하므로, 클라이언트는 반드시 `registeredBy` / `groupId`로 좁혀
> 조회해야 합니다 (④장 참고).

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // ====== 헬퍼 ======
    function isSignedIn() { return request.auth != null; }
    function isSelf(uid)  { return isSignedIn() && request.auth.uid == uid; }

    // users/{uid}.role 을 읽어 교사 여부 판단
    function isTeacher() {
      return isSignedIn()
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "teacher";
    }

    // 모둠 멤버십/조장 판정 (members 서브문서 존재로 멤버십 확인)
    function isGroupMember(groupId) {
      return isSignedIn()
        && exists(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid));
    }
    function isGroupLeader(groupId) {
      return isSignedIn()
        && exists(/databases/$(database)/documents/groups/$(groupId))
        && get(/databases/$(database)/documents/groups/$(groupId)).data.leaderUid == request.auth.uid;
    }

    // ====== config/teacher : 교사 인증 코드 게이트(프로젝트 단위 단일 문서) ======
    match /config/{docId} {
      allow read: if isSignedIn();                  // 코드 검증 위해 로그인 사용자 읽기
      allow create: if isSignedIn()                 // 첫 교사가 본인 uid로 1회 생성
                    && request.resource.data.setByUid == request.auth.uid;
      allow update: if isTeacher();                 // 변경은 인증된 교사만
      allow delete: if false;
    }

    // ====== users/{uid} : 본인 프로필 ======
    match /users/{uid} {
      allow read: if isSelf(uid);
      // 최초 생성: 본인 UID, role은 student/teacher 중 하나
      allow create: if isSelf(uid)
                    && request.resource.data.role in ["student", "teacher"];
      // 갱신: 본인만, role 변경 불가(최초 1회 확정)
      allow update: if isSelf(uid)
                    && request.resource.data.role == resource.data.role;
      allow delete: if false;

      match /checklists/{checklistId}        { allow read, write: if isSelf(uid); }
      match /factcheck_history/{historyId}   { allow read, write: if isSelf(uid); }
      // v5.0에서 algorithm_model / training_data / feedback_cards 규칙 제거(보정·마스터리 폐기)
    }

    // ====== media_items/{mediaId} : 미디어 자료 (교사 공통 / 모둠 전용) ======
    match /media_items/{mediaId} {
      function isGroupMedia() {
        return 'registeredBy' in resource.data && resource.data.registeredBy == "group";
      }

      // 교사·레거시 자료는 로그인 사용자 전체 / 모둠 자료는 그 모둠원(+교사)만
      allow read: if isSignedIn()
                  && ( !isGroupMedia()
                       || isGroupMember(resource.data.groupId)
                       || isTeacher() );

      // 교사 등록: 공통 필수 자료로만
      allow create: if isTeacher()
                    && request.resource.data.uploadedBy == request.auth.uid
                    && request.resource.data.registeredBy == "teacher"
                    && request.resource.data.isRequired == true;

      // 모둠 등록: 그 모둠 조장만, 자기 모둠 id로만
      allow create: if isSignedIn()
                    && request.resource.data.uploadedBy == request.auth.uid
                    && request.resource.data.registeredBy == "group"
                    && request.resource.data.groupId is string
                    && isGroupLeader(request.resource.data.groupId)
                    && request.resource.data.isRequired == false;

      // 수정: 등록 주체(registeredBy/groupId) 불변. 단 레거시 문서 백필은 교사에게 1회 허용
      allow update: if ( isTeacher() || (isGroupMedia() && isGroupLeader(resource.data.groupId)) )
                    && (
                         ( 'registeredBy' in resource.data
                           && request.resource.data.registeredBy == resource.data.registeredBy
                           && request.resource.data.groupId == resource.data.groupId )
                         || ( isTeacher()
                              && !('registeredBy' in resource.data)
                              && request.resource.data.registeredBy == "teacher" )
                       );

      allow delete: if isTeacher()
                    || (isGroupMedia() && isGroupLeader(resource.data.groupId));

      // v5.0에서 teacher_evaluation / student_evaluations 규칙 제거
      // (교사 채점이 학생 점수에 개입하는 경로를 없앴음)
    }

    // ====== groups/{groupId} : 모둠 협업 작업실 ======
    match /groups/{groupId} {
      allow read: if isSignedIn();                 // 공유코드 합류 전 조회
      allow create: if isSignedIn()
                    && request.resource.data.leaderUid == request.auth.uid;
      allow update: if isGroupMember(groupId)
                    && request.resource.data.leaderUid == resource.data.leaderUid;
      allow delete: if isGroupLeader(groupId);

      match /members/{memberUid} {
        allow read: if isSignedIn();
        allow create, update: if isSelf(memberUid);
        allow delete: if isSelf(memberUid) || isGroupLeader(groupId);
      }
      match /checklists/{checklistId}        { allow read, write: if isGroupMember(groupId); }
      match /factcheck_history/{historyId}   { allow read, write: if isGroupMember(groupId); }
      match /factcheck_runs/{runKey}         { allow read, write: if isGroupMember(groupId); }
      // v5.0에서 algorithm_model / feedback_cards 규칙 제거
    }

    // 그 외 모든 경로 차단
    match /{document=**} { allow read, write: if false; }
  }
}
```

#### 적용되는 Storage 규칙 (`storage.rules` 전문)

핵심 원칙: **읽기는 로그인 사용자 전체**(화면에 이미지를 보여줘야 하므로), **쓰기는 본인 UID 폴더에만,
10MB 이하 이미지**만 허용합니다.

```js
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {

    // 교사 미디어 썸네일
    match /media_thumbnails/{userId}/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.auth.uid == userId
                   && request.resource.size < 10 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
      allow delete: if request.auth != null && request.auth.uid == userId;
    }

    // 학생이 팩트체크에 첨부한 이미지(V4 시각 검증용)
    match /factcheck_images/{userId}/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.auth.uid == userId
                   && request.resource.size < 10 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
      allow delete: if request.auth != null && request.auth.uid == userId;
    }

    match /{allPaths=**} { allow read, write: if false; }
  }
}
```

### 6단계 — 첫 교사 계정 만들기 (인증 코드 설정)

`role`은 사용자가 **처음 로그인할 때의 선택(학생/교사)** 으로 1회 확정되고 이후 바뀌지 않습니다.
교사 인증 코드는 **빌드에 박힌 고정값이 아니라, 이 Firebase 프로젝트에서 첫 교사가 직접 정하는 값**입니다.

- 로그인 화면 **"교사로 시작"** → Google 로그인.
- 이 프로젝트에 아직 코드가 없으면(=첫 교사) → **"교사 인증 코드 설정"** 화면이 떠서 원하는
  코드를 정합니다. 이 코드는 `config/teacher` 문서에 **salt+해시**로 저장되고, 해당 계정은
  `role: "teacher"`로 생성됩니다.
- 같은 프로젝트에 **다른 교사**를 추가하려면, 그 교사가 자기 Google 계정으로 "교사로 시작"한 뒤
  **첫 교사가 정한 코드를 입력**해야 합니다(코드를 모르면 교사가 될 수 없음).
- 교사는 로그인 후 **교사 대시보드 → "인증 코드 변경"** 에서 현재 코드 확인 후 새 코드로 바꿀 수 있습니다.

> "교사당 Firebase 1개" 모델이라, 각 교사의 데이터는 **서로 다른 Firebase 프로젝트**에 있어 자연히 격리됩니다.
> 이미 학생으로 굳은 계정을 교사로 바꾸려면 규칙상 클라이언트에서 변경할 수 없으므로,
> Firebase 콘솔 Firestore에서 해당 `users/{uid}.role`을 직접 `teacher`로 수정하세요.
>
> ⚠️ 인증 코드는 학생의 우발적 교사 진입을 막는 **소프트 게이트**입니다(해시로 저장하지만
> 클라이언트에서 검증). 강한 보안 경계는 인증 코드가 아니라 **Firestore 규칙 + 프로젝트 분리**가 담당합니다.

### 7단계 — Gemini API 키 발급

[Google AI Studio](https://aistudio.google.com/app/apikey)에서 API 키를 발급해
`GEMINI_API_KEY`로 사용합니다(서버 전용, 절대 클라이언트에 노출 금지).
무료 한도가 부족하면 키가 속한 Google Cloud 프로젝트에 결제를 연결해 종량제로 전환할 수 있습니다.

---

## 🟫 ⑥ Google 로그인(OAuth) 허용 과정

Firebase에서 Google 로그인을 켜면 연결된 **Google Cloud 프로젝트에 OAuth 클라이언트가
자동 생성**됩니다. 로컬·운영 도메인에서 팝업/리다이렉트 로그인이 막히지 않도록 아래를 설정하세요.

### A. Firebase 쪽 (대부분 여기서 끝남)

1. **Authentication → Sign-in method → Google → 사용 설정.**
2. **프로젝트 지원 이메일(support email)** 선택 → 저장.
3. **Authentication → Settings → 승인된 도메인(Authorized domains)** 에 다음을 추가:
   - `localhost` (로컬 개발)
   - `<사이트이름>.netlify.app` (배포)
   - 커스텀 도메인(있다면)

대부분의 경우 위 3가지로 로그인이 작동합니다. 운영용으로 동의 화면을 다듬거나
"앱이 확인되지 않음" 경고를 없애려면 아래 Google Cloud 설정을 진행합니다.

### B. Google Cloud Console 쪽 (운영 다듬기)

같은 프로젝트의 [Google Cloud Console](https://console.cloud.google.com)에서:

1. **APIs & Services → OAuth 동의 화면(OAuth consent screen)**
   - User Type: **외부(External)** 선택.
   - 앱 이름, 사용자 지원 이메일, 개발자 연락처 이메일 입력.
   - 범위(Scopes): 기본 `openid`, `email`, `profile`이면 충분(이 앱은 추가 권한이 필요 없음).
   - 테스트 중에는 **테스트 사용자**에 로그인할 계정을 추가하거나, 일반 공개하려면
     **앱 게시(Publish app)** 로 프로덕션 전환.

2. **APIs & Services → 사용자 인증 정보(Credentials) → OAuth 2.0 클라이언트 ID**
   - Firebase가 자동 생성한 **"Web client (auto created by Google Service)"** 항목을 엽니다.
   - **승인된 JavaScript 원본(Authorized JavaScript origins)** 에 추가:
     - `http://localhost:8888` (netlify dev)
     - `http://localhost:5173` (vite dev, 로그인만 테스트할 때)
     - `https://<사이트이름>.netlify.app`
     - 커스텀 도메인(있다면)
   - **승인된 리디렉션 URI(Authorized redirect URIs)** 에 추가:
     - `https://<projectId>.firebaseapp.com/__/auth/handler`
     - (커스텀 authDomain을 쓴다면 `https://<authDomain>/__/auth/handler`)

> **왜 이렇게 나눠 넣나:** 이 앱은 팝업 로그인(`signInWithPopup`)을 기본으로 쓰고, 팝업이
> 차단된 환경에서만 리다이렉트로 폴백합니다(`src/services/auth.js`). **JavaScript 원본**은
> 팝업 방식에, **리디렉션 URI**(`/__/auth/handler`)는 리다이렉트 방식에 필요합니다.
> 둘 다 넣어 두면 어떤 환경에서도 로그인이 막히지 않습니다.

3. 설정 변경은 반영에 수 분이 걸릴 수 있습니다. `redirect_uri_mismatch`나
   `auth/unauthorized-domain` 오류가 나면 위 도메인/URI 목록을 다시 확인하세요.

---

## ⚙️ 환경 변수 · 로컬 실행 · 배포

### 환경 변수

`VITE_*` 접두어가 붙은 값만 클라이언트 번들에 포함됩니다.
**`GEMINI_API_KEY`는 절대 `VITE_`를 붙이지 마세요(서버 전용).**
`.env.example`은 git에 올라가는 템플릿이므로 **실제 키가 아니라 빈 자리(placeholder)만** 두고,
실제 값은 `.env.local`(로컬)과 Netlify 대시보드(운영)에만 넣습니다.

```bash
# .env.local (로컬 전용, git 미추적)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

GEMINI_API_KEY=          # 서버 전용! VITE_ 붙이지 말 것
GEMINI_MODEL=gemini-2.5-flash
```

> 교사 인증 코드는 더 이상 환경변수가 아닙니다. 첫 교사가 **Google 로그인 후 화면에서 직접
> 설정**하며, 값은 Firestore `config/teacher`에 salt+해시로 저장됩니다([6단계](#6단계--첫-교사-계정-만들기-인증-코드-설정) 참고).

### 로컬 실행

```bash
npm install -g netlify-cli
netlify dev            # http://localhost:8888  (Gemini Function 포함)
```

> `npm run dev`(= `vite`)만 띄우면 화면은 뜨지만 **AI 팩트체크는 동작하지 않습니다**
> (Netlify Function이 안 떠서). AI까지 테스트하려면 반드시 `netlify dev`를 쓰세요.

### 배포 (Netlify + GitHub)

1. 저장소를 GitHub에 푸시.
2. [Netlify](https://app.netlify.com) → **Add new site → Import from Git**.
3. 빌드 설정은 이미 `netlify.toml`에 정의됨 (Build: `npm run build`, Publish: `dist`,
   Functions: `netlify/functions`).
4. **Site settings → Environment variables** 에 위 `.env.local`의 키들을 모두 등록
   (`GEMINI_API_KEY` 포함).
5. Firebase Authentication **승인된 도메인** + Google Cloud **JavaScript 원본**에
   배포 도메인 추가([⑥장](#-6-google-로그인oauth-허용-과정)).
6. 이후 `git push` 하면 자동 배포됩니다.

---

## 🎒 수업 활동 — 4단계 순차 게이트

한 차시 수업을 그대로 담은 **모둠 작업실 전용** 흐름입니다. 앞 단계를 마쳐야 다음 단계가 열립니다.
(개인 작업실은 기존 자유 팩트체크를 그대로 씁니다 — 조장 등록·블라인드 채점·제출 현황판이 모두
모둠을 전제하기 때문입니다.)

```
① 지표 할당  →  ② 자료 등록  →  ③ 블라인드 채점  →  ④ AI 판정·비교
   /student/lesson/assign  /media  /blind  /reveal · /dashboard
```

### ① 지표 할당 — AI 제안을 기본값으로 두지 않는다

체크리스트 항목을 학생이 직접 V1~V5에 배정합니다.

- **AI 제안은 참고 표시일 뿐, 기본 선택으로 찍히지 않습니다.** 진입 시 기존 `dimension`(AI가
  채워둔 값)을 `aiSuggestedDimension`으로 옮기고 `dimension`은 비웁니다(`splitAiSuggestion`).
  이렇게 하지 않으면 학생이 그대로 넘겨버려 배정 활동 자체가 성립하지 않습니다.
  **Gemini 재호출은 없습니다** — 기존 분류를 재활용합니다.
- AI 제안과 다르게 고른 항목은 별도 표시되고 **"왜 다르게 판단했는가"** 서술이 필수입니다.
- **문항이 0개인 지표**는 곧바로 보충하지 못합니다. `STEP 1` 빠뜨린 이유를 기록·저장해야
  `STEP 2` 보충 문항 입력이 열립니다. 기록은 `groups/{gid}/reflections/{Vn}`에 저장되고
  **교사가 열람**합니다.
- **1문항 지표는 통과**시키되 "그 항목 하나가 지표 점수를 그대로 결정하므로 결과가 흔들리기
  쉽다"는 경고를 띄우고 2문항 이상을 권고합니다.
- **게이트:** 5개 지표 모두 1문항 이상 + 전 항목 배정 완료 + 불일치 사유 작성 완료

### ② 자료 등록 — 판단이 갈릴 자료를 고른다

- 교사 공통 필수 자료를 먼저 보여줍니다(읽기 전용). 교사가 아직 등록 전이면 게이트가 잠깁니다.
- **모둠 조장만** 자료 1건을 등록합니다. 모둠원은 열람만 가능합니다.
- 등록 화면에 선정 기준을 명시합니다 — *"가짜 같은 자료가 아니라, 모둠원끼리 판단이 갈릴 것
  같은 자료를 고르세요."*
- **게이트:** 교사 자료 1건 + 모둠 자료 1건, 그리고 **조장만** 다음 단계를 엽니다.

### ③ 블라인드 채점 — AI를 아예 호출하지 않는다

- 모둠원이 각자 **모둠 공통 체크리스트**로 두 자료를 항목별 채점합니다.
- **이 단계에서 AI는 호출되지 않습니다.** 미리 만들어 화면에서 가리는 방식이 아니라,
  학생 제출이 끝난 뒤에 비로소 호출하는 구조입니다(`runLessonAi`는 4단계에서만 실행).
- 제출하면 `locked: true`로 **잠기고 제출 시각이 서버 시간으로 기록**됩니다. 재제출은
  트랜잭션과 보안 규칙 양쪽에서 거부됩니다.
- 대기 화면에 정박 효과 설명을 한 문단 노출합니다.
- 3단계 진입 시 체크리스트를 `progress.checklistSnapshot`으로 **동결**합니다. 이후 항목을
  고쳐도 채점·통계 기준이 흔들리지 않습니다.
- 전원 제출 시 자동으로 4단계가 열립니다.

### ④ AI 판정·비교

**A. AI 판정 안내판** (`/student/lesson/reveal`) — 자료당 Gemini 1회 호출(single-flight),
모둠원이 각자 기기에서 실시간으로 함께 봅니다.

- 항목별 **AI 점수 · 판단 근거 문장 · N/A와 그 사유**를 모두 표시
- **출처 정보 고지**(§②)를 화면 상단에 상시 노출
- **내 점수 vs AI 점수**를 나란히, `|차이| ≥ 2`는 강조
- 차이 항목마다 원인 유형 4가지를 **우열 없이 대등하게** 배치하고 서술을 받습니다
  (`|차이| ≥ 2`는 필수, 1점은 선택)

| | 원인 유형 |
|---|---|
| ① | 자료 해석의 차이 |
| ② | 우리 체크리스트 문항이 모호함 |
| ③ | AI가 실제로 확인할 수 없는 항목 |
| ④ | 정답이 없는 가치 판단 영역 |

**B. 비교 대시보드** (`/student/lesson/dashboard`) — 지표별 통계는 **네 값을 함께** 봅니다.

| 지표 | 정의 | 역할 |
|---|---|---|
| **차이 절댓값 평균** | `mean(｜학생−AI｜)` | **기본 정렬 기준.** 작을수록 일치 |
| **부호 있는 평균** | `mean(학생−AI)` | 후하게/박하게 봤는지 (보조) |
| **중앙값** | `median(학생−AI)` | 평균과 벌어지면 "한 명이 유독 다르게 봄" |
| **모둠원 표준편차** | 항목별 학생 점수 표준편차의 평균 | AI와 무관하게 모둠원끼리 갈렸는지 |

> ⚠️ **부호 평균만 쓰면 안 되는 이유:** AI 3점에 모둠원이 5·5·1·1을 주면 부호 평균은 **0**이라
> "완전 일치"로 읽히지만, 절댓값 평균은 **2.0** — 한 명도 AI와 같지 않았습니다. `+2`와 `−2`가
> 서로 지운 것입니다. 이 경우 🔴 **상쇄 경고**가 뜹니다.

- **절사평균(trimmed mean)은 쓰지 않습니다.** 표본이 모둠원 3~5명이라 최대·최소를 자르면
  관측치 절반이 사라지고, 한 명이 크게 다르게 본 사실 자체가 가장 중요한 신호이기 때문입니다.
- **N/A 항목은 차이 통계에서 제외**합니다. 다만 모둠원 표준편차는 AI와 무관하므로 N/A 항목도
  포함해 계산합니다(AI가 전부 N/A를 낸 지표에서도 모둠원이 갈렸는지 보기 위해).
- **모둠 내 편차 뷰** — 같은 항목에 모둠원이 각각 몇 점을 줬는지 원자료 그대로 표시
- **원인 유형 지표별 분포** · **CSV 내보내기**(학생별·항목별 원점수 + 원인 유형 + 성찰 답변,
  한글 Excel용 UTF-8 BOM 포함)
- **미제출로 제외된 학생 수가 화면에 표시**됩니다.

**C. 성찰 답변** — 대시보드 하단 서술형 3문항. 2)·3)은 자기 모둠 수치를 최소 하나 인용하도록
안내하고, 숫자가 없으면 부드러운 경고만 띄웁니다(제출은 가능).

**D. 교사용 학급 집계** (`/teacher/class-stats`) — **교사 등록 공통 자료 한정**으로 지표별
절댓값 평균과 원인 유형 분포를 학급 전체로 모읍니다.

> ℹ️ 모둠마다 체크리스트가 다르므로 이 수치는 *"각 모둠이 **자기 도구로** 채점했을 때 AI와
> 얼마나 벌어졌는가"*를 지표 단위로 모은 값입니다. **모둠 간 우열 비교가 아니라 어떤 지표가
> 사람 판단을 요구하는가**를 읽는 자료입니다.

### 교사 화면 — 진행 현황판 (`/teacher/progress`)

모둠별 단계·제출 현황을 보고, 미제출자가 있어도 **[미제출자 제외하고 진행]**으로 다음 단계를
열 수 있습니다. 제외된 학생은 `progress.stage3.excludedUids`에 기록되어 이후 통계에서 빠지고,
**그 사실이 모둠 대시보드와 학급 집계에 표시**됩니다. 모둠 상세에서 지표 배정 결과 · AI 불일치
사유 · 빠뜨린 지표 성찰 · 성찰 답변 · 원인 유형 기록을 열람합니다.

### 순수 함수와 테스트

게이트 판정과 통계는 화면에서 분리해 순수 함수로 두고 단위 테스트로 고정했습니다.

| 모듈 | 내용 |
|---|---|
| `src/utils/lessonGates.js` | `splitAiSuggestion` · `assignGate` · `mediaGate` · `submissionStatus` |
| `src/utils/lessonStats.js` | `computeDimensionStats` · `buildScoreMatrix` · `aggregateCauseTags` · `computeClassStats` · `buildCsv` |

---

## 🗄️ Firestore 데이터 구조 (VAPM-5.0)

> 워크스페이스는 개인(`users/{uid}`)과 모둠(`groups/{groupId}`) 두 종류이며, 서브컬렉션
> 구조는 동일합니다. 모델 버전 상수(`version`, `standard_basis`)는
> **`src/constants/model.js` 단일 출처**에서 채워집니다
> (v5.0: `MODEL_VERSION = "VAPM-5.0"`, `STANDARD_BASIS = "student_checklist_items"`).

```
config/teacher                                              // 교사 인증 코드 게이트(프로젝트 단위)
  salt, codeHash, setByUid, setByEmail, createdAt, updatedAt // 평문 아님(salt+SHA-256)

users/{uid}
  role, email, displayName, photoURL, createdAt, lastLogin
  groups: { [groupId]: { role, groupName, joinedAt } }      // 소속 모둠
  checklists/{checklistId}                                  // ★ 점수의 유일한 근거
    checklistName,
    items[{ question, rubric{1..5},
            dimension(V1~V6), dimensionConfidence,          // 표시용 라벨(점수 계산에 미사용)
            dimensionMapKey }]                              // 매핑 캐시 키(질문 텍스트)
    lastEditedBy, lastEditedName, createdAt, updatedAt
  factcheck_history/{historyId}
    version("VAPM-5.0"), standard_basis,
    media{ title, subtitle, content, link, imageUrl,
           publisher, publishedAt, mediaItemId },           // publisher/publishedAt은 미검증 입력값
    checklistId, checklistName, checklistSnapshot[],        // 실행 시점 항목 스냅샷
    itemResults[{ index, question, dimension,
                  score(1~5 | null), na, reason, redFlags[] }],
    rawScore, maxScore, percent, band,                      // 원점수 / 만점 / 백분율 / 등급
    scoredCount, naCount, itemAlert, alertIndexes[],        // 채점 항목 수 / N/A 수 / 과락
    dimensionAverages{ V1..V5: number|null },               // 표시 전용(총점 무관)
    createdByUid, createdByName, createdAt

media_items/{mediaId}                                        // 교사 공통 자료 + 모둠 전용 자료
  title, subtitle, content, imageUrl, publishedAt, publisher, link,
  registeredBy("teacher"|"group"), groupId(모둠 등록 시), isRequired(교사=true),
  uploadedBy, uploadedByName, createdAt, updatedAt
  // v4.0의 thumbnailUrl은 남아 있어도 mediaImageUrl()이 imageUrl과 함께 읽는다

groups/{groupId}                                             // 모둠 협업 작업실
  groupName, leaderUid, leaderName, shareCode, checklistId, createdAt, updatedAt
  members/{uid} { name, email, role, joinedAt }
  checklists / factcheck_history                             // users와 동일 구조
  factcheck_runs/{runKey}                                    // single-flight 실행 조정
    status("running"|"done"), claimedByUid, claimedByName, startedAt, historyId

  // ===== 수업 활동(4단계 순차 게이트) — 모둠 작업실에만 존재 =====
  progress/current
    stage(1~4), checklistId, checklistSnapshot[],            // 3단계 진입 시 동결
    stage1{completedAt, completedBy}, stage2{...},
    stage3{includedUids[], excludedUids[], forcedBy, closedAt},
    stage4{aiHistoryIds:{[mediaId]:historyId}, aiRunAt}
  reflections/{V1..V5}                                       // ① 빠뜨린 지표 성찰(교사 열람)
    dimension, reason, writtenBy, writtenByName, updatedAt
  blind_scores/{uid}__{mediaId}                              // ③ 블라인드 점수(제출 시 잠금)
    uid, name, mediaId, checklistId, scores{itemIndex:1~5},
    submitted, locked, submittedAt
  cause_tags/{uid}__{mediaId}                                // ④ 원인 유형 + 서술
    uid, name, mediaId, items{ itemIndex:{type, note} }
  reflection_answers/{uid}                                   // ④ 성찰 3문항
    uid, name, answers{q1,q2,q3}, submittedAt

  // 체크리스트 항목은 ①단계에서 AI 제안과 학생 선택이 분리된다
  //   items[{ question, rubric,
  //           aiSuggestedDimension, aiConfidence, aiReason,   ← AI 제안(참고용)
  //           dimension,                                       ← 학생 최종 선택
  //           disagreeReason, assignedBy, addedInStage1 }]
```

### v5.0에서 사라진 것

| 삭제 | 이유 |
|---|---|
| `users|groups/*/algorithm_model/current` (+ `training_data`) | 보정값·마스터리·학습 데이터 폐기 |
| `users|groups/*/feedback_cards/current` | 교사 격차 기반 진단 카드 폐기 |
| `media_items/*/teacher_evaluation/default` | 교사 정답지 폐기 |
| `media_items/*/student_evaluations/{uid}` | 모델링(기준 다듬기) 폐기 |

기존 문서를 자동으로 지우지는 않지만, **코드에서 접근하지 않고 보안 규칙에서도 제거**되어
읽기·쓰기가 모두 거부됩니다. 정리하고 싶다면 Firebase 콘솔에서 수동 삭제하세요.

---

## 🔄 v4.0 → v5.0 마이그레이션

코드를 새 버전으로 배포한 뒤 해야 할 일은 **두 가지**입니다.

### 1. 보안 규칙 재배포 (필수)

`media_items` 규칙이 크게 바뀌었습니다. 배포하지 않으면 모둠 자료 등록이 `permission-denied`로 실패합니다.

```bash
firebase deploy --only firestore:rules
```

### 2. 교사 계정으로 대시보드 1회 방문 (필수)

v4.0 이전에 등록된 미디어 자료에는 `registeredBy` 필드가 없습니다. 학생 화면은
`where("registeredBy","==","teacher")`로 좁혀 조회하므로, **백필하지 않으면 기존 자료가
학생 목록에서 사라집니다.**

교사가 `/teacher`에 들어오면 `backfillLegacyMediaItems()`가 자동으로 실행되어
`registeredBy: "teacher"`, `isRequired: true`, `imageUrl`(옛 `thumbnailUrl`에서 승계)을 채웁니다.
- 이미 채워진 문서는 건드리지 않아 **재진입해도 쓰기가 발생하지 않습니다**(멱등).
- 보정된 건수는 대시보드 상단에 안내 배너로 표시됩니다.
- 코드: `backfillLegacyMediaItems()` in `src/services/firestore.js`.

> ⚠️ 여러 교사 계정이 각자 자료를 올렸다면, **각 교사가 한 번씩** 대시보드에 들어와야 합니다
> (백필 쿼리가 `uploadedBy == 본인 uid`로 좁혀져 있음).

### 기존 팩트체크 기록은?

`factcheck_history` 문서는 **그대로 보존**되며 읽기 전용으로 표시됩니다.
`itemResults` 필드가 없으면 v4.0 기록으로 판정해, 결과 화면이 "이전 버전(v4.0) 기록" 배너와
함께 당시 저장된 검증 행동별 점수·50점 총점을 그대로 보여줍니다. 다시 계산하지 않습니다.
- 코드: `LegacyResultView` in `src/pages/student/ResultPage.jsx`.

### 데이터 마이그레이션은 없습니다

v4.0 기록을 v5.0 형식으로 변환하는 스크립트는 **의도적으로 만들지 않았습니다.** 채점 단위가
"5대 검증 행동 5개"에서 "체크리스트 항목 N개"로 바뀌어 **1:1 대응이 존재하지 않기 때문**입니다.
같은 자료를 새 방식으로 보려면 팩트체크 화면의 '기존 자료 불러오기'로 다시 실행하세요.

옛 데이터를 남겨두지 않고 **깨끗이 초기화**하고 싶다면 아래 초기화 스크립트를 사용하세요.

---

## 🧹 v5.0 데이터 초기화 (관리자용)

계산 방식이 바뀌어 기존 평가 데이터가 더 이상 유효하지 않을 때,
**학생·모둠이 작성한 체크리스트만 보존하고** 나머지 평가 데이터를 지우는 스크립트입니다.

```
scripts/reset-v5.mjs
```

### 보존 / 삭제 범위

| | 경로 | 비고 |
|---|---|---|
| ✅ 보존 | `users/{uid}` · `groups/{gid}` | 계정·모둠 문서 자체 |
| ✅ 보존 | `users/{uid}/checklists` · `groups/{gid}/checklists` | 문항·루브릭·**지표 매핑 캐시** |
| ✅ 보존 | `groups/{gid}/members` | 모둠원 명단 |
| ✅ 보존 | `config/teacher` | 교사 인증 코드 |
| ❌ 삭제 | `media_items` | 하위 `teacher_evaluation`·`student_evaluations` 포함 |
| ❌ 삭제 | `users\|groups/{id}/factcheck_history` | 팩트체크 기록 |
| ❌ 삭제 | `users\|groups/{id}/algorithm_model` | 하위 `training_data` 포함 |
| ❌ 삭제 | `users\|groups/{id}/feedback_cards` | |
| ❌ 삭제 | `groups/{gid}/factcheck_runs` | single-flight 조정 문서 |
| ❌ 삭제 | Storage `media_thumbnails/` · `factcheck_images/` | |

> 💡 **"질문 → 지표 매핑 캐시"는 별도 컬렉션이 아닙니다.** `dimension`, `dimensionConfidence`,
> `dimensionReason`, `dimensionMapKey`가 **체크리스트 항목 안에** 저장되므로
> (`src/utils/mappingCache.js`), 체크리스트를 보존하면 매핑도 그대로 남습니다.
> 초기화 후에도 **재분류 Gemini 호출은 발생하지 않습니다.**

### 준비 — 서비스 계정 키

이 스크립트는 클라이언트 SDK가 아니라 **Firebase Admin SDK**로 동작하며, 보안 규칙을 우회하는
관리자 권한을 씁니다.

1. Firebase 콘솔 → **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성** → JSON 다운로드
2. 저장소 밖 안전한 위치에 두거나, 저장소 안에 둔다면 파일명을 `serviceAccount*.json` 형태로
   (`.gitignore`에 이미 등록되어 있습니다)

> 🔐 **서비스 계정 키는 프로젝트 전체를 삭제할 수 있는 권한입니다.** 절대 커밋하거나 공유하지 마세요.

### 1) 먼저 dry-run (기본값)

```bash
npm run reset:dry-run -- --key ./serviceAccount.json
# 또는
node scripts/reset-v5.mjs --key ./serviceAccount.json
```

보존 대상 요약 → 삭제 대상 경로별 건수 → 합계를 출력하고 **아무것도 지우지 않습니다.**

```
── 보존 (건드리지 않음) ─────────────────────────────────
   users 계정 문서                : 27개
   users/*/checklists             : 25개 (항목 183개)
   └ 지표 매핑이 붙은 항목        : 183개  ← 재분류 API 호출 불필요

── 삭제 대상 ────────────────────────────────────────────
   경로                                수  단위
   media_items                        14  문서
   users/aBc.../factcheck_history       6  문서
   ...
   media_thumbnails/                   12  파일 (8.4 MB)
```

### 2) 확인 후 실제 실행

```bash
node scripts/reset-v5.mjs --key ./serviceAccount.json --confirm --with-files
```

`--confirm`이 붙으면 **백업 → 삭제** 순서로 진행됩니다. 백업이 실패하면 삭제는 시작되지 않습니다.

```
backups/reset-v5-<타임스탬프>/
├─ manifest.json                     # 프로젝트·보존 현황·대상 요약
├─ firestore/
│  ├─ media_items.json               # 하위 서브컬렉션까지 트리로 포함
│  ├─ users__<uid>__factcheck_history.json
│  └─ ...
└─ storage/
   ├─ media_thumbnails.json          # 파일 목록·크기·타입
   └─ files/                         # --with-files 일 때만 원본 이미지
```

### 옵션

| 옵션 | 설명 |
|---|---|
| `--key <path>` | 서비스 계정 JSON (또는 `GOOGLE_APPLICATION_CREDENTIALS`) |
| `--bucket <name>` | Storage 버킷 (기본: `<projectId>.firebasestorage.app` 추정) |
| `--dry-run` | 건수만 출력 **(기본값)** |
| `--confirm` | 백업 후 실제 삭제 |
| `--out <dir>` | 백업 폴더 (기본 `./backups/reset-v5-<타임스탬프>`) |
| `--with-files` | Storage 이미지 원본까지 내려받아 백업 |
| `--skip-storage` | Firestore만 처리 |

### ⚠️ 주의사항

- **`--with-files` 없이 실행하면 이미지 원본은 복구할 수 없습니다.** 목록(JSON)만 남습니다.
  학생들이 올린 사진을 보관해야 한다면 반드시 붙이세요.
- **되돌리기(restore) 기능은 없습니다.** 백업 JSON은 사람이 읽고 필요한 부분을 수동 복원하는
  용도입니다. 실행 전에 Firebase 콘솔에서 별도 내보내기를 해두면 더 안전합니다.
- 백업 폴더에는 **학생 평가 데이터가 그대로** 들어갑니다. `.gitignore`에 `backups/`를 등록해
  두었지만, 외부 공유·클라우드 동기화 폴더에 두지 않도록 주의하세요.
- 스크립트는 `PROTECTED_COLLECTIONS`(`checklists`, `members`, `config`, `users`, `groups`)가
  삭제 목록에 섞이면 **실행을 중단**합니다. 대상을 늘리려면 `ROOT_COLLECTIONS` /
  `USER_SUBCOLLECTIONS` / `GROUP_SUBCOLLECTIONS` 상수만 수정하세요.
- Firestore 문서 삭제는 서브컬렉션을 지우지 않으므로 `recursiveDelete`를 사용합니다.
  `media_items/{id}`만 지우면 `teacher_evaluation`·`student_evaluations`가 고아로 남습니다.
- 실행 순서 권장: **초기화 → 보안 규칙 배포 → 교사 자료 재등록.**
  초기화로 `media_items`가 비므로 v4.0 레거시 백필(위 마이그레이션 절)은 불필요해집니다.

---

## 📎 부록

### 레거시 차원 → V1~V6 변환

이전 버전(HPFM v1.0의 D1~D8, IPFM v2.0의 C1~C6)으로 저장된 점수와 체크리스트 항목의 옛
dimension 코드는 다음 표로 V1~V6에 매핑되어 표시·집계됩니다
(`migrateLegacyDimensionScores`, `LEGACY_TO_NEW`). v5.0에서도 **v4.0 이전 기록의 읽기 전용
표시**와 **지표별 평균 산출**에 계속 쓰입니다.

| 레거시 | 새 검증 행동 |
|---|---|
| D1 출처 권위성 / C3 출처·작성자 투명성 | → **V1 + V2** (양쪽 평균) |
| D2 내용 정확성 / C4 방법·증거 / D4 근거 / D7 검증 가능성 / C2 자료 투명성 | → **V3** |
| D3 시의성 / C5 정정·시의성 | → **V1** |
| D5 편향성 / D6 언어 건전성 / C1 공정성·균형 | → **V5** |
| D8 / C6 (사용자 정의) | → **V6** |

> ⚠️ **개발자 주의:** `LEGACY_TO_NEW` 매핑 테이블은 클라이언트(`src/utils/hpfm.js`)와
> Netlify Function(`netlify/functions/gemini.js`)이 **분리 배포되어 import를 공유할 수 없어**
> 양쪽에 의도적으로 복제되어 있습니다. 매핑을 바꿀 때는 **두 파일을 함께** 수정하세요.
> (반면 모델 버전 상수 `MODEL_VERSION`/`STANDARD_BASIS`는 `src/constants/model.js` 한 곳으로 통합됨.)

### 프로젝트 구조

```
mediadatacheck/
├─ index.html
├─ netlify.toml
├─ firestore.rules                     # ⑤장에서 배포해야 적용됨 (v5.0에서 크게 변경)
├─ storage.rules                       # ⑤장에서 배포해야 적용됨 (v5.0에서 변경 없음)
├─ ALGORITHM.md                        # 학생용 알고리즘 안내서(v5.0 + 부록에 v4.0 보존)
├─ scripts/reset-v5.mjs                # 관리자용 평가 데이터 초기화(체크리스트 보존)
├─ netlify/functions/gemini.js         # Gemini 프록시 (map + evaluate=항목별 채점)
└─ src/
   ├─ main.jsx, App.jsx
   ├─ firebase.js                      # Firebase 초기화(Auth/Firestore/Storage)
   ├─ constants/
   │   ├─ model.js                     # ★ 모델 버전 상수 단일 출처
   │   └─ lesson.js                    # 수업 단계·원인 유형·성찰 문항 상수
   ├─ contexts/                        # AuthContext, WorkspaceContext(개인/모둠 전환)
   ├─ services/                        # auth, firestore, storage, gemini, groups,
   │                                   #   lesson(수업 데이터), lessonAi(4단계 AI 실행)
   ├─ utils/
   │   ├─ hpfm.js                      # VAPM 코어(항목 채점 집계·백분율·등급/과락·지표 평균·레거시 매핑)
   │   ├─ lessonGates.js               # ★ 순차 게이트 판정(순수 함수, 단위 테스트 대상)
   │   ├─ lessonStats.js               # ★ 비교 대시보드 통계(순수 함수, 단위 테스트 대상)
   │   ├─ mappingCache.js              # 검증 행동 매핑 캐시(표시용 라벨)
   │   ├─ dataCache.js                 # 세션 read-through 캐시(무료 쿼터 보호)
   │   └─ teacherCode.js               # 교사 인증 코드 salt+SHA-256 해싱(소프트 게이트)
   ├─ components/                      # Button, Layout, MediaForm, LessonShell, Mascot, Loading/*
   └─ pages/
       ├─ LoginPage.jsx, TeacherCodePage.jsx
       ├─ teacher/                     # Dashboard, MediaUpload, Progress(현황판), ClassStats(학급 집계)
       └─ student/                     # Dashboard, Checklist, GroupMediaUpload,
                                       #   FactCheck, Result, JoinGroup,
                                       #   Stage1Assign · Stage2Media · Stage3Blind
                                       #   · Stage4Reveal · Stage4Dashboard
```

> `src/utils/hpfm.js`는 v1(HPFM)→v2(IPFM)→v3(VAPM)→v4(보정)→v5(체크리스트 채점) 진화
> 호환을 위해 파일명만 유지하며, 내부 모델은 VAPM-5.0입니다.
>
> **v5.0에서 삭제된 파일:** `src/pages/student/ModelingPage.jsx`(기준 다듬기),
> `src/pages/teacher/TeacherEvaluation.jsx`(교사 정답지 평가).
> **추가된 파일:** `src/components/MediaForm.jsx`(등록 폼 공용화),
> `src/pages/student/GroupMediaUpload.jsx`(조장 전용 모둠 자료 등록).

---

## 🎓 교육적 의의

VAPM v5.0은 자동 채점기가 아니라, **학생이 스스로 만든 평가 도구가 실제로 작동하는 것을 보고,
AI의 판단을 자기 판단과 견주어 검토하게 하는 도구**입니다.

- **평가 도구를 만드는 것이 곧 학습** — 배워야 할 것은 "이 기사가 몇 점인가"가 아니라
  "미디어를 볼 때 무엇을 물어야 하는가"입니다. 체크리스트가 점수의 **유일한** 근거이므로,
  도구가 허술하면 결과도 허술하게 나오고 학생은 그걸 보고 도구를 고칩니다.
- **검산 가능한 투명성** — 총점은 항목 점수의 단순 합계입니다. 학생이 손으로 검산할 수 있고,
  검산할 수 있어야 의심할 수도 있습니다.
- **AI를 권위가 아니라 동료 평가자로** — 보정 없이 AI 판단을 그대로 보여줍니다. 동의가 안 되는
  점수는 오류가 아니라 **토론할 거리**이고, 그 토론이 이 수업의 핵심 활동입니다.
- **한계의 명시적 노출** — AI가 출처 정보를 검증하지 못한다는 사실과 N/A 항목의 사유를 항상
  화면에 남깁니다. 숨기면 학생이 AI가 하지도 않은 검증을 했다고 착각하게 됩니다.
- **정답지 없는 평가** — 미디어 평가에는 유일한 정답이 없습니다. 교사 채점을 정답지로 삼으면
  학생은 판단하는 법이 아니라 교사의 답을 맞히는 법을 배우게 되므로, 그 경로를 제거했습니다.
- **등급 + 과락 이중 기준** — 백분율 등급과 별개로 개별 항목이 2점 미만이면 경고해,
  합계가 결함을 가리지 않게 합니다. (v4.0에서 계승)

> 수업 활동 아이디어는 [ALGORITHM.md §12](./ALGORITHM.md#12-학습-활동-아이디어-선생님과-함께)를 참고하세요.
