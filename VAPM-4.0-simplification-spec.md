# VAPM 4.0 — 채점 알고리즘 간소화 구현 명세

> **대상 리포지터리:** `pcd0822/mediadatacheck` (main)
> **작업 성격:** `src/utils/hpfm.js`의 베이지안 가중치 체계를 "교사 기준 보정(calibration)" 체계로 교체
> **작업 원칙:** 이 문서에 없는 기능을 임의로 추가하지 말 것. 기존 UI 골격·라우팅·Firestore 보안 규칙은 건드리지 않음. README/ALGORITHM.md 갱신은 이번 작업 범위에서 제외(코드 완료 후 별도 작업).

---

## 0. 배경 — 왜 바꾸는가

현행 VAPM 3.0은 교사-학생 격차(Gap)를 신호로 항목 가중치 μ를 경사하강 방식으로 갱신하고(`bayesianUpdate`), 학습률 η(t) 지수감쇠, cold start 3단계, σ 감쇠, 신뢰구간, 수렴도, 마스터리가 서로 얽혀 있다. 산출 점수의 정량적 타당성을 교육적 언어로 설명하기 어렵다.

**새 설계의 논리(한 단락):** 학생이 만든 체크리스트에는 교사 기준 대비 체계적 편차가 존재한다. 모델링 단계에서 같은 미디어를 교사·학생이 각각 채점한 데이터로 **검증 행동별 평균 편차(보정값)**를 측정한다. AI는 학생의 체크리스트를 기준으로 채점하므로 그 편차를 승계한다고 가정하고, AI 점수에 보정값을 가감하여 교사 기준점에 정박(anchoring)된 최종 점수를 얻는다. 이는 교육측정에서 확립된 **채점자 보정(rater calibration / moderation)** 절차와 동일한 논리다.

---

## 1. 새 산출식 — 전체 3단계

### 1단계. 항목별 보정값 (모델링 데이터에서 산출)

모델링(`source === "modeling"`)으로 저장된 training_data 레코드 전체를 대상으로, 검증 행동 V_i마다:

```
rawCorrection_i = mean( teacherDimensionScores[V_i] − studentDimensionScores[V_i] )
                  (두 값이 모두 존재하는 레코드만 집계; 레코드별 gap 필드가 이미 저장되어 있으므로 gap[V_i]의 평균과 동일)

correction_i =
    0                                    if count_i < MIN_CALIBRATION_COUNT (3)
    clamp(rawCorrection_i, −1.0, +1.0)   otherwise
```

- **누적 방식이 아니라 전량 재계산.** 저장할 때마다 해당 워크스페이스의 modeling 레코드 전체에서 다시 계산한다(순서 무관·결정적, 멱등). 현행처럼 t번째 갱신 결과가 순서에 의존하는 구조를 만들지 말 것.
- 수용/정교화(`source === "accept" | "refine"`) 레코드는 **보정값 계산에서 제외**한다. 교사 기준점이 없는 데이터이기 때문. (이 레코드들은 피드백 카드·마스터리 용도로만 사용 — §4)

### 2단계. AI 점수 보정

AI(`gemini.js` evaluate 모드 — **변경 없음**)가 반환한 V1~V5 점수(1~5 정수, N/A는 null)에 대해:

```
corrected_i = clamp( aiScore_i + correction_i , 1 , 5 )     // aiScore_i가 null이면 corrected_i도 null
```

### 3단계. 50점 환산

```
finalScore = round( mean( corrected_i where corrected_i ≠ null ) × 10 , 소수 1자리 )   // 10~50점
```

- 가중치(μ) 없음. 단순 평균 × 10.
- V4가 N/A면 나머지 4개 평균 × 10 (현행 재정규화와 결과 동일, 설명은 한 줄).
- 유효 항목이 0개면 finalScore = 0 (현행 `computeFinalScore`의 방어 로직과 동일).

### 판정 등급 (신규)

