/**
 * VAPM (Verification Action-based Progressive fact-check Model) v3.0
 *
 * 미디어 자료를 평가할 때 학생이 실제로 수행하는 5가지 검증 행동(V1~V5)에 대한
 * 베이지안 점진적 가중치 + 행동별 마스터리(Mastery) 모델.
 *
 *  - V1 출처 확인 (Source Check)
 *  - V2 저자 확인 (Author Check)
 *  - V3 콘텐츠 교차 확인 (Content Cross-check)
 *  - V4 이미지·영상 확인 (Visual Verification)
 *  - V5 감정 반응 점검 (Emotional Reaction Check)
 *
 *  - 사전(Prior): 학생 가중치 W_student = {Vi: {mu, sigma}}, 초기 mu = 1/5 (0.20)
 *  - 갱신(Update):
 *      w_i^(t+1) = w_i^(t) + η × Gap_i × V_i_score / Σ(V_j_score²)
 *  - 학습률 η(t) = max(0.05, 0.2 × exp(-0.05 × t))
 *  - σ는 데이터가 누적될수록 점차 감소
 *  - 마스터리 Mastery(V_i) = (1 - σ_i) × (1 - |avg_gap_i| / 4)
 *
 * 본 파일은 v1(HPFM) → v2(IPFM) → v3(VAPM) 진화 흐름의 호환성을 위해
 * 파일명을 hpfm.js로 유지하지만 모델은 VAPM-3.0입니다.
 */

export const MODEL_VERSION = "VAPM-3.0";
export const STANDARD_BASIS = "5_verification_actions";

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
 * 미디어 유형별 권장 가중치 프리셋.
 * 학생/교사가 자료 유형에 맞춰 가중치를 빠르게 적용할 때 사용.
 */
