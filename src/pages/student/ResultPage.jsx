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
  listTrainingData,
  replaceFeedbackCards,
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
  generateFeedbackCards,
  initialWeights,
  isColdStart,
  isLegacyDimMap,
  learningRate,
  migrateLegacyDimensionScores,
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
      // v1 잔재(D1~D7) dimension 키가 저장된 옛 history도 정상 표시되도록 자동 변환
      const rawScores = h?.dimensionScores ?? {};
      const normalized = isLegacyDimMap(rawScores)
        ? migrateLegacyDimensionScores(rawScores)
        : rawScores;
      const cleaned = {};
      for (const d of DIMENSIONS) {
        const v = Number(normalized?.[d]);
        if (Number.isFinite(v)) cleaned[d] = v;
      }
      setScores(cleaned);
      setLoading(false);
    })();
  }, [historyId, user]);

  // 학생 대시보드와 항상 같은 비중을 표시하도록 현재 model.weights를 우선 사용한다.
  // history.weightsSnapshot은 저장 시점(학습 전일 수 있음)의 값이라 정교화·수용 이후엔 stale.
  const weights =
    (model?.weights && Object.keys(model.weights).length > 0
      ? model.weights
      : null) ??
    history?.weightsSnapshot ??
    initialWeights();

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

    // 누적 학습 데이터의 격차 패턴으로 메타인지 피드백 카드 재생성
    try {
      const trainings = await listTrainingData(user.uid);
      const gapHistory = trainings
        .map((t) => t.gap)
        .filter((g) => g && Object.keys(g).length > 0);
      const cards = generateFeedbackCards(gapHistory);
      await replaceFeedbackCards(user.uid, cards);
    } catch (err) {
      console.warn("피드백 카드 갱신 실패", err);
    }
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
      setSavedNote("이번 평가가 내 기준에 반영됐어요. 5가지 기준 비중이 조금 다듬어졌습니다.");
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
      setSavedNote("내가 수정한 점수를 더 강하게 반영했어요. AI 결과와 다른 너의 판단이 큰 신호로 작동해요.");
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
  const hasScores = Object.keys(scores ?? {}).length > 0;
  // 학생 가중치가 (거의) 균일이면 학습 전 상태로 간주
  const uniformWeights = (() => {
    const u = 1 / DIMENSIONS.length;
    return DIMENSIONS.every(
      (d) => Math.abs((weights?.[d]?.mu ?? u) - u) < 1e-3
    );
  })();

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
          팩트체크 결과
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
              <span className="flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-xs font-bold tracking-wider text-brand-700">
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  auto_awesome
                </span>
                AI 평가
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold tracking-wider text-amber-800">
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  edit_note
                </span>
                내 점수로 수정 중
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
                        {info.name}
                      </h3>
                      <span className="rounded bg-surface-high px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                        내 기준 비중 {(w.mu * 100).toFixed(0)}%
                      </span>
                      <p className="mt-1 text-[11px] text-ink-muted">
                        {info.description}
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
              <p className="text-xs font-medium text-brand-700">
                대시보드의 내 기준 비중을 그대로 적용한 점수예요.
              </p>
              <p className="mt-1 text-[11px] text-brand-700/80">
                95% 확률로 {ci95[0].toFixed(1)} ~ {ci95[1].toFixed(1)}점 사이일 거예요.
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

            {!hasScores && (
              <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                저장된 평가 점수를 읽지 못했어요. 새 미디어로 다시 팩트체크를 실행해주세요.
              </p>
            )}
            {(cold || uniformWeights) && hasScores && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                {cold
                  ? "아직 평가가 적게 쌓여 5가지 기준을 동일한 비중으로 계산했어요. "
                  : "내 기준에 변화가 적어 5가지 기준이 거의 동일한 비중으로 계산됐어요. "}
                "기준 다듬기" 페이지에서 미디어 점수를 다양하게 매겨보면 비중이 또렷해져요.
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
                    {acting ? "저장 중..." : "수정한 점수로 저장하기"}
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
