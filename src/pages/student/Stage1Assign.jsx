import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import LessonShell, { StageGateFooter } from "../../components/LessonShell.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import { listChecklists } from "../../services/firestore.js";
import {
  completeStage,
  saveChecklistItems,
  saveGapReflection,
  subscribeGapReflections,
} from "../../services/lesson.js";
import { DIMENSIONS, DIMENSION_INFO } from "../../utils/hpfm.js";
import { assignGate, splitAiSuggestion } from "../../utils/lessonGates.js";
import { RECOMMENDED_ITEMS_PER_DIMENSION } from "../../constants/lesson.js";

const blankItem = () => ({
  question: "",
  rubric: { 1: "", 2: "", 3: "", 4: "", 5: "" },
  dimension: null,
  aiSuggestedDimension: null,
  addedInStage1: true,
});

export default function Stage1Assign() {
  return (
    <LessonShell
      stage={1}
      title="1단계 · 체크리스트 지표 할당"
      subtitle="지난 시간에 만든 항목을 5대 지표에 직접 배정해요. AI 제안은 참고일 뿐입니다."
    >
      {(ctx) => <Stage1Body {...ctx} />}
    </LessonShell>
  );
}

function Stage1Body({ progress }) {
  const { user, profile } = useAuth();
  const { activeWorkspace: ws } = useWorkspace();
  const navigate = useNavigate();

  const [checklistId, setChecklistId] = useState(null);
  const [checklistName, setChecklistName] = useState("");
  const [items, setItems] = useState([]);
  const [reflections, setReflections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");

  const name = profile?.displayName ?? user?.displayName ?? null;

  // 모둠 체크리스트 로드 + AI 제안 분리 (dimension → aiSuggestedDimension, 선택은 비움)
  useEffect(() => {
    if (!ws?.id) return;
    (async () => {
      setLoading(true);
      try {
        const lists = await listChecklists(ws);
        const target =
          lists.find((c) => c.id === progress?.checklistId) ?? lists[0] ?? null;
        if (!target) {
          setError("모둠 체크리스트가 없어요. 먼저 체크리스트를 만들어주세요.");
          setLoading(false);
          return;
        }
        setChecklistId(target.id);
        setChecklistName(target.checklistName ?? "");
        setItems(splitAiSuggestion(target.items ?? []));
      } catch (e) {
        console.error(e);
        setError(e.message ?? "체크리스트를 불러오지 못했어요.");
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id]);

  useEffect(() => {
    if (!ws?.id) return undefined;
    const unsub = subscribeGapReflections(ws.id, (r) => setReflections(r));
    return () => unsub();
  }, [ws?.id]);

  const reflectionByDim = useMemo(
    () => Object.fromEntries(reflections.map((r) => [r.id, r])),
    [reflections]
  );

  const gate = useMemo(
    () => assignGate(items, reflectionByDim),
    [items, reflectionByDim]
  );
  const { counts, emptyDims, thinDims, unassignedIndexes: unassigned } = gate;

  const persist = async (nextItems) => {
    setItems(nextItems);
    setSaving(true);
    try {
      await saveChecklistItems(ws.id, checklistId, nextItems, { uid: user.uid, name });
    } catch (e) {
      console.error(e);
      setError(e.message ?? "저장 중 오류가 발생했어요.");
    } finally {
      setSaving(false);
    }
  };

  const setDimension = (idx, dim) => {
    const next = items.map((it, i) =>
      i === idx
        ? {
            ...it,
            dimension: dim,
            assignedBy: user.uid,
            // AI와 같아지면 사유는 필요 없으므로 비운다
            disagreeReason: dim === it.aiSuggestedDimension ? "" : it.disagreeReason ?? "",
          }
        : it
    );
    persist(next);
  };

  const setDisagreeReason = (idx, text) => {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, disagreeReason: text } : it)));
  };

  const flushReason = (idx) => persist(items);

  const addItemForDimension = async (dim, draft) => {
    const next = [
      ...items,
      { ...blankItem(), question: draft.question, rubric: draft.rubric, dimension: dim, assignedBy: user.uid },
    ];
    await persist(next);
  };

  const removeItem = (idx) => {
    if (!confirm("이 항목을 삭제할까요?")) return;
    persist(items.filter((_, i) => i !== idx));
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await saveChecklistItems(ws.id, checklistId, items, { uid: user.uid, name });
      await completeStage(ws.id, 1, { checklistId, completedBy: user.uid });
      navigate("/student/lesson/media");
    } catch (e) {
      console.error(e);
      setError(e.message ?? "단계 완료 중 오류가 발생했어요.");
      setCompleting(false);
    }
  };

  if (loading) return <SkeletonList count={3} />;
  if (error && !checklistId) {
    return (
      <div className="card text-center">
        <p className="text-rose-700">{error}</p>
        <Button variant="primary" className="mt-3" onClick={() => navigate("/student/checklist")}>
          체크리스트 만들러 가기
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="card mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">{checklistName}</h2>
            <p className="text-xs text-slate-500">
              항목 {items.length}개 · 배정 완료 {items.length - unassigned.length}개
              {saving && <span className="ml-2 text-brand-600">저장 중…</span>}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-5">
          {DIMENSIONS.map((d) => {
            const n = counts[d];
            const tone =
              n === 0
                ? "bg-rose-50 text-rose-700 ring-rose-200"
                : n < RECOMMENDED_ITEMS_PER_DIMENSION
                ? "bg-amber-50 text-amber-800 ring-amber-200"
                : "bg-emerald-50 text-emerald-700 ring-emerald-200";
            return (
              <div key={d} className={`rounded-xl px-3 py-2 text-center ring-1 ${tone}`}>
                <p className="text-[11px] font-bold">{d}</p>
                <p className="text-[10px] leading-tight">{DIMENSION_INFO[d].name}</p>
                <p className="mt-1 text-lg font-black">{n}</p>
                <p className="text-[10px]">
                  {n === 0 ? "문항 없음" : n === 1 ? "1문항" : `${n}문항`}
                </p>
              </div>
            );
          })}
        </div>

        {thinDims.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
            ℹ️{" "}
            <strong>
              {thinDims.map((d) => `${d} ${DIMENSION_INFO[d].name}`).join(", ")}
            </strong>
            는 1문항이에요. <strong>1문항짜리 지표는 그 항목 하나가 지표 점수를 그대로
            결정하므로 결과가 흔들리기 쉬워요.</strong> 2문항 이상을 권합니다. (이대로 진행해도
            다음 단계는 열립니다)
          </div>
        )}
      </div>

      {emptyDims.map((d) => (
        <EmptyDimensionCard
          key={d}
          dimension={d}
          reflection={reflectionByDim[d]}
          onSaveReason={(reason) =>
            saveGapReflection(ws.id, d, { reason, uid: user.uid, name })
          }
          onAddItem={(draft) => addItemForDimension(d, draft)}
        />
      ))}

      <div className="space-y-4">
        {items.map((it, idx) => (
          <ItemCard
            key={idx}
            item={it}
            index={idx}
            onPick={(dim) => setDimension(idx, dim)}
            onReasonChange={(v) => setDisagreeReason(idx, v)}
            onReasonBlur={() => flushReason(idx)}
            onRemove={() => removeItem(idx)}
          />
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      <StageGateFooter
        blockers={gate.blockers}
        label="1단계 완료하고 2단계 열기"
        busy={completing}
        onComplete={handleComplete}
        note="5개 지표에 각각 1문항 이상 배정되고, AI와 다르게 판단한 항목의 사유가 모두 채워져야 열립니다."
      />
    </>
  );
}

function ItemCard({ item, index, onPick, onReasonChange, onReasonBlur, onRemove }) {
  const ai = item.aiSuggestedDimension;
  const picked = item.dimension;
  const disagree = picked && ai && picked !== ai;
  const agree = picked && ai && picked === ai;

  return (
    <div
      className={`card ${
        !picked ? "border-amber-200 ring-1 ring-amber-100" : disagree ? "border-brand-200" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              항목 {index + 1}
            </span>
            {item.addedInStage1 && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                이번에 보충한 문항
              </span>
            )}
          </div>
          <h3 className="text-base font-bold leading-6 text-ink">
            {item.question || "(빈 질문)"}
          </h3>
          {item.rubric && (
            <p className="mt-1 text-[11px] leading-5 text-ink-muted">
              {[1, 3, 5]
                .map((s) => (item.rubric?.[s] ? `${s}점 ${item.rubric[s]}` : null))
                .filter(Boolean)
                .join("  /  ")}
            </p>
          )}
        </div>
        {item.addedInStage1 && (
          <Button variant="ghost" onClick={onRemove}>
            삭제
          </Button>
        )}
      </div>

      {ai ? (
        <div className="mt-3 rounded-xl bg-surface-low px-4 py-3">
          <p className="text-[11px] font-bold text-ink-variant">
            🤖 AI 제안 : {ai} {DIMENSION_INFO[ai]?.name ?? ""}
            {Number.isFinite(Number(item.aiConfidence)) && (
              <span className="ml-1 font-normal text-ink-muted">
                (확신도 {Math.round(Number(item.aiConfidence) * 100)}%)
              </span>
            )}
          </p>
          {item.aiReason && (
            <p className="mt-1 text-[11px] leading-5 text-ink-muted">"{item.aiReason}"</p>
          )}
          <p className="mt-1.5 text-[10px] text-ink-muted">
            참고용이에요. 우리 모둠의 판단이 다르면 다르게 골라도 됩니다.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-ink-muted">AI 제안이 없는 항목이에요.</p>
      )}

      <div className="mt-3">
        <p className="mb-2 text-xs font-bold text-ink-variant">우리 모둠의 선택</p>
        <div className="flex flex-wrap gap-2">
          {DIMENSIONS.map((d) => {
            const on = picked === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onPick(d)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition ${
                  on
                    ? "bg-brand-600 text-white ring-brand-600"
                    : "bg-white text-ink-variant ring-slate-200 hover:bg-slate-50"
                }`}
              >
                <span className="font-black">{d}</span> {DIMENSION_INFO[d].name}
              </button>
            );
          })}
        </div>
        {!picked && (
          <p className="mt-2 text-xs font-semibold text-amber-700">
            ⚠ 아직 선택하지 않았어요. 직접 골라주세요.
          </p>
        )}
        {agree && <p className="mt-2 text-xs text-emerald-700">✓ AI 제안과 같게 판단했어요</p>}
      </div>

      {disagree && (
        <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/40 px-4 py-3">
          <p className="text-xs font-bold text-brand-800">
            ⚠ AI는 {ai}({DIMENSION_INFO[ai]?.name}), 우리는 {picked}(
            {DIMENSION_INFO[picked]?.name})로 판단했어요
          </p>
          <label className="mt-2 block text-[11px] font-semibold text-ink-variant">
            왜 다르게 판단했나요? (필수)
          </label>
          <textarea
            className="input mt-1 min-h-[72px] resize-y text-sm"
            value={item.disagreeReason ?? ""}
            onChange={(e) => onReasonChange(e.target.value)}
            onBlur={onReasonBlur}
            placeholder="예) 통계 출처 표기는 매체가 얼마나 투명한지 보여주는 거라 출처 확인에 가깝다고 봤다."
          />
        </div>
      )}
    </div>
  );
}

