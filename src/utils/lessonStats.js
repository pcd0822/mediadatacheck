/**
 * 4단계 비교 대시보드 통계 코어 (순수 함수).
 *
 * ⚠️ 통계 해석 원칙 — 이 파일의 존재 이유
 *
 *  1) **차이 절댓값 평균과 부호 있는 평균은 반드시 함께 본다.**
 *     부호 평균만 쓰면 +2와 −2가 서로 지워져, 모둠 판단이 정반대로 갈린 상태가
 *     "완전 일치"로 잘못 읽힌다. 기본 정렬 기준은 **절댓값 평균**이다.
 *
 *  2) **중앙값이 평균과 크게 벌어지면** 한 명이 유독 다르게 봤다는 신호다.
 *
 *  3) **모둠원 간 표준편차**는 AI와 무관하게 모둠원끼리 갈렸는지를 본다.
 *     AI와의 평균 차이가 작아도 모둠원끼리 크게 갈렸다면 "우연히 평균이 맞은" 것이다.
 *
 *  4) **절사평균(trimmed mean)은 쓰지 않는다.** 표본이 모둠원 3~5명 수준이라
 *     최대·최소를 자르면 관측치 절반이 사라지고, 무엇보다 "한 명이 크게 다르게 본 사실"
 *     자체가 이 수업에서 가장 중요한 신호이기 때문이다.
 *
 *  5) **N/A(AI가 판단하지 못한 항목)는 차이 통계에서 제외**한다. 차이를 정의할 수 없다.
 *     다만 모둠원 표준편차는 AI와 무관하므로 N/A 항목도 포함해 계산한다
 *     (그래야 AI가 전부 N/A를 낸 지표에서도 모둠원이 갈렸는지 볼 수 있다).
 */

import { DIMENSIONS } from "./hpfm.js";

/* ===================== 기초 통계 ===================== */

