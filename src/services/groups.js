import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase.js";

const MODEL_VERSION = "VAPM-3.0";
const STANDARD_BASIS = "5_verification_actions";

/** 모둠 인원 상한 — 리스너 fan-out·동시쓰기를 묶어 무료 쿼터를 보호. */
export const MAX_GROUP_MEMBERS = 8;

// 혼동하기 쉬운 문자(0/O/1/I/L) 제외.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateShareCode(len = 6) {
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** 공유 코드로 모둠 조회. shareCode는 단일필드 자동 인덱스. */
export async function getGroupByCode(code) {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!normalized) return null;
  const q = query(
    collection(db, "groups"),
    where("shareCode", "==", normalized),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function getGroup(groupId) {
  const snap = await getDoc(doc(db, "groups", groupId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * 모둠 생성. 조장의 기존 체크리스트(+모델·피드백)를 작업실로 복사한다.
 * Firestore 규칙상 하위 데이터 쓰기는 멤버여야 하므로
 *   group 생성 → 조장 멤버십 생성 → 체크리스트/모델 복사 → group.checklistId 갱신 → user.groups 기록
 * 순서로 진행한다.
 * @param {{uid,name,email}} leader
 * @param {{groupName, sourceChecklist, sourceModel, sourceFeedbackCards}} opts
 * @returns {Promise<{groupId, shareCode}>}
 */
export async function createGroup(leader, { groupName, sourceChecklist, sourceModel, sourceFeedbackCards }) {
  const shareCode = generateShareCode();

  // 1) group 문서 (checklistId는 복사 후 채움)
  const groupRef = await addDoc(collection(db, "groups"), {
    groupName: groupName?.trim() || "우리 모둠",
    leaderUid: leader.uid,
    leaderName: leader.name ?? null,
    shareCode,
    checklistId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const groupId = groupRef.id;

  // 2) 조장 멤버십 (이후 하위 쓰기 권한 확보)
  await setDoc(doc(db, "groups", groupId, "members", leader.uid), {
    name: leader.name ?? null,
    email: leader.email ?? null,
    role: "leader",
    joinedAt: serverTimestamp(),
  });

  // 3) 체크리스트 복사
  const checklistRef = await addDoc(collection(db, "groups", groupId, "checklists"), {
    checklistName: sourceChecklist?.checklistName ?? "우리 모둠 체크리스트",
    items: sourceChecklist?.items ?? [],
    lastEditedBy: leader.uid,
    lastEditedName: leader.name ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const checklistId = checklistRef.id;

  // 4) 모델 시드 (있으면 조장 모델 복사, training_data는 새로 시작)
  if (sourceModel) {
    await setDoc(doc(db, "groups", groupId, "algorithm_model", "current"), {
      version: MODEL_VERSION,
      standard_basis: STANDARD_BASIS,
      weights: sourceModel.weights ?? null,
      mastery: sourceModel.mastery ?? null,
      checklistId,
      trainingDataCount: sourceModel.trainingDataCount ?? 0,
      convergenceScore: sourceModel.convergenceScore ?? null,
      teacherImplicitWeights: sourceModel.teacherImplicitWeights ?? null,
      learningRate: sourceModel.learningRate ?? null,
      trainedAt: serverTimestamp(),
    });
  }

  // 5) 피드백 카드 복사 (표시 연속성)
  if (Array.isArray(sourceFeedbackCards) && sourceFeedbackCards.length) {
    await setDoc(doc(db, "groups", groupId, "feedback_cards", "current"), {
      cards: sourceFeedbackCards,
      updatedAt: serverTimestamp(),
    });
  }

  // 6) group.checklistId 활성 포인터
  await updateDoc(doc(db, "groups", groupId), {
    checklistId,
    leaderUid: leader.uid, // update 규칙의 leaderUid 불변 검증 통과용(동일값)
    updatedAt: serverTimestamp(),
  });

  // 7) 조장 본인 프로필에 소속 기록
  await updateDoc(doc(db, "users", leader.uid), {
    [`groups.${groupId}`]: {
      role: "leader",
      groupName: groupName?.trim() || "우리 모둠",
      joinedAt: Date.now(),
    },
  });

  return { groupId, shareCode };
}

/** 모둠 합류 (구글 로그인된 모둠원). 인원 상한 검사. */
export async function joinGroup(group, user) {
  const groupId = group.id;
  const membersSnap = await getDocs(collection(db, "groups", groupId, "members"));
  const already = membersSnap.docs.some((d) => d.id === user.uid);
  if (!already && membersSnap.size >= MAX_GROUP_MEMBERS) {
    throw new Error(`모둠 인원이 가득 찼어요 (최대 ${MAX_GROUP_MEMBERS}명).`);
  }

  await setDoc(doc(db, "groups", groupId, "members", user.uid), {
    name: user.displayName ?? null,
    email: user.email ?? null,
    role: "member",
    joinedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "users", user.uid), {
    [`groups.${groupId}`]: {
      role: "member",
      groupName: group.groupName ?? "우리 모둠",
      joinedAt: Date.now(),
    },
  });
}

/** 본인 탈퇴: 멤버십 + 프로필 소속 제거. */
export async function leaveGroup(groupId, uid) {
  await deleteDoc(doc(db, "groups", groupId, "members", uid));
  await updateDoc(doc(db, "users", uid), {
    [`groups.${groupId}`]: deleteField(),
  });
}

/** 조장 강퇴: 대상 멤버십만 삭제(대상 프로필은 규칙상 수정 불가 — 그쪽 클라이언트가 정리). */
export async function removeMember(groupId, uid) {
  await deleteDoc(doc(db, "groups", groupId, "members", uid));
}

export function subscribeGroup(groupId, cb, onError) {
  return onSnapshot(
    doc(db, "groups", groupId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError
  );
}

export function subscribeMembers(groupId, cb, onError) {
  return onSnapshot(
    collection(db, "groups", groupId, "members"),
    (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
    onError
  );
}
