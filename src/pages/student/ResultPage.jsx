import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import {
  appendTrainingData,
  deleteFactCheckHistory,
  getAlgorithmModel,
  getFactCheckHistory,
  listTrainingData,
  replaceFeedbackCards,
  updateAlgorithmModel,
  updateFactCheckHistory,
} from "../../services/firestore.js";
import {
  DIMENSIONS,
  DIMENSION_INFO,
  applyCorrections,
  computeFinalScore,
  computeMastery,
  countAppliedCorrections,
  generateFeedbackCards,
  isLegacyDimMap,
  migrateLegacyDimensionScores,
} from "../../utils/hpfm.js";

// 등급(band)별 표시 메타. hpfm.js SCORE_BANDS의 key와 1:1 대응.
const BAND_META = {
  high: { label: "신뢰 높음", cls: "bg-emerald-50 text-emerald-700", hint: "신뢰도가 높은 미디어로 판단됩니다." },
  caution: { label: "주의", cls: "bg-amber-50 text-amber-700", hint: "총점은 보통이지만 일부 항목을 더 확인하는 게 좋아요." },
  low: { label: "신뢰 낮음", cls: "bg-rose-50 text-rose-700", hint: "비판적 점검이 강하게 권장됩니다. (팩트체크 경고)" },
  veryLow: { label: "매우 낮음", cls: "bg-rose-100 text-rose-800", hint: "신뢰하기 어려운 자료예요. 다른 자료를 우선 참고하세요." },
};

