import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import {
  listChecklists,
  listFactCheckHistory,
  subscribeChecklists,
} from "../../services/firestore.js";
import { subscribeProgress } from "../../services/lesson.js";
import { STAGES, stageMeta } from "../../constants/lesson.js";
import {
  MAX_GROUP_MEMBERS,
  createGroup,
  leaveGroup,
  removeMember,
  subscribeGroup,
  subscribeMembers,
} from "../../services/groups.js";
import Mascot from "../../components/Mascot.jsx";
import {
  DIMENSIONS,
  DIMENSION_INFO,
  averageDimensionMaps,
} from "../../utils/hpfm.js";

const STEPS = [
  {
    key: "checklist",
    index: "01",
    bigIcon: "format_list_bulleted",
    title: "체크리스트 만들기",
    desc: "미디어를 평가할 때 쓸 질문과 1~5점 기준(루브릭)을 직접 만들어요. 이 체크리스트가 점수의 유일한 근거예요.",
    cta: "체크리스트 작성",
    path: "/student/checklist",
    accent: "brand",
  },
  {
    key: "factcheck",
    index: "02",
    bigIcon: "verified",
    title: "미디어 팩트체크",
    desc: "AI가 우리 체크리스트를 한 항목씩 적용해 1~5점을 매겨요. 항목 점수를 합해 원점수·백분율로 보여줘요.",
    cta: "팩트체크 실행",
    path: "/student/factcheck",
    accent: "orange",
  },
];

const ACCENTS = {
  brand: { iconBg: "bg-brand-50", iconText: "text-brand-600", btn: "bg-brand-600 hover:bg-brand-500 shadow-brand-500/20", border: "hover:border-brand-200" },
  purple: { iconBg: "bg-purple-50", iconText: "text-purple-600", btn: "bg-purple-600 hover:bg-purple-700 shadow-purple-500/20", border: "hover:border-purple-200" },
  orange: { iconBg: "bg-orange-50", iconText: "text-orange-600", btn: "bg-orange-600 hover:bg-orange-700 shadow-orange-500/20", border: "hover:border-orange-200" },
};

