import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";

const WorkspaceContext = createContext(null);

const personalWs = (uid) => ({ type: "user", id: uid, name: "내 개인 작업실" });

export function WorkspaceProvider({ children }) {
  const { user, profile, refreshProfile } = useAuth();
  const [activeWorkspace, setActiveState] = useState(null);

  // 내가 속한 모둠 목록 (프로필 groups 맵에서 파생)
  const myGroups = useMemo(() => {
    const groups = profile?.groups ?? {};
    return Object.entries(groups).map(([id, v]) => ({
      id,
      role: v?.role ?? "member",
      groupName: v?.groupName ?? "우리 모둠",
    }));
  }, [profile]);

  const setActiveWorkspace = (ws) => {
    setActiveState(ws);
    try {
      if (user) localStorage.setItem(`workspace:${user.uid}`, JSON.stringify(ws));
    } catch {
      // localStorage 비활성 — 무시
    }
  };

  // user 확정 시 저장된 작업실 복원(없으면 개인).
  useEffect(() => {
    if (!user) {
      setActiveState(null);
      return;
    }
    let restored = null;
    try {
      const raw = localStorage.getItem(`workspace:${user.uid}`);
      if (raw) restored = JSON.parse(raw);
    } catch {
      restored = null;
    }
    setActiveState(restored?.id ? restored : personalWs(user.uid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 활성 작업실이 그룹인데 더 이상 소속이 아니면(강퇴/탈퇴) 개인으로 폴백.
  useEffect(() => {
    if (!user || !activeWorkspace || activeWorkspace.type !== "group") return;
    if (profile && !myGroups.some((g) => g.id === activeWorkspace.id)) {
      setActiveWorkspace(personalWs(user.uid));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile, myGroups, activeWorkspace]);

  const value = useMemo(
    () => ({
      activeWorkspace: activeWorkspace ?? (user ? personalWs(user.uid) : null),
      isGroup: activeWorkspace?.type === "group",
      myGroups,
      setActiveWorkspace,
      refreshGroups: refreshProfile,
      personalWorkspace: user ? personalWs(user.uid) : null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeWorkspace, myGroups, user, refreshProfile]
  );

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
