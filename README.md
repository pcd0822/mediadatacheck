# 미디어 리터러시 · 팩트체크 학습 플랫폼 (VAPM v4.0)

중·고등학생이 **스스로 팩트체크 체크리스트를 설계**하고, 그 기준으로 미디어 자료를
평가하면서 **자신의 채점을 교사 기준에 데이터로 맞춰 가는(보정)** AI 활용 탐구형 학습 플랫폼입니다.

> **v4.0에서 바뀐 점:** v3.0의 베이지안 가중치(μ,σ)·학습률 감쇠·cold start·신뢰구간·수렴도를
> 모두 걷어내고, 교육측정에서 확립된 **채점자 보정(rater calibration / moderation)** 절차로
> 채점 알고리즘을 단순화했습니다. "같은 미디어를 교사와 학생이 채점한 평균 차이"를 검증 행동별
> **보정값**으로 만들어 AI 점수에 가감합니다. 산출 근거를 교육적 언어로 한 줄에 설명할 수 있습니다.

이 문서는 "이 프로그램이 점수를 **어떻게** 매기고, **왜** 그렇게 매기는지"를 비전공자도
이해할 수 있게 풀어서 설명하고, **다른 사람이 똑같이 만들어 쓸 수 있도록** Firebase 구축과
Google 로그인 설정까지 단계별로 안내합니다.

---

## 📚 목차