```
finalScore ≥ 40        → "high"     신뢰 높음
30 ≤ finalScore < 40   → "caution"  주의 — 일부 항목 확인 필요
20 ≤ finalScore < 30   → "low"      신뢰 낮음 (팩트체크 경고)
finalScore < 20        → "veryLow"  매우 낮음
```

**과락 규칙:** 총점과 무관하게 `corrected_i < 2` 인 항목이 하나라도 있으면 `dimensionAlert: true` 플래그와 해당 항목 코드 목록을 함께 반환. UI에서 "총점과 별개로 V1(출처) 확인이 심각하게 미흡" 형태의 경고 배지 표시.

**근거(주석으로 코드에 남길 것):** 컷 30점 = 전 항목 평균 3점('보통'). 준거참조 기준이며, 과락은 평균이 개별 결함을 가리는 문제를 막기 위한 표준적 이중 기준.

---

## 2. 상수 정의

`src/utils/hpfm.js` 상단(또는 교체 모듈)에:

```js
export const MIN_CALIBRATION_COUNT = 3;   // 항목별 보정 적용에 필요한 최소 모델링 건수
export const MAX_CORRECTION = 1.0;        // 보정값 상·하한 (±1.0점)
export const SCORE_BANDS = [
  { key: "high",    min: 40, label: "신뢰 높음" },
  { key: "caution", min: 30, label: "주의" },
  { key: "low",     min: 20, label: "신뢰 낮음" },
  { key: "veryLow", min: 0,  label: "매우 낮음" },
];
export const DIMENSION_FLOOR = 2;         // 과락 기준
```

`src/constants/model.js`: `MODEL_VERSION`을 `"VAPM-4.0"`으로 올림. `STANDARD_BASIS`는 `"5_verification_actions"` 유지.

---

## 3. hpfm.js 함수별 처리 지시

### 유지 (변경 없음)
| 함수 | 비고 |
|---|---|
| `DIMENSIONS`, `FALLBACK_DIMENSION`, `DIMENSION_INFO`, `MEDIA_TYPE_PRESETS` | 그대로 |
| `aggregateToDimensions()` | 항목별 평균 집계 — 설계상 그대로 타당. 레거시 매핑 포함 유지 |
| `makeNullDimMap()`, `computeGap()` | 그대로 (Gap = 교사 − 학생, 부호 유지) |
| `isLegacyDimMap()`, `migrateLegacyDimensionScores()`, `LEGACY_TO_NEW` | 그대로 |
| `generateFeedbackCards(gapHistory)` | 가중치를 쓰지 않으므로 그대로 |
| `weightsToArray()` | 대시보드 표시용 → `correctionsToArray()`로 대체하되 시그니처 유사하게 |

### 제거
`initialWeights`, `learningRate`, `isColdStart`, `bayesianActive`, `bayesianUpdate`, `normalize`, `teacherImplicitWeights`, `convergenceScore`, `scoreVariance`, `confidenceInterval95`, 상수 `INITIAL_SIGMA` / `MIN_SIGMA` / `SIGMA_DECAY`.

### 신규
```js
/** modeling 레코드 배열(각각 gap: {V1..V5}) → { V1: {value, count}, ... } */
export function computeCorrections(modelingRecords)

/** AI 점수에 보정 적용: {V1..V5: number|null} → {V1..V5: number|null} */
export function applyCorrections(aiScores, corrections)

/** 보정된 점수 → { total, band, dimensionAlert, alertDimensions } */
export function computeFinalScore(correctedScores)   // 시그니처 변경: weights 인자 제거

export function scoreBand(total)                     // SCORE_BANDS 조회
```

### 수정
`computeMastery(weights, gapHistory)` → σ 항 제거, `computeMastery(gapHistory)`:

```
mastery_i = clamp( 1 − mean(|gap_i|) / 4 , 0 , 1 )    // 해당 항목 gap 데이터가 없으면 null
```

의미: "교사 기준과의 평균 격차가 작을수록 그 검증 행동에 숙련." 기존의 `(1−σ)` 곱은 제거.

---

## 4. 호출 지점별 변경 (파일 단위)

