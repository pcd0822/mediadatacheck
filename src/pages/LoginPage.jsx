import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import LoadingOverlay from "../components/Loading/LoadingOverlay.jsx";
import Spinner from "../components/Loading/Spinner.jsx";
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
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
      style={{
        background: "linear-gradient(180deg, #E6F0FF 0%, #FFFFFF 100%)",
      }}
    >
      <div className="pointer-events-none fixed -left-[10%] -top-[10%] -z-10 h-[40%] w-[40%] rounded-full bg-brand-100/60 blur-[120px]" />
      <div className="pointer-events-none fixed -bottom-[10%] -right-[10%] -z-10 h-[40%] w-[40%] rounded-full bg-brand-50 blur-[120px]" />

      <main className="z-10 w-full max-w-[480px]">
        <div className="rounded-[32px] border border-white/60 bg-white p-10 shadow-glow-xl backdrop-blur-sm">
          <div className="mb-10 flex flex-col items-center">
            <div className="mb-4 grid h-20 w-20 place-items-center rounded-full bg-brand-600 shadow-lg shadow-brand-600/20 transition-transform duration-300 hover:scale-105">
              <span
                className="material-symbols-outlined text-white"
                style={{ fontSize: 44, fontVariationSettings: "'FILL' 1" }}
              >
                verified
              </span>
            </div>
            <h1 className="mb-2 font-display text-[28px] font-bold tracking-tight text-brand-700">
              미디어 리터러시 · 팩트체크
            </h1>
            <p className="text-center text-[15px] leading-relaxed text-ink-variant/80">
              나만의 체크리스트로 미디어를 평가해보세요
            </p>
          </div>

          <div className="relative mb-10 aspect-video w-full overflow-hidden rounded-2xl">
            <img
              alt="Students collaborating"
              className="h-full w-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDleL-XHVCu2vqLEXoC5yQFMZwVgqhfSabqYJabdxHgPf8oi0Rdmlj0ObLVTwnoUy8zs6V-ulu-JRpPz8a7_xFu7nmDdb4SQjqmXICZiadW864KaMYRtXmQ4Y508TGvHMuRJbbOI7bjuN4P79QvZ98wYMsFtN-_hprJOZQi1gQ3fFZpnnOo4qLb-EOwqd1gtJL1FodgBeVxkD_5ZLDreXVxqw-GUj58oltjjVDNxJdfy25mMz4BO3QzsJtBdkvML-s41mBgRMh5VbmQ"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-brand-600/20 to-transparent" />
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleStudentLogin}
              disabled={studentLoading}
              className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-brand-600 text-base font-semibold text-white shadow-md shadow-brand-600/20 transition-all duration-300 hover:bg-brand-500 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {studentLoading ? (
                <Spinner size={18} className="text-white" />
              ) : (
                <svg className="h-6 w-6" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="currentColor"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="currentColor"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                    fill="currentColor"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="currentColor"
                  />
                </svg>
              )}
              <span>학생으로 시작 (Google 로그인)</span>
            </button>

            <button
              type="button"
              onClick={() => navigate("/teacher-code")}
              disabled={studentLoading}
              className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border-2 border-brand-100 bg-white text-base font-semibold text-brand-700 transition-all duration-300 hover:border-brand-500 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="material-symbols-outlined">school</span>
              <span>교사로 시작</span>
            </button>

            {error && (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}
          </div>

          <div className="mt-12 flex items-center justify-center gap-5 border-t border-surface-variant pt-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              학생: Google 로그인
            </span>
            <span className="h-1 w-1 rounded-full bg-surface-variant" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              교사: 인증 코드 필요
            </span>
          </div>
        </div>

        <div className="mt-4 px-6 text-center">
          <p className="text-sm text-ink-variant/70">
            올바른 미디어 소비 습관을 위한 첫 걸음을 함께하세요.
          </p>
        </div>
      </main>

      {loading && <LoadingOverlay message="사용자 확인 중..." />}
    </div>
  );
}
