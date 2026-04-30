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

    // Gemini 원본 점수 vs 학생 정교화 점수 격차 (정교화 모드일 때 의미 있음)
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

    // 가중치 갱신: refined일 때 강하게(η×1.5), accept면 σ만 약간 감소
    const tCount = (model?.trainingDataCount ?? 0) + 1;
    let nextWeights = model?.weights ?? initialWeights();
    if (refined) {
      nextWeights = bayesianUpdate(
        nextWeights,
        { dimensionScores: scores, gap },
        { trainingDataCount: model?.trainingDataCount ?? 0, refineMultiplier: 1.5 }
      );
    } else {
      // accept만으로도 σ 점진 감소 (관측치 누적)
      nextWeights = bayesianUpdate(
        nextWeights,
        { dimensionScores: scores, gap: {} },
        { trainingDataCount: model?.trainingDataCount ?? 0 }
      );
    }

    const teacherImplicit = model?.teacherImplicitWeights ?? null;
    const conv = teacherImplicit ? convergenceScore(nextWeights, teacherImplicit) : model?.convergenceScore ?? null;

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
        <Button variant="secondary" onClick={() => navigate("/student")}>← 대시보드</Button>
      </Layout>
    );

  const cold = isColdStart(model?.trainingDataCount ?? 0);

  return (
    <Layout
      title="팩트체크 결과 (HPFM)"
      subtitle={history.media?.title}
      actions={<Button variant="secondary" onClick={() => navigate("/student")}>← 대시보드</Button>}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">7대 차원 평가</h3>
            {mode === "view" ? (
              <span className="badge bg-emerald-50 text-emerald-700">Gemini 평가</span>
            ) : (
              <span className="badge bg-amber-50 text-amber-700">정교화 모드 (η×1.5)</span>
            )}
          </div>
          <div className="space-y-3">
            {DIMENSIONS.map((dim) => {
              const info = DIMENSION_INFO[dim];
              const w = weights?.[dim] ?? { mu: 1 / 7, sigma: 0.15 };
              const reason = history.dimensionReasons?.[dim];
              const value = scores[dim] ?? 3;
              return (
                <div key={dim} className="rounded-xl bg-slate-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {dim} · {info.name}
                      </p>
                      <p className="text-[11px] text-slate-500">{info.framework}</p>
                    </div>
                    <span className="badge">
                      가중치 {(w.mu * 100).toFixed(0)}%{" "}
                      <span className="text-[10px] text-slate-400">±{(w.sigma * 100).toFixed(0)}</span>
                    </span>
                  </div>

                  {mode === "view" ? (
                    <div className="mt-2 flex items-center gap-3">
                      <p className="text-2xl font-bold text-brand-700">
                        {value}<span className="text-sm text-slate-400">/5</span>
                      </p>
                      <div className="flex-1 h-2 rounded-full bg-white">
                        <div
                          className="h-2 rounded-full bg-brand-500"
                          style={{ width: `${(value / 5) * 100}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="range"
                        min={1}
                        max={5}
                        step={1}
                        value={value}
                        onChange={(e) => setDimScore(dim, e.target.value)}
                        className="flex-1 accent-brand-600"
                      />
                      <span className="w-10 text-right text-sm font-bold text-brand-700">{value}</span>
                    </div>
                  )}
                  {reason && (
                    <p className="mt-2 text-xs leading-5 text-slate-600">근거: {reason}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="card flex flex-col">
          <p className="text-sm text-slate-500">최종 점수 (50점 만점)</p>
          <p className="mt-1 text-5xl font-extrabold text-brand-700">
            {totalScore.toFixed(1)}<span className="text-base text-slate-400">/50</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            95% 신뢰구간 {ci95[0].toFixed(1)} ~ {ci95[1].toFixed(1)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            가중평균 = Σ(D_i × μ_i) × 10 · Var = Σ D_i² × σ_i²
          </p>
          {cold && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Cold Start 단계 — 모델링을 더 진행하면 가중치가 정교해집니다.
            </p>
          )}
          {savedNote && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{savedNote}</p>
          )}

          <div className="mt-5 space-y-2">
            {mode === "view" ? (
              <>
                <Button variant="primary" className="w-full justify-center" onClick={handleAccept} loading={acting}>
                  🟢 수용 (학습에 반영)
                </Button>
                <Button variant="accent" className="w-full justify-center" onClick={() => setMode("refine")} disabled={acting}>
                  🟡 정교화 (점수 수정)
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" className="w-full justify-center" onClick={handleRefineSave} loading={acting}>
                  재계산 후 저장 (η×1.5)
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-center"
                  onClick={() => {
                    setMode("view");
                    setScores({ ...(history.dimensionScores ?? {}) });
                  }}
                >
                  되돌리기
                </Button>
              </>
            )}
          </div>
        </aside>
      </div>

      <div className="card mt-6">
        <h3 className="text-sm font-bold text-slate-900">평가 대상</h3>
        <p className="mt-1 text-sm font-semibold text-slate-800">{history.media?.title}</p>
        {history.media?.link && (
          <a href={history.media.link} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">
            원본 링크 ↗
          </a>
        )}
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{history.media?.content}</p>
      </div>
    </Layout>
  );
}
