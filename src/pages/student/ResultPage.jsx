import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import {
  appendTrainingData,
  getAlgorithmModel,
  getFactCheckHistory,
  saveAlgorithmModel,
  updateFactCheckHistory,
} from "../../services/firestore.js";
import {
  DIMENSIONS,
  DIMENSION_INFO,
  bayesianUpdate,
  computeFinalScore,
  confidenceInterval95,
  convergenceScore,
  initialWeights,
  isColdStart,
  learningRate,
  scoreVariance,
} from "../../utils/hpfm.js";

export default function ResultPage() {
  const { historyId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [history, setHistory] = useState(null);
  const [scores, setScores] = useState({});
  const [mode, setMode] = useState("view"); // view | refine
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [model, setModel] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [h, m] = await Promise.all([
        getFactCheckHistory(user.uid, historyId),
        getAlgorithmModel(user.uid),
      ]);
      setHistory(h);
      setModel(m);
      setScores({ ...(h?.dimensionScores ?? {}) });
      setLoading(false);
    })();
  }, [historyId, user]);

  const weights = history?.weightsSnapshot ?? model?.weights ?? initialWeights();

  const totalScore = useMemo(
    () => computeFinalScore(weights, scores),
    [weights, scores]
  );
  const variance = useMemo(
    () => scoreVariance(weights, scores),
    [weights, scores]
  );
  const ci95 = useMemo(
    () => confidenceInterval95(totalScore, variance),
    [totalScore, variance]
  );

  const setDimScore = (dim, val) =>
    setScores((s) => ({ ...s, [dim]: Number(val) }));

  const persistTraining = async ({ refined }) => {
    const dataId = `factcheck_${historyId}`;
    const targetScore = totalScore;
    const geminiScores = history.dimensionScores ?? {};
    const gap = {};
    for (const d of DIMENSIONS) {
      const a = Number(scores[d]);
      const g = Number(geminiScores[d]);
      if (Number.isFinite(a) && Number.isFinite(g)) gap[d] = a - g;
    }

    await appendTrainingData(user.uid, dataId, {
      historyId,
      checklistId: history.checklistId,
      mediaTitle: history.media?.title ?? null,
      geminiScores,
      finalScores: { ...scores },
      finalTotalScore: targetScore,
      gap,
      source: refined ? "refine" : "accept",
    });

    const tCount = (model?.trainingDataCount ?? 0) + 1;
    let nextWeights = model?.weights ?? initialWeights();
    if (refined) {
      nextWeights = bayesianUpdate(
        nextWeights,
        { dimensionScores: scores, gap },
        { trainingDataCount: model?.trainingDataCount ?? 0, refineMultiplier: 1.5 }
      );
    } else {
      nextWeights = bayesianUpdate(
        nextWeights,
        { dimensionScores: scores, gap: {} },
        { trainingDataCount: model?.trainingDataCount ?? 0 }
      );
    }

    const teacherImplicit = model?.teacherImplicitWeights ?? null;
    const conv = teacherImplicit
      ? convergenceScore(nextWeights, teacherImplicit)
      : model?.convergenceScore ?? null;

    await saveAlgorithmModel(user.uid, {
      weights: nextWeights,
      checklistId: model?.checklistId ?? history.checklistId,
      trainingDataCount: tCount,
      convergenceScore: conv,
      teacherImplicitWeights: teacherImplicit,
      learningRate: learningRate(tCount),
    });

    setModel((m) => ({
      ...(m ?? {}),
      weights: nextWeights,
      trainingDataCount: tCount,
      convergenceScore: conv,
    }));
  };

  const handleAccept = async () => {
    setActing(true);
    try {
      await persistTraining({ refined: false });
      await updateFactCheckHistory(user.uid, historyId, {
        accepted: true,
        finalDimensionScores: scores,
        finalTotalScore: totalScore,
      });
      setSavedNote("결과를 학습 데이터에 반영했습니다. 모델 가중치가 갱신되었어요.");
    } catch (e) {
      console.error(e);
      alert(`반영 중 오류: ${e.message}`);
    } finally {
      setActing(false);
    }
  };

  const handleRefineSave = async () => {
    setActing(true);
    try {
      await persistTraining({ refined: true });
      await updateFactCheckHistory(user.uid, historyId, {
        accepted: true,
        refined: true,
        finalDimensionScores: scores,
        finalTotalScore: totalScore,
      });
      setSavedNote("정교화한 점수를 더 강하게(η×1.5) 모델에 반영했어요.");
      setMode("view");
    } catch (e) {
      console.error(e);
      alert(`반영 중 오류: ${e.message}`);
    } finally {
      setActing(false);
    }
  };

  if (loading) return <LoadingOverlay message="결과 불러오는 중..." />;
  if (!history)
    return (
      <Layout title="결과를 찾을 수 없습니다">
        <Button variant="secondary" onClick={() => navigate("/student")}>
          ← 대시보드
        </Button>
      </Layout>
    );

  const cold = isColdStart(model?.trainingDataCount ?? 0);
  const scorePct = Math.max(0, Math.min(100, (totalScore / 50) * 100));

  return (
    <Layout
      title={
        <span className="flex items-center gap-3">
          <span
            className="material-symbols-outlined text-brand-600"
            style={{ fontSize: 32 }}
          >
            fact_check
          </span>
          팩트체크 결과 (IPFM)
        </span>
      }
      subtitle={`미디어 제목: ${history.media?.title ?? "(제목 없음)"}`}
      actions={
        <Button variant="secondary" onClick={() => navigate("/student")}>
          ← 대시보드
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">
              항목별 평가
            </h2>
            {mode === "view" ? (
              <span className="flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-700">
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  auto_awesome
                </span>
                Gemini 평가
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-800">
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  edit_note
                </span>
                정교화 모드 (η×1.5)
              </span>
            )}
          </div>

          <div className="space-y-4">
            {DIMENSIONS.map((dim) => {
              const info = DIMENSION_INFO[dim];
              const w = weights?.[dim] ?? { mu: 1 / DIMENSIONS.length, sigma: 0.15 };
              const reason = history.dimensionReasons?.[dim];
              const value = scores[dim] ?? 3;
              return (
                <div
                  key={dim}
                  className="rounded-2xl border border-slate-100 bg-white p-6 shadow-glow transition-transform hover:scale-[1.01]"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="mb-1 text-base font-bold text-ink">
                        {dim} · {info.name}
                      </h3>
                      <span className="rounded bg-surface-high px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                        가중치 {(w.mu * 100).toFixed(0)}% · σ{(w.sigma * 100).toFixed(0)}
                      </span>
                      <p className="mt-1 text-[11px] text-ink-muted">
                        {info.framework}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-display text-2xl font-extrabold text-brand-600">
                        {value}
                        <span className="text-base text-ink-muted">/5</span>
                      </span>
                    </div>
                  </div>

                  {mode === "view" ? (
                    <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-base">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-500"
                        style={{ width: `${(value / 5) * 100}%` }}
                      />
                    </div>
                  ) : (
                    <div className="mb-3 flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={5}
                        step={1}
                        value={value}
                        onChange={(e) => setDimScore(dim, e.target.value)}
                        className="flex-1 accent-brand-600"
                      />
                      <span className="w-10 text-right text-sm font-bold text-brand-700">
                        {value}
                      </span>
                    </div>
                  )}

                  {reason && (
                    <p className="text-sm leading-relaxed text-ink-variant">
                      <span className="font-bold text-brand-700">근거:</span>{" "}
                      {reason}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="lg:col-span-1">
          <div className="sticky top-24 rounded-2xl border border-brand-50 bg-white p-7 shadow-glow-lg">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-ink-muted">
              최종 점수 (50점 만점)
            </p>
            <div className="mb-6 flex items-baseline gap-2">
              <span className="font-display text-[56px] font-black leading-none text-brand-600">
                {totalScore.toFixed(1)}
              </span>
              <span className="text-2xl font-bold text-slate-300">/50</span>
            </div>
            <div className="mb-4 rounded-xl bg-brand-50 p-3">
              <p className="text-xs font-medium italic text-brand-700">
                가중평균 = Σ(C_i × μ_i) × 10
              </p>
              <p className="mt-1 text-[11px] text-brand-700/80">
                Var = Σ C_i² × σ_i² · 95% CI {ci95[0].toFixed(1)} ~{" "}
                {ci95[1].toFixed(1)}
              </p>
            </div>
            <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-surface-base">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-700"
                style={{ width: `${scorePct}%` }}
              />
            </div>
            <p className="mb-5 text-center text-xs font-medium text-ink-variant">
              {scorePct >= 80
                ? "신뢰도 높은 미디어로 판단됩니다."
                : scorePct >= 60
                ? "일부 점검이 필요한 미디어입니다."
                : "비판적 점검이 강하게 권장됩니다."}
            </p>

            {cold && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                Cold Start 단계 — 모델링을 더 진행하면 가중치가 정교해집니다.
              </p>
            )}
            {savedNote && (
              <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {savedNote}
              </p>
            )}

            <div className="space-y-2">
              {mode === "view" ? (
                <>
                  <button
                    type="button"
                    onClick={handleAccept}
                    disabled={acting}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-4 font-semibold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-500 active:scale-95 disabled:opacity-60"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      check_circle
                    </span>
                    🟢 수용 (학습에 반영)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("refine")}
                    disabled={acting}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-secondary/40 bg-white py-4 font-semibold text-secondary transition-all hover:bg-secondary-fixed/40 active:scale-95 disabled:opacity-60"
                    style={{ borderColor: "#006687", color: "#006687" }}
                  >
                    <span className="material-symbols-outlined">edit_note</span>
                    🟡 정교화 (점수 수정)
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleRefineSave}
                    disabled={acting}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-4 font-semibold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-500 active:scale-95 disabled:opacity-60"
                  >
                    {acting ? "저장 중..." : "재계산 후 저장 (η×1.5)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("view");
                      setScores({ ...(history.dimensionScores ?? {}) });
                    }}
                    className="w-full rounded-xl py-3 text-sm font-semibold text-ink-variant hover:bg-surface-low"
                  >
                    되돌리기
                  </button>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      <section className="mt-12 rounded-2xl border border-slate-200 bg-surface-low p-7">
        <h4 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
          <span
            className="material-symbols-outlined text-ink-variant"
            style={{ fontSize: 22 }}
          >
            article
          </span>
          평가 대상
        </h4>
        <div className="rounded-xl border border-slate-100 bg-white p-6">
          <p className="mb-2 text-sm font-bold text-ink">
            {history.media?.title}
          </p>
          {history.media?.link && (
            <a
              href={history.media.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-700 underline"
            >
              원본 링크 ↗
            </a>
          )}
          <p className="mt-3 whitespace-pre-wrap text-[15px] italic leading-relaxed text-ink-variant">
            "{history.media?.content}"
          </p>
        </div>
      </section>
    </Layout>
  );
}
