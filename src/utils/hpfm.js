/**
 * IPFM (IFCN-aligned Progressive Fact-Check Model) v2.0
 *
 * IFCN 5대 강령에 정렬된 5개 평가 차원(C1~C5)에 대한 베이지안 점진적 가중치 모델.
 *  - 사전(Prior): 학생 가중치 W_student = {Ci: {mu, sigma}}, 초기 mu = 1/5 (0.20)
 *  - 갱신(Update): 새로운 (미디어, 교사 평가) 또는 (미디어, 학생 정교화) 쌍이 들어올 때
 *      w_i^(t+1) = w_i^(t) + η × Gap_i × C_i_score / Σ(C_j_score²)
 *  - 학습률 η(t) = max(0.05, 0.2 × exp(-0.05 × t))
 *  - σ는 데이터가 누적될수록 점차 감소
 *
 * 본 파일은 호환성을 위해 파일명을 hpfm.js로 유지하지만 모델은 IPFM-2.0입니다.
 */

export const MODEL_VERSION = "IPFM-2.0";
export const STANDARD_BASIS = "IFCN_5_principles";

export const DIMENSIONS = ["C1", "C2", "C3", "C4", "C5"];

/** 학생 체크리스트의 자유 입력 항목이 5대 차원 어디에도 매핑되지 않을 때 사용. */
export const FALLBACK_DIMENSION = "C6";

export const DIMENSION_INFO = {
  C1: {
    code: "C1",
    name: "공정성·균형",
    short: "Fairness & Balance",
    framework: "IFCN 강령 1 — 초당파성과 공정성",
    description: "다양한 입장 균형, 자극적 어휘 자제, 의견-사실 구분",
  },
  C2: {
    code: "C2",
    name: "근거·자료의 투명성",
    short: "Source Transparency",
    framework: "IFCN 강령 2 — 자료 출처의 투명성",
    description: "출처·인용·데이터의 추적 가능성과 외부 교차검증",
  },
  C3: {
    code: "C3",
    name: "출처·작성자의 투명성",
    short: "Author/Org Transparency",
    framework: "IFCN 강령 3 — 재원·조직의 투명성",
    description: "작성자·매체의 자격·이력·이해관계 공개",
  },
  C4: {
    code: "C4",
    name: "검증된 방법과 증거",
    short: "Methodology & Evidence",
    framework: "IFCN 강령 4 — 방법론의 투명성",
    description: "사실 정확성, 통계 산출 방식, 추론 과정의 명시",
  },
  C5: {
    code: "C5",
    name: "정정 가능성과 시의성",
    short: "Correction & Currency",
    framework: "IFCN 강령 5 — 개방성과 정직한 수정",
    description: "발행 시점·최신성·정정 정책의 명시 여부",
  },
};

const INITIAL_SIGMA = 0.15;
const SIGMA_DECAY = 0.95;
const MIN_SIGMA = 0.02;

export function initialWeights() {
  const w = {};
  for (const d of DIMENSIONS) w[d] = { mu: 1 / DIMENSIONS.length, sigma: INITIAL_SIGMA };
  return w;
}

/** η(t) = max(0.05, 0.2 × exp(-0.05 × t)) */
export function learningRate(trainingDataCount = 0) {
  return Math.max(0.05, 0.2 * Math.exp(-0.05 * trainingDataCount));
}

/** Cold start: 누적 데이터가 3개 미만이면 균등 가중치만 적용. 5개 이상부터 베이즈 갱신 활성화. */
export function isColdStart(trainingDataCount = 0) {
  return trainingDataCount < 3;
}

export function bayesianActive(trainingDataCount = 0) {
  return trainingDataCount >= 5;
}

/** 체크리스트 항목별 점수를 차원별 평균으로 집계. */
export function aggregateToDimensions(items, scoresByIndex) {
  const sums = {};
  const counts = {};
  if (!items || !scoresByIndex) return makeNullDimMap();
  for (let i = 0; i < items.length; i += 1) {
    const dim = items[i]?.dimension;
    if (!DIMENSIONS.includes(dim)) continue;
    const v = Number(scoresByIndex[i]);
    if (!Number.isFinite(v)) continue;
    sums[dim] = (sums[dim] ?? 0) + v;
    counts[dim] = (counts[dim] ?? 0) + 1;
  }
  const out = makeNullDimMap();
  for (const d of DIMENSIONS) {
    out[d] = counts[d] ? sums[d] / counts[d] : null;
  }
  return out;
}

export function makeNullDimMap() {
  const m = {};
  for (const d of DIMENSIONS) m[d] = null;
  return m;
}

/** 두 dimension 점수 맵 사이의 격차 (teacher - student). */
export function computeGap(studentDims, teacherDims) {
  const gap = {};
  for (const d of DIMENSIONS) {
    const s = studentDims?.[d];
    const t = teacherDims?.[d];
    if (s == null || t == null) continue;
    gap[d] = t - s;
  }
  return gap;
}

