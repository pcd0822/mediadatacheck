import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "./Button.jsx";
import Layout from "./Layout.jsx";
import LoadingOverlay from "./Loading/LoadingOverlay.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useWorkspace } from "../contexts/WorkspaceContext.jsx";
import { STAGES, stageMeta } from "../constants/lesson.js";
import { subscribeProgress } from "../services/lesson.js";
import { subscribeGroup, subscribeMembers } from "../services/groups.js";

/**
 * 수업 활동 공용 껍데기 — 단계 표시줄 + 순차 게이트.
 *
 * - 모둠 작업실이 아니면 진입을 막는다(이 흐름은 모둠 전용).
 * - progress.stage보다 앞선 단계로 들어오면 현재 단계로 되돌린다.
 * - 자식에게 { group, members, progress, isLeader } 를 넘긴다.
 */
export default function LessonShell({ stage, title, subtitle, actions, children }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeWorkspace: ws, isGroup } = useWorkspace();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isGroup || !ws?.id) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsubG = subscribeGroup(ws.id, (g) => setGroup(g));
    const unsubM = subscribeMembers(ws.id, (m) => setMembers(m));
    const unsubP = subscribeProgress(
      ws.id,
      (p) => {
        setProgress(p);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setLoading(false);
      }
    );
    return () => {
      unsubG();
      unsubM();
      unsubP();
    };
  }, [isGroup, ws?.id]);

  if (!isGroup) {
    return (
      <Layout title="수업 활동">
        <div className="card text-center">
          <p className="text-slate-700">
            이 수업 활동은 <strong>모둠 작업실</strong>에서 진행해요.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            대시보드에서 모둠 작업실로 전환하거나, 모둠을 만들어 시작하세요.
          </p>
          <Button variant="primary" className="mt-4" onClick={() => navigate("/student")}>
            ← 대시보드로
          </Button>
        </div>
      </Layout>
    );
  }

  if (loading || !progress) return <LoadingOverlay message="수업 진행 상황 확인 중..." />;

  // 순차 게이트 — 아직 열리지 않은 단계면 현재 단계로 안내
  if (stage > progress.stage) {
    const cur = stageMeta(progress.stage);
    return (
      <Layout title="아직 열리지 않은 단계예요">
        <StageBar current={progress.stage} viewing={stage} />
        <div className="card mt-4 text-center">
          <p className="text-slate-700">
            {stage}단계는 <strong>{stage - 1}단계를 마쳐야</strong> 열려요.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            지금은 <strong>{progress.stage}단계 · {cur.title}</strong> 차례예요.
          </p>
          <Button variant="primary" className="mt-4" onClick={() => navigate(cur.path)}>
            {progress.stage}단계로 가기 →
          </Button>
        </div>
      </Layout>
    );
  }

  const isLeader = Boolean(group?.leaderUid && group.leaderUid === user?.uid);

  return (
    <Layout
      title={title}
      subtitle={subtitle}
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/student")}>
            ← 대시보드
          </Button>
          {actions}
        </>
      }
    >
      <StageBar current={progress.stage} viewing={stage} />
      <div className="mt-6">
        {typeof children === "function"
          ? children({ group, members, progress, isLeader })
          : children}
      </div>
    </Layout>
  );
}

export function StageBar({ current, viewing }) {
  const navigate = useNavigate();
  return (
    <nav className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-glow">
      {STAGES.map((s, i) => {
        const done = s.n < current;
        const isCurrent = s.n === viewing;
        const locked = s.n > current;
        const cls = isCurrent
          ? "bg-brand-600 text-white shadow"
          : done
          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : locked
          ? "bg-slate-50 text-slate-400"
          : "bg-surface-low text-ink-variant hover:bg-slate-100";
        return (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-300">›</span>}
            <button
              type="button"
              disabled={locked}
              onClick={() => !locked && navigate(s.path)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition ${cls}`}
              title={locked ? "앞 단계를 먼저 마쳐야 열려요" : s.short}
            >
              <span className="font-black">{s.n}</span>
              <span>{s.title}</span>
              {done && <span>✓</span>}
              {locked && (
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                  lock
                </span>
              )}
            </button>
          </div>
        );
      })}
    </nav>
  );
}

/** 단계 하단 게이트 버튼 — 미충족 조건을 그대로 보여준다. */
export function StageGateFooter({ blockers = [], label, onComplete, busy, note }) {
  const ready = blockers.length === 0;
  return (
    <div className="sticky bottom-4 mt-8 rounded-2xl border border-brand-100 bg-white/95 p-5 shadow-glow-lg backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {ready ? (
            <p className="text-sm font-semibold text-emerald-700">
              ✓ 조건을 모두 충족했어요. 다음 단계로 넘어갈 수 있습니다.
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold text-amber-800">남은 일</p>
              <ul className="mt-1 space-y-0.5">
                {blockers.map((b, i) => (
                  <li key={i} className="text-xs text-amber-800">
                    · {b}
                  </li>
                ))}
              </ul>
            </>
          )}
          {note && <p className="mt-1.5 text-[11px] text-ink-muted">{note}</p>}
        </div>
        <Button
          variant="primary"
          disabled={!ready || busy}
          loading={busy}
          onClick={onComplete}
        >
          {label}
        </Button>
      </div>
    </div>
  );
}
