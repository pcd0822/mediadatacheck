/**
 * VAPM (Verification Action-based Progressive fact-check Model) v5.0
 *
 * 점수 산출의 근거를 **학생이 만든 체크리스트 하나**로 단일화한 모델.
 *
 *  1) AI(Gemini)가 미디어 자료를 읽고 그 모둠의 체크리스트 항목을 하나씩 적용해
 *     항목마다 1~5점과 판단 근거를 부여한다. 판단 단서가 없는 항목은 N/A(null) + 사유.
 *  2) 총점 = 유효 항목 점수의 단순 합계(원점수).
 *     만점 = 유효 항목 수 × 5, 백분율 = 원점수 / 만점.
 *  3) 신뢰 등급(band)은 원점수가 아니라 **백분율** 기준(80/60/40).
 *     개별 항목 과락(2점 미만)은 총점과 별개로 경고한다.
 *
 * v4.0의 교사 기준 보정(correction)·격차(gap)·마스터리·피드백 카드는 전부 제거했다.
 * 학생이 "AI 점수"라고 보는 값이 실제로는 교사 기준에 정박된 값이면, AI의 판단을
 * 자기 판단과 견주어 검토하는 수업 활동이 성립하지 않기 때문이다.
 * (변경 배경과 이전 버전 서술은 ALGORITHM.md 참고)
 *
 * 5대 검증 행동(V1~V5)은 점수 계산에서 빠지고, 항목이 어느 지표에 속하는지의 분류와
 * 지표별 평균 표시(분석·비교 용도)로만 남는다.
 *
 * 본 파일은 v1(HPFM) → v2(IPFM) → v3(VAPM) → v4(보정) → v5(체크리스트 채점) 진화 흐름의
 * 호환성을 위해 파일명을 hpfm.js로 유지하지만 모델은 VAPM-5.0이다.
 */

// 모델 버전 상수는 단일 출처(src/constants/model.js)에서 가져와 재노출한다.
export { MODEL_VERSION, STANDARD_BASIS } from "../constants/model.js";

export const DIMENSIONS = ["V1", "V2", "V3", "V4", "V5"];

/** 학생 체크리스트의 자유 입력 항목이 5대 검증 행동 어디에도 매핑되지 않을 때 사용. */
export const FALLBACK_DIMENSION = "V6";

export const DIMENSION_INFO = {
  V1: {
    code: "V1",
    name: "출처 확인",
    short: "Source Check",
    framework: "검증 행동 1 — 매체·사이트의 진위와 평판",
    description: "도메인 정확성, 매체 운영 이력, 위장 사이트 식별, HTTPS·디자인 품질",
  },
  V2: {
    code: "V2",
    name: "저자 확인",
    short: "Author Check",
    framework: "검증 행동 2 — 작성자 이력·봇 계정 식별",
    description: "작성자 이력·소속 검증, 이전 글의 일관성, 봇/자동화 계정 신호, 이해관계 공개",
  },
  V3: {
    code: "V3",
    name: "콘텐츠 교차 확인",
    short: "Content Cross-check",
    framework: "검증 행동 3 — 신뢰 매체·공공기관과의 비교",
    description: "주요 매체·공공기관·NGO 보도 일치, 통계 원자료 추적, 단일 출처 의존 점검",
  },
  V4: {
    code: "V4",
    name: "이미지·영상 확인",
    short: "Visual Verification",
    framework: "검증 행동 4 — 시각 자료의 출처와 조작 여부",
    description: "역이미지 검색, 메타데이터 점검, 딥페이크·AI 생성 신호, 시각 자료-본문 정합성",
  },
  V5: {
    code: "V5",
    name: "감정 반응 점검",
    short: "Emotional Reaction Check",
    framework: "검증 행동 5 — 감정 자극 의도 자기 인식",
    description: "자극적 어휘 빈도, 클릭베이트, 분노·공포·혐오 유발, 즉각 공유 충동 메타인지",
    metacognitive: true,
  },
};

