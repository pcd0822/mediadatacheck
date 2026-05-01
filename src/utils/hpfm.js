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

/**
 * 차원별 · 패턴별 상세 가이드.
 * - 학생 평가 습관에 대한 자기 진단 문구만 사용 (외부 비교 표현 배제).
 * - detail: 어떤 점에서 그런 경향이 나타났는지 자세한 해석.
 * - suggestion: 다음 평가에서 살펴볼 구체적 단서/행동.
 */
const PATTERN_GUIDE = {
  C1: {
    over: {
      detail:
        "한쪽 입장만 다루거나 자극적 어휘가 들어간 자료에도 점수를 살려주고 있을 가능성이 있어요. '충격!', '경악!' 같은 단어나 '~라더라' 식 표현에 둔감해진 상태일 수 있어요.",
      suggestion:
        "다음엔 자료에서 반대편 의견이 한 줄이라도 다뤄지는지, 작성자 의견과 사실이 구분되어 있는지 먼저 확인해보자.",
    },
    under: {
      detail:
        "조금만 한쪽으로 기울어 보여도 점수를 깊게 깎고 있을 수 있어요. 모든 자료가 완벽히 중립일 수는 없으니, 얼마나 균형 잡히려 노력했는지를 살펴볼 필요가 있어요.",
      suggestion:
        "반대 의견을 한 줄이라도 다루려 했다면 그 노력은 점수에 반영해주자.",
    },
    inconsistent: {
      detail:
        "같은 종류의 자극적 표현인데도 어떤 자료에선 너그럽게, 어떤 자료에선 엄격하게 보고 있어요. 자료의 첫인상이나 주제 친숙도에 따라 점수 기준이 흔들리는 상태예요.",
      suggestion:
        "'자극적 단어', '의견-사실 구분', '광고성 단서' 중 어느 것을 가장 중요하게 볼지 너만의 우선순위를 정해두면 일관성이 생겨.",
    },
  },
  C2: {
    over: {
      detail:
        "'전문가에 따르면', '한 연구는' 같은 막연한 출처 언급도 점수를 살려주고 있을 수 있어요. 구체적인 인물·기관·링크 없이도 '출처가 있다'고 받아들이는 거죠.",
      suggestion:
        "다음엔 '구체적 이름이 적혀 있는지', '링크나 각주가 실제로 있는지', '검색하면 같은 출처가 나오는지'를 한번 더 확인해보자.",
    },
    under: {
      detail:
        "출처가 일부만 있어도 너무 박하게 보고 있을 수 있어요. 모든 문장에 출처가 달려야만 신뢰할 수 있는 건 아니에요.",
      suggestion:
        "핵심 주장에 출처가 있고 그 출처가 검증 가능하다면 그 점은 점수에 살려두자.",
    },
    inconsistent: {
      detail:
        "어떤 자료에서는 출처를 까다롭게 따지고, 어떤 자료에서는 그냥 넘어가는 패턴이에요. 자료의 친숙함이나 첫인상에 따라 출처 검증 강도가 달라지는 상태예요.",
      suggestion:
        "'1차 출처가 있는지', '링크를 클릭해 직접 확인할 수 있는지' 같은 체크 포인트를 매번 동일하게 적용해보자.",
    },
  },
  C3: {
    over: {
      detail:
        "닉네임이나 채널명만 있고 실제로 누구인지 검색해도 잘 나오지 않는 경우에도 좋은 점수를 주고 있을 수 있어요. 작성자의 자격이나 매체의 운영 정보를 충분히 따지지 않은 거죠.",
      suggestion:
        "다음엔 '작성자 이름을 검색했을 때 이력이 나오는지', '매체의 회사 소개·연락처 페이지가 있는지'를 한번 더 살펴보자.",
    },
    under: {
      detail:
        "익명 작성자나 처음 보는 매체라고 해서 무조건 점수를 깎고 있을 수 있어요. 매체 자체가 검증된 곳이라면 작성자가 익명이어도 신뢰도는 보장될 수 있어요.",
      suggestion:
        "매체의 운영 구조나 발행 이력이 공개되어 있다면 그 점도 점수에 반영해주자.",
    },
    inconsistent: {
      detail:
        "어떤 자료는 작성자 신원을 엄격히 따지고, 어떤 자료는 그냥 넘어가는 패턴이에요. 매체 이름이 익숙하면 점수가 후해지고, 처음 보는 매체면 박해지는 식으로 친숙함이 기준 역할을 하고 있어요.",
      suggestion:
        "친숙함이 아니라 '실제로 검색해서 확인되는지'를 기준으로 동일하게 적용해보자.",
    },
  },
  C4: {
    over: {
      detail:
        "추측이나 단정이 사실인 것처럼 적혀 있어도 그대로 받아들이고 있을 수 있어요. 통계 수치도 어떻게 측정됐는지 따지지 않고 점수를 주는 패턴이에요.",
      suggestion:
        "다음엔 '핵심 사실 1~2개를 직접 검색해보기', '통계의 산출 방식이 설명됐는지 살펴보기'를 시도해보자.",
    },
    under: {
      detail:
        "방법론 설명이 부족하다고 해서 점수를 너무 깊게 깎고 있을 수 있어요. 핵심 사실이 검색으로 검증된다면 그것도 의미 있는 신뢰 신호예요.",
      suggestion:
        "사실 진술이 다른 매체에서도 일관되게 확인된다면 그 점은 점수에 살려두자.",
    },
    inconsistent: {
      detail:
        "어떤 자료는 통계 출처를 따지고, 어떤 자료는 그냥 받아들이는 패턴이에요. 사실과 추측을 구분하는 강도가 자료마다 들쭉날쭉한 상태예요.",
      suggestion:
        "'핵심 사실 1개는 항상 검색해본다', '추측 표현(~일 가능성, ~로 보인다)은 사실과 구분한다'를 매번 적용해보자.",
    },
  },
  C5: {
    over: {
      detail:
        "발행일이 모호하거나 시점이 오래된 자료에도 점수를 살려주고 있을 수 있어요. 다루는 주제가 빠르게 변하는 분야(정치·기술·통계 등)인지 충분히 확인하지 않은 거죠.",
      suggestion:
        "다음엔 '발행일이 명확히 표시됐는지', '주제가 빠르게 변하는 분야인지'를 먼저 판단해보자.",
    },
    under: {
      detail:
        "오래된 자료라고 해서 무조건 점수를 깎고 있을 수 있어요. 역사적 사건이나 잘 변하지 않는 사실은 오래된 자료도 충분히 유효해요.",
      suggestion:
        "주제에 따라 '오래되어도 괜찮은가'를 먼저 판단한 뒤 점수를 매겨보자.",
    },
    inconsistent: {
      detail:
        "어떤 자료는 발행일을 엄격히 보고, 어떤 자료는 그냥 넘어가는 패턴이에요. 주제별로 시의성의 중요도가 다르게 적용되어야 하는데 그게 일관되지 않은 상태예요.",
      suggestion:
        "'이 주제는 시의성이 얼마나 중요한가?'를 먼저 판단한 뒤 발행일을 살펴보면 일관성이 생겨.",
    },
  },
};

const TYPE_LABELS = {
  over: "후하게 주는",
  under: "박하게 주는",
  inconsistent: "들쭉날쭉한",
};

function buildCard(dim, type, mean, variance) {
  const info = DIMENSION_INFO[dim];
  const guide = PATTERN_GUIDE[dim]?.[type] ?? {};
  const typeLabel = TYPE_LABELS[type] ?? "흔들리는";
  return {
    dimension: dim,
    dimensionName: info.name,
    framework: info.framework, // 데이터로는 보존, 학생 화면 노출은 UI에서 차단
    type,
    diagnosis: `'${info.name}'에서 점수를 ${typeLabel} 경향이에요.`,
    detail: guide.detail ?? "",
    suggestion: guide.suggestion ?? "",
    stats: { mean: Number(mean.toFixed(2)), variance: Number(variance.toFixed(2)) },
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
