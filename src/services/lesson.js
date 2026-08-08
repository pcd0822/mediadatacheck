import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { FIRST_STAGE } from "../constants/lesson.js";

/**
 * 수업 활동(순차 게이트) 데이터 접근 계층. **모둠 작업실 전용**이다.
 *
 *   groups/{gid}/progress/current            진행 단계 + 3단계 포함/제외 명단 + 4단계 AI 결과 id
 *   groups/{gid}/reflections/{V1..V5}        1단계 "이 지표를 빠뜨린 이유"
 *   groups/{gid}/blind_scores/{uid}__{mid}   3단계 잠금 점수
 *   groups/{gid}/cause_tags/{uid}__{mid}     4단계 원인 유형 + 서술
 *   groups/{gid}/reflection_answers/{uid}    4단계 성찰 3문항
 *
 * AI 채점 결과 자체는 기존 factcheck_history를 그대로 재사용하고,
 * progress.stage4.aiHistoryIds 에 미디어별 historyId만 연결한다.
 */

const scoreKey = (uid, mediaId) => `${uid}__${mediaId}`;

/* ====================== progress ====================== */

function progressRef(groupId) {
  return doc(db, "groups", groupId, "progress", "current");
}

export const EMPTY_PROGRESS = {
  stage: FIRST_STAGE,
  stage1: null,
  stage2: null,
  stage3: null,
  stage4: null,
  checklistSnapshot: null,
  checklistId: null,
};

export async function getProgress(groupId) {
  const snap = await getDoc(progressRef(groupId));
  return snap.exists() ? { ...EMPTY_PROGRESS, ...snap.data() } : { ...EMPTY_PROGRESS };
}

export function subscribeProgress(groupId, cb, onError) {
  return onSnapshot(
    progressRef(groupId),
    (snap) => cb(snap.exists() ? { ...EMPTY_PROGRESS, ...snap.data() } : { ...EMPTY_PROGRESS }),
    onError
  );
}

/**
 * 단계 완료 → 다음 단계 열기. 트랜잭션으로 처리해 모둠원이 동시에 눌러도
 * 단계가 뒤로 밀리지 않게 한다(이미 더 진행됐으면 그대로 둔다).
 */
export async function completeStage(groupId, stage, extra = {}) {
  const ref = progressRef(groupId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? snap.data() : { ...EMPTY_PROGRESS };
    const nextStage = Math.max(Number(cur.stage ?? FIRST_STAGE), stage + 1);
    const patch = {
      stage: nextStage,
      [`stage${stage}`]: {
        ...(cur[`stage${stage}`] ?? {}),
        ...extra,
        completedAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    };
    tx.set(ref, patch, { merge: true });
    return nextStage;
  });
}

/**
 * 동결된 체크리스트 스냅샷을 돌려준다. 없으면 지금 동결하고 돌려준다.
 *
 * 보통은 3단계 진입 시 동결되지만, 교사가 학생보다 먼저 단계를 강제 진행하면
 * 스냅샷 없이 4단계에 도달할 수 있다. 그 경우에도 화면이 비지 않도록 여기서 메운다.
 *
 * @param {{type:string,id:string}} ws 워크스페이스 디스크립터
 * @param {object} progress 현재 progress 문서
 * @param {function(object): Promise<Array>} loadChecklists ws를 받아 체크리스트 목록을 주는 함수
 * @returns {Promise<{items:Array, checklistId:string|null}>}
 */
export async function ensureChecklistSnapshot(ws, progress, loadChecklists) {
  const existing = progress?.checklistSnapshot;
  if (Array.isArray(existing) && existing.length > 0) {
    return { items: existing, checklistId: progress?.checklistId ?? null };
  }
  const lists = await loadChecklists(ws);
  const target = lists.find((c) => c.id === progress?.checklistId) ?? lists[0] ?? null;
  if (!target) return { items: [], checklistId: null };
  const items = target.items ?? [];
  await freezeChecklist(ws.id, target.id, items).catch((e) =>
    console.error("체크리스트 동결 실패", e)
  );
  return { items, checklistId: target.id };
}

