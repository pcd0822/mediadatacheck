import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import Spinner from "../../components/Loading/Spinner.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import { startGoogleSignIn } from "../../services/auth.js";
import { getGroupByCode, joinGroup } from "../../services/groups.js";

export default function JoinGroupPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { setActiveWorkspace, refreshGroups } = useWorkspace();

  const [status, setStatus] = useState("idle"); // idle | joining | error
  const [error, setError] = useState("");
  const [signinLoading, setSigninLoading] = useState(false);
  const ranRef = useRef(false);

  // Firestore 규칙상 groups 읽기에는 로그인이 필요하다.
  // 그래서 코드 조회·합류는 반드시 로그인 이후에 수행한다(로그아웃 조회는 권한 거부됨).
  useEffect(() => {
    if (loading || !user || ranRef.current) return;
    ranRef.current = true;
    setStatus("joining");
    (async () => {
      try {
        const g = await getGroupByCode(code);
        if (!g) {
          setError(
            `코드 ${String(code).toUpperCase()} 에 해당하는 모둠을 찾을 수 없어요. 링크가 정확한지 조장에게 확인해주세요.`
          );
          setStatus("error");
          return;
        }
        await joinGroup(g, user);
        await refreshGroups();
        setActiveWorkspace({ type: "group", id: g.id, name: g.groupName });
        navigate("/student", { replace: true });
      } catch (e) {
        console.error(e);
        setError(e.message || "모둠 합류에 실패했어요. 잠시 후 다시 시도해주세요.");
        setStatus("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, code]);

  const handleSignIn = async () => {
    setError("");
    setSigninLoading(true);
    try {
      await startGoogleSignIn("student");
    } catch (e) {
      console.error(e);
      setError("로그인에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSigninLoading(false);
    }
  };

  if (loading) return <LoadingOverlay message="사용자 확인 중..." />;
  if (user && status === "joining") return <LoadingOverlay message="모둠에 합류하는 중..." />;

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
      style={{ background: "linear-gradient(180deg, #E6F0FF 0%, #FFFFFF 100%)" }}
    >
      <main className="z-10 w-full max-w-[460px]">
        <div className="rounded-[32px] border border-white/60 bg-white p-10 shadow-glow-xl">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-brand-600 shadow-lg shadow-brand-600/20">
              <span
                className="material-symbols-outlined text-white"
                style={{ fontSize: 36, fontVariationSettings: "'FILL' 1" }}
              >
                groups
              </span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-brand-700">
              모둠 합류
            </h1>
            <p className="mt-1 text-[11px] font-semibold text-ink-muted">
              초대 코드 {String(code).toUpperCase()}
            </p>
          </div>

          {status === "error" ? (
            <div className="space-y-4 text-center">
              <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
              <button
                type="button"
                onClick={() => navigate("/student")}
                className="text-sm font-semibold text-brand-700 hover:underline"
              >
                대시보드로 →
              </button>
            </div>
          ) : !user ? (
            <div className="space-y-5 text-center">
              <p className="text-[15px] leading-relaxed text-ink-variant">
                모둠 작업실에 초대받았어요. 구글 계정으로 로그인하면
                체크리스트와 팩트체크를 모둠원과 함께 할 수 있어요.
              </p>
              <button
                type="button"
                onClick={handleSignIn}
                disabled={signinLoading}
                className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-brand-600 text-base font-semibold text-white shadow-md shadow-brand-600/20 transition-all hover:bg-brand-500 active:scale-[0.97] disabled:opacity-70"
              >
                {signinLoading ? (
                  <Spinner size={18} className="text-white" />
                ) : (
                  <span className="material-symbols-outlined">login</span>
                )}
                <span>구글로 로그인하고 합류</span>
              </button>
              {error && (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
              )}
            </div>
          ) : (
            <div className="flex justify-center py-6">
              <Spinner size={24} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