1. [한눈에 보기](#-한눈에-보기)
2. [기술 스택](#-기술-스택)
3. [5대 검증 행동(V1~V5)이란?](#-5대-검증-행동v1v5이란)
4. **[① 학생 점수가 표준화되는 전체 과정](#-1-학생-점수가-표준화되는-전체-과정)**
5. **[② 교사 점수와 학생 점수의 차이가 보정값이 되는 원리](#-2-교사-점수와-학생-점수의-차이가-보정값이-되는-원리)**
6. **[③ AI 기반 점수 산출식과 그렇게 계산하는 이유](#-3-ai-기반-점수-산출식과-그렇게-계산하는-이유)**
7. **[④ 데이터가 쌓일수록 점수가 보정되는 원리](#-4-데이터가-쌓일수록-점수가-보정되는-원리)**
8. **[⑤ 직접 구축하기 — Firebase / Firestore / Storage](#-5-직접-구축하기--firebase--firestore--storage)**
9. **[⑥ Google 로그인(OAuth) 허용 과정](#-6-google-로그인oauth-허용-과정)**
10. [환경 변수 · 로컬 실행 · 배포](#-환경-변수--로컬-실행--배포)
11. [Firestore 데이터 구조](#-firestore-데이터-구조-vapm-30)
12. [부록 — 레거시 매핑 / 프로젝트 구조](#-부록)

---

## 🔭 한눈에 보기

학생은 다음 흐름을 따라갑니다.

```
① 체크리스트 만들기          내가 미디어를 의심할 질문들을 직접 작성
        │                   (각 질문은 5대 검증 행동 V1~V5로 자동 분류됨)
        ▼
② 기준 다듬기(모델링)         선생님이 올린 미디어를 내가 채점 → 선생님 채점과 비교
        │                   → 검증 행동별 "평균 차이(보정값)"가 계산됨
        ▼
③ 팩트체크 실행              새 미디어를 AI(Gemini)가 V1~V5 각 1~5점으로 채점
        │
        ▼
④ 최종 점수 + 등급           AI 점수에 보정값을 더해 50점 만점으로 환산, 신뢰 등급·과락 경고 표시
        │
        ▼
⑤ 수용 / 정교화              AI 결과에 동의(수용)하거나 내 점수로 수정(정교화)
        │                   → 마스터리·평가 습관 분석에 반영됨 (보정값은 안 바뀜)
        ▼
⑥ 마스터리 · 피드백 카드      검증 행동별 숙련도와 "내 평가 습관" 진단을 받음
```

핵심 아이디어 한 줄: **"AI가 매긴 1~5점"에 "교사와 나의 평균 채점 차이(보정값)"를 더해
교사 기준에 정박된 50점짜리 신뢰도 점수로 바꾸고, 모델링이 쌓일수록 보정값이 정확해진다.**

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

이 프로그램의 모든 점수는 "5가지 검증 행동"이라는 공통 기준 위에서 계산됩니다.
추상적인 점수 한 개가 아니라, **학생이 실제로 해야 하는 5가지 행동**으로 미디어를 쪼개서 봅니다.

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

## 🟦 ① 학생 점수가 표준화되는 전체 과정

학생이 체크리스트에 매긴 점수는 그대로 쓰이지 않습니다.
**서로 다른 학생·서로 다른 질문을 같은 잣대(V1~V5)로 비교할 수 있게 표준화**하는
2단계를 거칩니다. (이렇게 표준화된 학생 점수는 ②에서 교사 점수와 비교되어 보정값을 만들고,
50점 환산은 ③의 팩트체크에서 이뤄집니다.)

### 1단계 — 자유로운 질문을 5대 검증 행동으로 "분류"

학생이 만든 체크리스트 질문은 제각각입니다.
예) "이 사이트 주소가 진짜 언론사 주소인가?", "사진이 다른 사건 거 아닌가?"

저장하는 순간, AI(Gemini의 `map` 모드)가 각 질문을 V1~V5 중 하나로 자동 분류합니다.
- "사이트 주소…" → **V1(출처)**
- "사진이 다른 사건…" → **V4(이미지)**

이렇게 해야 학생마다 질문 문장이 달라도 **같은 검증 행동끼리 묶어서** 비교할 수 있습니다.
(분류 결과는 `mappingCache.js`에 캐시해 같은 질문을 두 번 AI에 묻지 않습니다 — 무료 쿼터 보호.)

### 2단계 — 항목 점수를 검증 행동별 "평균"으로 집계

한 검증 행동에 질문이 여러 개 붙을 수 있습니다.
예) V1에 질문 2개(점수 4점, 2점)가 있으면 → V1 = (4+2)/2 = **3.0점**.

```
aggregateToDimensions(체크리스트 항목들, 점수들)
  → { V1: 3.0, V2: 5.0, V3: 4.0, V4: null, V5: 2.0 }   // 1~5점 척도
```
- 어떤 검증 행동에 해당하는 질문이 하나도 없으면 그 값은 `null`(해당 없음)이 됩니다.
- 코드: `src/utils/hpfm.js`의 `aggregateToDimensions()`.

이 단계의 결과를 **`studentDimensionScores`(학생의 검증 행동별 점수)** 라고 부릅니다.
모든 학생이 똑같은 5칸짜리 표로 환산되므로, 여기서부터는 누구든 직접 비교가 가능합니다.

> **요약:** 자유 질문 → (1) V1~V5 분류 → (2) 행동별 평균. 이 2단계가 학생 점수 "표준화"의
> 전부입니다. 이렇게 만든 `studentDimensionScores`가 ②에서 같은 미디어의 교사 점수와
> 비교되어 **보정값**을 만들고, 그 보정값이 ③의 팩트체크에서 50점으로 환산됩니다.
>
> _(v3.0에는 여기에 "가중치 곱 → 50점 환산"·"신뢰구간 부여" 2단계가 더 있었지만,
> v4.0에서는 가중치·신뢰구간을 없애고 그 자리를 교사 기준 보정으로 대체했습니다.)_

---

## 🟩 ② 교사 점수와 학생 점수의 차이가 보정값이 되는 원리

이 프로그램의 가장 중요한 학습 장치입니다. **교사 점수는 "기준점(reference)"** 역할을 하고,
**학생 점수와의 평균 차이(보정값)** 가 AI 점수를 교사 기준에 맞춰 줍니다.
이는 교육측정에서 확립된 **채점자 보정(rater calibration / moderation)** 절차와 같은 논리입니다.

### 교사 점수는 어디서 오나

교사는 `/teacher/evaluate/:mediaId`에서 같은 미디어를 5대 검증 행동 기준으로 채점합니다.
저장 시 교사 항목도 V1~V5로 자동 분류·집계되어 **`teacherDimensionScores`** 가 됩니다.
(코드: `TeacherEvaluation.jsx` → `setTeacherEvaluation()`.)

### 핵심: 보정값 = 교사·학생 점수 차이의 "평균"

학생이 "기준 다듬기(모델링)"에서 선생님 미디어를 채점하면, 같은 미디어에 대한
교사 점수와 비교해 검증 행동별 격차(gap)를 계산해 학습 데이터에 저장합니다.

```
gap_i = (교사의 V_i 점수) − (학생의 V_i 점수)          (코드: computeGap)
```

그리고 지금까지 저장된 **모든 모델링 레코드**를 대상으로, 검증 행동 V_i마다 gap의 평균을 내
그 항목의 **보정값(correction)** 으로 삼습니다.

```
correction_i = 0                                   (그 항목 모델링 건수 < 3)
             = clamp( mean(gap_i), −1.0, +1.0 )    (그 외)
```
- **누적이 아니라 전량 재계산**입니다. 저장할 때마다 그 워크스페이스의 modeling 레코드
  전체에서 다시 계산하므로 **순서와 무관하고 멱등**합니다(같은 데이터 → 항상 같은 결과).
- **최소 건수(3건)** 미달 항목은 보정하지 않습니다(0). 표본이 적을 때의 우연을 막는 안정장치.
- **±1.0점 클램프**: 리커트 척도에서 한 눈금 이상 통째로 밀지 않도록 제한.
- 수용/정교화(accept/refine) 레코드는 **교사 기준점이 없어 보정값 계산에서 제외**합니다.
- 코드: `computeCorrections()` in `src/utils/hpfm.js`.

### 이게 점수에 주는 실제 효과 — 숫자 예시

선생님은 V5(감정 반응 점검)를 낮게 봤는데(엄격), 학생은 매번 후하게 줬다고 합시다.
모델링 4건의 gap_V5가 `[−0.5, −1.0, −0.5, −0.4]`이면 → 평균 −0.6 → `correction_V5 = −0.6`.

이후 학생이 **새 미디어를 팩트체크할 때 AI가 V5에 4점을 주면, 보정값을 더해 4 + (−0.6) = 3.4점**
으로 낮춰 계산됩니다. "너는 감정 자극에 후한 편이니 그만큼 깎아 교사 기준에 맞춘다"는 뜻입니다.
반대로 학생이 교사와 비슷하게 봤다면 gap 평균이 0에 가까워 보정값도 0에 수렴합니다.

### 보조 경로: 팩트체크에서의 "학생 vs AI" 차이

위는 **교사 vs 학생** 차이(보정값을 만드는 모델링 단계)입니다. 한편 팩트체크 결과 화면에서
학생이 AI 점수를 손보면(정교화), 그때는 **학생 vs AI** 격차가 기록됩니다
(`gap = 학생 수정점수 − AI점수`). 단, 이 격차는 **보정값을 바꾸지 않고** 마스터리·평가 습관
분석에만 쓰입니다(교사 기준점이 없는 데이터이기 때문).

---

## 🟨 ③ AI 기반 점수 산출식과 그렇게 계산하는 이유

### 1) AI(Gemini)가 미디어를 1~5점으로 채점

팩트체크를 실행하면 미디어(제목·본문·링크·첨부 이미지)가 Netlify Function을 거쳐
Gemini의 `evaluate` 모드로 전달됩니다. AI는 **단 한 번의 호출로 V1~V5 다섯 개**를
각각 1~5 정수로 채점하고, 행동별 근거와 위험신호(redFlags)를 함께 돌려줍니다.

```jsonc
{ "verifications": {
    "V1": { "score": 4, "reason": "...", "redFlags": [] },
    "V2": { "score": 3, "reason": "..." },
    "V3": { "score": 5, "reason": "..." },
    "V4": { "score": null, "skipped": true, "reason": "본문에 시각 자료 없음" },
    "V5": { "score": 2, "reason": "..." }
} }
```

**왜 이렇게 호출하나 (설계 의도):**
- **5개를 한 번에** 묶어 호출 → AI 호출 횟수를 미디어당 1회로 묶어 **무료 쿼터를 보호**.
- 모둠에서는 같은 미디어를 **single-flight**(`factcheck_runs` 트랜잭션)로 1명만 호출하고
  결과를 공유 → N명이 같은 자료를 봐도 호출은 1회.
- `temperature: 0.2`, `responseMimeType: "application/json"`, flash 계열은 `thinkingBudget: 0` →
  **결정적이고 일관된 JSON**을 받기 위함(채점 작업엔 추론 토큰 이득이 적고 지연만 늘어남).
- 실패 시 **지수 백오프 재시도**(최대 3회) → 일시적 429/503에 견딤.
- 코드: `netlify/functions/gemini.js`의 `buildEvaluatePrompt()`, `callGemini()`.

> **V4(이미지)가 특별한 이유:** 본문에 사진·영상 언급이 전혀 없으면 V4는 `skipped`(N/A)
> 처리됩니다. 단, 학생이 실제 이미지를 첨부하면 AI가 그 이미지를 직접 분석해 반드시 점수를 줍니다.

### 2) 1~5점에 보정을 더해 50점으로 바꾸는 최종 산출식 (3단계)

```
1단계  corrected_i = clamp( aiScore_i + correction_i , 1 , 5 )     // aiScore_i가 null이면 null
2단계  finalScore  = round( mean( corrected_i where ≠ null ) × 10 , 소수 1자리 )   // 10~50점
```
- `aiScore_i` : AI가 준 V_i의 1~5점 (N/A는 null)
- `correction_i` : ②에서 만든 그 항목의 보정값(−1.0~+1.0, 미달 시 0)
- 가중치(μ) 없이 **단순 평균 × 10**. V4가 N/A면 나머지 4개 평균 × 10(자동 재정규화).
  유효 항목이 0개면 0점. 코드: `applyCorrections()`, `computeFinalScore()`.

**왜 가중평균이 아니라 "보정 후 단순 평균 × 10"인가:**
1. **교사 기준 정박** — AI는 학생 체크리스트로 채점하므로 학생의 체계적 편차를 승계합니다.
   그 편차(보정값)를 더해 **교사 기준점에 맞춘** 점수를 얻습니다(rater calibration).
2. **설명 가능성** — "AI 점수 + 교사와의 평균 차이"는 비전공자도 한 줄로 이해할 수 있습니다.
3. **덧셈 보정(곱셈 아님)** — 리커트 척도는 비율 연산이 불가하고 저점수에서 계수가 폭발하므로,
   ±점수의 가감으로만 보정합니다.

### 3) 등급과 과락 — 점수를 어떻게 읽나

총점을 4개 신뢰 등급(band)으로 나누고, 총점과 별개로 **개별 항목 과락**을 함께 경고합니다.

| 최종 점수 | 등급(key) | 의미 |
|---|---|---|
| 40 이상 | `high` (신뢰 높음) | 신뢰도가 높은 미디어 |
| 30 ~ 40 | `caution` (주의) | 일부 항목 확인 필요 |
| 20 ~ 30 | `low` (신뢰 낮음) | 팩트체크 경고 |
| 20 미만 | `veryLow` (매우 낮음) | 신뢰하기 어려움 |

- **컷 30점**의 근거: 전 항목 평균 3점('보통')에 해당하는 준거참조(criterion-referenced) 기준.
- **과락 규칙:** 보정 후 어떤 항목이 **2점 미만**이면 총점과 무관하게 `dimensionAlert`를 띄우고
  해당 항목 코드를 함께 보여줍니다. 평균이 개별 결함(예: 출처가 심각히 부실)을 가리는 문제를
  막기 위한 표준적 이중 기준입니다.
- 코드: `SCORE_BANDS`, `scoreBand()`, `DIMENSION_FLOOR` in `src/utils/hpfm.js`.

> v4.0에는 v3.0의 95% 신뢰구간(±오차범위)이 없습니다. 불확실성 표시는 σ에 의존했는데,
> σ 자체를 걷어냈기 때문입니다. 대신 "보정 데이터가 아직 적다"는 사실을 결과 화면에 명시적으로
> 안내합니다(항목별 3건 미만이면 보정 없이 AI 점수 그대로 계산).

---

## 🟧 ④ 데이터가 쌓일수록 점수가 보정되는 원리

v4.0의 안정화 장치는 **"전량 평균 재계산 + 최소 건수 + 클램프"** 이 셋이 전부입니다.
학습률·감쇠·단계 정책·σ는 없습니다.

### 1) 보정값은 매번 전량 재계산된다 (누적 갱신이 아님)

모델링을 저장할 때마다 그 워크스페이스의 **modeling 레코드 전체**에서 항목별 gap 평균을
다시 구합니다. t번째 갱신 결과가 순서에 의존하던 v3.0과 달리, **순서 무관·멱등**입니다.

```
correction_i = clamp( mean( 모든 modeling gap_i ) , −1.0 , +1.0 )   (건수 ≥ 3)
             = 0                                                     (건수 < 3)
```
→ 모델링이 쌓일수록 평균이 안정되어 보정값이 **참 편차에 수렴**합니다. 한 번의 우연한
채점이 전체를 흔들지 않습니다. (코드: `computeCorrections()`)

### 2) 최소 건수 3건 — 표본이 적을 때의 과적합 방지

항목별 모델링 건수가 3건 미만이면 그 항목은 보정하지 않고(0) AI 점수를 그대로 씁니다.
**모든 항목이 3건 미만이면** 팩트체크 결과 화면에 "아직 기준 다듬기 데이터가 적어 보정 없이
AI 점수를 그대로 계산했어요(항목별 3건 이상 필요)"라고 명시합니다.
(코드: `countAppliedCorrections()`, `MIN_CALIBRATION_COUNT`.)

### 3) 수용 / 정교화 — 보정값은 바꾸지 않는다

팩트체크 결과 화면(`ResultPage.jsx`)에서 학생은 둘 중 하나를 누릅니다.
**둘 다 보정값을 바꾸지 않습니다**(교사 기준점이 없는 데이터이기 때문). training_data에
기록만 남기고, **마스터리·피드백 카드 재계산에만** 사용합니다.

| 선택 | 학습 데이터 | 효과 |
|---|---|---|
| 🟢 **수용** | AI 점수 그대로 (`source: "accept"`) | 격차 ≈ 0으로 기록 → 마스터리·습관 분석 갱신 |
| 🟡 **정교화** | 학생이 수정한 점수 (`source: "refine"`) | `학생−AI` 격차를 기록 → 습관 분석에 반영 (η×1.5 같은 가속 없음) |

- 보정값을 바꾸려면 **"기준 다듬기"에서 선생님 미디어를 채점**해야 합니다(교사 기준점 확보).

### 4) 누적의 효과 — 마스터리와 피드백 카드

쌓인 격차(gap) 기록 전체를 다시 훑어 두 가지를 갱신합니다.

```
마스터리(V_i) = clamp( 1 − mean(|gap_i|) / 4 , 0 , 1 )     (해당 항목 gap이 없으면 '데이터 없음')
```
- 교사 기준과의 평균 격차가 작을수록 1에 가까워짐 → 학생 대시보드에서 약점 행동을 색으로 표시.
- **피드백 카드**: 누적 gap의 평균/분산을 보고 "이 행동을 후하게/박하게/들쭉날쭉하게 준다"를
  자동 진단(평균|gap|>0.5 → 편향, 분산>1.0 → 일관성 부족). 코드: `computeMastery()`, `generateFeedbackCards()`.

> **요약:** 모델링이 쌓이면 ① 항목별 gap 평균(보정값)이 참값에 수렴하고, ② 3건을 넘긴
> 항목부터 보정이 켜지며, ③ 수용/정교화는 보정값을 건드리지 않고 습관 분석만 갱신하고,
> ④ 마스터리·피드백으로 학생의 평가 습관 자체가 교정됩니다.

---

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

핵심 원칙: **학생은 자기 데이터(`users/{본인uid}`)만**, **교사 역할(`role=="teacher"`)만 미디어 등록/평가**,
**모둠 데이터는 멤버만** 읽고 씁니다.

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
      match /algorithm_model/{docId} {
        allow read, write: if isSelf(uid);
        match /training_data/{dataId}        { allow read, write: if isSelf(uid); }
      }
      match /feedback_cards/{cardId}         { allow read, write: if isSelf(uid); }
      match /factcheck_history/{historyId}   { allow read, write: if isSelf(uid); }
    }

    // ====== media_items/{mediaId} : 교사가 등록한 미디어 ======
    match /media_items/{mediaId} {
      allow read: if isSignedIn();                 // 학생도 목록/본문 열람
      allow create: if isTeacher()
                    && request.resource.data.uploadedBy == request.auth.uid;
      allow update, delete: if isTeacher();

      match /teacher_evaluation/{docId} {
        allow read:  if isSignedIn();              // 학생 모델링이 읽어야 함
        allow write: if isTeacher();
      }
      match /student_evaluations/{evalUid} {
        allow read, write: if isSelf(evalUid);     // 미디어×학생 본인 1건
      }
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
      match /algorithm_model/{docId} {
        allow read, write: if isGroupMember(groupId);
        match /training_data/{dataId}        { allow read, write: if isGroupMember(groupId); }
      }
      match /feedback_cards/{cardId}         { allow read, write: if isGroupMember(groupId); }
      match /factcheck_history/{historyId}   { allow read, write: if isGroupMember(groupId); }
      match /factcheck_runs/{runKey}         { allow read, write: if isGroupMember(groupId); }
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

## 🗄️ Firestore 데이터 구조 (VAPM-4.0)

> 워크스페이스는 개인(`users/{uid}`)과 모둠(`groups/{groupId}`) 두 종류이며, 학습 관련
> 서브컬렉션 구조는 동일합니다. 모델 버전 상수(`version`, `standard_basis`)는
> **`src/constants/model.js` 단일 출처**에서 채워집니다.

```
config/teacher                                              // 교사 인증 코드 게이트(프로젝트 단위)
  salt, codeHash, setByUid, setByEmail, createdAt, updatedAt // 평문 아님(salt+SHA-256)

users/{uid}
  role, email, displayName, photoURL, createdAt, lastLogin
  groups: { [groupId]: { role, groupName, joinedAt } }      // 소속 모둠
  checklists/{checklistId}
    checklistName, items[{ question, score|rubric,
                           dimension(V1~V6), dimensionConfidence }]
  algorithm_model/current
    version, standard_basis,
    corrections: { V1:{value,count}, ..., V5:{value,count} },  // value: 보정값(−1.0~+1.0), count: 반영 modeling 건수
    mastery: { V1..V5: 0~1 | null },
    checklistId, trainingDataCount, trainedAt
    training_data/{dataId}                                   // 결정적 id로 upsert
      studentDimensionScores, teacherDimensionScores, gap,
      source: "modeling" | "accept" | "refine"              // 보정값은 modeling만 사용
  feedback_cards/current
    cards[{ dimension, dimensionName, type, diagnosis, detail, suggestion, stats }]
  factcheck_history/{historyId}
    version, standard_basis,
    media{ title, content, link, imageUrl }, checklistId, checklistSnapshot,
    dimensionScores(V4=null이면 N/A; AI 원점수, 보정 전), dimensionReasons, dimensionRedFlags, dimensionSkipped,
    correctionsSnapshot, correctedDimensionScores, totalScore, band, dimensionAlert, alertDimensions,
    accepted, refined, finalDimensionScores, finalTotalScore
    // ⚠️ 3.0 문서(weightsSnapshot/variance/confidenceInterval95)는 읽기 전용 하위호환:
    //    옛 필드는 무시하고 totalScore만 표시한다.

media_items/{mediaId}                                        // 교사가 등록(전역)
  title, content, link, thumbnailUrl, uploadedBy, createdAt
  teacher_evaluation/default                                 // 학생 학습의 "정답지"
    items[{ question, score, dimension, verification_action? }], totalScore, dimensionScores
  student_evaluations/{uid}
    items[], checklistId, dimensionScores, updatedAt

groups/{groupId}                                             // 모둠 협업 작업실
  groupName, leaderUid, leaderName, shareCode, checklistId, createdAt, updatedAt
  members/{uid} { name, email, role, joinedAt }
  checklists / algorithm_model / feedback_cards / factcheck_history   // users와 동일 구조
  factcheck_runs/{runKey}                                    // single-flight 실행 조정
    status("running"|"done"), claimedByUid, claimedByName, startedAt, historyId
```

> **3.0 → 4.0 레이지 마이그레이션:** 모델 문서를 로드할 때 `version`이 `VAPM-4.0`이 아니거나
> `corrections`가 없으면, `training_data`의 `source == "modeling"` 레코드(각 레코드에 저장된 `gap`)로
> `computeCorrections()`를 실행해 새 스키마로 문서를 덮어씁니다(개인·모둠 동일). 별도 일괄
> 마이그레이션 스크립트는 없습니다. 코드: `getAlgorithmModel()` in `src/services/firestore.js`.

---

## 📎 부록

### 레거시 차원 → V1~V6 변환

이전 버전(HPFM v1.0의 D1~D8, IPFM v2.0의 C1~C6)으로 저장된 점수는 다음 표로 V1~V6에
매핑되어 자동 표시·집계됩니다 (`migrateLegacyDimensionScores`, `LEGACY_TO_NEW`).

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
├─ firestore.rules                     # ⑤장에서 배포해야 적용됨
├─ storage.rules                       # ⑤장에서 배포해야 적용됨
├─ netlify/functions/gemini.js         # Gemini 프록시 (map + evaluate)
└─ src/
   ├─ main.jsx, App.jsx
   ├─ firebase.js                      # Firebase 초기화(Auth/Firestore/Storage)
   ├─ constants/
   │   └─ model.js                     # ★ 모델 버전 상수 단일 출처
   ├─ contexts/                        # AuthContext, WorkspaceContext(개인/모둠 전환)
   ├─ services/                        # auth, firestore, storage, gemini, groups
   ├─ utils/
   │   ├─ hpfm.js                      # VAPM 코어(집계·보정값 산출·50점 환산·등급/과락·마스터리·마이그레이션)
   │   ├─ mappingCache.js              # 검증 행동 매핑 캐시
   │   ├─ dataCache.js                 # 세션 read-through 캐시(무료 쿼터 보호)
   │   └─ teacherCode.js               # 교사 인증 코드 salt+SHA-256 해싱(소프트 게이트)
   ├─ components/                      # Button, Layout, Loading/*
   └─ pages/
       ├─ LoginPage.jsx, TeacherCodePage.jsx
       ├─ teacher/                     # Dashboard, MediaUpload, Evaluation
       └─ student/                     # Dashboard, Checklist, Modeling, FactCheck, Result, JoinGroup
```

> `src/utils/hpfm.js`는 v1(HPFM)→v2(IPFM)→v3(VAPM)→v4(VAPM 보정) 진화 호환을 위해 파일명만
> 유지하며, 내부 모델은 VAPM-4.0입니다.

---

## 🎓 교육적 의의

VAPM v4.0은 단순 자동 채점기가 아니라, **학생이 자신의 검증 습관을 숫자로 보고, 교사라는
기준점과의 평균 차이로 그 습관을 스스로 교정하는 메타인지 도구**입니다.

- **5대 검증 행동** — 추상적 점수가 아닌, 학생이 실제로 수행하는 구체적 행동 단위.
- **채점자 보정(calibration)** — "교사 vs 나"의 평균 채점 차이를 보정값으로 삼아 AI 점수를 교사 기준에 정박.
- **설명 가능성** — "AI 점수 + 교사와의 평균 차이"라는 한 줄 논리. 교육측정의 moderation 절차와 동일.
- **등급 + 과락 이중 기준** — 총점 등급과 별개로 개별 항목이 심각히 미흡하면 경고해 평균이 결함을 가리지 않게.
- **마스터리·피드백** — 약점 검증 행동을 집중적으로 보완하도록 유도.
