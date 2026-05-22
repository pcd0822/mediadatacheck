import {
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "../firebase.js";

const PENDING_ROLE_KEY = "pendingAuthRole";

// 페이지가 Google로 이동하기 직전, role(student/teacher)을 보관해두고
// 복귀 후 consumeRedirectResult()에서 다시 꺼내 ensureUserProfile에 넘긴다.
// signInWithPopup 대비 장점: COOP/window.closed 차단 영향 없음.
export function startGoogleSignIn(role) {
  try {
    sessionStorage.setItem(PENDING_ROLE_KEY, role);
  } catch {
    // sessionStorage 비활성(시크릿 모드 일부 등) — 무시
  }
  return signInWithRedirect(auth, googleProvider);
}

// 페이지 로드 시 1회 호출. 리다이렉트 복귀가 아니면 null 반환.
export async function consumeRedirectResult() {
  const result = await getRedirectResult(auth);
  if (!result) return null;

  let pendingRole = null;
  try {
    pendingRole = sessionStorage.getItem(PENDING_ROLE_KEY);
    sessionStorage.removeItem(PENDING_ROLE_KEY);
  } catch {
    // ignore
  }
  return { user: result.user, pendingRole };
}

export async function signOut() {
  await fbSignOut(auth);
}

export function onAuthStateChanged(cb) {
  return fbOnAuthStateChanged(auth, cb);
}

export async function ensureUserProfile(user, role) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const baseData = {
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    lastLogin: serverTimestamp(),
  };

  if (!snap.exists()) {
    await setDoc(ref, {
      ...baseData,
      role: role ?? "student",
      createdAt: serverTimestamp(),
    });
    return { ...baseData, role: role ?? "student" };
  }

  const existing = snap.data();
  // role은 최초 등록 시 1회 결정되면 이후 변경하지 않는다.
  // (다른 디바이스/경로 재로그인 시 우발적 강등·권한상승 방지)
  const update = { ...baseData };
  await setDoc(ref, update, { merge: true });
  return { ...existing, ...update };
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}
