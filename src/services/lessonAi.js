import {
  claimFactCheckRun,
  completeFactCheckRun,
  failFactCheckRun,
  mediaImageUrl,
  saveFactCheckHistory,
} from "./firestore.js";
import { evaluateMediaByChecklist } from "./gemini.js";
import { recordAiResult } from "./lesson.js";
import { MODEL_VERSION, STANDARD_BASIS } from "../constants/model.js";
import {
  aggregateItemsToDimensions,
  computeChecklistScore,
  normalizeItemResults,
} from "../utils/hpfm.js";

/**
 * 3단계가 닫힌 뒤 실행하는 AI 채점.
 *
 * - 자료당 Gemini 1회 호출. 모둠 전체에서 single-flight(factcheck_runs 트랜잭션)로 묶여
 *   모둠원이 동시에 화면을 열어도 호출은 한 번만 나간다.
 * - 결과는 기존 factcheck_history 구조를 그대로 재사용해 저장하고,
 *   progress.stage4.aiHistoryIds 에 미디어별 historyId를 연결한다.
 * - 이미 실행된 자료는 건너뛴다(멱등).
 *
 * @returns {Promise<Record<string,string>>} { [mediaId]: historyId }
 */
export async function runLessonAi(ws, { medias, items, checklistId, user, existing = {} }) {
  const out = { ...existing };

  for (const media of medias) {
    if (out[media.id]) continue; // 이미 채점됨

    const runKey = `lesson_${media.id}_${checklistId ?? "none"}`;
    const decision = await claimFactCheckRun(ws, runKey, {
      uid: user.uid,
      name: user.displayName ?? null,
    });

    if (decision.role === "reuse") {
      out[media.id] = decision.historyId;
      await recordAiResult(ws.id, media.id, decision.historyId);
      continue;
    }
    if (decision.role === "wait") {
      // 다른 모둠원이 실행 중 — 이 자료는 건너뛰고 구독으로 결과를 받는다.
      continue;
    }

    try {
      const payload = {
        title: media.title ?? "",
        subtitle: media.subtitle ?? "",
        content: media.content ?? "",
        link: media.link ?? "",
        publisher: media.publisher ?? "",
        publishedAt: media.publishedAt ?? "",
        imageUrl: mediaImageUrl(media),
      };
      const aiResults = await evaluateMediaByChecklist(payload, items);
      const itemResults = normalizeItemResults(items, aiResults);
      const score = computeChecklistScore(itemResults);

      const historyId = await saveFactCheckHistory(ws, {
        media: { ...payload, mediaItemId: media.id },
        checklistId: checklistId ?? null,
        checklistSnapshot: items,
        itemResults,
        rawScore: score.rawScore,
        maxScore: score.maxScore,
        percent: score.percent,
        band: score.band,
        itemAlert: score.itemAlert,
        alertIndexes: score.alertIndexes,
        naCount: score.naCount,
        scoredCount: score.scoredCount,
        dimensionAverages: aggregateItemsToDimensions(itemResults),
        createdByUid: user.uid,
        createdByName: user.displayName ?? null,
        version: MODEL_VERSION,
        standard_basis: STANDARD_BASIS,
        lessonMediaId: media.id, // 수업 활동에서 만들어진 결과임을 표시
      });

      await completeFactCheckRun(ws, runKey, historyId);
      await recordAiResult(ws.id, media.id, historyId);
      out[media.id] = historyId;
    } catch (e) {
      await failFactCheckRun(ws, runKey); // claim 해제 → 재시도 가능
      throw e;
    }
  }

  return out;
}