/**
 * 미디어 유형별로 어떤 검증 행동을 더 촘촘히 물어볼지 참고하는 프리셋.
 * ⚠️ v5.0의 점수 계산에는 가중치를 전혀 쓰지 않는다. 체크리스트를 **설계할 때**
 *    "어디에 질문을 더 둘까"를 정하는 참고 자료로만 남겨둔 값이다.
 */
export const MEDIA_TYPE_PRESETS = {
  news: {
    label: "뉴스 기사",
    emphasis: { V1: 0.20, V2: 0.15, V3: 0.30, V4: 0.15, V5: 0.20 },
  },
  sns: {
    label: "SNS 게시물",
    emphasis: { V1: 0.15, V2: 0.30, V3: 0.15, V4: 0.20, V5: 0.20 },
  },
  video: {
    label: "영상 콘텐츠",
    emphasis: { V1: 0.15, V2: 0.20, V3: 0.20, V4: 0.30, V5: 0.15 },
  },
  ad: {
    label: "광고·홍보",
    emphasis: { V1: 0.20, V2: 0.15, V3: 0.20, V4: 0.15, V5: 0.30 },
  },
  gov: {
    label: "정부 공식 발표",
    emphasis: { V1: 0.30, V2: 0.25, V3: 0.25, V4: 0.10, V5: 0.10 },
  },
};

/** 체크리스트 항목 1개의 만점. */
export const MAX_ITEM_SCORE = 5;

/**
 * 항목 과락 기준. 이 값 미만인 항목이 하나라도 있으면 총점과 무관하게 경고한다.
 * 합계·평균이 개별 결함을 가리는 문제를 막기 위한 이중 기준(총점 + 개별 과락).
 */
export const ITEM_FLOOR = 2;

/**
 * 신뢰 등급 — **백분율(원점수 ÷ 만점)** 기준.
 *
 * 원점수는 체크리스트 문항 수에 따라 만점이 달라지므로 등급 기준이 될 수 없다.
 * (10문항 만점 50점 / 6문항 만점 30점) 그래서 v5.0의 등급은 백분율로 판정한다.
 * min 기준 내림차순 — percentBand()가 위에서부터 처음 매칭되는 등급을 반환한다.
 */
export const PERCENT_BANDS = [
  { key: "high",    min: 80, label: "신뢰 높음" },
  { key: "caution", min: 60, label: "주의" },
  { key: "low",     min: 40, label: "신뢰 낮음" },
  { key: "veryLow", min: 0,  label: "매우 낮음" },
];

/** 백분율(0~100) → 등급 key. */
export function percentBand(percent) {
  const p = Number(percent);
  const val = Number.isFinite(p) ? p : 0;
  for (const b of PERCENT_BANDS) {
    if (val >= b.min) return b.key;
  }
  return PERCENT_BANDS[PERCENT_BANDS.length - 1].key;
}

/**
 * AI 응답(항목별)을 체크리스트 항목과 짝지어 저장·표시용 구조로 정규화한다.
 *
 * AI가 항목 일부를 빠뜨려도 배열 길이는 항상 체크리스트 항목 수와 같다(누락 = N/A 처리).
 * 임의의 평균값으로 채워 넣지 않는다 — 근거 없는 점수를 만들지 않기 위함.
 *
 * @param {Array<{question:string, dimension?:string, rubric?:object}>} items 체크리스트 항목
 * @param {Array<{index:number, score:number|null, na?:boolean, reason?:string, redFlags?:string[]}>} aiResults
 * @returns {Array<{index:number, question:string, dimension:string|null, score:number|null,
 *                  na:boolean, reason:string, redFlags:string[]}>}
 */