export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const {
    activeWorkspace: ws,
    isGroup,
    myGroups,
    setActiveWorkspace,
    refreshGroups,
    personalWorkspace,
  } = useWorkspace();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [checklists, setChecklists] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedChecklistId, setSelectedChecklistId] = useState("all");

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [progress, setProgress] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState(false);

  // 체크리스트는 실시간(소규모), 팩트체크 기록은 1회 로드(무료 쿼터 보호).
  useEffect(() => {
    if (!ws) return undefined;
    setLoading(true);
    setHistory([]);
    setSelectedChecklistId("all");
    const unsubCl = subscribeChecklists(ws, (list) => {
      setChecklists(list);
      setLoading(false);
    });
    listFactCheckHistory(ws)
      .then((h) => setHistory(h))
      .catch(() => setHistory([]));
    return () => unsubCl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.type, ws?.id]);

  // 모둠 메타 + 멤버 실시간
  useEffect(() => {
    if (!isGroup || !ws) {
      setGroup(null);
      setMembers([]);
      setProgress(null);
      return undefined;
    }
    const unsubG = subscribeGroup(ws.id, (g) => setGroup(g));
    const unsubM = subscribeMembers(ws.id, (mm) => setMembers(mm));
    const unsubP = subscribeProgress(ws.id, (p) => setProgress(p), (e) => console.error(e));
    return () => {
      unsubG();
      unsubM();
      unsubP();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, ws?.id]);

  const greetingName = profile?.displayName ?? "학생";

  // v5.0 기록(itemResults 보유)만 요약 통계에 쓴다. v4.0 기록은 계산 방식이 달라 섞지 않는다.
  const currentHistory = useMemo(
    () => history.filter((h) => Array.isArray(h.itemResults)),
    [history]
  );

  const filteredHistory = useMemo(
    () =>
      selectedChecklistId === "all"
        ? currentHistory
        : currentHistory.filter((h) => h.checklistId === selectedChecklistId),
    [currentHistory, selectedChecklistId]
  );

  const avgPercent = useMemo(() => {
    const vals = filteredHistory
      .map((h) => Number(h.percent))
      .filter((v) => Number.isFinite(v));
    if (!vals.length) return null;
    return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
  }, [filteredHistory]);

  const naTotal = useMemo(
    () => filteredHistory.reduce((s, h) => s + Number(h.naCount ?? 0), 0),
    [filteredHistory]
  );

  const dimensionAverages = useMemo(
    () => averageDimensionMaps(filteredHistory.map((h) => h.dimensionAverages)),
    [filteredHistory]
  );

  // 선택된 체크리스트의 항목 dimension 분포로 누락 검증 행동을 식별.
  // 점수와 무관하지만 "우리 기준이 어떤 검증 행동을 안 보고 있는지" 자기 점검에 쓰인다.
  const coverage = useMemo(() => {
    const targetLists =
      selectedChecklistId === "all"
        ? checklists
        : checklists.filter((c) => c.id === selectedChecklistId);
    const covered = new Set();
    let totalItems = 0;
    for (const cl of targetLists) {
      for (const item of cl.items ?? []) {
        totalItems += 1;
        if (DIMENSIONS.includes(item.dimension)) covered.add(item.dimension);
      }
    }
    return {
      covered: [...covered],
      missing: DIMENSIONS.filter((d) => !covered.has(d)),
      totalItems,
      hasAnyList: targetLists.length > 0,
    };
  }, [checklists, selectedChecklistId]);

  const selectedChecklistLabel =
    selectedChecklistId === "all"
      ? "전체 체크리스트"
      : checklists.find((c) => c.id === selectedChecklistId)?.checklistName ??
        "(삭제된 체크리스트)";

  const isLeader = group?.leaderUid === user?.uid;
  const shareUrl =
    group?.shareCode && typeof window !== "undefined"
      ? `${window.location.origin}/student/join/${group.shareCode}`
      : "";

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드 불가 — 사용자가 직접 선택 복사
    }
  };

  const handleLeave = async () => {
    if (!group) return;
    if (!confirm("이 모둠에서 나가시겠어요?")) return;
    await leaveGroup(group.id, user.uid);
    await refreshGroups();
    setActiveWorkspace(personalWorkspace);
  };

  const handleRemove = async (uid) => {
    if (!group || !isLeader) return;
    if (!confirm("이 모둠원을 내보낼까요?")) return;
    await removeMember(group.id, uid);
  };

  return (
    <Layout
      title="학생 대시보드"
      subtitle={`반가워요, ${greetingName} 학생! 오늘은 어떤 미디어를 살펴볼까요?`}
    >
      {/* ===== 작업실 전환 바 ===== */}
      <section className="mb-6 rounded-2xl border border-slate-100 bg-white p-4 shadow-glow">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">작업실</p>
          <Button variant="ghost" onClick={() => setShowCreate(true)}>+ 모둠 만들기</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <WorkspaceChip
            active={!isGroup}
            icon="person"
            label="내 개인 작업실"
            onClick={() => setActiveWorkspace(personalWorkspace)}
          />
          {myGroups.map((g) => (
            <WorkspaceChip
              key={g.id}
              active={isGroup && ws?.id === g.id}
              icon="groups"
              label={g.groupName}
              badge={g.role === "leader" ? "조장" : null}
              onClick={() =>
                setActiveWorkspace({ type: "group", id: g.id, name: g.groupName })
              }
            />
          ))}
        </div>
      </section>

      {/* ===== 모둠 패널 ===== */}
      {isGroup && group && (
        <section className="mb-8 rounded-2xl border border-brand-100 bg-brand-50/40 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-bold text-brand-800">
                {group.groupName}
              </h3>
              <p className="text-xs text-ink-muted">
                모둠원 {members.length}/{MAX_GROUP_MEMBERS}명 · 체크리스트와 팩트체크를 함께 사용해요
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isLeader && (
                <Button
                  variant="secondary"
                  onClick={() => navigate("/student/group-media")}
                >
                  모둠 자료 등록
                </Button>
              )}
              <Button variant="ghost" onClick={handleLeave}>모둠 나가기</Button>
            </div>
          </div>

          {isLeader && shareUrl && (
            <div className="mt-3 rounded-xl border border-brand-100 bg-white p-3">
              <p className="mb-1 text-[11px] font-semibold text-ink-muted">
                공유 링크 (모둠원에게 보내주세요) · 코드 {group.shareCode}
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="input flex-1 text-xs"
                  onFocus={(e) => e.target.select()}
                />
                <Button variant="secondary" onClick={handleCopy}>
                  {copied ? "복사됨 ✓" : "복사"}
                </Button>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {members.map((m) => (
              <span
                key={m.uid}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-ink-variant ring-1 ring-brand-100"
              >
                <span className="material-symbols-outlined text-brand-500" style={{ fontSize: 14 }}>
                  {m.role === "leader" ? "star" : "person"}
                </span>
                {m.name ?? m.email ?? "모둠원"}
                {m.role === "leader" && <span className="text-[10px] font-bold text-brand-600">조장</span>}
                {isLeader && m.uid !== user.uid && (
                  <button
                    type="button"
                    onClick={() => handleRemove(m.uid)}
                    className="ml-1 text-slate-400 hover:text-rose-500"
                    aria-label="모둠원 내보내기"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <SkeletonList count={3} />
      ) : (
        <>
          <section className="mb-8 flex flex-col items-center gap-5 rounded-3xl border border-brand-50 bg-gradient-to-br from-brand-50 to-white p-6 sm:flex-row sm:p-7">
            <Mascot size={120} className="shrink-0" />
            <div className="text-center sm:text-left">
              <h2 className="font-display text-xl font-bold text-ink">
                {isGroup ? "우리 모둠 작업실이에요 👥" : "안녕! 나는 너의 팩트체크 친구야 👋"}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-variant">
                점수의 근거는 <strong>우리가 만든 체크리스트 하나</strong>예요. AI가 매긴 점수에
                동의가 안 되면 그건 오류가 아니라 <strong>토론할 거리</strong>예요. AI의 근거를
                읽고 우리 판단과 견주어 보세요.
              </p>
            </div>
          </section>

          {isGroup ? (
            <LessonPanel progress={progress} onGo={(path) => navigate(path)} />
          ) : (
            <section className="mb-8 rounded-2xl border border-slate-200 bg-surface-low px-5 py-4">
              <p className="text-sm font-bold text-ink">수업 활동은 모둠 작업실에서 진행해요</p>
              <p className="mt-1 text-xs text-ink-variant">
                지표 할당 → 자료 등록 → 블라인드 채점 → AI 비교로 이어지는 수업 흐름은 모둠 단위로
                진행됩니다. 위에서 모둠 작업실로 전환하거나 모둠을 만들어보세요. 개인 작업실에서는
                아래 자유 팩트체크를 쓸 수 있어요.
              </p>
            </section>
          )}

          <section className="mb-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={isGroup ? "모둠 체크리스트" : "내 체크리스트"}
              value={checklists.length}
              unit="개"
              tone="brand"
              icon="checklist"
              tag={`항목 ${coverage.totalItems}개`}
              tagTone="emerald"
            />
            <StatCard
              label="팩트체크 기록"
              value={currentHistory.length}
              unit="건"
              tone="orange"
              icon="history_edu"
              tag="v5.0 기준"
              tagTone="slate"
            />
            <StatCard
              label="평균 백분율"
              value={avgPercent == null ? "–" : avgPercent}
              unit={avgPercent == null ? "" : "%"}
              tone="purple"
              icon="percent"
              tag="모둠 비교용"
              tagTone="slate"
            />
            <StatCard
              label="AI 판단 불가(N/A)"
              value={naTotal}
              unit="개"
              tone="emerald"
              icon="help"
              tag="직접 조사할 몫"
              tagTone={naTotal > 0 ? "amber" : "slate"}
            />
          </section>

          {checklists.length > 1 && (
            <section className="mb-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-glow">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="dashboard-cl" className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  분석 기준 체크리스트
                </label>
                <select
                  id="dashboard-cl"
                  className="input max-w-xs"
                  value={selectedChecklistId}
                  onChange={(e) => setSelectedChecklistId(e.target.value)}
                >
                  <option value="all">전체 (모든 체크리스트)</option>
                  {checklists.map((cl) => (
                    <option key={cl.id} value={cl.id}>{cl.checklistName}</option>
                  ))}
                </select>
                <p className="text-[11px] text-ink-muted">
                  ※ 아래 <strong>검증 행동별 평균</strong>과 통계에 함께 적용돼요.
                </p>
              </div>
            </section>
          )}

          <section className="mb-10 rounded-3xl border border-slate-100 bg-white p-7 shadow-glow">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="font-display text-xl font-bold tracking-tight text-ink">
                  검증 행동별 평균
                </h3>
                <p className="mt-1 text-xs text-ink-muted">
                  우리 체크리스트 항목을 5대 검증 행동으로 묶어 평균낸 값이에요.{" "}
                  <strong>점수 계산에는 쓰이지 않아요.</strong> 어떤 검증 행동에서 자료가 약한지,
                  우리 기준이 어디에 몰려 있는지 살펴보는 용도예요.
                </p>
              </div>
              {checklists.length > 1 && (
                <span className="badge bg-brand-50 text-brand-700">
                  {selectedChecklistLabel} · 기록 {filteredHistory.length}건
                </span>
              )}
            </div>

            {coverage.missing.length > 0 && coverage.hasAnyList && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                ⚠️ 이 체크리스트엔 다음 검증 행동을 묻는 항목이 없어요 —{" "}
                <strong>
                  {coverage.missing.map((d) => `${d} ${DIMENSION_INFO[d].name}`).join(", ")}
                </strong>
                . 그 영역은 <strong>아예 채점되지 않습니다.</strong> 필요하다면 체크리스트에 질문을 추가해보세요.
              </div>
            )}

            <div className="grid gap-2.5 md:grid-cols-2">
              {DIMENSIONS.map((d) => {
                const v = Number(dimensionAverages?.[d]);
                const noData = !Number.isFinite(v);
                const pct = noData ? 0 : Math.max(0, Math.min(100, (v / 5) * 100));
                const missing = coverage.missing.includes(d);
                const tone = noData ? "slate" : pct >= 70 ? "emerald" : pct >= 40 ? "amber" : "rose";
                const barColor =
                  noData ? "from-slate-300 to-slate-400"
                  : tone === "emerald" ? "from-emerald-400 to-emerald-600"
                  : tone === "amber" ? "from-amber-400 to-amber-600"
                  : "from-rose-400 to-rose-600";
                const textColor =
                  noData ? "text-slate-400"
                  : tone === "emerald" ? "text-emerald-700"
                  : tone === "amber" ? "text-amber-700"
                  : "text-rose-700";
                return (
                  <div key={d} className="flex items-center gap-3">
                    <span className="w-40 truncate text-xs text-ink-variant">
                      <span className={`font-bold ${textColor}`}>{d}</span>{" "}
                      {DIMENSION_INFO[d].name}
                      {missing && (
                        <span
                          className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800"
                          title="이 검증 행동을 묻는 체크리스트 항목이 없어요"
                        >
                          항목 없음
                        </span>
                      )}
                    </span>
                    <div className="flex-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-base">
                        <div
                          className={`h-2 rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className={`w-16 text-right text-xs font-bold ${textColor}`}>
                      {noData ? "–" : `${v.toFixed(1)}/5`}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-5">
            <h3 className="font-display text-xl font-bold tracking-tight text-ink">차근차근 따라가보기</h3>
            {STEPS.map((s) => {
              const a = ACCENTS[s.accent];
              return (
                <div key={s.key} className={`group relative flex flex-col items-center gap-6 overflow-hidden rounded-3xl border border-slate-100 bg-white p-7 shadow-[0_8px_32px_rgba(0,0,0,0.04)] transition-all md:flex-row ${a.border}`}>
                  <div className="pointer-events-none absolute right-4 top-4 opacity-[0.04] transition-opacity group-hover:opacity-[0.08]">
                    <span className="material-symbols-outlined" style={{ fontSize: 120 }}>{s.bigIcon}</span>
                  </div>
                  <div className={`flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl ${a.iconBg} ${a.iconText} font-display text-2xl font-black`}>{s.index}</div>
                  <div className="flex-grow">
                    <h4 className="mb-1.5 font-display text-lg font-bold tracking-tight text-ink">{s.title}</h4>
                    <p className="text-[15px] leading-relaxed text-ink-variant">{s.desc}</p>
                  </div>
                  <button type="button" onClick={() => navigate(s.path)} className={`flex-shrink-0 rounded-xl px-7 py-3.5 font-bold text-white shadow-lg transition-all active:scale-95 ${a.btn}`}>{s.cta}</button>
                </div>
              );
            })}
          </section>
        </>
      )}

      {showCreate && (
        <CreateGroupModal
          leader={{ uid: user.uid, name: profile?.displayName ?? user.displayName ?? null, email: user.email ?? null }}
          personalWorkspace={personalWorkspace}
          onClose={() => setShowCreate(false)}
          onCreated={async (groupId, groupName) => {
            await refreshGroups();
            setActiveWorkspace({ type: "group", id: groupId, name: groupName });
            setShowCreate(false);
          }}
        />
      )}
    </Layout>
  );
}

/** 모둠 작업실 상단의 수업 활동 진행 패널 — 현재 단계로 바로 들어가게 한다. */
function LessonPanel({ progress, onGo }) {
  const stage = progress?.stage ?? 1;
  const cur = stageMeta(stage);
  return (
    <section className="mb-8 rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-6 shadow-glow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">수업 활동</p>
          <h3 className="mt-0.5 font-display text-xl font-bold text-ink">
            {stage}단계 · {cur.title}
          </h3>
          <p className="mt-1 text-sm text-ink-variant">{cur.short}</p>
        </div>
        <button
          type="button"
          onClick={() => onGo(cur.path)}
          className="rounded-xl bg-brand-600 px-6 py-3 font-bold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-500 active:scale-95"
        >
          {stage}단계 이어하기 →
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {STAGES.map((s) => {
          const done = s.n < stage;
          const isCur = s.n === stage;
          const locked = s.n > stage;
          return (
            <button
              key={s.key}
              type="button"
              disabled={locked}
              onClick={() => !locked && onGo(s.path)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                isCur
                  ? "bg-brand-600 text-white"
                  : done
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "bg-white/70 text-slate-400"
              }`}
            >
              {s.n} {s.title}
              {done && " ✓"}
              {locked && " 🔒"}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WorkspaceChip({ active, icon, label, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
        active ? "bg-brand-600 text-white shadow" : "bg-surface-low text-ink-variant hover:bg-slate-100"
      }`}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
      <span className="max-w-[160px] truncate">{label}</span>
      {badge && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/20" : "bg-brand-100 text-brand-700"}`}>{badge}</span>
      )}
    </button>
  );
}

function CreateGroupModal({ leader, personalWorkspace, onClose, onCreated }) {
  const [checklists, setChecklists] = useState([]);
  const [pickId, setPickId] = useState("");
  const [name, setName] = useState("우리 모둠");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const cls = await listChecklists(personalWorkspace);
        setChecklists(cls);
        setPickId(cls[0]?.id ?? "");
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [personalWorkspace]);

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const sourceChecklist = checklists.find((c) => c.id === pickId) ?? null;
      const { groupId } = await createGroup(leader, {
        groupName: name,
        sourceChecklist,
      });
      await onCreated(groupId, name.trim() || "우리 모둠");
    } catch (e) {
      console.error(e);
      setError(e.message || "모둠 생성에 실패했어요.");
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 font-display text-lg font-bold text-ink">모둠 만들기</h3>
        <p className="mb-4 text-xs text-ink-muted">
          내 체크리스트를 모둠 작업실로 복사해 시작해요. 만든 뒤 공유 링크를 모둠원에게 보내주세요.
        </p>

        <label className="label">모둠 이름</label>
        <input className="input mb-3" value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 3모둠 팩트체크" />

        <label className="label">시작할 체크리스트</label>
        {loading ? (
          <p className="text-sm text-slate-400">불러오는 중...</p>
        ) : checklists.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            아직 만든 체크리스트가 없어요. 빈 체크리스트로 모둠을 시작합니다.
          </p>
        ) : (
          <select className="input" value={pickId} onChange={(e) => setPickId(e.target.value)}>
            {checklists.map((c) => (
              <option key={c.id} value={c.id}>{c.checklistName} (항목 {c.items?.length ?? 0}개)</option>
            ))}
          </select>
        )}

        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={handleCreate} loading={creating}>모둠 만들기</Button>
        </div>
      </div>
    </div>
  );
}

const STAT_TONES = {
  brand: { iconBg: "bg-brand-50", iconText: "text-brand-600", value: "text-brand-600" },
  purple: { iconBg: "bg-purple-50", iconText: "text-purple-600", value: "text-purple-600" },
  emerald: { iconBg: "bg-emerald-50", iconText: "text-emerald-600", value: "text-emerald-600" },
  orange: { iconBg: "bg-orange-50", iconText: "text-orange-600", value: "text-orange-600" },
};

const TAG_TONES = {
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  slate: "bg-surface-low text-ink-muted",
};

function StatCard({ label, value, unit, tone = "brand", icon, tag, tagTone = "slate" }) {
  const t = STAT_TONES[tone] ?? STAT_TONES.brand;
  return (
    <div className="group rounded-2xl border border-slate-100 bg-white p-6 shadow-glow transition-all duration-300 hover:scale-[1.02] hover:shadow-glow-md">
      <div className="mb-4 flex items-center justify-between">
        <div className={`grid h-12 w-12 place-items-center rounded-xl ${t.iconBg} ${t.iconText}`}>
          <span className="material-symbols-outlined text-2xl">{icon}</span>
        </div>
        {tag && <span className={`rounded-md px-2 py-1 text-xs font-bold ${TAG_TONES[tagTone]}`}>{tag}</span>}
      </div>
      <h3 className="mb-1 text-sm font-semibold text-ink">{label}</h3>
      <div className="flex items-baseline gap-1">
        <span className={`font-display text-3xl font-extrabold ${t.value}`}>{value}</span>
        {unit && <span className="text-base font-semibold text-ink-muted">{unit}</span>}
      </div>
    </div>
  );
}