### `src/pages/student/ModelingPage.jsx`
- 현행: pairs를 순회하며 `bayesianUpdate` 반복 → weights 갱신, `teacherImplicitWeights` + `convergenceScore` 계산.
- 변경: 학생 채점 저장 후 **해당 워크스페이스의 modeling training_data 전체를 읽어 `computeCorrections()`로 재계산** → 모델 문서에 저장. 수렴도 계산·표시 제거.
- 화면의 "내 기준 자리잡힌 정도 ○○%" → "기준 보정 현황" 표(항목별 보정값·건수, 예: `V5 −0.6점 (4건 반영)`; 건수 미달 항목은 "3건 이상 모이면 보정 시작")로 교체.

### `src/pages/student/FactCheckPage.jsx`
- `initialWeights/isColdStart/scoreVariance/confidenceInterval95` 제거.
- 흐름: AI 점수 수신 → `applyCorrections(aiScores, model.corrections)` → `computeFinalScore(corrected)`.
- 신뢰구간 표시 제거 → 등급 배지 + (과락 시) 항목 경고로 대체.
- cold start 안내 문구 → "아직 기준 다듬기 데이터가 적어 보정 없이 AI 점수 그대로 계산했어요 (항목별 3건 이상 필요)" 취지로 교체. 판단 조건: 모든 `corrections[i].count < MIN_CALIBRATION_COUNT`.
- Firestore에 저장하는 결과 문서에서 `weightsSnapshot / variance / confidenceInterval95` 대신 `correctionsSnapshot / correctedDimensionScores / band / dimensionAlert / alertDimensions` 저장. **AI 원점수(`dimensionScores`)는 보정 전 값 그대로 유지 저장** (보정 전/후를 모두 남겨야 학생이 "내 기준이 점수를 어떻게 바꿨는지" 확인 가능 — 결과 화면에 보정 전→후를 함께 표시).

### `src/pages/student/ResultPage.jsx`
- 수용/정교화 저장 로직에서 `bayesianUpdate` 호출 제거. **수용/정교화는 보정값을 변경하지 않는다** — training_data에 `source: "accept"|"refine"`으로 기록만 하고, 피드백 카드·마스터리 재계산에만 사용.
- 정교화 시 `refineMultiplier` 개념 삭제.
- 점수 재계산이 필요하면 §1의 3단계 함수만 사용.

### `src/pages/student/StudentDashboard.jsx`
- `convergenceScore` 표시 제거. `computeMastery(gapHistory)` 새 시그니처 적용.
- "쌓인 평가 N개 / 기준 다듬는 중·기준 잡는 중" 배지: 기준을 `bayesianActive(t≥5)` 대신 "보정 적용 항목 수 ≥ 1"로 변경.
- 가중치 막대(있다면) → 항목별 보정값 표시로 교체.

### `src/services/firestore.js`, `src/services/groups.js`
- 모델 문서 필드 교체(§5). `convergenceScore / teacherImplicitWeights / learningRate / weights` 기본값 코드 제거, `corrections` 추가.

### `src/pages/teacher/TeacherEvaluation.jsx`
- `aggregateToDimensions`만 사용 → **변경 없음**.

### `netlify/functions/gemini.js`
- **변경 없음** (map/evaluate 프롬프트, single-flight, 재시도 로직 그대로).

---

## 5. Firestore 스키마 (algorithm_model/current)

```
// VAPM-4.0
{
  version: "VAPM-4.0",
  standard_basis: "5_verification_actions",
  corrections: {
    V1: { value: 0.0, count: 0 },   // value: 보정값(−1.0~+1.0, 미달 시 0), count: 반영된 modeling 건수
    ... V5
  },
  mastery: { V1..V5: number|null },
  checklistId, trainingDataCount,    // trainingDataCount는 유지(전체 누적 건수 표시용)
  trainedAt
}
// 제거: weights, learningRate, convergenceScore, teacherImplicitWeights
```