export function mean(values) {
  if (!values?.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values) {
  if (!values?.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 모집단 표준편차(n으로 나눔).
 * 모둠원 전원을 관측한 기술통계이지 표본 추정이 아니므로 n−1 보정을 쓰지 않는다.
 */
export function stdev(values) {
  if (!values?.length) return null;
  if (values.length === 1) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

const round2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

/* ===================== 경고 판정 임계값 ===================== */

/** 부호 평균이 0 근처인데 절댓값 평균이 큰 = 상쇄. */
export const CANCELLATION_SIGNED_MAX = 0.5;
export const CANCELLATION_ABS_MIN = 1.0;
/** 모둠원끼리 갈림. */
export const MEMBER_SPLIT_MIN = 1.0;
/** 평균과 중앙값이 벌어짐 = 한 명이 유독 다름. */
export const MEDIAN_GAP_MIN = 1.0;

/* ===================== 관측치 수집 ===================== */

/**
 * 한 미디어에 대한 (학생 × 항목) 관측치를 만든다.
 *
 * @param {Array<{question:string, dimension:string|null}>} items 채점 시점 체크리스트 스냅샷
 * @param {Array<{index:number, score:number|null}>} aiResults  AI 항목별 채점
 * @param {Array<{uid:string, name:string|null, scores:Record<string|number, number>}>} members
 *        blind_scores 문서들 (제출·포함된 모둠원만)
 * @returns {Array<{uid, name, itemIndex, dimension, question, studentScore, aiScore, diff}>}
 *          aiScore가 null이면 diff도 null (통계에서 제외 대상)
 */
export function buildObservations(items = [], aiResults = [], members = []) {
  const aiByIndex = new Map();
  for (const r of aiResults ?? []) {
    const idx = Number(r?.index);
    if (Number.isInteger(idx)) aiByIndex.set(idx, r);
  }

  const out = [];
  items.forEach((item, i) => {
    const ai = aiByIndex.get(i);
    const aiScore =
      ai && ai.score !== null && ai.score !== undefined && Number.isFinite(Number(ai.score))
        ? Number(ai.score)
        : null;
    for (const m of members ?? []) {
      const raw = m?.scores?.[i] ?? m?.scores?.[String(i)];
      if (raw === null || raw === undefined) continue;
      const studentScore = Number(raw);
      if (!Number.isFinite(studentScore)) continue;
      out.push({
        uid: m.uid,
        name: m.name ?? null,
        itemIndex: i,
        dimension: item?.dimension ?? null,
        question: item?.question ?? "",
        studentScore,
        aiScore,
        diff: aiScore === null ? null : studentScore - aiScore,
      });
    }
  });
  return out;
}

/* ===================== 지표별 통계 ===================== */

/**
 * 지표(V1~V5)별 통계.
 *
 * @returns {Array<{
 *   dimension, itemCount, naItemCount, observationCount,
 *   absMean, signedMean, medianDiff, memberStdev,
 *   flags: {cancellation, memberSplit, medianGap},
 *   reading: string
 * }>}  절댓값 평균 오름차순 정렬(값 없는 지표는 뒤로)
 */
export function computeDimensionStats(items = [], aiResults = [], members = []) {
  const observations = buildObservations(items, aiResults, members);

  const rows = DIMENSIONS.map((dim) => {
    const dimItemIndexes = items
      .map((it, i) => (it?.dimension === dim ? i : -1))
      .filter((i) => i >= 0);

    const dimObs = observations.filter((o) => o.dimension === dim);
    const scored = dimObs.filter((o) => o.diff !== null);
    const diffs = scored.map((o) => o.diff);

    // AI가 점수를 낸 항목 / N/A 항목 구분
    const naItemIndexes = dimItemIndexes.filter((i) => {
      const any = dimObs.find((o) => o.itemIndex === i);
      return any ? any.aiScore === null : false;
    });

    // 모둠원 간 표준편차: AI와 무관하므로 N/A 항목도 포함해 항목별로 구한 뒤 평균.
    const perItemStdevs = [];
    for (const i of dimItemIndexes) {
      const scores = dimObs.filter((o) => o.itemIndex === i).map((o) => o.studentScore);
      if (scores.length >= 2) perItemStdevs.push(stdev(scores));
    }

    const absMean = diffs.length ? mean(diffs.map(Math.abs)) : null;
    const signedMean = diffs.length ? mean(diffs) : null;
    const medianDiff = diffs.length ? median(diffs) : null;
    const memberStdev = perItemStdevs.length ? mean(perItemStdevs) : null;

    const flags = {
      cancellation:
        absMean !== null &&
        signedMean !== null &&
        Math.abs(signedMean) < CANCELLATION_SIGNED_MAX &&
        absMean >= CANCELLATION_ABS_MIN,
      memberSplit: memberStdev !== null && memberStdev >= MEMBER_SPLIT_MIN,
      medianGap:
        signedMean !== null &&
        medianDiff !== null &&
        Math.abs(signedMean - medianDiff) >= MEDIAN_GAP_MIN,
    };

    return {
      dimension: dim,
      itemCount: dimItemIndexes.length,
      naItemCount: naItemIndexes.length,
      observationCount: diffs.length,
      absMean: round2(absMean),
      signedMean: round2(signedMean),
      medianDiff: round2(medianDiff),
      memberStdev: round2(memberStdev),
      flags,
      reading: readDimension({ absMean, signedMean, flags, hasData: diffs.length > 0 }),
    };
  });

  // 기본 정렬: 절댓값 평균 오름차순(일치 → 불일치). 데이터 없는 지표는 맨 뒤.
  return rows.sort((a, b) => {
    if (a.absMean === null && b.absMean === null) return 0;
    if (a.absMean === null) return 1;
    if (b.absMean === null) return -1;
    return a.absMean - b.absMean;
  });
}

/** 지표 한 줄 읽기 문구. 심각한 신호부터 우선 표시한다. */
function readDimension({ absMean, signedMean, flags, hasData }) {
  if (!hasData) return "AI가 판단하지 못해 비교할 수 없음";
  if (flags.cancellation) return "판단이 정반대로 갈림 (평균이 상쇄됨)";
  if (flags.memberSplit) return "모둠원끼리 갈림";
  if (flags.medianGap) return "한 명이 유독 다르게 봄";
  if (absMean !== null && absMean < 0.5) return "대체로 일치";
  if (signedMean > 0) return "AI보다 후하게 봄";
  if (signedMean < 0) return "AI보다 박하게 봄";
  return "대체로 일치";
}

/* ===================== 원자료 행렬 (모둠 내 편차 뷰) ===================== */

/**
 * 항목 × 모둠원 점수 행렬 + AI 점수 + 항목별 |차이| 평균.
 * "누가 어떻게 봤는지" 원자료를 그대로 보여주기 위한 것이라 어떤 요약도 하지 않는다.
 */
export function buildScoreMatrix(items = [], aiResults = [], members = []) {
  const observations = buildObservations(items, aiResults, members);
  const memberList = (members ?? []).map((m) => ({ uid: m.uid, name: m.name ?? "이름없음" }));

  const rows = items.map((item, i) => {
    const cells = memberList.map((m) => {
      const o = observations.find((x) => x.itemIndex === i && x.uid === m.uid);
      return { uid: m.uid, score: o ? o.studentScore : null };
    });
    const itemObs = observations.filter((o) => o.itemIndex === i);
    const aiScore = itemObs.length ? itemObs[0].aiScore : null;
    const diffs = itemObs.filter((o) => o.diff !== null).map((o) => Math.abs(o.diff));
    return {
      itemIndex: i,
      question: item?.question ?? "",
      dimension: item?.dimension ?? null,
      cells,
      aiScore,
      absDiffMean: diffs.length ? round2(mean(diffs)) : null,
      memberStdev: cells.filter((c) => c.score !== null).length >= 2
        ? round2(stdev(cells.filter((c) => c.score !== null).map((c) => c.score)))
        : null,
    };
  });

  return { members: memberList, rows };
}

/* ===================== 원인 유형 집계 ===================== */

/**
 * 원인 유형(①~④)이 어느 지표에 몰려 있는지 분포.
 * @param {Array<{items: Record<string, {type:string, note:string}>}>} tagDocs cause_tags 문서들
 * @param {Array<{dimension:string|null}>} items 체크리스트 스냅샷
 * @returns {{byDimension: Record<string, Record<string, number>>, byType: Record<string, number>, total: number}}
 */
export function aggregateCauseTags(tagDocs = [], items = []) {
  const byDimension = {};
  const byType = {};
  let total = 0;

  for (const d of DIMENSIONS) byDimension[d] = {};

  for (const doc of tagDocs ?? []) {
    const entries = doc?.items ?? {};
    for (const [idxRaw, tag] of Object.entries(entries)) {
      const type = tag?.type;
      if (!type) continue;
      const idx = Number(idxRaw);
      const dim = items[idx]?.dimension ?? null;
      total += 1;
      byType[type] = (byType[type] ?? 0) + 1;
      if (dim && byDimension[dim]) {
        byDimension[dim][type] = (byDimension[dim][type] ?? 0) + 1;
      }
    }
  }
  return { byDimension, byType, total };
}

/* ===================== 학급 집계 (교사용) ===================== */

/**
 * 여러 모둠의 관측치를 지표 단위로 합친다. **교사 등록 공통 자료에만 적용**한다.
 *
 * ⚠️ 모둠마다 체크리스트가 다르므로, 이 값은 "각 모둠이 **자기 도구로** 채점했을 때
 *    AI와 얼마나 벌어졌는가"를 지표 단위로 모은 것이다. 모둠 간 우열 비교가 아니라
 *    "어떤 지표가 사람 판단을 요구하는가"를 읽는 용도다.
 *
 * @param {Array<{groupId, groupName, items, aiResults, members}>} groupData
 */
export function computeClassStats(groupData = []) {
  const perDimensionDiffs = {};
  for (const d of DIMENSIONS) perDimensionDiffs[d] = [];

  const perGroup = [];
  let studentSet = new Set();

  for (const g of groupData) {
    const obs = buildObservations(g.items, g.aiResults, g.members);
    const scored = obs.filter((o) => o.diff !== null);
    for (const o of scored) {
      if (o.dimension && perDimensionDiffs[o.dimension]) {
        perDimensionDiffs[o.dimension].push(o.diff);
      }
    }
    for (const m of g.members ?? []) studentSet.add(`${g.groupId}:${m.uid}`);
    const absAll = scored.map((o) => Math.abs(o.diff));
    perGroup.push({
      groupId: g.groupId,
      groupName: g.groupName,
      memberCount: (g.members ?? []).length,
      absMean: absAll.length ? round2(mean(absAll)) : null,
    });
  }

  const byDimension = DIMENSIONS.map((d) => {
    const diffs = perDimensionDiffs[d];
    return {
      dimension: d,
      observationCount: diffs.length,
      absMean: diffs.length ? round2(mean(diffs.map(Math.abs))) : null,
      signedMean: diffs.length ? round2(mean(diffs)) : null,
    };
  }).sort((a, b) => {
    if (a.absMean === null && b.absMean === null) return 0;
    if (a.absMean === null) return 1;
    if (b.absMean === null) return -1;
    return b.absMean - a.absMean; // 학급 집계는 "사람이 봐야 하는 지표"를 위로
  });

  return {
    byDimension,
    perGroup,
    groupCount: groupData.length,
    studentCount: studentSet.size,
  };
}

/* ===================== CSV ===================== */

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * 학생별·항목별 원자료 + 원인 유형 + 성찰 답변까지 한 파일로.
 * 한글 Excel에서 깨지지 않도록 호출부에서 UTF-8 BOM을 붙인다.
 */
export function buildCsv({ groupName, medias, reflectionAnswers = [] }) {
  const lines = [];
  lines.push(
    [
      "모둠",
      "학번uid",
      "이름",
      "자료",
      "항목번호",
      "질문",
      "지표",
      "학생점수",
      "AI점수",
      "차이",
      "차이절댓값",
      "원인유형",
      "원인서술",
    ].join(",")
  );

  for (const media of medias ?? []) {
    const obs = buildObservations(media.items, media.aiResults, media.members);
    const tagByUid = new Map((media.causeTags ?? []).map((t) => [t.uid, t.items ?? {}]));
    for (const o of obs) {
      const tag = tagByUid.get(o.uid)?.[String(o.itemIndex)] ?? tagByUid.get(o.uid)?.[o.itemIndex];
      lines.push(
        [
          groupName,
          o.uid,
          o.name,
          media.title,
          o.itemIndex + 1,
          o.question,
          o.dimension ?? "",
          o.studentScore,
          o.aiScore ?? "N/A",
          o.diff ?? "",
          o.diff === null ? "" : Math.abs(o.diff),
          tag?.type ?? "",
          tag?.note ?? "",
        ]
          .map(csvCell)
          .join(",")
      );
    }
  }

  if (reflectionAnswers.length) {
    lines.push("");
    lines.push(["모둠", "학번uid", "이름", "문항", "답변"].join(","));
    for (const a of reflectionAnswers) {
      for (const [qKey, text] of Object.entries(a.answers ?? {})) {
        lines.push([groupName, a.uid, a.name, qKey, text].map(csvCell).join(","));
      }
    }
  }

  return lines.join("\n");
}

/** 브라우저에서 CSV 파일 다운로드 (UTF-8 BOM 포함 — 한글 Excel 호환). */
export function downloadCsv(filename, csv) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
