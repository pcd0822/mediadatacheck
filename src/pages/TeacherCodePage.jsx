import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { TEACHER_AUTH_CODE } from "../firebase.js";
import { ensureUserProfile, signInWithGoogle } from "../services/auth.js";

export default function TeacherCodePage() {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (code.trim() !== TEACHER_AUTH_CODE) {
      setError("인증 코드가 올바르지 않습니다. 다시 확인해주세요.");
      return;
    }
    setLoading(true);
    try {
      const fbUser = await signInWithGoogle();
      await ensureUserProfile(fbUser, "teacher");
      await refreshProfile();
      navigate("/teacher/upload", { replace: true });
    } catch (err) {
      console.error(err);
      setError("로그인에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

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
          <h2 className="text-xl font-bold text-slate-900">교사 인증</h2>
          <p className="mt-1 text-sm text-slate-500">
            사전 안내된 4자리 인증 코드를 입력해주세요.
          </p>
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="teacher-code" className="label">
                인증 코드
              </label>
              <input
                id="teacher-code"
                type="password"
                inputMode="numeric"
                maxLength={8}
                autoComplete="off"
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
              loading={loading}
              disabled={!code.trim()}
            >
              인증 후 Google 로그인
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