export function normalizeItemResults(items = [], aiResults = []) {
  const byIndex = new Map();
  for (const r of Array.isArray(aiResults) ? aiResults : []) {
    const idx = Number(r?.index);
    if (Number.isInteger(idx)) byIndex.set(idx, r);
  }
  return items.map((it, i) => {
    const r = byIndex.get(i) ?? {};
    const rawScore = r.score;
    const isNa =
      r.na === true ||
      r.skipped === true ||
      rawScore === null ||
      rawScore === undefined ||
      rawScore === "null" ||
      !Number.isFinite(Number(rawScore));
    const score = isNa
      ? null
      : Math.max(1, Math.min(MAX_ITEM_SCORE, Math.round(Number(rawScore))));
    return {
      index: i,
      question: it?.question ?? "",
      dimension: it?.dimension ?? null,
      score,
      na: isNa,
      reason:
        typeof r.reason === "string" && r.reason.trim()
          ? r.reason.trim()
          : isNa
          ? "AI가 이 항목을 판단할 단서를 자료에서 찾지 못했어요."
          : "",
      redFlags: Array.isArray(r.redFlags)
        ? r.redFlags.filter((s) => typeof s === "string" && s.trim()).slice(0, 5)
        : [],
    };
  });
}

/**
 * 체크리스트 항목 점수 → 원점수·만점·백분율·등급·과락.
 *
 *   rawScore = Σ(유효 항목 점수)
 *   maxScore = 유효 항목 수 × 5          // N/A 항목은 분모에서도 빠진다
 *   percent  = rawScore / maxScore × 100
 *
 * N/A 항목을 만점에서 빼는 이유: 단서가 없는 항목까지 분모에 넣으면
 * "AI가 판단할 수 없었다"는 사실이 곧 감점이 되어버리기 때문이다.
 *
 * @param {Array<{score:number|null}>} itemResults
 * @returns {{rawScore:number, maxScore:number, percent:number, band:string,
 *            scoredCount:number, naCount:number, itemAlert:boolean, alertIndexes:number[]}}
 */
export function computeChecklistScore(itemResults = []) {
  const alertIndexes = [];
  let rawScore = 0;
  let scoredCount = 0;
  let naCount = 0;

  itemResults.forEach((r, i) => {
    const v = Number(r?.score);
    if (r?.score === null || r?.score === undefined || !Number.isFinite(v)) {
      naCount += 1;
      return;
    }
    const clamped = Math.max(1, Math.min(MAX_ITEM_SCORE, v));
    rawScore += clamped;
    scoredCount += 1;
    if (clamped < ITEM_FLOOR) alertIndexes.push(r?.index ?? i);
  });

  const maxScore = scoredCount * MAX_ITEM_SCORE;
  const percent = maxScore > 0 ? Math.round((rawScore / maxScore) * 1000) / 10 : 0;

  return {
    rawScore: Math.round(rawScore * 10) / 10,
    maxScore,
    percent,
    band: percentBand(percent),
    scoredCount,
    naCount,
    itemAlert: alertIndexes.length > 0,
    alertIndexes,
  };
}

/**
 * 항목 점수를 5대 검증 행동별 평균으로 집계한다. **점수 계산이 아니라 분석·비교 표시용.**
 * 레거시 차원 코드(D1~D8 / C1~C6)는 LEGACY_TO_NEW로 변환해 누적한다.
 *
 * @param {Array<{dimension?:string|null, score:number|null}>} itemResults
 * @returns {Record<string, number|null>} { V1: 3.5, V2: null, ... }
 */
export function aggregateItemsToDimensions(itemResults = []) {
  const sums = {};
  const counts = {};
  for (const r of itemResults) {
    // Number(null) === 0 이므로 null 체크를 먼저 해야 N/A가 0점으로 섞이지 않는다.
    if (r?.score === null || r?.score === undefined) continue;
    const v = Number(r.score);
    if (!Number.isFinite(v)) continue;
    const rawDim = r?.dimension;
    const targets = DIMENSIONS.includes(rawDim)
      ? [rawDim]
      : LEGACY_TO_NEW[rawDim] ?? null;
    if (!targets) continue; // V6(사용자 정의)·미분류는 지표 평균에서 제외
    for (const dim of targets) {
      if (!DIMENSIONS.includes(dim)) continue;
      sums[dim] = (sums[dim] ?? 0) + v;
      counts[dim] = (counts[dim] ?? 0) + 1;
    }
  }
  const out = makeNullDimMap();
  for (const d of DIMENSIONS) {
    out[d] = counts[d] ? Math.round((sums[d] / counts[d]) * 100) / 100 : null;
  }
  return out;
}