**마이그레이션(레이지):** 모델 문서 로드 시 `version !== "VAPM-4.0"`이면 → training_data 서브컬렉션에서 `source === "modeling"` 레코드를 읽어 `computeCorrections()` 실행 → 새 스키마로 문서 덮어쓰기(기존 `gap` 필드가 레코드마다 저장돼 있으므로 재계산 가능). training_data가 비어 있으면 corrections 전부 `{value: 0, count: 0}`. 별도 일괄 마이그레이션 스크립트는 만들지 않는다. 개인(`users/{uid}`)·모둠(`groups/{groupId}`) 두 워크스페이스 모두 동일 적용.

`factcheck_history` 기존 문서(3.0)는 읽기 전용 하위호환만 유지: `confidenceInterval95` 등 옛 필드가 있으면 무시하고 `totalScore`만 표시되도록 렌더링 분기.

---

## 6. 엣지 케이스 처리표

| 상황 | 처리 |
|---|---|
| 항목 V_i의 modeling 건수 < 3 | correction_i = 0 (AI 점수 그대로), count는 실제 값 저장 |
| 교사 또는 학생 쪽에 V_i 점수가 null인 레코드 | 해당 레코드는 V_i 집계에서 제외 (computeGap이 이미 이렇게 동작) |
| AI가 V4를 skipped(null) 반환 | corrected_V4 = null, 평균에서 제외 |
| 보정 후 1 미만 / 5 초과 | clamp(1, 5) |
| 유효 항목 0개 | finalScore 0, band "veryLow", UI에 "채점 불가" 안내 |
| 모둠 워크스페이스 | 개인과 동일 로직, 모둠의 training_data로 계산 (기존 single-flight 구조 유지) |
| 레거시 차원(D1~D8/C1~C6) 레코드 | `migrateLegacyDimensionScores`로 변환 후 집계 (현행 유지) |

---

## 7. 검증 케이스 (구현 후 반드시 수기 확인)

**케이스 A — 보정 산출.** modeling 레코드 4건, V5의 gap이 [−0.5, −1.0, −0.5, −0.4] (학생이 교사보다 후함) → rawCorrection = −0.6, count 4 ≥ 3 → `correction_V5 = −0.6`.
V2의 gap이 [+2.0, +1.8, +1.5] → raw +1.77 → clamp → `correction_V2 = +1.0`.
V4는 2건뿐 → `correction_V4 = 0 (count 2)`.

**케이스 B — 최종 점수.** AI: {V1:4, V2:2, V3:5, V4:null, V5:4}, corrections: {V1:0, V2:+1.0, V3:0, V4:0, V5:−0.6}
→ corrected {V1:4, V2:3, V3:5, V4:null, V5:3.4} → mean(4,3,5,3.4)=3.85 → **finalScore 38.5, band "caution", 과락 없음**.

**케이스 C — 과락.** AI: {V1:1, V2:4, V3:4, V4:4, V5:4}, 보정 전부 0 → corrected V1=1 (<2) → total 34.0, band "caution", **dimensionAlert true, alertDimensions ["V1"]**.

**케이스 D — 보정 미적용 초기 상태.** corrections 전 항목 count 0 → AI 점수 그대로 평균×10, FactCheckPage에 초기 안내 문구 노출.

**케이스 E — 멱등성.** 같은 modeling 레코드 집합으로 `computeCorrections`를 두 번 호출해도 결과 동일(순서 셔플해도 동일).

---

## 8. 하지 말 것

- 보정값을 수용/정교화 데이터로 갱신하지 말 것 (교사 기준점 없는 데이터).
- 보정값에 학습률·감쇠·단계 정책을 다시 도입하지 말 것 — "전량 평균 재계산 + 최소 건수 + 클램프"가 안정화 장치의 전부다.
- 곱셈(%) 보정으로 구현하지 말 것 (리커트 척도는 비율 연산 불가, 저점수에서 계수 폭발).
- 신뢰구간·분산·σ를 어떤 형태로도 남기지 말 것.
- gemini.js의 프롬프트·응답 스키마를 변경하지 말 것.
