/**
 * 순차 게이트 판정 로직 (순수 함수).
 *
 * 화면에서 분리해 둔 이유: "언제 다음 단계가 열리는가"는 수업 진행을 좌우하는 규칙이라
 * 단위 테스트로 고정해두어야 한다. 컴포넌트 안에 있으면 검증할 방법이 없다.
 */

import { DIMENSIONS, DIMENSION_INFO } from "./hpfm.js";
import { RECOMMENDED_ITEMS_PER_DIMENSION } from "../constants/lesson.js";

/**
 * AI 제안과 학생 선택을 분리한다.
 *
 * v5.0까지는 AI 분류 결과가 `dimension`에 바로 들어가 있었다. 그대로 두면 1단계 화면에서
 * "이미 선택된 상태"가 되어 학생이 그냥 넘겨버린다. 그래서 AI 결과를 aiSuggestedDimension으로
 * 옮기고 dimension은 비운다. **Gemini 재호출은 없다**(기존 분류를 그대로 재활용).
 *
 * 이미 분리된 항목(aiSuggestedDimension 보유)은 건드리지 않는다 — 멱등.
 */
export function splitAiSuggestion(items = []) {
  return items.map((it) => {
    if (it?.aiSuggestedDimension) return { ...it };
    return {
      ...it,
      aiSuggestedDimension: it?.dimension ?? null,
      aiConfidence: it?.dimensionConfidence ?? null,
      aiReason: it?.dimensionReason ?? "",
      dimension: null,
    };
  });
}

/** 지표별 배정된 문항 수. */
export function dimensionCounts(items = []) {
  const counts = Object.fromEntries(DIMENSIONS.map((d) => [d, 0]));
  for (const it of items) {
    if (counts[it?.dimension] !== undefined) counts[it.dimension] += 1;
  }
  return counts;
}

/**
 * 1단계 게이트 판정.
 *
 * 열리는 조건:
 *  · 모든 항목에 지표가 선택되어 있고
 *  · AI 제안과 다르게 고른 항목에는 사유가 적혀 있고
 *  · 5개 지표 각각에 문항이 1개 이상 있다
 *
 * 문항이 0개인 지표는 **성찰 기록이 먼저**여야 한다(보충 문항보다 앞선다).
 * 1문항짜리 지표는 통과시키되 경고만 낸다.
 *
 * @param {Array} items 체크리스트 항목
 * @param {Record<string,{reason?:string}>} reflectionsByDim 지표별 성찰 기록
 * @returns {{blockers:string[], warnings:string[], counts, emptyDims, thinDims,
 *            unassignedIndexes, missingReasonIndexes, ready:boolean}}
 */
export function assignGate(items = [], reflectionsByDim = {}) {
  const counts = dimensionCounts(items);
  const emptyDims = DIMENSIONS.filter((d) => counts[d] === 0);
  const thinDims = DIMENSIONS.filter(
    (d) => counts[d] > 0 && counts[d] < RECOMMENDED_ITEMS_PER_DIMENSION
  );

  const unassignedIndexes = [];
  const missingReasonIndexes = [];
  items.forEach((it, i) => {
    if (!it?.dimension) {
      unassignedIndexes.push(i);
      return;
    }
    const ai = it?.aiSuggestedDimension;
    if (ai && it.dimension !== ai && !String(it.disagreeReason ?? "").trim()) {
      missingReasonIndexes.push(i);
    }
  });

  const blockers = [];
  if (items.length === 0) blockers.push("체크리스트에 항목이 없어요");
  if (unassignedIndexes.length) {
    blockers.push(
      `지표 미선택 항목 ${unassignedIndexes.length}개 (항목 ${unassignedIndexes
        .map((i) => i + 1)
        .join("·")})`
    );
  }
  if (missingReasonIndexes.length) {
    blockers.push(
      `AI와 다르게 판단한 사유 미작성 ${missingReasonIndexes.length}개 (항목 ${missingReasonIndexes
        .map((i) => i + 1)
        .join("·")})`
    );
  }
  for (const d of emptyDims) {
    const hasReason = String(reflectionsByDim[d]?.reason ?? "").trim().length > 0;
    blockers.push(
      hasReason
        ? `${d} ${DIMENSION_INFO[d].name}: 보충 문항 작성 필요`
        : `${d} ${DIMENSION_INFO[d].name}: 빠뜨린 이유 기록 → 보충 문항 순으로 진행`
    );
  }

  const warnings = thinDims.map(
    (d) =>
      `${d} ${DIMENSION_INFO[d].name}는 1문항이에요. 그 항목 하나가 지표 점수를 그대로 결정하므로 결과가 흔들리기 쉬워요.`
  );

  return {
    blockers,
    warnings,
    counts,
    emptyDims,
    thinDims,
    unassignedIndexes,
    missingReasonIndexes,
    ready: blockers.length === 0,
  };
}

/**
 * 2단계 게이트 판정. 자료는 교사 1건 + 모둠 1건이 있어야 하고, 다음 단계는 조장이 연다.
 */
export function mediaGate({ teacherCount, groupCount, isLeader }) {
  const blockers = [];
  if (teacherCount === 0) {
    blockers.push("선생님이 아직 공통 자료를 등록하지 않았어요 (선생님을 기다려주세요)");
  }
  if (groupCount === 0) {
    blockers.push(
      isLeader ? "우리 모둠 자료 1건을 등록해주세요" : "조장이 우리 모둠 자료를 등록해야 해요"
    );
  }
  if (blockers.length === 0 && !isLeader) {
    blockers.push("다음 단계는 조장이 열 수 있어요");
  }
  return { blockers, ready: blockers.length === 0 };
}

/**
 * 3단계 제출 현황. mediaCount건을 모두 제출(잠금)한 사람만 '완료'로 센다.
 *
 * @param {Array<{uid:string}>} members
 * @param {Array<{uid:string, mediaId:string, locked:boolean}>} blindScores
 * @param {number} mediaCount
 */
export function submissionStatus(members = [], blindScores = [], mediaCount = 2) {
  const counts = new Map();
  for (const s of blindScores) {
    if (!s?.locked) continue;
    counts.set(s.uid, (counts.get(s.uid) ?? 0) + 1);
  }
  const submitted = [];
  const pending = [];
  for (const m of members) {
    const c = counts.get(m.uid) ?? 0;
    (c >= mediaCount ? submitted : pending).push({ ...m, done: c });
  }
  return {
    submitted,
    pending,
    submittedCount: submitted.length,
    total: members.length,
    allDone: members.length > 0 && pending.length === 0,
  };
}