/** 3단계 시작 시 체크리스트를 동결한다. 이후 체크리스트를 고쳐도 통계가 흔들리지 않게. */
export async function freezeChecklist(groupId, checklistId, items) {
  await setDoc(
    progressRef(groupId),
    {
      checklistId,
      checklistSnapshot: items,
      frozenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** 4단계 진입 기록 — AI 채점 결과 id와 통계 포함/제외 명단을 확정한다. */
export async function recordStage3Close(groupId, { includedUids, excludedUids, forcedBy }) {
  await setDoc(
    progressRef(groupId),
    {
      stage: Math.max(4, 4),
      stage3: {
        includedUids,
        excludedUids,
        forcedBy: forcedBy ?? null,
        closedAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function recordAiResult(groupId, mediaId, historyId) {
  await setDoc(
    progressRef(groupId),
    {
      stage4: { aiHistoryIds: { [mediaId]: historyId }, aiRunAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** 교사가 수업을 처음부터 다시 돌리고 싶을 때 (진행 상태만 초기화). */
export async function resetProgress(groupId) {
  await setDoc(
    progressRef(groupId),
    {
      stage: FIRST_STAGE,
      stage1: deleteField(),
      stage2: deleteField(),
      stage3: deleteField(),
      stage4: deleteField(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/* ====================== 1단계 · 빠뜨린 지표 성찰 ====================== */

export async function saveGapReflection(groupId, dimension, { reason, uid, name }) {
  await setDoc(
    doc(db, "groups", groupId, "reflections", dimension),
    {
      dimension,
      reason,
      writtenBy: uid,
      writtenByName: name ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function listGapReflections(groupId) {
  const snap = await getDocs(collection(db, "groups", groupId, "reflections"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeGapReflections(groupId, cb, onError) {
  return onSnapshot(
    collection(db, "groups", groupId, "reflections"),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

/* ====================== 3단계 · 블라인드 점수 ====================== */

export async function getMyBlindScore(groupId, uid, mediaId) {
  const snap = await getDoc(
    doc(db, "groups", groupId, "blind_scores", scoreKey(uid, mediaId))
  );
  return snap.exists() ? snap.data() : null;
}

/** 임시 저장(미제출). 제출 후에는 잠기므로 호출부에서 locked를 먼저 확인한다. */
export async function saveBlindDraft(groupId, { uid, name, mediaId, checklistId, scores }) {
  await setDoc(
    doc(db, "groups", groupId, "blind_scores", scoreKey(uid, mediaId)),
    {
      uid,
      name: name ?? null,
      mediaId,
      checklistId: checklistId ?? null,
      scores,
      submitted: false,
      locked: false,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * 제출 → 잠금. 트랜잭션으로 이미 잠긴 문서의 재제출을 막는다.
 * 제출 시각(submittedAt)은 서버 시간으로 기록한다.
 */
export async function submitBlindScore(groupId, { uid, name, mediaId, checklistId, scores }) {
  const ref = doc(db, "groups", groupId, "blind_scores", scoreKey(uid, mediaId));
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data().locked === true) {
      throw new Error("이미 제출해 잠긴 점수예요. 수정할 수 없습니다.");
    }
    tx.set(
      ref,
      {
        uid,
        name: name ?? null,
        mediaId,
        checklistId: checklistId ?? null,
        scores,
        submitted: true,
        locked: true,
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  });
}

export async function listBlindScores(groupId) {
  const snap = await getDocs(collection(db, "groups", groupId, "blind_scores"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeBlindScores(groupId, cb, onError) {
  return onSnapshot(
    collection(db, "groups", groupId, "blind_scores"),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

/* ====================== 4단계 · 원인 유형 태그 ====================== */

export function subscribeMyCauseTags(groupId, uid, mediaId, cb, onError) {
  return onSnapshot(
    doc(db, "groups", groupId, "cause_tags", scoreKey(uid, mediaId)),
    (snap) => cb(snap.exists() ? snap.data() : null),
    onError
  );
}

/** 항목 하나의 원인 유형·서술을 저장(부분 갱신). */
export async function saveCauseTag(groupId, { uid, name, mediaId, itemIndex, type, note }) {
  await setDoc(
    doc(db, "groups", groupId, "cause_tags", scoreKey(uid, mediaId)),
    {
      uid,
      name: name ?? null,
      mediaId,
      items: { [String(itemIndex)]: { type: type ?? null, note: note ?? "" } },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function listCauseTags(groupId) {
  const snap = await getDocs(collection(db, "groups", groupId, "cause_tags"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeCauseTags(groupId, cb, onError) {
  return onSnapshot(
    collection(db, "groups", groupId, "cause_tags"),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

/* ====================== 4단계 · 성찰 답변 ====================== */

export async function getMyReflectionAnswers(groupId, uid) {
  const snap = await getDoc(doc(db, "groups", groupId, "reflection_answers", uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveReflectionAnswers(groupId, { uid, name, answers }) {
  await setDoc(
    doc(db, "groups", groupId, "reflection_answers", uid),
    {
      uid,
      name: name ?? null,
      answers,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function listReflectionAnswers(groupId) {
  const snap = await getDocs(collection(db, "groups", groupId, "reflection_answers"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ====================== 교사용 — 전체 모둠 조회 ====================== */

/** 교사 현황판: 모든 모둠 + 진행 상태 + 멤버 수 + 제출 수. */
export async function listAllGroupsWithProgress() {
  const groupsSnap = await getDocs(collection(db, "groups"));
  const out = [];
  for (const g of groupsSnap.docs) {
    const groupId = g.id;
    const [progressSnap, membersSnap, scoresSnap] = await Promise.all([
      getDoc(progressRef(groupId)),
      getDocs(collection(db, "groups", groupId, "members")),
      getDocs(collection(db, "groups", groupId, "blind_scores")),
    ]);
    const members = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    const scores = scoresSnap.docs.map((d) => d.data());
    out.push({
      groupId,
      groupName: g.data().groupName ?? "모둠",
      leaderUid: g.data().leaderUid ?? null,
      progress: progressSnap.exists()
        ? { ...EMPTY_PROGRESS, ...progressSnap.data() }
        : { ...EMPTY_PROGRESS },
      members,
      blindScores: scores,
    });
  }
  return out;
}

/** 모둠 상세(교사 열람): 체크리스트·성찰·점수·태그·답변 한 번에. */
export async function getGroupDetailForTeacher(groupId) {
  const [checklists, reflections, scores, tags, answers, progress] = await Promise.all([
    getDocs(collection(db, "groups", groupId, "checklists")),
    getDocs(collection(db, "groups", groupId, "reflections")),
    getDocs(collection(db, "groups", groupId, "blind_scores")),
    getDocs(collection(db, "groups", groupId, "cause_tags")),
    getDocs(collection(db, "groups", groupId, "reflection_answers")),
    getDoc(progressRef(groupId)),
  ]);
  return {
    checklists: checklists.docs.map((d) => ({ id: d.id, ...d.data() })),
    reflections: reflections.docs.map((d) => ({ id: d.id, ...d.data() })),
    blindScores: scores.docs.map((d) => ({ id: d.id, ...d.data() })),
    causeTags: tags.docs.map((d) => ({ id: d.id, ...d.data() })),
    reflectionAnswers: answers.docs.map((d) => ({ id: d.id, ...d.data() })),
    progress: progress.exists()
      ? { ...EMPTY_PROGRESS, ...progress.data() }
      : { ...EMPTY_PROGRESS },
  };
}

/** 모둠 factcheck_history 문서 1건 (AI 채점 결과) 읽기 — 교사·학생 공통. */
export async function getGroupFactCheck(groupId, historyId) {
  const snap = await getDoc(doc(db, "groups", groupId, "factcheck_history", historyId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ====================== 1단계 · 체크리스트 지표 배정 ======================
 * AI 제안 분리(splitAiSuggestion)와 게이트 판정은 순수 함수라 utils/lessonGates.js 에 있다.
 */

export async function saveChecklistItems(groupId, checklistId, items, { uid, name }) {
  await updateDoc(doc(db, "groups", groupId, "checklists", checklistId), {
    items,
    lastEditedBy: uid,
    lastEditedName: name ?? null,
    updatedAt: serverTimestamp(),
  });
}