/**
 * 문항이 하나도 없는 지표 카드.
 * STEP 1(빠뜨린 이유 기록)을 저장해야 STEP 2(보충 문항)가 열린다 — 순서를 강제한다.
 */
function EmptyDimensionCard({ dimension, reflection, onSaveReason, onAddItem }) {
  const info = DIMENSION_INFO[dimension];
  const [reason, setReason] = useState(reflection?.reason ?? "");
  const [savingReason, setSavingReason] = useState(false);
  const [draft, setDraft] = useState({ question: "", rubric: { 1: "", 3: "", 5: "" } });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (reflection?.reason && !reason) setReason(reflection.reason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reflection?.reason]);

  const unlocked = Boolean((reflection?.reason ?? "").trim());

  const handleSaveReason = async () => {
    if (!reason.trim()) return;
    setSavingReason(true);
    try {
      await onSaveReason(reason.trim());
    } finally {
      setSavingReason(false);
    }
  };

  const handleAdd = async () => {
    if (!draft.question.trim()) return;
    setAdding(true);
    try {
      await onAddItem({
        question: draft.question.trim(),
        rubric: { 1: draft.rubric[1] ?? "", 2: "", 3: draft.rubric[3] ?? "", 4: "", 5: draft.rubric[5] ?? "" },
      });
      setDraft({ question: "", rubric: { 1: "", 3: "", 5: "" } });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="mb-4 rounded-2xl border-2 border-rose-200 bg-rose-50/40 p-6">
      <h3 className="text-base font-bold text-rose-800">
        ⚠ 문항이 없는 지표 : {dimension} {info.name}
      </h3>
      <p className="mt-1 text-xs text-rose-700">{info.description}</p>

      <div className="mt-4 rounded-xl bg-white p-4 ring-1 ring-rose-100">
        <p className="text-sm font-bold text-ink">STEP 1. 먼저 생각해보기</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          바로 문항을 추가하기 전에, 왜 이 지표를 놓쳤는지부터 이야기해보세요.
          이 기록은 선생님이 함께 봅니다.
        </p>
        <label className="mt-3 block text-[11px] font-semibold text-ink-variant">
          우리 모둠이 이 지표를 빠뜨린 이유는 무엇이라고 생각하나요?
        </label>
        <textarea
          className="input mt-1 min-h-[84px] resize-y text-sm"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="예) 사진을 볼 생각을 아예 못 했다. 글만 읽고 판단하는 습관이 있는 것 같다."
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          {unlocked ? (
            <span className="text-xs font-semibold text-emerald-700">
              ✓ 기록됨{reflection?.writtenByName ? ` · ${reflection.writtenByName}` : ""}
            </span>
          ) : (
            <span className="text-xs text-ink-muted">저장해야 STEP 2가 열려요</span>
          )}
          <Button
            variant="secondary"
            onClick={handleSaveReason}
            loading={savingReason}
            disabled={!reason.trim()}
          >
            기록 저장
          </Button>
        </div>
      </div>

      <div
        className={`mt-3 rounded-xl p-4 ring-1 ${
          unlocked ? "bg-white ring-rose-100" : "bg-slate-50 ring-slate-200 opacity-60"
        }`}
      >
        <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
          STEP 2. 보충 문항 작성
          {!unlocked && (
            <span className="material-symbols-outlined text-slate-400" style={{ fontSize: 16 }}>
              lock
            </span>
          )}
        </p>
        {!unlocked ? (
          <p className="mt-0.5 text-xs text-ink-muted">STEP 1을 저장하면 열립니다.</p>
        ) : (
          <>
            <label className="mt-3 block text-[11px] font-semibold text-ink-variant">
              평가 질문
            </label>
            <input
              className="input mt-1"
              value={draft.question}
              onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))}
              placeholder={`예) ${exampleQuestion(dimension)}`}
            />
            <p className="mt-3 text-[11px] font-semibold text-ink-variant">
              루브릭 (선택 — 적어두면 AI가 이 기준으로 채점해요)
            </p>
            <div className="mt-1 grid gap-2">
              {[1, 3, 5].map((s) => (
                <div key={s} className="grid items-center gap-2 sm:grid-cols-[64px_1fr]">
                  <span className="rounded-lg bg-slate-100 px-2 py-2 text-center text-xs font-semibold text-slate-700">
                    {s}점
                  </span>
                  <input
                    className="input"
                    value={draft.rubric[s] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, rubric: { ...d.rubric, [s]: e.target.value } }))
                    }
                    placeholder={`${s}점에 해당하는 자료의 특징`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                variant="primary"
                onClick={handleAdd}
                loading={adding}
                disabled={!draft.question.trim()}
              >
                {dimension}에 문항 추가
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function exampleQuestion(d) {
  return (
    {
      V1: "이 매체 이름을 검색하면 실제로 나오는가?",
      V2: "작성자 이름과 이력이 확인되는가?",
      V3: "같은 내용을 다른 매체에서도 다루는가?",
      V4: "사진이 본문 내용과 실제로 맞는가?",
      V5: "읽고 나서 화가 나거나 바로 공유하고 싶어지는가?",
    }[d] ?? "우리가 확인하고 싶은 것"
  );
}
