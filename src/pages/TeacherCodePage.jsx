import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button.jsx";
import LoadingOverlay from "../components/Loading/LoadingOverlay.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { ensureUserProfile, startGoogleSignIn } from "../services/auth.js";
import { createTeacherAuthConfig, getTeacherAuthConfig } from "../services/firestore.js";
import { makeCodeRecord, verifyCode } from "../utils/teacherCode.js";

const MIN_CODE_LEN = 4;

/**
 * 교사 인증 게이트.
 *  1) 구글 로그인이 안 됐으면 → 로그인 버튼.
 *  2) 로그인된 새 계정 + 프로젝트에 코드가 없으면 → "코드 설정"(첫 교사).
 *  3) 로그인된 새 계정 + 코드가 이미 있으면 → "코드 입력"(교사 추가).
 *  4) 이미 학생으로 확정된 계정이면 → 전환 불가 안내.
 * 통과해야 비로소 role=teacher 프로필을 만든다.
 */
export default function TeacherCodePage() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, pendingTeacher, refreshProfile } = useAuth();
  const [mode, setMode] = useState(null); // "login" | "set" | "enter" | "studentBlocked"
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  // 이미 교사면 곧장 대시보드로.
  useEffect(() => {
    if (!authLoading && user && profile?.role === "teacher") {
      navigate("/teacher", { replace: true });
    }
  }, [user, profile, authLoading, navigate]);

  // 로그인/프로필 상태에 따라 화면 모드 결정.
  useEffect(() => {
    if (authLoading) return;
    let alive = true;
    (async () => {
      if (!user) {
        setMode("login");
        setChecking(false);
        return;
      }
      if (profile?.role === "student") {
        setMode("studentBlocked");
        setChecking(false);
        return;
      }
      if (profile?.role === "teacher") return; // 위 effect가 이동시킴
      // 로그인됨 + 아직 프로필 없음(교사 게이트 대기) → 코드 존재 여부로 분기
      setChecking(true);
      try {
        const cfg = await getTeacherAuthConfig();
        if (!alive) return;
        setMode(cfg ? "enter" : "set");
      } catch (e) {
        console.error(e);
        if (alive) setError("설정을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, profile, pendingTeacher, authLoading]);

  const handleGoogle = async () => {
    setError("");
    setSigningIn(true);
    try {
      await startGoogleSignIn("teacher");
    } catch (e) {
      console.error(e);
      setError("로그인에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setSigningIn(false);
    }
  };

  const finishAsTeacher = async () => {
    await ensureUserProfile(user, "teacher");
    await refreshProfile();
    navigate("/teacher", { replace: true });
  };

  const handleSet = async (e) => {
    e.preventDefault();
    setError("");
    const c = code.trim();
    if (c.length < MIN_CODE_LEN) {
      setError(`인증 코드는 ${MIN_CODE_LEN}자 이상이어야 합니다.`);
      return;
    }
    if (c !== confirm.trim()) {
      setError("두 번 입력한 코드가 일치하지 않습니다.");
      return;
    }
    setSubmitting(true);
    try {
      const record = await makeCodeRecord(c);
      await createTeacherAuthConfig({ uid: user.uid, email: user.email, ...record });
      await finishAsTeacher();
    } catch (e) {
      console.error(e);
      setError("코드 설정 중 오류가 발생했어요. 다시 시도해주세요.");
      setSubmitting(false);
    }
  };

  const handleEnter = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const cfg = await getTeacherAuthConfig();
      const ok = cfg && (await verifyCode(code.trim(), cfg));
      if (!ok) {
        setError("인증 코드가 올바르지 않습니다.");
        setSubmitting(false);
        return;
      }
      await finishAsTeacher();
    } catch (e) {
      console.error(e);
      setError("인증 중 오류가 발생했어요. 다시 시도해주세요.");
      setSubmitting(false);
    }
  };

  if (authLoading || checking) return <LoadingOverlay message="교사 인증 준비 중..." />;

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 via-white to-accent-400/10 px-6">
      <div className="w-full max-w-md">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mb-4 text-sm text-slate-500 hover:text-slate-700"
        >
          ← 사용자 유형 다시 선택
        </button>

        <div className="card">
          {mode === "login" && (
            <>
              <h2 className="text-xl font-bold text-slate-900">교사로 시작</h2>
              <p className="mt-1 text-sm text-slate-500">
                먼저 Google 계정으로 로그인하면, 이 교실(Firebase)의 교사 인증 코드를 설정하거나
                입력하는 화면으로 이어져요.
              </p>
              {error && (
                <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
              )}
              <Button
                variant="primary"
                className="mt-5 w-full justify-center"
                onClick={handleGoogle}
                loading={signingIn}
              >
                Google 계정으로 로그인
              </Button>
            </>
          )}

          {mode === "set" && (
            <>
              <h2 className="text-xl font-bold text-slate-900">교사 인증 코드 설정</h2>
              <p className="mt-1 text-sm text-slate-500">
                이 교실의 <b>첫 교사</b>예요. 앞으로 교사로 로그인할 때 사용할 인증 코드를 정해주세요.
                <br />
                이 코드는 이 계정/교실에 저장되며, 다른 교사를 추가할 때도 이 코드가 필요합니다.
              </p>
              <form onSubmit={handleSet} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="t-code" className="label">새 인증 코드 ({MIN_CODE_LEN}자 이상)</label>
                  <input
                    id="t-code"
                    type="password"
                    autoComplete="new-password"
                    maxLength={32}
                    className="input tracking-widest text-center text-lg"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="••••"
                  />
                </div>
                <div>
                  <label htmlFor="t-confirm" className="label">인증 코드 확인</label>
                  <input
                    id="t-confirm"
                    type="password"
                    autoComplete="new-password"
                    maxLength={32}
                    className="input tracking-widest text-center text-lg"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••"
                  />
                </div>
                {error && (
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full justify-center"
                  loading={submitting}
                  disabled={!code.trim() || !confirm.trim()}
                >
                  코드 설정하고 교사로 시작
                </Button>
              </form>
            </>
          )}

          {mode === "enter" && (
            <>
              <h2 className="text-xl font-bold text-slate-900">교사 인증</h2>
              <p className="mt-1 text-sm text-slate-500">
                이 교실에 설정된 교사 인증 코드를 입력하면 교사로 시작할 수 있어요.
              </p>
              <form onSubmit={handleEnter} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="t-enter" className="label">인증 코드</label>
                  <input
                    id="t-enter"
                    type="password"
                    autoComplete="off"
                    maxLength={32}
                    className="input tracking-widest text-center text-lg"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="••••"
                  />
                </div>
                {error && (
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full justify-center"
                  loading={submitting}
                  disabled={!code.trim()}
                >
                  인증하고 교사로 시작
                </Button>
              </form>
            </>
          )}

          {mode === "studentBlocked" && (
            <>
              <h2 className="text-xl font-bold text-slate-900">교사로 전환할 수 없어요</h2>
              <p className="mt-1 text-sm text-slate-500">
                이 Google 계정은 이미 <b>학생</b>으로 등록되어 있어요. 역할은 최초 1회 정해지면
                바뀌지 않습니다. 교사로 쓰려면 다른 Google 계정으로 로그인해주세요.
              </p>
              <div className="mt-5 flex gap-2">
                <Button variant="secondary" className="flex-1 justify-center" onClick={() => navigate("/student")}>
                  학생으로 계속
                </Button>
                <Button variant="primary" className="flex-1 justify-center" onClick={() => navigate("/")}>
                  처음으로
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
