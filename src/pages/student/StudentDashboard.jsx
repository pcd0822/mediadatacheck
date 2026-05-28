import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import {
  getAlgorithmModel,
  listChecklists,
  listFactCheckHistory,
  listFeedbackCards,
  subscribeAlgorithmModel,
  subscribeChecklists,
  subscribeFeedbackCards,
} from "../../services/firestore.js";
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
  masteryToArray,
  weightsToArray,
} from "../../utils/hpfm.js";

const TYPE_META = {
  over: { label: "후한 평가", icon: "trending_up", tone: "rose" },
  under: { label: "박한 평가", icon: "trending_down", tone: "amber" },
  inconsistent: { label: "기준 흔들림", icon: "shuffle", tone: "slate" },
};

const TYPE_TONES = {
  rose: { bg: "bg-rose-50", ring: "ring-rose-100", chip: "bg-rose-100 text-rose-800" },
  amber: { bg: "bg-amber-50", ring: "ring-amber-100", chip: "bg-amber-100 text-amber-800" },
  slate: { bg: "bg-surface-low", ring: "ring-ink-line/30", chip: "bg-slate-200 text-slate-700" },
};

const STEPS = [
  {
    key: "checklist",
    index: "01",
    bigIcon: "format_list_bulleted",
    title: "체크리스트 만들기",
    desc: "미디어를 평가할 때 쓸 질문과 1~5점 기준을 직접 만들어요. 저장하면 5대 검증 행동에 자동으로 정리됩니다.",
    cta: "체크리스트 작성",
    path: "/student/checklist",
    accent: "brand",
  },
  {
    key: "modeling",
    index: "02",
    bigIcon: "cognition",
    title: "평가 기준 다듬기",
    desc: "선생님이 올린 미디어를 직접 평가하면서 평가 기준을 조금씩 다듬어요.",
    cta: "기준 다듬기 시작",
    path: "/student/modeling",
    accent: "purple",
  },
  {
    key: "factcheck",
    index: "03",
    bigIcon: "verified",
    title: "미디어 팩트체크",
    desc: "AI가 5대 검증 행동으로 미디어를 평가하면, 가중치를 적용해 50점 만점 점수와 오차범위를 보여줘요.",
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
  const [checklistCount, setChecklistCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [model, setModel] = useState(null);
  const [cards, setCards] = useState([]);

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState(false);

  // 활성 작업실 데이터 실시간(모델·피드백·체크리스트는 단일/소규모라 저비용)
  useEffect(() => {
    if (!ws) return undefined;
    setLoading(true);
    setModel(null);
    const unsubCl = subscribeChecklists(ws, (list) => {
      setChecklistCount(list.length);
      setLoading(false);
    });
    const unsubModel = subscribeAlgorithmModel(ws, (m) => setModel(m));
    const unsubFb = subscribeFeedbackCards(ws, (fb) => setCards(fb));
    listFactCheckHistory(ws)
      .then((h) => setHistoryCount(h.length))
      .catch(() => setHistoryCount(0));
    return () => {
      unsubCl();
      unsubModel();
      unsubFb();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.type, ws?.id]);

  // 모둠 메타 + 멤버 실시간
  useEffect(() => {
    if (!isGroup || !ws) {
      setGroup(null);
      setMembers([]);
      return undefined;
    }
    const unsubG = subscribeGroup(ws.id, (g) => setGroup(g));
    const unsubM = subscribeMembers(ws.id, (mm) => setMembers(mm));
    return () => {
      unsubG();
      unsubM();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, ws?.id]);

  const greetingName = profile?.displayName ?? "학생";
  const convergencePct =
    model?.convergenceScore != null ? `${(model.convergenceScore * 100).toFixed(0)}%` : "-";

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
            <Button variant="ghost" onClick={handleLeave}>모둠 나가기</Button>
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
                {isGroup
                  ? "모둠원이 함께 만든 체크리스트와 기준으로 미디어를 살펴봐요. 변경 사항은 모두에게 실시간으로 반영돼요."
                  : "오늘도 미디어를 똑똑하게 살펴보자. 아래 단계를 차근차근 따라오면 너만의 평가 기준이 점점 또렷해져요."}
              </p>
            </div>
          </section>

          <section className="mb-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={isGroup ? "모둠 체크리스트" : "내 체크리스트"} value={checklistCount} unit="개" tone="brand" icon="checklist" tag="진행 중" tagTone="emerald" />
            <StatCard label="쌓인 평가" value={model?.trainingDataCount ?? 0} unit="개" tone="purple" icon="model_training" tag={model?.trainingDataCount >= 5 ? "기준 다듬는 중" : "기준 잡는 중"} tagTone={model?.trainingDataCount >= 5 ? "emerald" : "amber"} />
            <StatCard label={isGroup ? "모둠 기준 자리잡힌 정도" : "내 기준 자리잡힌 정도"} value={convergencePct} tone="emerald" icon="trending_up" tag="성장 그래프" tagTone="slate" />
            <StatCard label="팩트체크 기록" value={historyCount} unit="건" tone="orange" icon="history_edu" tag="누적" tagTone="slate" />
          </section>

          {model?.weights && (
            <section className="mb-10 rounded-3xl border border-slate-100 bg-white p-7 shadow-glow">
              <div className="mb-4">
                <h3 className="font-display text-xl font-bold tracking-tight text-ink">
                  {isGroup ? "우리 모둠이 중요하게 보는 5대 검증 행동" : "내가 중요하게 보는 5대 검증 행동"}
                </h3>
                <p className="mt-1 text-xs text-ink-muted">
                  평가를 거듭할수록 막대 길이가 판단 습관에 맞춰 조금씩 변해요. 다섯 막대를 합치면 100%가 돼요.
                </p>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {weightsToArray(model.weights).map((w) => (
                  <div key={w.code} className="flex items-center gap-3">
                    <span className="w-40 truncate text-xs text-ink-variant">
                      <span className="font-bold text-brand-600">{w.code}</span> {w.name}
                    </span>
                    <div className="flex-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-base">
                        <div className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-500" style={{ width: `${w.mu * 100}%` }} />
                      </div>
                    </div>
                    <span className="w-16 text-right text-xs font-bold text-brand-700">{(w.mu * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {model?.mastery && (
            <section className="mb-10 rounded-3xl border border-slate-100 bg-white p-7 shadow-glow">
              <div className="mb-4">
                <h3 className="font-display text-xl font-bold tracking-tight text-ink">검증 행동 마스터리</h3>
                <p className="mt-1 text-xs text-ink-muted">
                  각 검증 행동을 얼마나 안정적으로 수행하는지 보여줘요. 격차가 작고 σ가 줄어들수록 마스터리가 올라가요.
                </p>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {masteryToArray(model.mastery).map((m) => {
                  const pct = Math.max(0, Math.min(100, m.value * 100));
                  const tone = pct >= 70 ? "emerald" : pct >= 40 ? "amber" : "rose";
                  const barColor = tone === "emerald" ? "from-emerald-400 to-emerald-600" : tone === "amber" ? "from-amber-400 to-amber-600" : "from-rose-400 to-rose-600";
                  const textColor = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-rose-700";
                  return (
                    <div key={m.code} className="flex items-center gap-3">
                      <span className="w-40 truncate text-xs text-ink-variant">
                        <span className={`font-bold ${textColor}`}>{m.code}</span> {m.name}
                      </span>
                      <div className="flex-1">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-base">
                          <div className={`h-2 rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className={`w-16 text-right text-xs font-bold ${textColor}`}>
                        {pct.toFixed(0)}%{pct < 40 && " ⚠️"}{pct >= 80 && " 🌟"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mb-10 rounded-3xl border border-slate-100 bg-white p-7 shadow-glow">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="font-display text-xl font-bold tracking-tight text-ink">
                  {isGroup ? "우리 모둠 평가 습관 분석" : "내 평가 습관 분석"}
                </h3>
                <p className="mt-1 text-xs text-ink-muted">지금까지 평가한 결과에서 발견한 평가 버릇이야. 자기 점검에 활용해봐.</p>
              </div>
              <span className="badge bg-emerald-50 text-emerald-700">
                안정 {DIMENSIONS.length - cards.length} / {DIMENSIONS.length}개 검증 행동
              </span>
            </div>

            <PrincipleProgress cards={cards} />

            {cards.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-surface-low p-6 text-center">
                <p className="text-sm font-semibold text-ink">5대 검증 행동 모두에서 안정적으로 평가하고 있어요! 🎉</p>
                <p className="mt-1 text-xs text-ink-muted">미디어를 더 평가할수록 평가 습관이 더 자세히 분석돼요.</p>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {cards.map((c) => {
                  const info = DIMENSION_INFO[c.dimension];
                  const meta = TYPE_META[c.type] ?? TYPE_META.inconsistent;
                  const tone = TYPE_TONES[meta.tone];
                  return (
                    <div key={c.id ?? `${c.dimension}-${c.type}`} className={`rounded-2xl p-4 ring-1 ${tone.bg} ${tone.ring}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-ink">{c.dimensionName ?? info?.name}</p>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}>
                          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{meta.icon}</span>
                          {meta.label}
                        </span>
                      </div>
                      <p className="mt-2 text-xs font-semibold text-ink">{c.diagnosis}</p>
                      {c.detail && <p className="mt-1.5 text-[11px] leading-5 text-ink-variant">{c.detail}</p>}
                      {c.suggestion && (
                        <div className="mt-2 rounded-lg bg-white/70 px-3 py-2">
                          <p className="text-[11px] leading-5 text-ink-variant">
                            <span className="font-semibold text-brand-700">💡 다음엔:</span> {c.suggestion}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
      const [sourceModel, sourceFeedbackCards] = await Promise.all([
        getAlgorithmModel(personalWorkspace).catch(() => null),
        listFeedbackCards(personalWorkspace).catch(() => []),
      ]);
      const { groupId } = await createGroup(leader, {
        groupName: name,
        sourceChecklist,
        sourceModel,
        sourceFeedbackCards,
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

function PrincipleProgress({ cards }) {
  const flagged = new Set((cards ?? []).map((c) => c.dimension));
  return (
    <div className="grid gap-2 rounded-2xl bg-surface-low p-3 sm:grid-cols-5">
      {DIMENSIONS.map((d) => {
        const info = DIMENSION_INFO[d];
        const stable = !flagged.has(d);
        return (
          <div key={d} className={`rounded-xl px-3 py-2 ring-1 ${stable ? "bg-emerald-50 ring-emerald-100" : "bg-white ring-slate-200"}`} title={info.description}>
            <p className="flex items-center gap-1 text-[11px] font-bold text-ink">
              <span className={`material-symbols-outlined ${stable ? "text-emerald-600" : "text-slate-400"}`} style={{ fontSize: 14 }}>
                {stable ? "check_circle" : "radio_button_unchecked"}
              </span>
              {info.name}
            </p>
            <p className="mt-0.5 text-[10px] text-ink-muted">{stable ? "안정" : "조금 더!"}</p>
          </div>
        );
      })}
    </div>
  );
}
