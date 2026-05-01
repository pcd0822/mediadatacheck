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
import { weightsToArray } from "../../utils/hpfm.js";

const STEPS = [
  {
    key: "checklist",
    index: "01",
    icon: "format_list_bulleted",
    bigIcon: "format_list_bulleted",
    title: "체크리스트 만들기",
    desc: "팩트체크 질문과 1~5점 루브릭을 직접 설계합니다 (저장 시 IFCN 5대 차원 자동 분류).",
    cta: "체크리스트 작성",
    path: "/student/checklist",
    accent: "brand",
  },
  {
    key: "modeling",
    index: "02",
    icon: "model_training",
    bigIcon: "cognition",
    title: "알고리즘 모델링 (IPFM)",
    desc: "선생님이 등록한 미디어를 평가해 베이지안 가중치(μ, σ)를 학습시킵니다.",
    cta: "모델링 시작",
    path: "/student/modeling",
    accent: "purple",
  },
  {
    key: "factcheck",
    index: "03",
    icon: "verified",
    bigIcon: "verified",
    title: "미디어 팩트체크",
    desc: "Gemini IFCN 5대 차원 평가 + 내 모델로 50점 환산 (신뢰구간 포함).",
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
      subtitle={`반가워요, ${greetingName} 학생! 오늘은 어떤 미디어를 분석해볼까요? 학습 단계를 차근차근 따라가 보세요.`}
    >
      {loading ? (
        <SkeletonList count={3} />
      ) : (
        <>
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
              label="학습 데이터"
              value={model?.trainingDataCount ?? 0}
              unit="개"
              tone="purple"
              icon="model_training"
              tag={model?.trainingDataCount >= 5 ? "활성" : "Cold"}
              tagTone={model?.trainingDataCount >= 5 ? "emerald" : "amber"}
            />
            <StatCard
              label="모델 수렴도"
              value={convergencePct}
              tone="emerald"
              icon="trending_up"
              tag={model?.version ?? "IPFM-2.0"}
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
                    IFCN 5대 차원 가중치 (IPFM)
                  </h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    베이지안 평균 μ를 100% 정규화한 막대그래프입니다.
                  </p>
                </div>
                <span className="badge">
                  η = {Number(model.learningRate ?? 0).toFixed(3)}
                </span>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {weightsToArray(model.weights).map((w) => (
                  <div key={w.code} className="flex items-center gap-3">
                    <span className="w-32 truncate text-xs text-ink-variant">
                      <strong className="text-brand-700">{w.code}</strong> · {w.name}
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

          {cards.length > 0 && (
            <section className="mb-10 rounded-3xl border border-slate-100 bg-white p-7 shadow-glow">
              <h3 className="font-display text-xl font-bold tracking-tight text-ink">
                메타인지 피드백 카드
              </h3>
              <p className="mt-1 text-xs text-ink-muted">
                교사 평가와의 누적 격차에서 발견한 패턴이에요. 자기 점검에 활용해보세요.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {cards.map((c) => (
                  <div
                    key={c.id ?? `${c.dimension}-${c.type}`}
                    className={`rounded-2xl p-4 ring-1 ${
                      c.type === "over"
                        ? "bg-rose-50 ring-rose-100"
                        : c.type === "under"
                        ? "bg-amber-50 ring-amber-100"
                        : "bg-surface-low ring-ink-line/30"
                    }`}
                  >
                    <p className="text-sm font-bold text-ink">
                      {c.dimension} · {c.dimensionName}
                    </p>
                    <p className="mt-1 text-xs text-ink-variant">{c.diagnosis}</p>
                    <p className="mt-1 text-[11px] leading-5 text-ink-variant/80">
                      {c.suggestion}
                    </p>
                    <p className="mt-1 text-[10px] text-ink-muted">
                      참고: {c.framework}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-5">
            <h3 className="font-display text-xl font-bold tracking-tight text-ink">
              학습 가이드
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
                  #리터러시
                </span>
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs backdrop-blur-sm">
                  #비판적사고
                </span>
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs backdrop-blur-sm">
                  #IPFM
                </span>
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs backdrop-blur-sm">
                  #IFCN
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