/**
 * 베이지안 갱신.
 * @param {Record<string,{mu:number,sigma:number}>} prior
 * @param {{dimensionScores:Record<string,number>, gap:Record<string,number>}} obs
 * @param {{trainingDataCount?:number, refineMultiplier?:number}} opts
 */
export function bayesianUpdate(prior, obs, opts = {}) {
  const t = opts.trainingDataCount ?? 0;
  const eta = learningRate(t) * (opts.refineMultiplier ?? 1.0);

  const scores = obs.dimensionScores ?? {};
  const denom =
    Object.values(scores).reduce((s, v) => s + (Number.isFinite(v) ? v * v : 0), 0) || 1;

  const next = {};
  for (const d of DIMENSIONS) {
    const cur = prior?.[d] ?? { mu: 1 / DIMENSIONS.length, sigma: INITIAL_SIGMA };
    const score = Number(scores[d]);
    const gap = Number(obs.gap?.[d]);
    let newMu = cur.mu;
    if (Number.isFinite(score) && Number.isFinite(gap)) {
      newMu = cur.mu + (eta * gap * score) / denom;
    }
    next[d] = {
      mu: Math.max(0.01, newMu),
      sigma: Math.max(MIN_SIGMA, cur.sigma * SIGMA_DECAY),
    };
  }
  return normalize(next);
}

/** 가중치 정규화 (Σμ = 1). σ는 비례 보존. */
export function normalize(weights) {
  const sum = DIMENSIONS.reduce((s, d) => s + (weights[d]?.mu ?? 0), 0);
  if (sum <= 0) return initialWeights();
  const out = {};
  for (const d of DIMENSIONS) {
    const w = weights[d] ?? { mu: 1 / DIMENSIONS.length, sigma: INITIAL_SIGMA };
    out[d] = { mu: w.mu / sum, sigma: w.sigma };
  }
  return out;
}

/** 누적된 (학생, 교사) 페어들로부터 교사의 암묵적 가중치(평균 점수 비례) 추정. */
export function teacherImplicitWeights(teacherDimsList) {
  const sums = {};
  const counts = {};
  for (const dims of teacherDimsList) {
    for (const d of DIMENSIONS) {
      if (Number.isFinite(dims?.[d])) {
        sums[d] = (sums[d] ?? 0) + dims[d];
        counts[d] = (counts[d] ?? 0) + 1;
      }
    }
  }
  const w = {};
  let total = 0;
  for (const d of DIMENSIONS) {
    const v = counts[d] ? sums[d] / counts[d] : 1;
    w[d] = v;
    total += v;
  }
  if (total <= 0) {
    const u = 1 / DIMENSIONS.length;
    for (const d of DIMENSIONS) w[d] = u;
    return w;
  }
  for (const d of DIMENSIONS) w[d] = w[d] / total;
  return w;
}

/** 수렴도 = 1 - ||W_student - W_teacher_implicit|| / √n. 0~1. (n = 차원 수 = 5) */
export function convergenceScore(studentWeights, teacherImplicit) {
  let sq = 0;
  for (const d of DIMENSIONS) {
    const sw = studentWeights?.[d]?.mu ?? 1 / DIMENSIONS.length;
    const tw = teacherImplicit?.[d] ?? 1 / DIMENSIONS.length;
    sq += (sw - tw) ** 2;
  }
  return Math.max(0, 1 - Math.sqrt(sq) / Math.sqrt(DIMENSIONS.length));
}

/**
 * 50점 만점 환산.
 *  - 가중평균 (Σμ_i × score_i)는 1~5 사이 값. ×10 하면 10~50.
 *  - 균등 가중치(μ=0.2)와 동일 점수일 때, "합산 ÷ 5 × 10 = 합산 × 2" 식과 정확히 일치.
 */
export function computeFinalScore(weights, dimensionScores) {
  let sum = 0;
  let weightUsed = 0;
  for (const d of DIMENSIONS) {
    const mu = weights?.[d]?.mu ?? 1 / DIMENSIONS.length;
    const s = Number(dimensionScores?.[d]);
    if (!Number.isFinite(s)) continue;
    sum += mu * s;
    weightUsed += mu;
  }
  if (weightUsed <= 0) return 0;
  const normalized = sum / weightUsed;
  return Math.round(normalized * 10 * 10) / 10;
}

/** 점수 분산. Var(score×10) ≈ 100 × Σ score² × σ². */
export function scoreVariance(weights, dimensionScores) {
  let v = 0;
  for (const d of DIMENSIONS) {
    const sigma = weights?.[d]?.sigma ?? INITIAL_SIGMA;
    const s = Number(dimensionScores?.[d]);
    if (!Number.isFinite(s)) continue;
    v += s * s * sigma * sigma;
  }
  return v * 100;
}

