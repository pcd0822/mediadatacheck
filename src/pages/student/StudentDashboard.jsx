import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import {
  getAlgorithmModel,
  listChecklists,
  listFactCheckHistory,
  listFeedbackCards,
} from "../../services/firestore.js";
import Mascot from "../../components/Mascot.jsx";
import { DIMENSIONS, DIMENSION_INFO, weightsToArray } from "../../utils/hpfm.js";

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
    icon: "format_list_bulleted",
    bigIcon: "format_list_bulleted",
    title: "체크리스트 만들기",
    desc: "내가 미디어를 평가할 때 쓸 질문과 1~5점 기준을 직접 만들어요. 저장하면 5가지 평가 기준에 자동으로 정리됩니다.",
    cta: "체크리스트 작성",
    path: "/student/checklist",
    accent: "brand",
  },
  {
    key: "modeling",
    index: "02",
    icon: "model_training",
    bigIcon: "cognition",
    title: "내 평가 기준 다듬기",
    desc: "선생님이 올린 미디어를 직접 평가하고 선생님 평가와 비교해, 내 기준을 조금씩 다듬어요.",
    cta: "기준 다듬기 시작",
    path: "/student/modeling",
    accent: "purple",
  },
  {
    key: "factcheck",
    index: "03",
    icon: "verified",
    bigIcon: "verified",
    title: "미디어 팩트체크",
    desc: "AI가 5가지 기준으로 미디어를 평가하면, 내 기준을 적용해 50점 만점 점수와 오차범위를 보여줘요.",
    cta: "팩트체크 실행",
    path: "/student/factcheck",
    accent: "orange",
  },
];

const ACCENTS = {
  brand: {
    iconBg: "bg-brand-50",
    iconText: "text-brand-600",
    btn: "bg-brand-600 hover:bg-brand-500 shadow-brand-500/20",
    border: "hover:border-brand-200",
  },
  purple: {
    iconBg: "bg-purple-50",
    iconText: "text-purple-600",
    btn: "bg-purple-600 hover:bg-purple-700 shadow-purple-500/20",
    border: "hover:border-purple-200",
  },
  orange: {
    iconBg: "bg-orange-50",
    iconText: "text-orange-600",
    btn: "bg-orange-600 hover:bg-orange-700 shadow-orange-500/20",
    border: "hover:border-orange-200",
  },
};

