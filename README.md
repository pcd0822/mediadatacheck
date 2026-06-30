# 미디어 리터러시 · 팩트체크 학습 플랫폼 (VAPM v3.0)

중·고등학생이 **스스로 팩트체크 체크리스트를 설계**하고, 그 기준으로 미디어 자료를
평가하면서 **자신만의 평가 기준(가중치)을 데이터로 다듬어 가는** AI 활용 탐구형 학습 플랫폼입니다.

이 문서는 "이 프로그램이 점수를 **어떻게** 매기고, **왜** 그렇게 매기는지"를 비전공자도
이해할 수 있게 풀어서 설명하고, **다른 사람이 똑같이 만들어 쓸 수 있도록** Firebase 구축과
Google 로그인 설정까지 단계별로 안내합니다.

---

## 📚 목차

1. [한눈에 보기](#-한눈에-보기)
2. [기술 스택](#-기술-스택)
3. [5대 검증 행동(V1~V5)이란?](#-5대-검증-행동v1v5이란)
4. **[① 학생 점수가 표준화되는 전체 과정](#-1-학생-점수가-표준화되는-전체-과정)**
5. **[② 교사 점수와 학생 점수의 차이가 평정에 주는 영향](#-2-교사-점수와-학생-점수의-차이가-평정에-주는-영향)**
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
        │                   → "어떤 검증 행동을 더 중요하게 볼지"(가중치)가 학습됨
        ▼
③ 팩트체크 실행              새 미디어를 AI(Gemini)가 V1~V5 각 1~5점으로 채점
        │
        ▼
④ 최종 점수 + 신뢰구간        내 가중치를 적용해 50점 만점으로 환산, 오차범위까지 표시
        │
        ▼
⑤ 수용 / 정교화              AI 결과에 동의(수용)하거나 내 점수로 수정(정교화)
        │                   → 그 판단이 다시 내 기준에 반영됨
        ▼
⑥ 마스터리 · 피드백 카드      검증 행동별 숙련도와 "내 평가 습관" 진단을 받음
```

핵심 아이디어 한 줄: **"AI가 매긴 1~5점"을 "내가 데이터로 다듬은 가중치"로 가중평균해서
50점짜리 신뢰도 점수로 바꾸고, 평가가 쌓일수록 가중치와 점수가 점점 안정된다.**

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
**서로 다른 학생·서로 다른 질문을 같은 잣대(V1~V5, 50점)로 비교할 수 있게 표준화**하는
4단계를 거칩니다.

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

### 3단계 — 내 "가중치"를 곱해 50점으로 환산

5개 점수를 단순 평균하지 않습니다. 학생마다 **"어떤 검증 행동을 더 중요하게 보는가"가 다르기**
때문입니다. 이 중요도가 **가중치(μ)** 이고, 5개를 더하면 1이 됩니다(처음엔 모두 0.20씩 균등).

```
최종 점수 = ( Σ (가중치μ_i × 점수_i) / Σ 사용된 가중치 ) × 10      → 10~50점
```

- ×10을 하는 이유: 1~5점의 가중평균(1~5)을 사람들이 익숙한 **50점 만점**으로 늘리기 위함.
- "사용된 가중치로 다시 나누는" 이유: 어떤 행동이 N/A(예: 이미지 없는 글의 V4)면
  그 행동을 빼고 **나머지 행동만으로 공정하게** 다시 정규화하기 위함.
- 코드: `computeFinalScore()`.

### 4단계 — 점수에 "신뢰구간"을 붙여 표준화 완성

같은 50점이라도 "확신에 찬 50점"과 "근거가 적어 흔들리는 50점"은 다릅니다.
그래서 각 가중치에 붙은 **불확실성(σ)** 으로 점수의 분산을 구하고, 95% 신뢰구간을 함께 보여줍니다.

```
점수 분산   = 100 × Σ (점수_i² × σ_i²)
95% 신뢰구간 = 최종점수 ± 1.96 × √분산        (0~50으로 잘라냄)
```
- 코드: `scoreVariance()`, `confidenceInterval95()`.

> **요약:** 자유 질문 → (1) V1~V5 분류 → (2) 행동별 평균 → (3) 내 가중치로 50점 환산 →
> (4) 신뢰구간 부여. 이 4단계가 "표준화"의 전부이며, 모든 학생·모든 미디어가 같은 형식의
> 점수로 비교 가능해집니다.

---

## 🟩 ② 교사 점수와 학생 점수의 차이가 평정에 주는 영향

이 프로그램의 가장 중요한 학습 장치입니다. **교사 점수는 "정답지(reference)"** 역할을 하고,
**학생 점수와의 차이(Gap)** 가 학생의 평가 기준을 교정합니다.

### 교사 점수는 어디서 오나

교사는 `/teacher/evaluate/:mediaId`에서 같은 미디어를 5대 검증 행동 기준으로 채점합니다.
저장 시 교사 항목도 V1~V5로 자동 분류·집계되어 **`teacherDimensionScores`** 가 됩니다.
(코드: `TeacherEvaluation.jsx` → `setTeacherEvaluation()`.)

### 핵심: Gap = 교사 점수 − 학생 점수

학생이 "기준 다듬기(모델링)"에서 선생님 미디어를 채점하면, 같은 미디어에 대한
교사 점수와 비교해 검증 행동별 격차를 계산합니다.

```
Gap_i = (교사의 V_i 점수) − (학생의 V_i 점수)
```
- 코드: `computeGap(studentDims, teacherDims)`.

이 Gap이 학생의 **가중치(μ)** 를 다음 식으로 밀어 줍니다.

```
새 가중치μ_i = 기존μ_i + ( η × Gap_i × 학생점수_i ) / Σ(학생점수_j²)
```
(η = 학습률, 자세한 건 ③·④에서.)

### 이게 "평정"에 주는 실제 효과 — 숫자 예시

선생님은 V3(콘텐츠 교차 확인)을 5점으로 높게 봤는데, 학생은 2점만 줬다고 합시다.
→ `Gap_V3 = 5 − 2 = +3` (양수). 학생이 V3을 과소평가했다는 신호입니다.

식에 따라 **V3의 가중치 μ가 올라갑니다.** 즉 "너는 콘텐츠 교차 확인을 더 중요하게
봐야 한다"는 교사의 관점이 학생의 기준에 스며듭니다.
이후 학생이 **새 미디어를 팩트체크할 때 V3의 비중이 커진 채로 50점이 계산**되므로,
교사-학생 격차가 다음 미디어의 평정 결과를 실제로 바꿔 놓습니다.

반대로 Gap이 작으면(교사와 학생이 비슷하게 봄) 가중치는 거의 그대로 유지됩니다.

### 얼마나 가까워졌나 — 수렴도(Convergence)

교사들의 평균 점수 비율로 "교사의 암묵적 가중치"를 추정하고, 학생 가중치와 얼마나
가까운지를 0~1로 나타냅니다.

```
교사 암묵 가중치 = 교사 점수들의 평균을 정규화한 비율   (teacherImplicitWeights)
수렴도 = 1 − ‖학생가중치 − 교사암묵가중치‖ / √5         (0~1, 1에 가까울수록 일치)
```
- 코드: `teacherImplicitWeights()`, `convergenceScore()`.
- 화면에는 "내 기준 자리잡힌 정도 ○○%"로 표시됩니다(`ModelingPage.jsx`).

### 보조 경로: 팩트체크에서의 "학생 vs AI" 차이

위는 **교사 vs 학생** 격차(모델링 단계)입니다. 한편 팩트체크 결과 화면에서
학생이 AI 점수를 손보면(정교화), 그때는 **학생 vs AI** 격차가 신호로 쓰입니다
(`Gap = 학생 수정점수 − AI점수`, ③ 참고). 둘 다 "내 판단과 기준점의 차이로 가중치를
교정한다"는 같은 원리입니다.

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

### 2) 1~5점을 50점으로 바꾸는 최종 산출식

```
최종 점수 S = ( Σ (μ_i × score_i) / Σ μ_active ) × 10
```
- `score_i` : AI가 준 V_i의 1~5점
- `μ_i` : 그 학생/모둠의 V_i 가중치 (Σμ = 1)
- `μ_active` : 실제로 점수가 있는 행동들의 가중치 합 (N/A 제외 후 재정규화)

**왜 단순 평균이 아니라 "가중평균 × 10"인가:**
1. **개인화** — 학생마다 중요하게 보는 검증 행동이 다르므로, 그 차이를 μ로 반영.
   (교사-학생 격차로 학습된 그 μ가 여기서 비로소 점수에 작동함 → ②와 연결.)
2. **익숙한 척도** — 1~5의 가중평균(1~5)을 ×10 해서 **누구나 직관적으로 읽는 50점**으로.
3. **공정성** — V4가 N/A여도 나머지 4개만으로 재정규화해 "이미지 없는 글이 불리해지는" 왜곡 제거.

### 3) 점수의 불확실성까지 함께 산출하는 이유

```
분산 Var(S)   = 100 × Σ (score_i² × σ_i²)
95% 신뢰구간   = S ± 1.96 × √Var(S)        (0~50으로 클램프)
```
거짓 정밀(false precision)을 피하기 위함입니다. "32.5점"이 아니라
"**32.5점 (95% 확률로 28.1~36.9)**"이라고 말해야, 아직 기준이 덜 다듬어진 초기에
점수를 과신하지 않도록 학생에게 정직하게 전달됩니다.

---

## 🟧 ④ 데이터가 쌓일수록 점수가 보정되는 원리

평가를 한 건 할 때마다 누적 카운트 `t`(`trainingDataCount`)가 1씩 늘고, 이 `t`에 따라
학습 강도와 점수의 안정성이 단계적으로 바뀝니다.

### 1) 학습률 η — "처음엔 크게, 나중엔 조심스럽게"

```
η(t) = max( 0.05 , 0.2 × exp(−0.05 × t) )
```
| 누적 t | η(대략) | 의미 |
|---|---|---|
| 0 | 0.20 | 초반엔 한 번의 평가가 가중치를 크게 움직임 |
| 10 | 0.12 | 점점 보수적으로 |
| 30 | 0.05(하한) | 거의 안정 — 새 데이터로도 살짝만 바뀜 |

→ 데이터가 쌓일수록 가중치가 **출렁이지 않고 수렴**합니다. (코드: `learningRate()`)

### 2) 단계별 정책 — Cold start / 워밍업 / 본격 학습

| 누적 t | 단계 | 동작 |
|---|---|---|
| `t < 3` | **Cold start** | 베이즈 갱신 끄고 **5개 균등 가중치(0.20)** 로만 계산 |
| `3 ≤ t < 5` | 워밍업 | 신중하게 갱신 시작 |
| `t ≥ 5` | **Bayesian 활성** | 본격적으로 σ가 줄고 가중치가 또렷해짐 |

- 코드: `isColdStart(t)` (`t<3`), `bayesianActive(t)` (`t≥5`).
- 데이터가 적을 땐 섣불리 기준을 만들지 않고 "모두 동일"하게 보다가, 충분히 쌓이면
  개인화된 기준으로 전환 → **표본이 적을 때의 과적합을 방지**.

### 3) 불확실성 σ — 쌓일수록 줄어드는 "오차범위"

평가 1건이 반영될 때마다 각 행동의 σ가 줄어듭니다.

```
σ_i ← max( 0.02 , σ_i × 0.95 )      (초기 0.15 → 하한 0.02)
```
σ가 줄면 ③의 분산이 줄고 **신뢰구간이 좁아집니다.** 즉 같은 미디어라도 학습이 진행될수록
"32.5점 ±9" → "32.5점 ±3"처럼 **점점 확신 있는 점수**로 보정됩니다. (코드: `bayesianUpdate()`)

### 4) 수용 / 정교화 — 학생의 한 번의 선택이 보정에 미치는 차이

팩트체크 결과 화면(`ResultPage.jsx`)에서 학생은 둘 중 하나를 누릅니다.

| 선택 | 학습 데이터 | 가중치 변화 |
|---|---|---|
| 🟢 **수용** | AI 점수 그대로 | Gap을 비워 전달 → **μ는 사실상 그대로, σ만 감소**(확신↑) |
| 🟡 **정교화** | 학생이 수정한 점수 | `학생−AI` Gap을 신호로, **학습률 η × 1.5** 로 가중치를 더 강하게 이동 |

- 코드: `persistTraining({refined})` → `bayesianUpdate(..., { refineMultiplier: 1.5 })`.
- "내가 AI와 다르게 본 지점"을 더 큰 신호로 받아들여, 학생의 비판적 판단이 기준에 빠르게 반영됩니다.

### 5) 누적의 또 다른 효과 — 마스터리와 피드백 카드

쌓인 Gap 기록 전체를 다시 훑어 두 가지를 갱신합니다.

```
마스터리(V_i) = (1 − σ_i) × (1 − |평균 Gap_i| / 4)     (0~1)
```
- σ가 작고(안정적) Gap이 작을수록(정확) 1에 가까워짐 → 학생 대시보드에서 약점 행동을 색으로 표시.
- **피드백 카드**: 누적 Gap의 평균/분산을 보고 "이 행동을 후하게/박하게/들쭉날쭉하게 준다"를
  자동 진단(평균|Gap|>0.5 → 편향, 분산>1.0 → 일관성 부족). 코드: `computeMastery()`, `generateFeedbackCards()`.

> **요약:** 데이터가 쌓이면 ① 학습률이 줄어 가중치가 수렴하고, ② 단계가 Cold start→본격
> 학습으로 넘어가며, ③ σ가 줄어 신뢰구간이 좁아지고, ④ 수용/정교화로 점수가 미세 조정되며,
> ⑤ 마스터리·피드백으로 학생의 평가 습관 자체가 교정됩니다.

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

### 6단계 — 첫 교사 계정 만들기

`role`은 사용자가 **처음 로그인할 때의 선택(학생/교사)** 으로 1회 확정되고 이후 바뀌지 않습니다.
교사로 시작하려면 로그인 화면에서 교사 경로(`/teacher-code`)로 진입해 인증 코드(기본 `0822`,
`VITE_TEACHER_AUTH_CODE`로 변경 가능)를 입력한 뒤 Google 로그인하면, 해당 계정의
`users/{uid}.role`이 `teacher`로 생성됩니다.

> 이미 학생으로 만들어진 계정을 교사로 바꾸려면 규칙상 클라이언트에서 변경할 수 없으므로,
> Firebase 콘솔의 Firestore에서 해당 `users/{uid}` 문서의 `role`을 직접 `teacher`로 수정하세요.

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
VITE_TEACHER_AUTH_CODE=0822

GEMINI_API_KEY=          # 서버 전용! VITE_ 붙이지 말 것
GEMINI_MODEL=gemini-2.5-flash
```

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

## 🗄️ Firestore 데이터 구조 (VAPM-3.0)

> 워크스페이스는 개인(`users/{uid}`)과 모둠(`groups/{groupId}`) 두 종류이며, 학습 관련
> 서브컬렉션 구조는 동일합니다. 모델 버전 상수(`version`, `standard_basis`)는
> **`src/constants/model.js` 단일 출처**에서 채워집니다.

```
users/{uid}
  role, email, displayName, photoURL, createdAt, lastLogin
  groups: { [groupId]: { role, groupName, joinedAt } }      // 소속 모둠
  checklists/{checklistId}
    checklistName, items[{ question, score|rubric,
                           dimension(V1~V6), dimensionConfidence }]
  algorithm_model/current
    version, standard_basis,
    weights: { V1:{mu,sigma}, ..., V5:{mu,sigma} },
    mastery: { V1..V5: 0~1 },
    checklistId, trainingDataCount, learningRate,
    convergenceScore, teacherImplicitWeights, trainedAt
    training_data/{dataId}                                   // 결정적 id로 upsert
      studentDimensionScores, teacherDimensionScores, gap,
      source: "modeling" | "accept" | "refine"
  feedback_cards/current
    cards[{ dimension, dimensionName, type, diagnosis, detail, suggestion, stats }]
  factcheck_history/{historyId}
    version, standard_basis,
    media{ title, content, link, imageUrl }, checklistId, checklistSnapshot,
    dimensionScores(V4=null이면 N/A), dimensionReasons, dimensionRedFlags, dimensionSkipped,
    weightsSnapshot, totalScore, variance, confidenceInterval95,
    accepted, refined, finalDimensionScores, finalTotalScore

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
   ├─ firebase.js                      # Firebase 초기화 + TEACHER_AUTH_CODE
   ├─ constants/
   │   └─ model.js                     # ★ 모델 버전 상수 단일 출처
   ├─ contexts/                        # AuthContext, WorkspaceContext(개인/모둠 전환)
   ├─ services/                        # auth, firestore, storage, gemini, groups
   ├─ utils/
   │   ├─ hpfm.js                      # VAPM 코어(분류·집계·베이지안·수렴도·마스터리·마이그레이션)
   │   ├─ mappingCache.js              # 검증 행동 매핑 캐시
   │   └─ dataCache.js                 # 세션 read-through 캐시(무료 쿼터 보호)
   ├─ components/                      # Button, Layout, Loading/*
   └─ pages/
       ├─ LoginPage.jsx, TeacherCodePage.jsx
       ├─ teacher/                     # Dashboard, MediaUpload, Evaluation
       └─ student/                     # Dashboard, Checklist, Modeling, FactCheck, Result, JoinGroup
```

> `src/utils/hpfm.js`는 v1(HPFM)→v2(IPFM)→v3(VAPM) 진화 호환을 위해 파일명만 유지하며,
> 내부 모델은 VAPM-3.0입니다.

---

## 🎓 교육적 의의

VAPM v3.0은 단순 자동 채점기가 아니라, **학생이 자신의 검증 습관을 숫자로 보고, 교사라는
기준점과의 격차로 그 습관을 스스로 교정하는 메타인지 도구**입니다.

- **5대 검증 행동** — 추상적 점수가 아닌, 학생이 실제로 수행하는 구체적 행동 단위.
- **격차 기반 학습** — "교사 vs 나", "AI vs 나"의 차이를 신호로 가중치를 교정.
- **베이지안 갱신** — 새 증거에 따라 신념(가중치)과 확신(σ)을 업데이트하는 비판적 사고의 수학적 형식화.
- **정직한 불확실성** — 점수에 신뢰구간을 붙여 초기 과신을 방지.
- **마스터리·피드백** — 약점 검증 행동을 집중적으로 보완하도록 유도.
