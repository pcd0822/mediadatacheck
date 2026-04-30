import {
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "../firebase.js";

export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
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