export default function ResultPage() {
  const { historyId } = useParams();
  const { user } = useAuth();
  const { activeWorkspace: ws } = useWorkspace();
  const navigate = useNavigate();
  const [history, setHistory] = useState(null);
  const [scores, setScores] = useState({});
  const [mode, setMode] = useState("view"); // view | refine
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [model, setModel] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [h, m] = await Promise.all([
        getFactCheckHistory(ws, historyId),
        getAlgorithmModel(ws),
      ]);
      setHistory(h);
      setModel(m);
      // 레거시(D1~D8 / C1~C6) dimension 키가 저장된 옛 history도 정상 표시되도록 자동 변환
      const rawScores = h?.dimensionScores ?? {};
      const normalized = isLegacyDimMap(rawScores)
        ? migrateLegacyDimensionScores(rawScores)
        : rawScores;
      const cleaned = {};
      for (const d of DIMENSIONS) {
        const raw = normalized?.[d];
        if (raw === null || raw === undefined) continue; // V4 N/A 등 skipped 보존
        const v = Number(raw);
        if (Number.isFinite(v)) cleaned[d] = v;
      }
      setScores(cleaned);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId, ws?.type, ws?.id]);

  // 저장 시점에 적용됐던 보정값(스냅샷)을 우선 사용해 저장된 결과와 표시를 일치시킨다.
  // (레거시 3.0 문서엔 correctionsSnapshot이 없으므로 현재 모델 보정값으로 폴백)
  const corrections = history?.correctionsSnapshot ?? model?.corrections ?? null;

  // scores = AI 수준(1~5) 작업 점수(정교화 시 편집 대상). aiRaw = 저장된 AI 원점수(불변, 격차 기준).
  const aiRaw = useMemo(() => {
    const raw = history?.dimensionScores ?? {};
    const normalized = isLegacyDimMap(raw) ? migrateLegacyDimensionScores(raw) : raw;
    const out = {};
    for (const d of DIMENSIONS) {
      const v = Number(normalized?.[d]);
      out[d] = Number.isFinite(v) ? v : null;
    }
    return out;
  }, [history]);

  const corrected = useMemo(
    () => applyCorrections(scores, corrections),
    [scores, corrections]
  );
  const result = useMemo(() => computeFinalScore(corrected), [corrected]);

  // 레거시(3.0) 문서는 보정 후 점수가 없으므로 저장된 totalScore를 그대로 표시한다.
  const isLegacyDoc = history?.correctedDimensionScores == null && history?.version !== "VAPM-4.0";
  const totalScore = isLegacyDoc
    ? Number(history?.finalTotalScore ?? history?.totalScore ?? result.total)
    : result.total;
  const bandMeta = BAND_META[result.band] ?? BAND_META.veryLow;

  const setDimScore = (dim, val) =>
    setScores((s) => ({ ...s, [dim]: Number(val) }));

  const persistTraining = async ({ refined }) => {
    const dataId = `factcheck_${historyId}`;
    // 격차 = 학생 최종(수정) 점수 − AI 원점수. 수용(미수정)이면 gap ≈ 0.
    // 수용/정교화는 보정값(corrections)을 바꾸지 않는다(교사 기준점이 없는 데이터).
    // training_data에 기록만 하고 피드백 카드·마스터리 재계산에만 사용한다.
    const gap = {};
    for (const d of DIMENSIONS) {
      const a = Number(scores[d]);
      const g = Number(aiRaw[d]);
      if (Number.isFinite(a) && Number.isFinite(g)) gap[d] = a - g;
    }

    await appendTrainingData(ws, dataId, {
      historyId,
      checklistId: history.checklistId,
      mediaTitle: history.media?.title ?? null,
      geminiScores: history.dimensionScores ?? {},
      finalScores: { ...scores },
      finalTotalScore: result.total,
      gap,
      source: refined ? "refine" : "accept",
    });

    // 마스터리·피드백 카드를 누적 격차로 재계산. corrections는 그대로 유지(트랜잭션으로 lost update 방지).
    const trainings = await listTrainingData(ws);
    const gapHistory = trainings
      .map((t) => t.gap)
      .filter((g) => g && Object.keys(g).length > 0);
    const cards = generateFeedbackCards(gapHistory);
    await replaceFeedbackCards(ws, cards);
    const mastery = computeMastery(gapHistory);

    const updated = await updateAlgorithmModel(ws, (current) => ({
      corrections: current?.corrections ?? null,
      mastery,
      checklistId: current?.checklistId ?? history.checklistId,
      trainingDataCount: trainings.length,
    }));
    setModel((m) => ({ ...(m ?? {}), ...updated }));
  };

  const handleAccept = async () => {
    setActing(true);
    try {
      await persistTraining({ refined: false });
      await updateFactCheckHistory(ws, historyId, {
        accepted: true,
        finalDimensionScores: scores,
        finalTotalScore: totalScore,
      });
      setSavedNote("이번 평가를 기록했어요. 마스터리와 평가 습관 분석이 갱신됐습니다. (보정값은 '기준 다듬기'에서만 바뀌어요)");
    } catch (e) {
      console.error(e);
      alert(`반영 중 오류: ${e.message}`);
    } finally {
      setActing(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    const ok = window.confirm(
      "이 팩트체크 결과를 삭제할까요?\n\n자료와 점수가 사라지고, 이번 결과로 반영된 학습 데이터도 함께 정리돼요.\n(이미 가중치에 누적된 학습은 되돌릴 수 없어요.)"
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteFactCheckHistory(ws, historyId);
      navigate("/student/factcheck", { replace: true });
    } catch (e) {
      console.error(e);
      alert(`삭제 중 오류: ${e.message}`);
      setDeleting(false);
    }
  };

  const handleRefineSave = async () => {
    setActing(true);
    try {
      await persistTraining({ refined: true });
      await updateFactCheckHistory(ws, historyId, {
        accepted: true,
        refined: true,
        finalDimensionScores: scores,
        finalTotalScore: totalScore,
      });
      setSavedNote("내가 수정한 점수를 기록했어요. AI와 다른 너의 판단이 평가 습관 분석에 반영돼요.");
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

  const noCalibration = countAppliedCorrections(corrections) === 0;
  const scorePct = Math.max(0, Math.min(100, (totalScore / 50) * 100));
  const hasScores = Object.keys(scores ?? {}).length > 0;
  const alertNames = (result.alertDimensions ?? []).map(
    (d) => `${d}(${DIMENSION_INFO[d]?.name ?? ""})`
  );

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
        <>
          <Button variant="secondary" onClick={() => navigate("/student")}>
            ← 대시보드
          </Button>
          <Button variant="primary" onClick={() => navigate("/student/factcheck")}>
            다른 자료 팩트체크하기 →
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            loading={deleting}
            disabled={deleting || acting}
          >
            이 자료 삭제
          </Button>
        </>
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
              const reason = history.dimensionReasons?.[dim];
              const redFlags = history.dimensionRedFlags?.[dim];
              const skipped =
                history.dimensionSkipped?.[dim] === true ||
                history.dimensionScores?.[dim] === null;
              const aiVal = aiRaw[dim];
              const correctedVal = corrected[dim];
              const corr = Number(corrections?.[dim]?.value);
              const hasCorr =
                Number.isFinite(corr) && corr !== 0 && Number.isFinite(correctedVal);
              const editing = mode === "refine";
              const hasScore = Number.isFinite(scores[dim]);
              const sliderValue = hasScore ? scores[dim] : 3;
              // 헤드라인 숫자: 보기 모드는 보정 후 값, 정교화 모드는 편집 중인 값.
              const headline = editing
                ? sliderValue
                : Number.isFinite(correctedVal)
                ? correctedVal
                : Number.isFinite(aiVal)
                ? aiVal
                : null;
              const isAlert = (result.alertDimensions ?? []).includes(dim);
              return (
                <div
                  key={dim}
                  className={`rounded-2xl border bg-white p-6 shadow-glow transition-transform hover:scale-[1.01] ${
                    isAlert ? "border-rose-200 ring-1 ring-rose-100" : "border-slate-100"
                  }`}
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-ink">
                        {info.code} · {info.name}
                        {info.metacognitive && (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">
                            메타인지
                          </span>
                        )}
                        {isAlert && (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                            항목 경고
                          </span>
                        )}
                      </h3>
                      <p className="mt-1 text-[11px] text-ink-muted">
                        {info.description}
                      </p>
                    </div>
                    <div className="text-right">
                      {skipped && headline === null ? (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                          해당 없음 (N/A)
                        </span>
                      ) : (
                        <>
                          <span className="font-display text-2xl font-extrabold text-brand-600">
                            {Number(headline).toFixed(1)}
                            <span className="text-base text-ink-muted">/5</span>
                          </span>
                          {!editing && hasCorr && (
                            <p className="mt-0.5 text-[11px] text-ink-muted">
                              AI {Number(aiVal).toFixed(0)}점{" "}
                              <span className={corr > 0 ? "text-emerald-600" : "text-rose-600"}>
                                (보정 {corr > 0 ? "+" : ""}{corr.toFixed(1)})
                              </span>
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {skipped && headline === null && mode === "view" ? (
                    <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-ink-muted">
                      본문에 시각 자료(사진·영상·그래프) 언급이 없어 이 행동은 평가에서 제외됐어요.
                      나머지 4개 행동의 평균으로 총점이 계산됩니다.
                    </p>
                  ) : mode === "view" ? (
                    <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-base">
                      <div
                        className={`h-2 rounded-full bg-gradient-to-r transition-all duration-500 ${
                          isAlert ? "from-rose-400 to-rose-600" : "from-brand-500 to-brand-600"
                        }`}
                        style={{ width: `${(Number(headline) / 5) * 100}%` }}
                      />
                    </div>
                  ) : (
                    <div className="mb-3 flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={5}
                        step={1}
                        value={sliderValue}
                        onChange={(e) => setDimScore(dim, e.target.value)}
                        className="flex-1 accent-brand-600"
                      />
                      <span className="w-10 text-right text-sm font-bold text-brand-700">
                        {Number(sliderValue).toFixed(1)}
                      </span>
                    </div>
                  )}

                  {editing && (
                    <p className="mb-3 text-[11px] text-ink-muted">
                      내 점수를 조정하면 AI 원점수와의 차이가 학습 신호로 기록돼요(보정값 자체는 바뀌지 않아요).
                    </p>
                  )}

                  {reason && (
                    <p className="text-sm leading-relaxed text-ink-variant">
                      <span className="font-bold text-brand-700">근거:</span>{" "}
                      {reason}
                    </p>
                  )}
                  {Array.isArray(redFlags) && redFlags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {redFlags.map((flag, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700"
                        >
                          ⚠️ {flag}
                        </span>
                      ))}
                    </div>
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
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${bandMeta.cls}`}>
                {bandMeta.label}
              </span>
              <p className="text-[11px] text-ink-muted">
                AI 점수에 교사 기준 보정을 적용한 점수예요.
              </p>
            </div>
            <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-surface-base">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-700"
                style={{ width: `${scorePct}%` }}
              />
            </div>
            <p className="mb-5 text-center text-xs font-medium text-ink-variant">
              {bandMeta.hint}
            </p>

            {result.dimensionAlert && (
              <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                ⚠️ 총점과 별개로 {alertNames.join(", ")} 확인이 심각하게 미흡해요(2점 미만).
                이 항목은 총점이 괜찮아도 반드시 다시 살펴보세요.
              </p>
            )}
            {!hasScores && (
              <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                저장된 평가 점수를 읽지 못했어요. 새 미디어로 다시 팩트체크를 실행해주세요.
              </p>
            )}
            {noCalibration && hasScores && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                아직 기준 다듬기 데이터가 적어 보정 없이 AI 점수를 그대로 계산했어요(항목별 3건 이상 필요).
                "기준 다듬기" 페이지에서 선생님 미디어를 더 채점하면 교사 기준 보정이 반영돼요.
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
          {history.media?.imageUrl && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                첨부 이미지 (V4 평가 대상)
              </p>
              <img
                src={history.media.imageUrl}
                alt="평가 대상 첨부 이미지"
                className="rounded-xl object-contain ring-1 ring-slate-200"
                style={{ maxWidth: "100%", maxHeight: "480px" }}
              />
            </div>
          )}
          <p className="mt-3 whitespace-pre-wrap text-[15px] italic leading-relaxed text-ink-variant">
            "{history.media?.content}"
          </p>
        </div>
      </section>
    </Layout>
  );
}
