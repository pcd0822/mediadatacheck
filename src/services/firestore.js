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
  where,
} from "firebase/firestore";
import { db } from "../firebase.js";

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

/* ====================== media_items ======================
 * v5.0에서 등록 주체가 둘로 늘었다.
 *   registeredBy: "teacher" → 전 학급 공통 자료(isRequired: true). 모두 열람·평가 가능.
 *   registeredBy: "group"   → 그 모둠(groupId)만 열람·평가 가능. 조장만 등록/수정/삭제.
 *
 * ⚠️ Firestore 보안 규칙은 쿼리 필터가 아니다. 모둠 자료를 규칙으로 격리하려면
 *    클라이언트 쿼리도 반드시 registeredBy / groupId로 좁혀야 한다. 그래서 목록 조회는
 *    "교사 자료"와 "내 모둠 자료" 두 갈래로 나뉜다.
 * ⚠️ where + orderBy 조합은 복합 인덱스를 요구하므로(수동 배포 단계 추가) 정렬은
 *    클라이언트에서 처리한다. 학급 단위 컬렉션이라 문서 수가 적다.
 */

/** 미디어 본문 필드. 등록 주체 메타(registeredBy/groupId/isRequired)와 분리해 다룬다. */
function buildMediaPayload(data) {
  return {
    title: data.title ?? "",
    subtitle: data.subtitle ?? "",
    content: data.content ?? "",
    // v4.0까지의 필드명은 thumbnailUrl이었다. v5.0 정식 필드는 imageUrl이고,
    // 읽을 때는 mediaImageUrl()로 두 필드를 함께 본다(기존 문서 보존).
    imageUrl: data.imageUrl ?? "",
    publishedAt: data.publishedAt ?? "", // "YYYY-MM-DD" 문자열(입력값 그대로, 검증하지 않음)
    publisher: data.publisher ?? "",
    link: data.link ?? "",
  };
}

/** 기존 문서(thumbnailUrl)와 v5.0 문서(imageUrl)를 함께 읽기 위한 헬퍼. */
export function mediaImageUrl(media) {
  return media?.imageUrl || media?.thumbnailUrl || "";
}

function sortByCreatedDesc(list) {
  return [...list].sort((a, b) => {
    const at = a.createdAt?.toMillis?.() ?? 0;
    const bt = b.createdAt?.toMillis?.() ?? 0;
    return bt - at;
  });
}

/**
 * 미디어 등록.
 * @param {{uid:string, registeredBy:"teacher"|"group", groupId?:string}} author
 */
export async function createMediaItem(author, data) {
  const isTeacher = author.registeredBy === "teacher";
  if (!isTeacher && !author.groupId) {
    throw new Error("모둠 자료를 등록하려면 모둠 작업실이 필요해요.");
  }
  const ref = await addDoc(collection(db, "media_items"), {
    ...buildMediaPayload(data),
    registeredBy: isTeacher ? "teacher" : "group",
    groupId: isTeacher ? null : author.groupId,
    isRequired: isTeacher, // 교사 자료 = 학급 공통 필수
    uploadedBy: author.uid,
    uploadedByName: author.name ?? null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateMediaItem(mediaId, data) {
  await updateDoc(doc(db, "media_items", mediaId), {
    ...buildMediaPayload(data),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteMediaItem(mediaId) {
  await deleteDoc(doc(db, "media_items", mediaId));
}

export async function getMediaItem(mediaId) {
  const snap = await getDoc(doc(db, "media_items", mediaId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** 학급 공통(교사 등록) 자료. 학생·교사 모두 열람 가능. */
export async function listTeacherMediaItems() {
  const snap = await getDocs(
    query(collection(db, "media_items"), where("registeredBy", "==", "teacher"))
  );
  return sortByCreatedDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

/** 특정 모둠이 등록한 자료. 규칙상 그 모둠원만 읽을 수 있다. */
export async function listGroupMediaItems(groupId) {
  if (!groupId) return [];
  const snap = await getDocs(
    query(collection(db, "media_items"), where("groupId", "==", groupId))
  );
  return sortByCreatedDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

/**
 * 교사 대시보드용 — 내가 올린 자료 전부(registeredBy가 없는 v4.0 이전 문서 포함).
 * 학생 목록 쿼리는 registeredBy로 좁히므로, 옛 문서는 backfillLegacyMediaItems()로
 * 한 번 메타를 채워야 학생 화면에 다시 나타난다.
 */
export async function listMediaItemsByUploader(uid) {
  const snap = await getDocs(
    query(collection(db, "media_items"), where("uploadedBy", "==", uid))
  );
  return sortByCreatedDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

/**
 * v4.0 이전 문서에 v5.0 등록 메타를 채운다(일회성, 멱등).
 * 교사 대시보드 진입 시 1회 실행되며, 이미 채워진 문서는 건드리지 않는다.
 * @returns {Promise<number>} 실제로 갱신한 문서 수
 */
export async function backfillLegacyMediaItems(items) {
  const targets = (items ?? []).filter((m) => !m.registeredBy);
  for (const m of targets) {
    await updateDoc(doc(db, "media_items", m.id), {
      registeredBy: "teacher",
      groupId: null,
      isRequired: true,
      // 옛 썸네일을 v5.0 정식 필드로 옮긴다(원본 필드는 남겨둠).
      imageUrl: m.imageUrl || m.thumbnailUrl || "",
      subtitle: m.subtitle ?? "",
      publisher: m.publisher ?? "",
      publishedAt: m.publishedAt ?? "",
      updatedAt: serverTimestamp(),
    });
  }
  return targets.length;
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

// 팩트체크 기록은 v5.0에서 생성·조회·삭제만 한다. 수정 경로(수용/정교화)는 제거되었다.
export async function deleteFactCheckHistory(ws, historyId) {
  await deleteDoc(wsDoc(ws, "factcheck_history", historyId));
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
 * 한 미디어에 대한 Gemini 호출을 모둠 전체에서 1회로 제한한다(무료 쿼터 보호).
 * runKey: 미디어 + 체크리스트 내용을 식별하는 결정적 키.
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
