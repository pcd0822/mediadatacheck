import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button.jsx";
import LoadingOverlay from "../components/Loading/LoadingOverlay.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { ensureUserProfile, signInWithGoogle } from "../services/auth.js";

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, profile, loading, refreshProfile } = useAuth();
  const [studentLoading, setStudentLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (user && profile?.role === "teacher") navigate("/teacher", { replace: true });
    if (user && profile?.role === "student") navigate("/student", { replace: true });
  }, [user, profile, loading, navigate]);

  const handleStudentLogin = async () => {
    setError("");
    setStudentLoading(true);
    try {
      const fbUser = await signInWithGoogle();
      await ensureUserProfile(fbUser, "student");
      const p = await refreshProfile();
      navigate(p?.role === "teacher" ? "/teacher" : "/student", { replace: true });
    } catch (e) {
      console.error(e);
      setError("로그인에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setStudentLoading(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 via-white to-accent-400/10 px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-soft">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12l2 2 4-4" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">미디어 리터러시 · 팩트체크</h1>
          <p className="mt-1 text-sm text-slate-500">
            나만의 체크리스트로 미디어를 평가해보세요
          </p>
        </div>

        <div className="card space-y-3">
          <p className="label">시작하실 사용자 유형을 선택해주세요</p>
          <Button
            variant="primary"
            className="w-full justify-center"
            onClick={handleStudentLogin}
            loading={studentLoading}
          >
            학생으로 시작 (Google 로그인)
          </Button>
          <Button
            variant="secondary"
            className="w-full justify-center"
            onClick={() => navigate("/teacher-code")}
            disabled={studentLoading}
          >
            교사로 시작
          </Button>
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          학생은 Google 계정으로 로그인하고, 교사는 사전 안내된 인증 코드 입력이 필요합니다.
        </p>
      </div>
      {loading && <LoadingOverlay message="사용자 확인 중..." />}
    </div>
  );
}
