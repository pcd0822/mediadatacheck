import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import LessonShell from "../../components/LessonShell.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import {
  listChecklists,
  listGroupMediaItems,
  listTeacherMediaItems,
  mediaImageUrl,
} from "../../services/firestore.js";
import {
  completeStage,
  ensureChecklistSnapshot,
  getMyBlindScore,
  recordStage3Close,
  submitBlindScore,
  subscribeBlindScores,
} from "../../services/lesson.js";
import { DIMENSION_INFO } from "../../utils/hpfm.js";
import { submissionStatus } from "../../utils/lessonGates.js";

/** 3단계에서 평가할 자료 2건(교사 1 + 모둠 1)을 고른다. */
export async function loadLessonMedia(groupId) {
  const [tm, gm] = await Promise.all([listTeacherMediaItems(), listGroupMediaItems(groupId)]);
  const out = [];
  if (tm[0]) out.push({ ...tm[0], kind: "teacher" });
  if (gm[0]) out.push({ ...gm[0], kind: "group" });
  return out;
}

export default function Stage3Blind() {
  return (
    <LessonShell
      stage={3}
      title="3단계 · 블라인드 채점"
      subtitle="AI 점수를 보지 않은 상태에서, 내 판단으로 먼저 채점합니다."
    >
      {(ctx) => <Stage3Body {...ctx} />}
    </LessonShell>
  );
}

