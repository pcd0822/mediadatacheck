import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import {
  appendTrainingData,
  clearTrainingData,
  getAlgorithmModel,
  getStudentEvaluation,
  listChecklists,
  listTeacherMediaWithTeacherEvals,
  replaceFeedbackCards,
  saveAlgorithmModel,
  saveStudentEvaluation,
} from "../../services/firestore.js";
import {
  DIMENSION_INFO,
  aggregateToDimensions,
  bayesianActive,
  bayesianUpdate,
  computeGap,
  convergenceScore,
  generateFeedbackCards,
  initialWeights,
  isColdStart,
  learningRate,
  teacherImplicitWeights,
  weightsToArray,
} from "../../utils/hpfm.js";

export default function ModelingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [checklists, setChecklists] = useState([]);
  const [activeChecklistId, setActiveChecklistId] = useState(null);
  const [media, setMedia] = useState([]);
  const [scoresByMedia, setScoresByMedia] = useState({});
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [model, setModel] = useState(null);
  const [detailMedia, setDetailMedia] = useState(null);

  const activeChecklist = useMemo(
    () => checklists.find((c) => c.id === activeChecklistId) ?? null,
    [checklists, activeChecklistId]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [cls, mediaItems, existingModel] = await Promise.all([
        listChecklists(user.uid),
        listTeacherMediaWithTeacherEvals(),
        getAlgorithmModel(user.uid),
      ]);
      setChecklists(cls);
      setMedia(mediaItems);
      setModel(existingModel);
      const initial =
        existingModel?.checklistId && cls.find((c) => c.id === existingModel.checklistId)
          ? existingModel.checklistId
          : cls[0]?.id ?? null;
      setActiveChecklistId(initial);
      setLoading(false);
    })();
  }, [user]);

  useEffect(() => {
    if (!activeChecklistId || media.length === 0) return;
    (async () => {
      const next = {};
      for (const m of media) {
        const ev = await getStudentEvaluation(m.id, user.uid);
        if (ev?.checklistId === activeChecklistId && ev?.items) {
          next[m.id] = ev.items;
        }
      }
      setScoresByMedia(next);
    })();
  }, [activeChecklistId, media, user]);

  const setScore = (mediaId, idx, value) => {
    setScoresByMedia((prev) => {
      const cur = prev[mediaId] ? [...prev[mediaId]] : [];
      cur[idx] = Number(value);
      return { ...prev, [mediaId]: cur };
    });
  };

  const evaluatedCount = useMemo(() => {
    if (!activeChecklist) return 0;
    return media.reduce((acc, m) => {
      const arr = scoresByMedia[m.id];
      if (!arr) return acc;
      const filled = activeChecklist.items.every((_, idx) => Number.isFinite(arr[idx]));
      return acc + (filled ? 1 : 0);
    }, 0);
  }, [media, scoresByMedia, activeChecklist]);

  const teacherEvaluatedCount = useMemo(
    () => media.filter((m) => m.teacherEvaluation?.dimensionScores).length,
    [media]
  );

  const handleTrain = async () => {
    if (!activeChecklist) return;
    if (evaluatedCount === 0) {
      alert("최소 1개 이상의 미디어를 평가해주세요.");
      return;
    }
    if (!activeChecklist.items.every((it) => it.dimension)) {
      alert(
        "체크리스트 항목들이 5가지 기준에 아직 분류되지 않았어요. 체크리스트 페이지에서 한번 더 저장해주세요."
      );
      return;
    }
    setTraining(true);
    try {
      const pairs = [];
      for (const m of media) {
        const arr = scoresByMedia[m.id];
        if (!arr || arr.length === 0) continue;
        const studentDims = aggregateToDimensions(activeChecklist.items, arr);
        await saveStudentEvaluation(m.id, user.uid, {
          items: arr,
          checklistId: activeChecklistId,
          dimensionScores: studentDims,
        });
        const teacherDims = m.teacherEvaluation?.dimensionScores;
        if (teacherDims) pairs.push({ studentDims, teacherDims, mediaId: m.id });
      }

      const totalCount = (model?.trainingDataCount ?? 0) + pairs.length;
      let weights = model?.weights && Object.keys(model.weights).length
        ? { ...model.weights }
        : initialWeights();

      if (!isColdStart(totalCount) && pairs.length > 0) {
        let count = model?.trainingDataCount ?? 0;
        for (const p of pairs) {
          const gap = computeGap(p.studentDims, p.teacherDims);
          weights = bayesianUpdate(
            weights,
            { dimensionScores: p.studentDims, gap },
            { trainingDataCount: count }
          );
          count += 1;
        }
      }

      const teacherDimsList = media
        .map((m) => m.teacherEvaluation?.dimensionScores)
        .filter(Boolean);
      const teacherImplicit = teacherImplicitWeights(teacherDimsList);
      const conv = convergenceScore(weights, teacherImplicit);

      await clearTrainingData(user.uid);
      const gapHistory = [];
      for (const p of pairs) {
        const gap = computeGap(p.studentDims, p.teacherDims);
        gapHistory.push(gap);
        await appendTrainingData(user.uid, `media_${p.mediaId}`, {
          mediaId: p.mediaId,
          checklistId: activeChecklistId,
          studentDimensionScores: p.studentDims,
          teacherDimensionScores: p.teacherDims,
          gap,
          source: "modeling",
        });
      }
      const cards = generateFeedbackCards(gapHistory);
      await replaceFeedbackCards(user.uid, cards);

      const trained = {
        weights,
        checklistId: activeChecklistId,
        trainingDataCount: totalCount,
        convergenceScore: conv,
        teacherImplicitWeights: teacherImplicit,
        learningRate: learningRate(totalCount),
      };
      await saveAlgorithmModel(user.uid, trained);
      setModel(trained);
    } catch (e) {
      console.error(e);
      alert(`학습 중 오류: ${e.message}`);
    } finally {
      setTraining(false);
    }
  };

  if (loading) return <Layout title="기준 다듬기"><SkeletonList count={3} /></Layout>;

  if (!checklists.length) {
    return (
      <Layout title="기준 다듬기" subtitle="먼저 체크리스트를 만들어야 해요">
        <div className="card text-center">
          <p className="text-slate-600">체크리스트가 없어요.</p>
          <Button variant="primary" className="mt-3" onClick={() => navigate("/student/checklist")}>
            체크리스트 만들러 가기
          </Button>
        </div>
      </Layout>
    );
  }

  if (media.length === 0) {
    return (
      <Layout title="기준 다듬기" subtitle="선생님이 올린 미디어를 평가해요">
        <div className="card text-center">
          <p className="text-slate-600">아직 선생님이 올린 미디어가 없어요.</p>
          <Button variant="secondary" className="mt-3" onClick={() => navigate("/student")}>← 대시보드</Button>
        </div>
      </Layout>
    );
  }

  const tCount = model?.trainingDataCount ?? 0;
  const phaseLabel = isColdStart(tCount)
    ? "기준 잡는 중"
    : bayesianActive(tCount)
    ? "기준 다듬는 중"
    : "기준 시험해보는 중";
  const phaseHint = isColdStart(tCount)
    ? "평가가 더 모이면 본격적으로 기준이 다듬어져요"
    : bayesianActive(tCount)
    ? "이제 너의 평가 습관이 안정적으로 반영돼요"
    : "조금만 더 평가하면 본격적인 다듬기가 시작돼요";

  return (
    <Layout
      title="내 평가 기준 다듬기"
      subtitle="여러 미디어를 평가하면서 내 평가 기준을 조금씩 다듬어요"
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/student")}>← 대시보드</Button>
          <Button variant="primary" onClick={handleTrain} loading={training}>
            저장하고 기준 다듬기
          </Button>
        </>
      }
    >
      <div className="card mb-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="label">사용할 체크리스트</label>
            <select
              className="input"
              value={activeChecklistId ?? ""}
              onChange={(e) => setActiveChecklistId(e.target.value)}
            >
              {checklists.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.checklistName} (항목 {cl.items?.length ?? 0}개)</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">
              내가 평가한 미디어 {evaluatedCount} / {media.length} · 기준 평가가 준비된 미디어 {teacherEvaluatedCount}건
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-right">
            <p className="text-xs text-slate-500">진행 단계</p>
            <p className="text-sm font-bold text-slate-800">{phaseLabel}</p>
            <p className="mt-1 text-[11px] leading-tight text-slate-500">{phaseHint}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {media.map((m) => (
          <MediaEvaluator
            key={m.id}
            media={m}
            checklist={activeChecklist}
            scores={scoresByMedia[m.id] ?? []}
            onChange={(idx, v) => setScore(m.id, idx, v)}
            onOpenDetail={() => setDetailMedia(m)}
          />
        ))}
      </div>

      <MediaDetailDrawer
        media={detailMedia}
        open={!!detailMedia}
        onClose={() => setDetailMedia(null)}
      />

      {model?.weights && (
        <div className="card mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">내가 중요하게 보는 5가지 기준</h3>
            {Number.isFinite(model.convergenceScore) && (
              <span className="badge bg-brand-50 text-brand-700">
                내 기준 자리잡힌 정도 {(model.convergenceScore * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            막대 길이 = 그 기준을 얼마나 중요하게 보는지. 평가가 쌓일수록 안정돼요.
          </p>
          <div className="mt-3 space-y-2">
            {weightsToArray(model.weights).map((w) => (
              <div key={w.code} className="flex items-center gap-3">
                <span className="w-44 truncate text-sm text-slate-700">
                  {w.name}
                </span>
                <div className="flex-1">
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-brand-500"
                      style={{ width: `${w.mu * 100}%` }}
                    />
                  </div>
                </div>
                <span className="w-16 text-right text-sm font-semibold text-brand-700">
                  {(w.mu * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={() => navigate("/student/factcheck")}>
              팩트체크 실행하기 →
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}

function MediaEvaluator({ media, checklist, scores, onChange, onOpenDetail }) {
  if (!checklist) return null;
  const hasTeacher = !!media.teacherEvaluation?.dimensionScores;
  return (
    <div className="card">
      <button
        type="button"
        onClick={onOpenDetail}
        className="group flex w-full items-start gap-4 rounded-xl text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        aria-label={`${media.title} 상세 보기`}
      >
        {media.thumbnailUrl ? (
          <img src={media.thumbnailUrl} alt="" className="h-24 w-32 rounded-xl object-cover" />
        ) : (
          <div className="grid h-24 w-32 place-items-center rounded-xl bg-slate-100 text-xs text-slate-400">
            No Thumb
          </div>
        )}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold text-slate-900 group-hover:text-brand-700">
              {media.title}
            </h4>
            {hasTeacher ? (
              <span className="badge bg-emerald-50 text-emerald-700">기준 평가 준비됨 ✓</span>
            ) : (
              <span className="badge bg-amber-50 text-amber-700">기준 평가 준비 중</span>
            )}
            <span className="ml-auto text-xs text-slate-400 group-hover:text-brand-600">
              자세히 보기 →
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{media.content}</p>
        </div>
      </button>

      <div className="mt-4 space-y-3">
        {checklist.items.map((it, idx) => (
          <div key={idx} className="grid items-center gap-3 sm:grid-cols-[1fr_240px]">
            <div>
              <p className="text-sm text-slate-700">{idx + 1}. {it.question}</p>
              {it.dimension && DIMENSION_INFO[it.dimension] && (
                <span className="mt-0.5 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                  {DIMENSION_INFO[it.dimension].name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={scores[idx] ?? 3}
                onChange={(e) => onChange(idx, e.target.value)}
                className="flex-1 accent-brand-600"
              />
              <span className="w-10 text-right text-sm font-bold text-brand-700">
                {scores[idx] ?? "-"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MediaDetailDrawer({ media, open, onClose }) {
  const closeBtnRef = useRef(null);

  // ESC 키로 닫기 + 열렸을 때 body 스크롤 잠금 + 닫기 버튼에 포커스
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="미디어 상세"
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-out sm:max-w-lg ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <p className="text-sm font-bold text-slate-900">미디어 상세</p>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="닫기"
          >
            닫기 ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {media ? (
            <div className="space-y-4">
              {media.thumbnailUrl ? (
                <img
                  src={media.thumbnailUrl}
                  alt=""
                  className="w-full rounded-xl object-cover ring-1 ring-slate-200"
                />
              ) : (
                <div className="grid h-44 w-full place-items-center rounded-xl bg-slate-100 text-sm text-slate-400">
                  No Thumbnail
                </div>
              )}

              <h2 className="text-lg font-bold leading-tight text-slate-900">
                {media.title}
              </h2>

              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  본문
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-800">
                  {media.content}
                </p>
              </div>

              {media.link ? (
                <a
                  href={media.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
                >
                  원본 링크 열기 ↗
                </a>
              ) : (
                <p className="text-xs text-slate-400">원본 링크가 등록되지 않았습니다.</p>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
