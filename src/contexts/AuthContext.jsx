import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  consumePendingRole,
  consumeRedirectResult,
  ensureUserProfile,
  getUserProfile,
  onAuthStateChanged,
  signOut as svcSignOut,
} from "../services/auth.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // 교사 경로로 로그인했지만 아직 인증 코드 게이트(설정/입력)를 통과하지 않은 상태.
  // 이때는 프로필(role)을 만들지 않는다 — role은 최초 1회 확정되므로, 게이트 통과 전에
  // 학생으로 잘못 굳지 않도록 게이트 페이지에서 role=teacher 프로필을 만들게 미룬다.
  const [pendingTeacher, setPendingTeacher] = useState(false);
  const teacherIntentRef = useRef(false);

  useEffect(() => {
    let unsub;
    let cancelled = false;

    (async () => {
      // 리다이렉트 복귀였다면 먼저 처리해 user 문서를 만든 뒤
      // onAuthStateChanged를 붙여야 listener가 profile null로 빠지지 않는다.
      try {
        const ret = await consumeRedirectResult();
        if (!cancelled && ret?.user) {
          if (ret.pendingRole === "teacher") {
            // 교사 경로: 프로필 생성 보류, 게이트 페이지로 넘긴다.
            teacherIntentRef.current = true;
            setPendingTeacher(true);
          } else if (ret.pendingRole) {
            await ensureUserProfile(ret.user, ret.pendingRole);
          }
        }
      } catch (e) {
        console.error("리다이렉트 결과 처리 실패", e);
      }
      if (cancelled) return;

      unsub = onAuthStateChanged(async (fbUser) => {
        setUser(fbUser ?? null);
        if (fbUser) {
          let p = await getUserProfile(fbUser.uid);
          // consumeRedirectResult가 null을 돌려준 환경에서도 user는 살아 있는 경우가 있다.
          // 그때 sessionStorage에 남아 있는 pendingRole로 분기한다.
          if (!p) {
            const pendingRole = consumePendingRole();
            if (pendingRole === "teacher") teacherIntentRef.current = true;
            if (teacherIntentRef.current) {
              // 교사 게이트 대기: 코드 통과 전까지 프로필을 만들지 않는다.
              setPendingTeacher(true);
            } else {
              try {
                await ensureUserProfile(fbUser, "student");
                p = await getUserProfile(fbUser.uid);
              } catch (e) {
                console.error("프로필 부트스트랩 실패", e);
              }
            }
          }
          if (p) setPendingTeacher(false);
          setProfile(p);
        } else {
          setProfile(null);
          setPendingTeacher(false);
          teacherIntentRef.current = false;
        }
        setLoading(false);
      });
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const signOut = async () => {
    await svcSignOut();
    setUser(null);
    setProfile(null);
    setPendingTeacher(false);
    teacherIntentRef.current = false;
  };

  const refreshProfile = async () => {
    if (!user) return null;
    const p = await getUserProfile(user.uid);
    setProfile(p);
    if (p) setPendingTeacher(false);
    return p;
  };

  const value = useMemo(
    () => ({ user, profile, loading, pendingTeacher, signOut, refreshProfile, setProfile }),
    [user, profile, loading, pendingTeacher]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
