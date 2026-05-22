import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "../firebase.js";

const PENDING_ROLE_KEY = "pendingAuthRole";

// Popup 우선, 차단된 환경에서만 redirect로 폴백.
// signInWithRedirect는 Firebase v10에서 authDomain != site domain + 3rd-party
// 쿠키/스토리지 차단 환경(iOS Safari, Chrome 일부 설정)에서 복귀 후 user가
// 복원되지 않는 알려진 이슈가 있어, 기본 경로를 popup으로 둔다.
// popup이 성공하면 onAuthStateChanged → AuthContext의 pendingRole fallback이
// 프로필을 부트스트랩한다.
export async function startGoogleSignIn(role) {
  try {
    sessionStorage.setItem(PENDING_ROLE_KEY, role);
  } catch {
    // sessionStorage 비활성(시크릿 모드 일부 등) — 무시
  }
  try {
    await signInWithPopup(auth, googleProvider);
    return { mode: "popup" };
  } catch (e) {
    const code = e?.code;
    // 사용자가 popup을 직접 닫음 → 조용히 종료(에러 throw 안 함)
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      try { sessionStorage.removeItem(PENDING_ROLE_KEY); } catch {}
      return { mode: "cancelled" };
    }
    // popup이 차단되었거나 환경 지원 불가 → redirect로 폴백 (페이지 이동)
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      return signInWithRedirect(auth, googleProvider);
    }
    throw e;
  }
}

// getRedirectResult가 null을 돌려주는 환경(iOS Safari, 3rd-party 쿠키 차단 등)에서도
// 프로필 부트스트랩이 가능하도록 pendingRole을 별도 헬퍼로 노출.
// 한 번 꺼내면 즉시 삭제해서 다음 세션에 누수되지 않게 한다.
export function consumePendingRole() {
  try {
    const role = sessionStorage.getItem(PENDING_ROLE_KEY);
    if (role) sessionStorage.removeItem(PENDING_ROLE_KEY);
    return role || null;
  } catch {
    return null;
  }
}

// 페이지 로드 시 1회 호출. 리다이렉트 복귀가 아니면 null 반환.
// StrictMode가 effect를 두 번 실행해도 같은 결과를 돌려주도록 캐시.
// (getRedirectResult는 1회만 소비되므로 두 번째 호출은 null을 반환하는 문제 회피)
let redirectPromise = null;
export function consumeRedirectResult() {
  if (redirectPromise) return redirectPromise;
  redirectPromise = (async () => {
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
  })();
  return redirectPromise;
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