export const MEDIA_TYPE_PRESETS = {
  news: {
    label: "뉴스 기사",
    weights: { V1: 0.20, V2: 0.15, V3: 0.30, V4: 0.15, V5: 0.20 },
  },
  sns: {
    label: "SNS 게시물",
    weights: { V1: 0.15, V2: 0.30, V3: 0.15, V4: 0.20, V5: 0.20 },
  },
  video: {
    label: "영상 콘텐츠",
    weights: { V1: 0.15, V2: 0.20, V3: 0.20, V4: 0.30, V5: 0.15 },
  },
  ad: {
    label: "광고·홍보",
    weights: { V1: 0.20, V2: 0.15, V3: 0.20, V4: 0.15, V5: 0.30 },
  },
  gov: {
    label: "정부 공식 발표",
    weights: { V1: 0.30, V2: 0.25, V3: 0.25, V4: 0.10, V5: 0.10 },
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

/**
 * 체크리스트 항목별 점수를 검증 행동별 평균으로 집계.
 * 이전 버전 잔재(D1~D8 / C1~C6) 코드는 LEGACY_TO_NEW로 자동 변환하여 누적.
 */
export function aggregateToDimensions(items, scoresByIndex) {
  const sums = {};
  const counts = {};
  if (!items || !scoresByIndex) return makeNullDimMap();
  for (let i = 0; i < items.length; i += 1) {
    const rawDim = items[i]?.dimension;
    const v = Number(scoresByIndex[i]);
    if (!Number.isFinite(v)) continue;
    const targets = DIMENSIONS.includes(rawDim)
      ? [rawDim]
      : LEGACY_TO_NEW[rawDim] ?? null;
    if (!targets) continue;
    for (const dim of targets) {
      if (!DIMENSIONS.includes(dim)) continue;
      sums[dim] = (sums[dim] ?? 0) + v;
      counts[dim] = (counts[dim] ?? 0) + 1;
    }
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
    Object.values(scores).reduce(
      (s, v) => s + (Number.isFinite(Number(v)) ? Number(v) * Number(v) : 0),
      0
    ) || 1;

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

/**
 * 수렴도 = 1 - ||W_student - W_teacher_implicit|| / √n. 0~1.
 * 학생/교사 가중치가 모두 균등(미학습 상태)이면 의미 있는 값이 아니므로 null 반환.
 */
export function convergenceScore(studentWeights, teacherImplicit) {
  const uniform = 1 / DIMENSIONS.length;
  const epsilon = 1e-6;
  const studentIsUniform = DIMENSIONS.every(
    (d) => Math.abs((studentWeights?.[d]?.mu ?? uniform) - uniform) < epsilon
  );
  const teacherIsUniform = DIMENSIONS.every(
    (d) => Math.abs((teacherImplicit?.[d] ?? uniform) - uniform) < epsilon
  );
  if (studentIsUniform && teacherIsUniform) return null;

  let sq = 0;
  for (const d of DIMENSIONS) {
    const sw = studentWeights?.[d]?.mu ?? uniform;
    const tw = teacherImplicit?.[d] ?? uniform;
    sq += (sw - tw) ** 2;
  }
  return Math.max(0, 1 - Math.sqrt(sq) / Math.sqrt(DIMENSIONS.length));
}

/** dimensionScores 객체에 v1 차원 키(D1~D8) 또는 v2 차원 키(C1~C6)가 있는지. */
export function isLegacyDimMap(dims) {
  if (!dims || typeof dims !== "object") return false;
  return Object.keys(dims).some((k) => /^D[1-8]$/.test(k) || /^C[1-6]$/.test(k));
}

/**
 * 50점 만점 환산.
 *  - 가중평균 (Σμ_i × score_i)는 1~5 사이 값. ×10 하면 10~50.
 *  - 일부 검증 행동이 N/A(예: 이미지 없는 텍스트 자료의 V4)인 경우,
 *    실제 사용된 가중치만으로 정규화하여 나머지 4개 항목으로 점수를 산출.
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

/** 점수 분산. Var(score×10) ≈ 100 × Σ score² × σ². N/A 행동은 합산에서 제외. */
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
 * 검증 행동별 마스터리(Mastery) 산출.
 *   Mastery(V_i) = (1 - σ_i) × (1 - |avg_gap_i| / 4)
 * - 0~1 사이.
 * - 1에 가까울수록 그 검증 행동을 안정적으로(=낮은 σ, 작은 격차) 수행한다는 뜻.
 *
 * @param {Record<string,{mu:number,sigma:number}>} weights
 * @param {Array<Record<string,number>>} gapHistory  // 누적 학습 데이터의 gap 객체 리스트
 */
export function computeMastery(weights, gapHistory = []) {
  const out = {};
  for (const d of DIMENSIONS) {
    const sigma = Number(weights?.[d]?.sigma);
    const sigmaPart = Number.isFinite(sigma)
      ? Math.max(0, Math.min(1, 1 - sigma))
      : 1 - INITIAL_SIGMA;
    const gaps = gapHistory
      .map((h) => Number(h?.[d]))
      .filter((v) => Number.isFinite(v));
    let gapPart = 1;
    if (gaps.length > 0) {
      const avgAbs = gaps.reduce((s, v) => s + Math.abs(v), 0) / gaps.length;
      gapPart = Math.max(0, Math.min(1, 1 - avgAbs / 4));
    }
    out[d] = Math.max(0, Math.min(1, sigmaPart * gapPart));
  }
  return out;
}

export function masteryToArray(mastery) {
  return DIMENSIONS.map((d) => ({
    code: d,
    name: DIMENSION_INFO[d].name,
    value: Number(mastery?.[d] ?? 0),
  }));
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
 * 검증 행동별 · 패턴별 상세 가이드.
 * - 학생 평가 습관에 대한 자기 진단 문구만 사용.
 * - detail: 어떤 점에서 그런 경향이 나타났는지 자세한 해석.
 * - suggestion: 다음 평가에서 살펴볼 구체적 검증 행동/도구.
 */
const PATTERN_GUIDE = {
  V1: {
    over: {
      detail:
        "도메인이 익숙하지 않거나 매체 운영 정보가 부실한 자료에도 점수를 살려주고 있을 가능성이 있어요. 사이트 디자인이 그럴듯하면 신뢰해버리는 패턴일 수 있어요.",
      suggestion:
        "다음엔 '주소창의 도메인이 정확한지', '회사 소개 페이지에 운영 정보가 있는지', '매체 이름을 검색했을 때 평판이 어떤지'를 한번 더 확인해보자.",
    },
    under: {
      detail:
        "처음 보는 매체라는 이유만으로 점수를 너무 깊게 깎고 있을 수 있어요. 매체 운영 정보·HTTPS·연락처가 있다면 그 자체로도 신뢰의 단서예요.",
      suggestion:
        "도메인이 합법적이고 운영 구조가 공개되어 있다면 그 점은 점수에 살려두자.",
    },
    inconsistent: {
      detail:
        "어떤 자료에선 도메인을 까다롭게 따지고, 어떤 자료에선 그냥 넘어가는 패턴이에요. 매체 이름의 친숙도에 따라 출처 검증 강도가 흔들리는 상태예요.",
      suggestion:
        "'도메인 정확성', '회사 소개 페이지 충실도', 'HTTPS 여부'를 매번 동일한 체크 포인트로 적용해보자.",
    },
  },
  V2: {
    over: {
      detail:
        "작성자명이 닉네임이거나 검색해도 이력이 잘 나오지 않는 경우에도 좋은 점수를 주고 있을 수 있어요. 봇 신호(비정상 게시 빈도, 동일 문구 반복)에도 둔감해진 상태일 수 있어요.",
      suggestion:
        "다음엔 '작성자 이름을 구글에 검색해보기', '이전 글들의 일관성 살펴보기', 'SNS 계정의 게시 패턴이 정상인지'를 한번 확인해보자.",
    },
    under: {
      detail:
        "익명·필명 작성자라는 이유로 점수를 너무 깊게 깎고 있을 수 있어요. 매체가 검증된 곳이라면 작성자가 익명이어도 편집 검토를 거친 결과일 수 있어요.",
      suggestion:
        "매체의 편집 구조나 책임자가 공개되어 있다면 그 점도 점수에 반영해주자.",
    },
    inconsistent: {
      detail:
        "어떤 자료는 작성자 이력을 엄격히 따지고, 어떤 자료는 그냥 넘어가는 패턴이에요. 친숙한 이름이면 후해지고 처음 보면 박해지는 식으로 친숙함이 기준 역할을 하고 있어요.",
      suggestion:
        "'실제로 검색해서 이력이 나오는지', '봇 신호가 있는지'를 매번 같은 잣대로 확인해보자.",
    },
  },
  V3: {
    over: {
      detail:
        "'한 매체에서만 다루는 내용'에도 점수를 살려주고 있을 가능성이 있어요. 단일 출처 의존이나 통계의 부분 인용에 둔감한 상태일 수 있어요.",
      suggestion:
        "다음엔 '같은 사건을 다른 매체 3곳 이상에서 다루는지', '인용 통계의 원자료를 직접 찾아볼 수 있는지'를 한번 더 확인해보자.",
    },
    under: {
      detail:
        "다른 매체에서 비슷한 내용이 일부만 확인돼도 너무 박하게 보고 있을 수 있어요. 모든 자료가 다양한 매체에서 다뤄질 수 있는 건 아니에요.",
      suggestion:
        "핵심 주장이 신뢰 매체 1곳 이상에서 일관되게 보도된다면 그 점은 점수에 살려두자.",
    },
    inconsistent: {
      detail:
        "어떤 자료는 다른 매체와의 비교를 꼼꼼히 하고, 어떤 자료는 그냥 받아들이는 패턴이에요. 자료의 첫인상에 따라 교차 확인 강도가 달라지는 상태예요.",
      suggestion:
        "'주요 일간지에서 같은 사건을 다루는지', '공공기관 공식 발표와 일치하는지'를 매번 동일하게 적용해보자.",
    },
  },
  V4: {
    over: {
      detail:
        "이미지·영상의 출처를 따로 확인하지 않고도 점수를 살려주고 있을 수 있어요. 같은 이미지가 다른 사건에 재사용되었거나 AI 생성일 가능성을 충분히 의심하지 않은 상태예요.",
      suggestion:
        "다음엔 '이미지를 우클릭해서 역검색해보기', 'AI 생성 신호(어색한 손가락, 깨진 글자, 이상한 그림자)가 있는지' 살펴보자.",
    },
    under: {
      detail:
        "이미지 출처가 약간 불명확하다고 해서 점수를 너무 깊게 깎고 있을 수 있어요. 모든 자료가 원본 이미지 링크를 첨부하는 건 아니에요.",
      suggestion:
        "이미지가 본문 내용과 명확히 일치하고 가공 흔적이 없다면 그 점은 점수에 반영해주자.",
    },
    inconsistent: {
      detail:
        "어떤 자료는 이미지를 꼼꼼히 따지고, 어떤 자료는 본문만 읽고 넘어가는 패턴이에요. 이미지 검증이 빠지면 큰 단서를 놓칠 수 있어요.",
      suggestion:
        "이미지가 있는 자료는 '역이미지 검색', '메타데이터 점검', 'AI 생성 신호 확인'을 매번 실행해보자.",
    },
  },
  V5: {
    over: {
      detail:
        "자극적 어휘('충격', '경악', '비밀')나 분노·공포 유발 헤드라인에도 점수를 살려주고 있을 수 있어요. 클릭베이트 패턴에 둔감해진 상태일 수 있어요.",
      suggestion:
        "다음엔 '읽고 나서 어떤 감정이 들었나', '즉시 누군가에게 보내고 싶은 충동이 들었나'를 자기 점검해보자. 강한 감정이 일어났다면 의심 신호예요.",
    },
    under: {
      detail:
        "강조 표현이 조금만 들어가도 점수를 너무 깊게 깎고 있을 수 있어요. 모든 자료가 완벽히 중립적일 수는 없어요.",
      suggestion:
        "사실 진술이 중심이고 감정 호소가 부수적이라면 그 점은 점수에 살려두자.",
    },
    inconsistent: {
      detail:
        "같은 종류의 자극적 표현인데도 어떤 자료에선 너그럽게, 어떤 자료에선 엄격하게 보고 있어요. 주제에 동의하느냐에 따라 기준이 흔들리는 상태일 수 있어요.",
      suggestion:
        "'자극적 어휘 빈도', '즉각 공유 유도 문구', '내 감정 반응'을 매번 같은 잣대로 점검해보자.",
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
    framework: info.framework,
    type,
    diagnosis: `'${info.name}'에서 점수를 ${typeLabel} 경향이에요.`,
    detail: guide.detail ?? "",
    suggestion: guide.suggestion ?? "",
    stats: { mean: Number(mean.toFixed(2)), variance: Number(variance.toFixed(2)) },
  };
}

/** 대시보드/결과 화면용 정렬된 검증 행동 가중치 배열. */
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
 * 레거시 차원 → V1~V6 마이그레이션
 *
 * v1 (HPFM, D1~D8) 변환식:
 *   D1 출처 권위성    → C3 (출처·작성자 투명성)
 *   D2 내용 정확성    → C4 (방법·증거)
 *   D3 시의성         → C5 (정정·시의성)
 *   D4 근거 제시      → C2 (자료 투명성)
 *   D5 편향성         → C1 (공정성·균형)
 *   D6 언어 건전성    → C1
 *   D7 검증 가능성    → C2
 *   D8 미분류         → C6
 *
 * v2 (IPFM, C1~C6) → v3 (VAPM, V1~V6) 변환식:
 *   C1 공정성·균형     → V5 감정 반응 (관련 부분)
 *   C2 자료 투명성     → V3 콘텐츠 교차 확인
 *   C3 출처·작성자 투명성 → V1 출처 확인 + V2 저자 확인 (양쪽 평균으로 적재)
 *   C4 방법·증거       → V3 콘텐츠 교차 확인
 *   C5 정정·시의성     → V1 출처 확인 (시의성·발행 매체 신뢰성과 가장 가까움)
 *   C6 사용자 정의     → V6
 *
 * 합쳐서 D1~D8 / C1~C6 → V1~V6 직접 매핑 테이블을 만든다.
 * 점수가 두 V에 매핑될 경우 각각에 누적되어 평균값으로 집계됨.
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
 * 레거시 차원 점수(D1~D8 또는 C1~C6)를 v3 검증 행동 점수(V1~V5)로 변환.
 * 다중 매핑(예: C3 → V1+V2)은 두 V 모두에 동일 점수가 누적되어 평균화됨.
 * 완전한 마이그레이션은 아니므로(특히 V4) 기존 자료는 V1~V5 기준으로 재평가 권장.
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
