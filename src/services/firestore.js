import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { MODEL_VERSION, STANDARD_BASIS } from "../constants/model.js";

/* ====================== 워크스페이스 추상화 ======================
 * 개인(users/{uid})과 모둠(groups/{groupId}) 작업실을 같은 함수로 다루기 위한 디스크립터.
 *   ws = { type: "user" | "group", id }
 * 하위호환: uid 문자열을 그대로 넘기면 개인 작업실로 처리.
 */
function wsSegments(ws) {
  if (typeof ws === "string") return ["users", ws];
  if (ws && ws.type === "group" && ws.id) return ["groups", ws.id];
  if (ws && ws.id) return ["users", ws.id];
  throw new Error("유효하지 않은 워크스페이스");
}
function wsCol(ws, ...rest) {
  return collection(db, ...wsSegments(ws), ...rest);
}
function wsDoc(ws, ...rest) {
  return doc(db, ...wsSegments(ws), ...rest);
}

/* ====================== config/teacher (교사 인증 코드 게이트, 프로젝트 단위) ======================
 * "교사당 Firebase 1개" 모델: 이 프로젝트(=이 Firebase)의 교사 접근 코드를 단일 문서에 보관한다.
 * - 첫 교사가 setByUid로 생성하고, 이후 교사 추가는 이 코드를 알아야 가능(클라이언트 검증).
 * - 평문이 아니라 salt+SHA-256 해시만 저장한다(소프트 게이트). 해시 생성은 utils/teacherCode.js.
 */
export async function getTeacherAuthConfig() {
  const snap = await getDoc(doc(db, "config", "teacher"));
  return snap.exists() ? snap.data() : null;
}