export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ checklists: 0, history: 0 });
  const [model, setModel] = useState(null);
  const [cards, setCards] = useState([]);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      const [cl, m, hist, fb] = await Promise.all([
        listChecklists(user.uid),
        getAlgorithmModel(user.uid),
        listFactCheckHistory(user.uid),
        listFeedbackCards(user.uid),
      ]);
      setStats({ checklists: cl.length, history: hist.length });
      setModel(m);
      setCards(fb);
      setLoading(false);
    })();
  }, [user]);

  const greetingName = profile?.displayName ?? "학생";
  const convergencePct =
    model?.convergenceScore != null
      ? `${(model.convergenceScore * 100).toFixed(0)}%`
      : "-";

  return (
    <Layout
      title="학생 대시보드"
      subtitle={`반가워요, ${greetingName} 학생! 오늘은 어떤 미디어를 살펴볼까요?`}
    >
      {loading ? (
        <SkeletonList count={3} />
      ) : (
        <>
          <section className="mb-8 flex flex-col items-center gap-5 rounded-3xl border border-brand-50 bg-gradient-to-br from-brand-50 to-white p-6 sm:flex-row sm:p-7">
            <Mascot size={120} className="shrink-0" />
            <div className="text-center sm:text-left">
              <h2 className="font-display text-xl font-bold text-ink">
                안녕! 나는 너의 팩트체크 친구야 👋
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-variant">
                오늘도 미디어를 똑똑하게 살펴보자. 아래 단계를 차근차근 따라오면 너만의 평가 기준이 점점 또렷해져요.
              </p>
            </div>
          </section>

          <section className="mb-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="내 체크리스트"
              value={stats.checklists}
              unit="개"
              tone="brand"
              icon="checklist"
              tag="진행 중"
              tagTone="emerald"
            />
            <StatCard
              label="쌓인 평가"
              value={model?.trainingDataCount ?? 0}
              unit="개"
              tone="purple"
              icon="model_training"
              tag={model?.trainingDataCount >= 5 ? "기준 다듬는 중" : "기준 잡는 중"}
              tagTone={model?.trainingDataCount >= 5 ? "emerald" : "amber"}
            />
            <StatCard
              label="선생님과 닮은 정도"
              value={convergencePct}
              tone="emerald"
              icon="trending_up"
              tag="성장 그래프"
              tagTone="slate"
            />
            <StatCard
              label="팩트체크 기록"
              value={stats.history}
              unit="건"
              tone="orange"
              icon="history_edu"
              tag="누적"
              tagTone="slate"
            />
          </section>

          {model?.weights && (
            <section className="mb-10 rounded-3xl border border-slate-100 bg-white p-7 shadow-glow">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="font-display text-xl font-bold tracking-tight text-ink">
                    내가 중요하게 보는 5가지 기준
                  </h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    평가를 거듭할수록 막대 길이가 너의 판단 습관에 맞춰 조금씩 변해요. 다섯 막대를 합치면 100%가 돼요.
                  </p>
                </div>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {weightsToArray(model.weights).map((w) => (
                  <div key={w.code} className="flex items-center gap-3">
                    <span className="w-32 truncate text-xs text-ink-variant">
                      {w.name}
                    </span>
                    <div className="flex-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-base">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-500"
                          style={{ width: `${w.mu * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-16 text-right text-xs font-bold text-brand-700">
                      {(w.mu * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mb-10 rounded-3xl border border-slate-100 bg-white p-7 shadow-glow">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="font-display text-xl font-bold tracking-tight text-ink">
                  내 평가 습관 분석
                </h3>
                <p className="mt-1 text-xs text-ink-muted">
                  선생님 평가와 비교해서 알아낸 너의 평가 버릇이야. 자기 점검에 활용해봐.
                </p>
              </div>
              <span className="badge bg-emerald-50 text-emerald-700">
                안정 {DIMENSIONS.length - cards.length} / {DIMENSIONS.length}개 기준
              </span>
            </div>

            <PrincipleProgress cards={cards} />

            {cards.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-surface-low p-6 text-center">
                <p className="text-sm font-semibold text-ink">
                  5가지 기준 모두에서 안정적으로 평가하고 있어요! 🎉
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  미디어를 더 평가할수록 너만의 평가 습관이 더 자세히 분석돼요.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {cards.map((c) => {
                  const info = DIMENSION_INFO[c.dimension];
                  const meta = TYPE_META[c.type] ?? TYPE_META.inconsistent;
                  const tone = TYPE_TONES[meta.tone];
                  const friendlyFramework = (c.framework ?? info?.framework ?? "")
                    .replace(/^IFCN\s*강령\s*\d+\s*[—–-]\s*/, "")
                    .replace(/^IFCN\s*/, "");
                  return (
                    <div
                      key={c.id ?? `${c.dimension}-${c.type}`}
                      className={`rounded-2xl p-4 ring-1 ${tone.bg} ${tone.ring}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-ink">
                          {c.dimensionName ?? info?.name}
                        </p>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 12 }}
                          >
                            {meta.icon}
                          </span>
                          {meta.label}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-ink-variant">{c.diagnosis}</p>
                      <p className="mt-1 text-[11px] leading-5 text-ink-variant/80">
                        {c.suggestion}
                      </p>
                      {friendlyFramework && (
                        <p className="mt-2 text-[10px] font-semibold text-ink-muted">
                          🎯 핵심 원칙: {friendlyFramework}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-5">
            <h3 className="font-display text-xl font-bold tracking-tight text-ink">
              차근차근 따라가보기
            </h3>
            {STEPS.map((s) => {
              const a = ACCENTS[s.accent];
              return (
                <div
                  key={s.key}
                  className={`group relative flex flex-col items-center gap-6 overflow-hidden rounded-3xl border border-slate-100 bg-white p-7 shadow-[0_8px_32px_rgba(0,0,0,0.04)] transition-all md:flex-row ${a.border}`}
                >
                  <div className="pointer-events-none absolute right-4 top-4 opacity-[0.04] transition-opacity group-hover:opacity-[0.08]">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 120 }}
                    >
                      {s.bigIcon}
                    </span>
                  </div>
                  <div
                    className={`flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl ${a.iconBg} ${a.iconText} font-display text-2xl font-black`}
                  >
                    {s.index}
                  </div>
                  <div className="flex-grow">
                    <h4 className="mb-1.5 font-display text-lg font-bold tracking-tight text-ink">
                      {s.title}
                    </h4>
                    <p className="text-[15px] leading-relaxed text-ink-variant">
                      {s.desc}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(s.path)}
                    className={`flex-shrink-0 rounded-xl px-7 py-3.5 font-bold text-white shadow-lg transition-all active:scale-95 ${a.btn}`}
                  >
                    {s.cta}
                  </button>
                </div>
              );
            })}
          </section>

          <section
            className="mt-10 flex h-60 items-center overflow-hidden rounded-3xl px-10 text-white"
            style={{
              background: "linear-gradient(135deg, #0058bc 0%, #0070eb 100%)",
            }}
          >
            <div className="relative z-10 max-w-md">
              <h3 className="mb-2 font-display text-2xl font-bold">
                디지털 세상의 수호자
              </h3>
              <p className="mb-5 text-sm leading-relaxed text-blue-100">
                팩트체크는 단순한 확인을 넘어, 건강한 민주주의를 지키는 가장 강력한
                도구입니다.
              </p>
              <div className="flex gap-2">
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs backdrop-blur-sm">
                  #미디어리터러시
                </span>
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs backdrop-blur-sm">
                  #비판적사고
                </span>
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs backdrop-blur-sm">
                  #팩트체크
                </span>
              </div>
            </div>
          </section>
        </>
      )}
    </Layout>
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
        {tag && (
          <span className={`rounded-md px-2 py-1 text-xs font-bold ${TAG_TONES[tagTone]}`}>
            {tag}
          </span>
        )}
      </div>
      <h3 className="mb-1 text-sm font-semibold text-ink">{label}</h3>
      <div className="flex items-baseline gap-1">
        <span className={`font-display text-3xl font-extrabold ${t.value}`}>
          {value}
        </span>
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
          <div
            key={d}
            className={`rounded-xl px-3 py-2 ring-1 ${
              stable
                ? "bg-emerald-50 ring-emerald-100"
                : "bg-white ring-slate-200"
            }`}
            title={info.description}
          >
            <p className="flex items-center gap-1 text-[11px] font-bold text-ink">
              <span
                className={`material-symbols-outlined ${
                  stable ? "text-emerald-600" : "text-slate-400"
                }`}
                style={{ fontSize: 14 }}
              >
                {stable ? "check_circle" : "radio_button_unchecked"}
              </span>
              {info.name}
            </p>
            <p className="mt-0.5 text-[10px] text-ink-muted">
              {stable ? "안정" : "조금 더!"}
            </p>
          </div>
        );
      })}
    </div>
  );
}
