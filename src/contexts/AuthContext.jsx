import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
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

  useEffect(() => {
    let unsub;
    let cancelled = false;

    (async () => {
      // 리다이렉트 복귀였다면 먼저 처리해 user 문서를 만든 뒤
      // onAuthStateChanged를 붙여야 listener가 profile null로 빠지지 않는다.
      try {
        const ret = await consumeRedirectResult();
        if (!cancelled && ret?.user && ret?.pendingRole) {
          await ensureUserProfile(ret.user, ret.pendingRole);
        }
      } catch (e) {
        console.error("리다이렉트 결과 처리 실패", e);
      }
      if (cancelled) return;

      unsub = onAuthStateChanged(async (fbUser) => {
        setUser(fbUser ?? null);
        if (fbUser) {
          const p = await getUserProfile(fbUser.uid);
          setProfile(p);
        } else {
          setProfile(null);
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
  };

  const refreshProfile = async () => {
    if (!user) return null;
    const p = await getUserProfile(user.uid);
    setProfile(p);
    return p;
  };

  const value = useMemo(
    () => ({ user, profile, loading, signOut, refreshProfile, setProfile }),
    [user, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