/** 최초 1회 설정(문서가 없을 때). 규칙상 setByUid는 본인이어야 한다. */
export async function createTeacherAuthConfig({ uid, email, salt, codeHash }) {
  await setDoc(doc(db, "config", "teacher"), {
    salt,
    codeHash,
    setByUid: uid,
    setByEmail: email ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** 로그인한 교사가 코드 변경. 규칙상 isTeacher()만 허용. */
export async function updateTeacherAuthCode({ salt, codeHash }) {
  await setDoc(
    doc(db, "config", "teacher"),
    { salt, codeHash, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/* ====================== media_items (교사가 등록, 전역) ====================== */

export async function createMediaItem(teacherUid, data) {
  const ref = await addDoc(collection(db, "media_items"), {
    title: data.title,
    content: data.content,
    link: data.link ?? "",
    thumbnailUrl: data.thumbnailUrl ?? "",
    uploadedBy: teacherUid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listMediaItems() {
  const q = query(collection(db, "media_items"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getMediaItem(mediaId) {
  const snap = await getDoc(doc(db, "media_items", mediaId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateMediaItem(mediaId, data) {
  const patch = {
    title: data.title,
    content: data.content,
    link: data.link ?? "",
    updatedAt: serverTimestamp(),
  };
  if (data.thumbnailUrl !== undefined) {
    patch.thumbnailUrl = data.thumbnailUrl;
  }
  await updateDoc(doc(db, "media_items", mediaId), patch);
}

export async function deleteMediaItem(mediaId) {
  await deleteDoc(doc(db, "media_items", mediaId));
}

/* ====================== teacher_evaluation (전역) ====================== */

export async function setTeacherEvaluation(mediaId, evaluation) {
  const ref = doc(db, "media_items", mediaId, "teacher_evaluation", "default");
  await setDoc(
    ref,
    {
      items: evaluation.items,
      totalScore: evaluation.totalScore ?? null,
      dimensionScores: evaluation.dimensionScores ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getTeacherEvaluation(mediaId) {
  const ref = doc(db, "media_items", mediaId, "teacher_evaluation", "default");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/* ====================== checklists (워크스페이스 스코프) ====================== */

export async function listChecklists(ws) {
  const q = query(wsCol(ws, "checklists"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeChecklists(ws, cb, onError) {
  const q = query(wsCol(ws, "checklists"), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

export async function getChecklist(ws, checklistId) {
  const snap = await getDoc(wsDoc(ws, "checklists", checklistId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeChecklist(ws, checklistId, cb, onError) {
  return onSnapshot(
    wsDoc(ws, "checklists", checklistId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError
  );
}

export async function createChecklist(ws, data) {
  const ref = await addDoc(wsCol(ws, "checklists"), {
    checklistName: data.checklistName,
    items: data.items ?? [],
    lastEditedBy: data.lastEditedBy ?? null,
    lastEditedName: data.lastEditedName ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateChecklist(ws, checklistId, data) {
  await updateDoc(wsDoc(ws, "checklists", checklistId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteChecklist(ws, checklistId) {
  await deleteDoc(wsDoc(ws, "checklists", checklistId));
}

/* ====================== student_evaluations (미디어×학생, per-uid) ====================== */

export async function saveStudentEvaluation(mediaId, uid, evaluation) {
  const ref = doc(db, "media_items", mediaId, "student_evaluations", uid);
  await setDoc(
    ref,
    {
      items: evaluation.items,
      checklistId: evaluation.checklistId ?? null,
      dimensionScores: evaluation.dimensionScores ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getStudentEvaluation(mediaId, uid) {
  const ref = doc(db, "media_items", mediaId, "student_evaluations", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/* ====================== algorithm_model (VAPM-3.0, 워크스페이스 스코프) ====================== */

function buildModelDoc(model) {
  return {
    version: MODEL_VERSION,
    standard_basis: STANDARD_BASIS,
    weights: model.weights ?? null,
    mastery: model.mastery ?? null,
    checklistId: model.checklistId ?? null,
    trainingDataCount: model.trainingDataCount ?? 0,
    convergenceScore: model.convergenceScore ?? null,
    teacherImplicitWeights: model.teacherImplicitWeights ?? null,
    learningRate: model.learningRate ?? null,
    trainedAt: serverTimestamp(),
  };
}

export async function saveAlgorithmModel(ws, model) {
  await setDoc(wsDoc(ws, "algorithm_model", "current"), buildModelDoc(model), {
    merge: true,
  });
}

/**
 * 모델을 트랜잭션으로 read-modify-write.
 * 모둠 동시 수용/정교화 시 lost update를 막는다.
 * @param {function(object|null): object} computeNext 현재 모델 데이터를 받아 다음 모델 필드를 반환
 */
export async function updateAlgorithmModel(ws, computeNext) {
  const ref = wsDoc(ws, "algorithm_model", "current");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data() : null;
    const next = computeNext(current);
    tx.set(ref, buildModelDoc(next), { merge: true });
    return next;
  });
}

export async function getAlgorithmModel(ws) {
  const snap = await getDoc(wsDoc(ws, "algorithm_model", "current"));
  return snap.exists() ? snap.data() : null;
}

export function subscribeAlgorithmModel(ws, cb, onError) {
  return onSnapshot(
    wsDoc(ws, "algorithm_model", "current"),
    (snap) => cb(snap.exists() ? snap.data() : null),
    onError
  );
}

export async function appendTrainingData(ws, dataId, payload) {
  await setDoc(
    wsDoc(ws, "algorithm_model", "current", "training_data", dataId),
    { ...payload, addedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function listTrainingData(ws) {
  const snap = await getDocs(wsCol(ws, "algorithm_model", "current", "training_data"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ====================== feedback_cards (단일 문서, 쿼터 보호) ======================
 * 과거: 매 학습/수용마다 컬렉션 전체 delete + N개 addDoc (쓰기/삭제 폭풍).
 * 현재: feedback_cards/current 한 문서의 cards 배열을 setDoc 1회로 교체.
 * 카드는 파생/재생성 데이터라 기존 컬렉션 마이그레이션 불필요(다음 학습 시 재생성).
 */
export async function replaceFeedbackCards(ws, cards) {
  await setDoc(wsDoc(ws, "feedback_cards", "current"), {
    cards: Array.isArray(cards) ? cards : [],
    updatedAt: serverTimestamp(),
  });
}

export async function listFeedbackCards(ws) {
  const snap = await getDoc(wsDoc(ws, "feedback_cards", "current"));
  if (!snap.exists()) return [];
  const cards = snap.data().cards;
  return Array.isArray(cards) ? cards : [];
}

export function subscribeFeedbackCards(ws, cb, onError) {
  return onSnapshot(
    wsDoc(ws, "feedback_cards", "current"),
    (snap) => {
      const cards = snap.exists() && Array.isArray(snap.data().cards)
        ? snap.data().cards
        : [];
      cb(cards);
    },
    onError
  );
}

/* ====================== factcheck_history (워크스페이스 스코프) ====================== */

export async function saveFactCheckHistory(ws, payload) {
  const ref = await addDoc(wsCol(ws, "factcheck_history"), {
    ...payload,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getFactCheckHistory(ws, historyId) {
  const snap = await getDoc(wsDoc(ws, "factcheck_history", historyId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeFactCheckHistoryDoc(ws, historyId, cb, onError) {
  return onSnapshot(
    wsDoc(ws, "factcheck_history", historyId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError
  );
}

export async function updateFactCheckHistory(ws, historyId, patch) {
  await updateDoc(wsDoc(ws, "factcheck_history", historyId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 팩트체크 결과 1건과 결정적 ID로 묶인 학습 데이터를 함께 정리한다.
 * 모델 가중치(Bayesian 누적)는 되돌리지 않는다 — 정확한 롤백 불가. 마스터리·피드백 카드는
 * 다음 수용/정교화 시 listTrainingData 기반으로 자동 재계산된다.
 */
export async function deleteFactCheckHistory(ws, historyId) {
  await deleteDoc(wsDoc(ws, "factcheck_history", historyId));
  await deleteDoc(
    wsDoc(ws, "algorithm_model", "current", "training_data", `factcheck_${historyId}`)
  ).catch(() => {});
}

export async function listFactCheckHistory(ws) {
  const q = query(
    wsCol(ws, "factcheck_history"),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 무한 증가 컬렉션이라 limit로 묶어 변경당 전체 재읽기를 막는다. */
export function subscribeFactCheckHistory(ws, cb, opts = {}) {
  const max = opts.limit ?? 30;
  const q = query(
    wsCol(ws, "factcheck_history"),
    orderBy("createdAt", "desc"),
    limit(max)
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    opts.onError
  );
}

/* ====================== factcheck_runs (single-flight 조정) ======================
 * 한 미디어에 대한 Gemini 호출을 모둠 전체에서 1회로 제한한다.
 * runKey: 미디어를 식별하는 결정적 키(교사 미디어면 media_{id}, 아니면 본문 해시).
 */
const RUN_STALE_MS = 90_000;

/**
 * @returns {Promise<{role:"reuse"|"wait"|"run", historyId?:string, claimedByName?:string|null}>}
 */
export async function claimFactCheckRun(ws, runKey, runner) {
  const runRef = wsDoc(ws, "factcheck_runs", runKey);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(runRef);
    const now = Date.now();
    if (snap.exists()) {
      const d = snap.data();
      if (d.status === "done" && d.historyId) {
        return { role: "reuse", historyId: d.historyId };
      }
      const startedMs = d.startedAt?.toMillis ? d.startedAt.toMillis() : 0;
      if (d.status === "running" && startedMs && now - startedMs < RUN_STALE_MS) {
        return { role: "wait", claimedByName: d.claimedByName ?? null };
      }
    }
    tx.set(runRef, {
      status: "running",
      claimedByUid: runner.uid,
      claimedByName: runner.name ?? null,
      startedAt: serverTimestamp(),
      historyId: null,
    });
    return { role: "run" };
  });
}

export async function completeFactCheckRun(ws, runKey, historyId) {
  await setDoc(
    wsDoc(ws, "factcheck_runs", runKey),
    { status: "done", historyId, finishedAt: serverTimestamp() },
    { merge: true }
  );
}

/** 실패 시 claim 해제 → 다른 모둠원이 재시도 가능. */
export async function failFactCheckRun(ws, runKey) {
  await deleteDoc(wsDoc(ws, "factcheck_runs", runKey)).catch(() => {});
}

export function subscribeFactCheckRun(ws, runKey, cb, onError) {
  return onSnapshot(
    wsDoc(ws, "factcheck_runs", runKey),
    (snap) => cb(snap.exists() ? snap.data() : null),
    onError
  );
}

/* ====================== utils ====================== */

export async function listTeacherMediaWithTeacherEvals() {
  const items = await listMediaItems();
  const enriched = await Promise.all(
    items.map(async (m) => ({
      ...m,
      teacherEvaluation: await getTeacherEvaluation(m.id),
    }))
  );
  return enriched;
}