export function makeNullDimMap() {
  const m = {};
  for (const d of DIMENSIONS) m[d] = null;
  return m;
}

/** 여러 팩트체크 기록의 지표별 평균을 다시 평균낸다(대시보드 요약용). */
export function averageDimensionMaps(dimMaps = []) {
  const sums = {};
  const counts = {};
  for (const m of dimMaps) {
    for (const d of DIMENSIONS) {
      // Number(null) === 0 — "데이터 없음"을 0점으로 집계하지 않도록 먼저 걸러낸다.
      if (m?.[d] === null || m?.[d] === undefined) continue;
      const v = Number(m[d]);
      if (!Number.isFinite(v)) continue;
      sums[d] = (sums[d] ?? 0) + v;
      counts[d] = (counts[d] ?? 0) + 1;
    }
  }
  const out = makeNullDimMap();
  for (const d of DIMENSIONS) {
    out[d] = counts[d] ? Math.round((sums[d] / counts[d]) * 100) / 100 : null;
  }
  return out;
}

/** dimensionScores 객체에 v1 차원 키(D1~D8) 또는 v2 차원 키(C1~C6)가 있는지. */
export function isLegacyDimMap(dims) {
  if (!dims || typeof dims !== "object") return false;
  return Object.keys(dims).some((k) => /^D[1-8]$/.test(k) || /^C[1-6]$/.test(k));
}

/* ============================================================
 * 레거시 차원 → V1~V6 매핑
 *
 * v1 (HPFM, D1~D8) → v2 (IPFM, C1~C6) → v3~ (VAPM, V1~V6) 변환을 합친 직접 매핑 테이블.
 * 점수가 두 V에 매핑될 경우 각각에 누적되어 평균값으로 집계된다.
 *
 * v5.0에서도 유지하는 이유: 옛 체크리스트 항목의 dimension 코드와 v4.0 이전에 저장된
 * 팩트체크 기록(읽기 전용)을 지표별 평균으로 표시하려면 여전히 필요하다.
 * ============================================================ */
const LEGACY_TO_NEW = {
  // v1 (HPFM)
  D1: ["V1", "V2"],
  D2: ["V3"],
  D3: ["V1"],
  D4: ["V3"],
  D5: ["V5"],
  D6: ["V5"],
  D7: ["V3"],
  D8: ["V6"],
  // v2 (IPFM)
  C1: ["V5"],
  C2: ["V3"],
  C3: ["V1", "V2"],
  C4: ["V3"],
  C5: ["V1"],
  C6: ["V6"],
};

/**
 * 레거시 차원 점수(D1~D8 또는 C1~C6)를 검증 행동 점수(V1~V5)로 변환.
 * 다중 매핑(예: C3 → V1+V2)은 두 V 모두에 동일 점수가 누적되어 평균화된다.
 */
export function migrateLegacyDimensionScores(legacyDims) {
  if (!legacyDims) return makeNullDimMap();
  const sums = {};
  const counts = {};
  for (const [legacy, score] of Object.entries(legacyDims)) {
    const num = Number(score);
    if (!Number.isFinite(num)) continue;
    const targets = LEGACY_TO_NEW[legacy];
    if (!targets) continue;
    for (const t of targets) {
      if (!DIMENSIONS.includes(t)) continue;
      sums[t] = (sums[t] ?? 0) + num;
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  const out = makeNullDimMap();
  for (const d of DIMENSIONS) {
    out[d] = counts[d] ? sums[d] / counts[d] : null;
  }
  return out;
}