export function confidenceInterval95(score, variance) {
  const margin = 1.96 * Math.sqrt(Math.max(0, variance));
  return [
    Math.max(0, Math.round((score - margin) * 10) / 10),
    Math.min(50, Math.round((score + margin) * 10) / 10),
  ];
}

/**
 * 누적 격차 패턴으로부터 메타인지 피드백 카드 생성.
 *  - 평균 |gap| > 0.5: 체계적 편향 (over/under)
 *  - 분산 > 1.0: 기준 일관성 부족
 */
export function generateFeedbackCards(gapHistory) {
  const cards = [];
  if (!gapHistory?.length) return cards;
  for (const d of DIMENSIONS) {
    const values = gapHistory.map((h) => h?.[d]).filter((v) => Number.isFinite(v));
    if (values.length < 2) continue;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance =
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;

    if (mean < -0.5) {
      cards.push(buildCard(d, "over", mean, variance));
    } else if (mean > 0.5) {
      cards.push(buildCard(d, "under", mean, variance));
    } else if (variance > 1.0) {
      cards.push(buildCard(d, "inconsistent", mean, variance));
    }
  }
  return cards;
}

function buildCard(dim, type, mean, variance) {
  const info = DIMENSION_INFO[dim];
  const base = {
    dimension: dim,
    dimensionName: info.name,
    framework: info.framework,
    type,
    stats: { mean: Number(mean.toFixed(2)), variance: Number(variance.toFixed(2)) },
  };
  if (type === "over") {
    return {
      ...base,
      diagnosis: `${info.name}: 교사보다 평균 ${(-mean).toFixed(1)}점 높게 평가하는 경향이 있습니다.`,
      suggestion: `이 차원의 단서(예: ${info.description})에 대한 민감도를 조금 더 높여보세요. 참고: ${info.framework}.`,
    };
  }
  if (type === "under") {
    return {
      ...base,
      diagnosis: `${info.name}: 교사보다 평균 ${mean.toFixed(1)}점 낮게 평가하는 경향이 있습니다.`,
      suggestion: `너무 박하게 보고 있을 수 있습니다. 좋은 자료의 단서가 보일 때는 점수를 살려두는 것도 방법이에요. 참고: ${info.framework}.`,
    };
  }
  return {
    ...base,
    diagnosis: `${info.name}: 평가 결과가 흔들리는 경향이 있습니다 (분산 ${variance.toFixed(2)}).`,
    suggestion: `이 차원에 대한 자신의 루브릭 정의를 다시 정비해보세요. 참고: ${info.framework}.`,
  };
}

/** 대시보드/결과 화면용 정렬된 차원 가중치 배열. */
export function weightsToArray(weights) {
  return DIMENSIONS.map((d) => ({
    code: d,
    name: DIMENSION_INFO[d].name,
    framework: DIMENSION_INFO[d].framework,
    mu: weights?.[d]?.mu ?? 1 / DIMENSIONS.length,
    sigma: weights?.[d]?.sigma ?? INITIAL_SIGMA,
  }));
}

/* ============================================================
 * v1(HPFM, D1~D7) 데이터 마이그레이션 헬퍼
 * 교사용 체크리스트 v2.0 문서 기준 변환식:
 *   C1 = (D5 + D6) / 2     // 편향 + 언어 → 공정성·균형
 *   C2 = (D4 + D7) / 2     // 근거 + 검증 가능성 → 자료 투명성
 *   C3 = D1                // 출처 권위성 → 출처·작성자 투명성
 *   C4 = D2                // 내용 정확성 → 방법·증거
 *   C5 = D3                // 시의성 → 정정·시의성
 * ============================================================ */
const LEGACY_TO_NEW = {
  D1: ["C3"],
  D2: ["C4"],
  D3: ["C5"],
  D4: ["C2"],
  D5: ["C1"],
  D6: ["C1"],
  D7: ["C2"],
  D8: ["C6"],
};

/** v1 차원 점수(D1~D7)를 v2 차원 점수(C1~C5)로 변환. */
export function migrateLegacyDimensionScores(legacyDims) {
  if (!legacyDims) return makeNullDimMap();
  const sums = {};
  const counts = {};
  for (const [legacy, score] of Object.entries(legacyDims)) {
    if (!Number.isFinite(Number(score))) continue;
    const targets = LEGACY_TO_NEW[legacy];
    if (!targets) continue;
    for (const t of targets) {
      if (!DIMENSIONS.includes(t)) continue;
      sums[t] = (sums[t] ?? 0) + Number(score);
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  const out = makeNullDimMap();
  for (const d of DIMENSIONS) {
    out[d] = counts[d] ? sums[d] / counts[d] : null;
  }
  return out;
}
