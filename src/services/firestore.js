import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase.js";

/* ====================== media_items (교사가 등록) ====================== */

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

export async function deleteMediaItem(mediaId) {
  await deleteDoc(doc(db, "media_items", mediaId));
}

/* ====================== teacher_evaluation ====================== */

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

/* ====================== users/{uid}/checklists ====================== */

export async function listChecklists(uid) {
  const q = query(collection(db, "users", uid, "checklists"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getChecklist(uid, checklistId) {
  const snap = await getDoc(doc(db, "users", uid, "checklists", checklistId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createChecklist(uid, data) {
  const ref = await addDoc(collection(db, "users", uid, "checklists"), {
    checklistName: data.checklistName,
    items: data.items ?? [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateChecklist(uid, checklistId, data) {
  await updateDoc(doc(db, "users", uid, "checklists", checklistId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteChecklist(uid, checklistId) {
  await deleteDoc(doc(db, "users", uid, "checklists", checklistId));
}

/* ====================== student_evaluations (모델링 평가) ====================== */

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

export async function listStudentEvaluationsForUser(uid) {
  const mediaSnap = await getDocs(collection(db, "media_items"));
  const results = [];
  for (const m of mediaSnap.docs) {
    const evalSnap = await getDoc(
      doc(db, "media_items", m.id, "student_evaluations", uid)
    );
    if (evalSnap.exists()) {
      results.push({ mediaId: m.id, ...evalSnap.data() });
    }
  }
  return results;
}

/* ====================== algorithm_model (IPFM-2.0) ====================== */

const MODEL_VERSION = "IPFM-2.0";
const STANDARD_BASIS = "IFCN_5_principles";

export async function saveAlgorithmModel(uid, model) {
  await setDoc(
    doc(db, "users", uid, "algorithm_model", "current"),
    {
      version: MODEL_VERSION,
      standard_basis: STANDARD_BASIS,
      weights: model.weights ?? null,
      checklistId: model.checklistId ?? null,
      trainingDataCount: model.trainingDataCount ?? 0,
      convergenceScore: model.convergenceScore ?? null,
      teacherImplicitWeights: model.teacherImplicitWeights ?? null,
      learningRate: model.learningRate ?? null,
      trainedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getAlgorithmModel(uid) {
  const snap = await getDoc(doc(db, "users", uid, "algorithm_model", "current"));
  return snap.exists() ? snap.data() : null;
}

export async function appendTrainingData(uid, dataId, payload) {
  await setDoc(
    doc(db, "users", uid, "algorithm_model", "current", "training_data", dataId),
    { ...payload, addedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function listTrainingData(uid) {
  const snap = await getDocs(
    collection(db, "users", uid, "algorithm_model", "current", "training_data")
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function clearTrainingData(uid) {
  const snap = await getDocs(
    collection(db, "users", uid, "algorithm_model", "current", "training_data")
  );
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

/* ====================== feedback_cards (IPFM 메타인지 카드) ====================== */

export async function replaceFeedbackCards(uid, cards) {
  const colRef = collection(db, "users", uid, "feedback_cards");
  const existing = await getDocs(colRef);
  await Promise.all(existing.docs.map((d) => deleteDoc(d.ref)));
  await Promise.all(
    cards.map((c) =>
      addDoc(colRef, { ...c, createdAt: serverTimestamp() })
    )
  );
}

export async function listFeedbackCards(uid) {
  const snap = await getDocs(collection(db, "users", uid, "feedback_cards"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ====================== factcheck_history ====================== */

export async function saveFactCheckHistory(uid, payload) {
  const ref = await addDoc(collection(db, "users", uid, "factcheck_history"), {
    ...payload,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getFactCheckHistory(uid, historyId) {
  const snap = await getDoc(doc(db, "users", uid, "factcheck_history", historyId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateFactCheckHistory(uid, historyId, patch) {
  await updateDoc(doc(db, "users", uid, "factcheck_history", historyId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function listFactCheckHistory(uid) {
  const q = query(
    collection(db, "users", uid, "factcheck_history"),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
