import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
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
    title: "체크리스트 만들기",
    desc: "팩트체크 질문과 1~5점 루브릭을 직접 설계합니다 (저장 시 7대 차원 자동 분류).",
    cta: "체크리스트 작성",
    path: "/student/checklist",
  },
  {
    key: "modeling",
    title: "알고리즘 모델링 (HPFM)",
    desc: "선생님이 등록한 미디어를 평가해 베이지안 가중치(μ, σ)를 학습시킵니다.",
    cta: "모델링 시작",
    path: "/student/modeling",
  },
  {
    key: "factcheck",
    title: "미디어 팩트체크",
    desc: "Gemini 7대 차원 평가 + 내 모델로 50점 환산 (신뢰구간 포함).",
    cta: "팩트체크 실행",
    path: "/student/factcheck",
  },
];

export default function StudentDashboard() {
  const { user } = useAuth();
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

  return (
    <Layout title="학생 대시보드" subtitle="HPFM(Hybrid Progressive Fact-Check Model) 학습 현황">
      {loading ? (
        <SkeletonList count={3} />
      ) : (
        <>
          <div className="mb-6 grid gap-3 md:grid-cols-4">
            <SummaryCard label="내 체크리스트" value={`${stats.checklists}개`} />
            <SummaryCard label="누적 학습 데이터" value={`${model?.trainingDataCount ?? 0}개`} />
            <SummaryCard
              label="모델 수렴도"
              value={model?.convergenceScore != null ? `${(model.convergenceScore * 100).toFixed(0)}%` : "-"}
            />
            <SummaryCard label="팩트체크 기록" value={`${stats.history}건`} />
          </div>

          {model?.weights && (
            <div className="card mb-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">7대 차원 가중치 (HPFM)</h3>
                <span className="badge bg-brand-50 text-brand-700">
                  {model.version ?? "HPFM-1.0"} · η={Number(model.learningRate ?? 0).toFixed(3)}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {weightsToArray(model.weights).map((w) => (
                  <div key={w.code} className="flex items-center gap-3">
                    <span className="w-32 truncate text-xs text-slate-700">
                      <strong>{w.code}</strong> · {w.name}
                    </span>
                    <div className="flex-1">
                      <div className="h-2 w-full rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-brand-500"
                          style={{ width: `${w.mu * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-20 text-right text-xs font-semibold text-brand-700">
                      {(w.mu * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {cards.length > 0 && (
            <div className="card mb-6">
              <h3 className="text-base font-bold text-slate-900">메타인지 피드백 카드</h3>
              <p className="mt-1 text-xs text-slate-500">
                교사 평가와의 누적 격차에서 발견한 패턴이에요. 자기 점검에 활용해보세요.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {cards.map((c) => (
                  <div
                    key={c.id ?? `${c.dimension}-${c.type}`}
                    className={`rounded-xl p-3 ring-1 ${
                      c.type === "over"
                        ? "bg-rose-50 ring-rose-100"
                        : c.type === "under"
                        ? "bg-amber-50 ring-amber-100"
                        : "bg-slate-50 ring-slate-200"
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {c.dimension} · {c.dimensionName}
                    </p>
                    <p className="mt-1 text-xs text-slate-700">{c.diagnosis}</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-600">{c.suggestion}</p>
                    <p className="mt-1 text-[10px] text-slate-400">참고: {c.framework}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4">
            {STEPS.map((s, i) => (
              <div
                key={s.key}
                className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                    STEP {i + 1}
                  </p>
                  <h3 className="mt-1 text-base font-bold text-slate-900">{s.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{s.desc}</p>
                </div>
                <Button variant="primary" onClick={() => navigate(s.path)}>
                  {s.cta} →
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </Layout>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
