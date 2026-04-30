/**
 * HPFM (Hybrid Progressive Fact-Check Model)
 *
 * 7대 표준 차원(D1~D7)에 대한 베이지안 점진적 가중치 모델.
 * - 사전(Prior): 학생 가중치 W_student = {Di: {mu, sigma}}
 * - 갱신(Update): 새로운 (미디어, 교사 평가) 또는 (미디어, 학생 정교화) 쌍이 들어올 때
 *   w_i^(t+1) = w_i^(t) + η × Gap_i × D_i_score / Σ(D_j_score²)
 * - 학습률 η(t) = max(0.05, 0.2 × exp(-0.05 × t))
 * - σ는 데이터가 누적될수록 점차 감소 (학생의 판단이 안정화됨을 의미)
 */

export const DIMENSIONS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7"];

export const DIMENSION_INFO = {
  D1: {
    code: "D1",
    name: "출처 권위성",
    short: "Authority",
    framework: "CRAAP · SIFT-Investigate",
    description: "작성자·매체·기관의 신뢰성",
  },
  D2: {
    code: "D2",
    name: "내용 정확성",
    short: "Accuracy",
    framework: "CRAAP · FEVER-Verdict",
    description: "사실 검증 가능 여부",
  },
  D3: {
    code: "D3",
    name: "시의성",
    short: "Currency",
    framework: "CRAAP",
    description: "정보의 최신성·유효성",
  },
  D4: {
    code: "D4",
    name: "근거 제시",
    short: "Evidence",
    framework: "FEVER-Retrieval · SIFT-Trace",
    description: "출처·인용·데이터 제시 정도",
  },
  D5: {
    code: "D5",
    name: "편향성·목적",
    short: "Bias",
    framework: "CRAAP · IFCN",
    description: "편향·의도·광고성",
  },
  D6: {
    code: "D6",
    name: "언어 건전성",
    short: "Language",
    framework: "IFCN",
    description: "선정성·감정 자극·클릭베이트",
  },
  D7: {
    code: "D7",
    name: "검증 가능성",
    short: "Verifiability",
    framework: "FEVER · IFCN",
    description: "교차검증 가능 여부",
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

/** 수렴도 = 1 - ||W_student - W_teacher_implicit|| / √7. 0~1. */
export function convergenceScore(studentWeights, teacherImplicit) {
  let sq = 0;
  for (const d of DIMENSIONS) {
    const sw = studentWeights?.[d]?.mu ?? 1 / DIMENSIONS.length;
    const tw = teacherImplicit?.[d] ?? 1 / DIMENSIONS.length;
    sq += (sw - tw) ** 2;
  }
  return Math.max(0, 1 - Math.sqrt(sq) / Math.sqrt(DIMENSIONS.length));
}

/** 50점 만점 환산. dimensionScores가 1~5라면 결과는 0~50. */
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
 * - 평균 |gap| > 0.5: 체계적 편향 (over/under)
 * - 분산 > 1.0: 기준 일관성 부족
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