function Stage3Body({ members, progress }) {
  const { user, profile } = useAuth();
  const { activeWorkspace: ws } = useWorkspace();
  const navigate = useNavigate();
  const advancedRef = useRef(false);

  const [items, setItems] = useState([]);
  const [checklistId, setChecklistId] = useState(null);
  const [medias, setMedias] = useState([]);
  const [activeMediaIdx, setActiveMediaIdx] = useState(0);
  const [scores, setScores] = useState({}); // { mediaId: { itemIndex: 1..5 } }
  const [myDocs, setMyDocs] = useState({}); // { mediaId: blindScoreDoc }
  const [allScores, setAllScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const name = profile?.displayName ?? user?.displayName ?? null;

  useEffect(() => {
    if (!ws?.id) return;
    (async () => {
      setLoading(true);
      try {
        // 체크리스트는 3단계 시작 시 동결한 스냅샷을 쓴다.
        // 이후 모둠원이 체크리스트를 고쳐도 채점·통계 기준이 흔들리지 않게 하기 위함.
        const { items: frozen, checklistId: cid } = await ensureChecklistSnapshot(
          ws,
          progress,
          listChecklists
        );
        setChecklistId(cid);
        setItems(frozen);

        const ms = await loadLessonMedia(ws.id);
        setMedias(ms);

        const nextScores = {};
        const nextDocs = {};
        for (const m of ms) {
          const doc = await getMyBlindScore(ws.id, user.uid, m.id);
          nextDocs[m.id] = doc;
          nextScores[m.id] = doc?.scores ?? {};
        }
        setMyDocs(nextDocs);
        setScores(nextScores);
      } catch (e) {
        console.error(e);
        setError(e.message ?? "채점 화면을 준비하지 못했어요.");
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id]);

  useEffect(() => {
    if (!ws?.id) return undefined;
    const unsub = subscribeBlindScores(ws.id, (list) => setAllScores(list));
    return () => unsub();
  }, [ws?.id]);

  const media = medias[activeMediaIdx] ?? null;
  const myDoc = media ? myDocs[media.id] : null;
  const locked = myDoc?.locked === true;

  // 모둠원 전원이 두 자료를 모두 제출하면 3단계를 닫고 4단계를 연다.
  // 여러 명이 동시에 호출해도 completeStage가 트랜잭션 + max()라 단계가 뒤로 밀리지 않는다.
  useEffect(() => {
    if (advancedRef.current || loading) return;
    if (!medias.length || !members.length) return;
    if (progress?.stage >= 4) return;
    const status = submissionStatus(members, allScores, medias.length);
    if (!status.allDone) return;
    advancedRef.current = true;
    (async () => {
      try {
        await recordStage3Close(ws.id, {
          includedUids: members.map((m) => m.uid),
          excludedUids: [],
          forcedBy: null,
        });
        await completeStage(ws.id, 3, { completedBy: user.uid });
      } catch (e) {
        console.error(e);
        advancedRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allScores, members.length, medias.length, loading, progress?.stage]);

  const mySubmittedCount = useMemo(
    () => medias.filter((m) => myDocs[m.id]?.locked).length,
    [medias, myDocs]
  );
  const allMineDone = medias.length > 0 && mySubmittedCount === medias.length;

  const setScore = (itemIndex, value) => {
    if (locked || !media) return;
    setScores((prev) => ({
      ...prev,
      [media.id]: { ...(prev[media.id] ?? {}), [itemIndex]: Number(value) },
    }));
  };

  const filledCount = media
    ? items.filter((_, i) => Number.isFinite(Number(scores[media.id]?.[i]))).length
    : 0;
  const allFilled = media && items.length > 0 && filledCount === items.length;

  const handleSubmit = async () => {
    if (!media || !allFilled) return;
    if (
      !confirm(
        `"${media.title}" 채점을 제출할까요?\n\n제출하면 점수를 수정할 수 없습니다.`
      )
    )
      return;
    setSubmitting(true);
    setError("");
    try {
      await submitBlindScore(ws.id, {
        uid: user.uid,
        name,
        mediaId: media.id,
        checklistId,
        scores: scores[media.id] ?? {},
      });
      const fresh = await getMyBlindScore(ws.id, user.uid, media.id);
      setMyDocs((d) => ({ ...d, [media.id]: fresh }));
      // 아직 안 낸 자료가 있으면 그쪽으로 이동
      const nextIdx = medias.findIndex((m, i) => i !== activeMediaIdx && !myDocs[m.id]?.locked);
      if (nextIdx >= 0) setActiveMediaIdx(nextIdx);
    } catch (e) {
      console.error(e);
      setError(e.message ?? "제출 중 오류가 발생했어요.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <SkeletonList count={3} />;

  if (medias.length === 0) {
    return (
      <div className="card text-center text-sm text-slate-500">
        평가할 자료를 찾지 못했어요. 2단계에서 자료가 제대로 등록됐는지 확인해주세요.
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 rounded-2xl border border-brand-200 bg-brand-50/40 px-5 py-4">
        <p className="text-sm font-bold text-brand-800">왜 AI 점수를 나중에 보여주나요?</p>
        <p className="mt-1.5 text-[13px] leading-6 text-ink-variant">
          사람은 먼저 본 숫자에 판단이 끌려갑니다(<strong>정박 효과</strong>). AI 점수를 먼저 보면
          내 판단이 아니라 "AI 점수를 조금 고친 값"이 되기 쉬워요. 그래서 이 화면에서는{" "}
          <strong>AI를 아예 호출하지 않습니다.</strong> 화면에 숨겨둔 것이 아니라 정말로 아직
          만들지 않았어요. 모둠원이 모두 제출한 뒤에야 같은 체크리스트로 AI에게 채점을 맡기고,
          그때 둘을 나란히 놓고 비교합니다.
        </p>
      </div>

      <SubmissionBoard members={members} allScores={allScores} medias={medias} myUid={user.uid} />

      {allMineDone ? (
        <WaitingPanel
          members={members}
          allScores={allScores}
          medias={medias}
          canProceed={progress?.stage >= 4}
          onProceed={() => navigate("/student/lesson/reveal")}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {medias.map((m, i) => {
              const done = myDocs[m.id]?.locked;
              const on = i === activeMediaIdx;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setActiveMediaIdx(i)}
                  className={`rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 transition ${
                    on
                      ? "bg-brand-600 text-white ring-brand-600"
                      : "bg-white text-ink-variant ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  자료 {i + 1}/{medias.length} ·{" "}
                  {m.kind === "teacher" ? "선생님 자료" : "우리 모둠 자료"}
                  {done && " ✓"}
                </button>
              );
            })}
          </div>

          {media && (
            <>
              <MediaPanel media={media} />

              {locked ? (
                <div className="card mt-4 border-emerald-200 bg-emerald-50/50 text-center">
                  <p className="text-sm font-bold text-emerald-800">
                    ✓ 이 자료는 제출 완료 · 점수가 잠겼습니다
                  </p>
                  <p className="mt-1 text-xs text-emerald-700">
                    {myDoc?.submittedAt?.toDate?.().toLocaleTimeString("ko-KR") ?? ""}
                  </p>
                </div>
              ) : (
                <>
                  <div className="mt-4 space-y-3">
                    {items.map((it, i) => (
                      <ScoreRow
                        key={i}
                        index={i}
                        item={it}
                        value={scores[media.id]?.[i]}
                        onChange={(v) => setScore(i, v)}
                      />
                    ))}
                  </div>

                  {error && (
                    <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {error}
                    </p>
                  )}

                  <div className="sticky bottom-4 mt-6 rounded-2xl border border-brand-100 bg-white/95 p-5 shadow-glow-lg backdrop-blur">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink">
                          진행 {filledCount} / {items.length} 항목
                        </p>
                        <p className="text-[11px] text-ink-muted">
                          제출하면 수정할 수 없어요. 모둠원과 상의하지 말고 각자 판단으로 매겨주세요.
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        disabled={!allFilled || submitting}
                        loading={submitting}
                        onClick={handleSubmit}
                      >
                        이 자료 제출하기
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function MediaPanel({ media }) {
  const img = mediaImageUrl(media);
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">{media.title}</h2>
          {media.subtitle && <p className="text-sm text-slate-500">{media.subtitle}</p>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            media.kind === "teacher"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-brand-50 text-brand-700"
          }`}
        >
          {media.kind === "teacher" ? "공통 필수" : "우리 모둠 자료"}
        </span>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
        {media.publisher && <span>언론사(미검증): {media.publisher}</span>}
        {media.publishedAt && <span>작성일(미검증): {media.publishedAt}</span>}
      </p>
      {img && (
        <img
          src={img}
          alt=""
          className="mt-3 w-full rounded-xl bg-slate-50 object-contain"
          style={{ maxHeight: "420px" }}
        />
      )}
      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-800">{media.content}</p>
      {media.link && (
        <a
          href={media.link}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-brand-700 underline"
        >
          원본 링크 ↗
        </a>
      )}
    </div>
  );
}

function ScoreRow({ index, item, value, onChange }) {
  const info = item.dimension ? DIMENSION_INFO[item.dimension] : null;
  const has = Number.isFinite(Number(value));
  return (
    <div className={`card ${has ? "" : "border-amber-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              항목 {index + 1}
            </span>
            {info && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                {info.code} {info.name}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold leading-6 text-ink">{item.question}</p>
          {item.rubric && (
            <p className="mt-1 text-[11px] leading-5 text-ink-muted">
              {[1, 3, 5]
                .map((s) => (item.rubric?.[s] ? `${s}점 ${item.rubric[s]}` : null))
                .filter(Boolean)
                .join("  /  ")}
            </p>
          )}
        </div>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className={`h-11 w-11 rounded-xl text-sm font-bold ring-1 transition ${
                Number(value) === s
                  ? "bg-brand-600 text-white ring-brand-600"
                  : "bg-white text-ink-variant ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 모둠원별 제출 현황 (학생 화면). */
function SubmissionBoard({ members, allScores, medias, myUid }) {
  const total = medias.length;
  const { submitted, pending } = submissionStatus(members, allScores, total);
  const doneUids = new Set(submitted.map((m) => m.uid));
  const all = [...submitted, ...pending];
  return (
    <div className="card mb-6">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-muted">
        모둠원 제출 현황
      </p>
      <div className="flex flex-wrap gap-2">
        {all.map((m) => {
          const complete = doneUids.has(m.uid);
          return (
            <span
              key={m.uid}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
                complete
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-surface-low text-ink-muted ring-slate-200"
              }`}
            >
              {complete ? "✓" : "⏳"} {m.name ?? m.email ?? "모둠원"}
              {m.uid === myUid && <span className="text-[10px] text-brand-600">(나)</span>}
              <span className="text-[10px]">
                {m.done}/{total}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function WaitingPanel({ members, allScores, medias, canProceed, onProceed }) {
  const { submittedCount, pending: waiting } = submissionStatus(
    members,
    allScores,
    medias.length
  );

  return (
    <div className="card border-emerald-200 bg-emerald-50/40 text-center">
      <p className="text-lg font-bold text-emerald-800">✓ 제출 완료 — 점수가 잠겼습니다</p>
      <p className="mt-2 text-sm text-ink-variant">
        모둠원 {submittedCount} / {members.length}명이 두 자료를 모두 제출했어요.
      </p>
      {waiting.length > 0 && !canProceed ? (
        <>
          <p className="mt-3 text-sm text-ink-variant">
            아직 <strong>{waiting.map((m) => m.name ?? "모둠원").join(", ")}</strong>{" "}
            {waiting.length}명이 채점 중이에요.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            전원이 제출하면 AI 채점이 자동으로 시작돼요. 선생님이 먼저 진행시킬 수도 있어요.
          </p>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm font-semibold text-emerald-800">
            {waiting.length > 0
              ? "선생님이 다음 단계로 진행시켰어요. 미제출자는 통계에서 제외됩니다."
              : "모둠원 전원이 제출했어요!"}
          </p>
          <Button variant="primary" className="mt-4" onClick={onProceed}>
            AI 판정 보러 가기 →
          </Button>
        </>
      )}
    </div>
  );
}
