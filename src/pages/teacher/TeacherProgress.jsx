import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import {
  completeStage,
  getGroupDetailForTeacher,
  listAllGroupsWithProgress,
  recordStage3Close,
  resetProgress,
} from "../../services/lesson.js";
import { listGroupMediaItems, listTeacherMediaItems } from "../../services/firestore.js";
import { DIMENSION_INFO } from "../../utils/hpfm.js";
import { submissionStatus } from "../../utils/lessonGates.js";
import { STAGES, causeTypeLabel } from "../../constants/lesson.js";

export default function TeacherProgress() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [mediaCount, setMediaCount] = useState({}); // groupId -> 자료 수
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const list = await listAllGroupsWithProgress();
      setGroups(list);
      const teacherMedia = await listTeacherMediaItems();
      const counts = {};
      for (const g of list) {
        const gm = await listGroupMediaItems(g.groupId).catch(() => []);
        counts[g.groupId] = { group: gm.length, teacher: teacherMedia.length };
      }
      setMediaCount(counts);
    } catch (e) {
      console.error(e);
      setError(e.message ?? "진행 현황을 불러오지 못했어요.");
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  /** 미제출자를 통계에서 제외하고 다음 단계로 강제 진행. */
  const handleForce = async (g) => {
    const mediaTotal = 2; // 교사 1 + 모둠 1
    const { submitted: included, pending: excluded } = submissionStatus(
      g.members,
      g.blindScores,
      mediaTotal
    );

    if (included.length === 0) {
      alert("아직 아무도 제출하지 않아 진행할 수 없어요.");
      return;
    }
    const ok = confirm(
      `${g.groupName}을(를) 다음 단계로 진행할까요?\n\n` +
        `미제출자 ${excluded.length}명(${excluded.map((m) => m.name ?? "모둠원").join(", ")})은 ` +
        `이후 통계에서 제외됩니다.\n제외 사실은 결과 대시보드에 표시됩니다.`
    );
    if (!ok) return;

    setBusyId(g.groupId);
    try {
      await recordStage3Close(g.groupId, {
        includedUids: included.map((m) => m.uid),
        excludedUids: excluded.map((m) => m.uid),
        forcedBy: "teacher",
      });
      await completeStage(g.groupId, 3, { forced: true });
      await refresh();
    } catch (e) {
      console.error(e);
      alert(`진행 중 오류: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleReset = async (g) => {
    if (
      !confirm(
        `${g.groupName}의 진행 상태를 1단계로 되돌릴까요?\n\n` +
          `체크리스트·점수·답변은 지워지지 않고 단계만 초기화됩니다.`
      )
    )
      return;
    setBusyId(g.groupId);
    try {
      await resetProgress(g.groupId);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Layout
      title="수업 진행 현황"
      subtitle="모둠별 단계 진행과 블라인드 채점 제출 상황을 봅니다"
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/teacher")}>
            ← 대시보드
          </Button>
          <Button variant="secondary" onClick={() => navigate("/teacher/class-stats")}>
            학급 집계 →
          </Button>
          <Button variant="ghost" onClick={refresh}>
            새로고침
          </Button>
        </>
      }
    >
      <div className="mb-4 rounded-2xl border border-slate-200 bg-surface-low px-5 py-4 text-xs leading-6 text-ink-variant">
        수업 흐름:{" "}
        {STAGES.map((s, i) => (
          <span key={s.key}>
            {i > 0 && " → "}
            <strong>
              {s.n} {s.title}
            </strong>
          </span>
        ))}
        <br />
        3단계에서 미제출자가 있어도 <strong>[미제출자 제외하고 진행]</strong>으로 다음 단계를 열 수
        있어요. 제외된 학생은 이후 통계에서 빠지고, 그 사실이 모둠 대시보드에 표시됩니다.
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      {loading ? (
        <SkeletonList count={4} />
      ) : groups.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          아직 만들어진 모둠이 없어요. 학생이 모둠을 만들면 여기에 나타납니다.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupRow
              key={g.groupId}
              group={g}
              media={mediaCount[g.groupId]}
              busy={busyId === g.groupId}
              onForce={() => handleForce(g)}
              onReset={() => handleReset(g)}
              onDetail={() => setDetailId(g.groupId)}
            />
          ))}
        </div>
      )}

      {detailId && (
        <GroupDetailModal groupId={detailId} onClose={() => setDetailId(null)} />
      )}
    </Layout>
  );
}

function GroupRow({ group, media, busy, onForce, onReset, onDetail }) {
  const stage = group.progress?.stage ?? 1;
  const mediaTotal = 2;
  const status = submissionStatus(group.members, group.blindScores, mediaTotal);
  const submitted = status.submittedCount;
  const total = status.total;
  const roster = [...status.submitted, ...status.pending];
  const excluded = group.progress?.stage3?.excludedUids ?? [];
  const aiDone = Object.keys(group.progress?.stage4?.aiHistoryIds ?? {}).length;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">{group.groupName}</h3>
            <span className="badge bg-slate-100 text-slate-600">모둠원 {total}명</span>
            {excluded.length > 0 && (
              <span className="badge bg-amber-50 text-amber-800">
                통계 제외 {excluded.length}명
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {STAGES.map((s) => {
              const done = s.n < stage;
              const cur = s.n === stage;
              return (
                <span
                  key={s.key}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    done
                      ? "bg-emerald-50 text-emerald-700"
                      : cur
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {s.n} {s.title}
                  {done && " ✓"}
                </span>
              );
            })}
          </div>

          <p className="mt-2 text-xs text-ink-muted">
            {stage === 1 && "체크리스트 지표 배정 중"}
            {stage === 2 && (
              <>
                자료 등록 대기 · 선생님 자료 {media?.teacher ?? 0}건 / 모둠 자료{" "}
                {media?.group ?? 0}건
              </>
            )}
            {stage === 3 && (
              <>
                블라인드 채점 · <strong>제출 {submitted}/{total}</strong>
              </>
            )}
            {stage >= 4 && (
              <>
                AI 채점 {aiDone}/2건 완료 · 통계 포함{" "}
                {(group.progress?.stage3?.includedUids ?? []).length || submitted}명
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {stage === 3 && (
            <Button variant="primary" onClick={onForce} loading={busy} disabled={busy}>
              {submitted === total ? "다음 단계로 진행" : "미제출자 제외하고 진행"}
            </Button>
          )}
          <Button variant="secondary" onClick={onDetail}>
            모둠 상세
          </Button>
          <Button variant="ghost" onClick={onReset} disabled={busy}>
            단계 초기화
          </Button>
        </div>
      </div>

      {stage === 3 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          {roster.map((m) => {
            const c = m.done ?? 0;
            const done = c >= mediaTotal;
            return (
              <span
                key={m.uid}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  done ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {done ? "✓" : "⏳"} {m.name ?? m.email ?? "모둠원"} {c}/{mediaTotal}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupDetailModal({ groupId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const d = await getGroupDetailForTeacher(groupId).catch((e) => {
        console.error(e);
        return null;
      });
      setDetail(d);
      setLoading(false);
    })();
  }, [groupId]);

  const checklist = detail?.checklists?.[0];
  const items = detail?.progress?.checklistSnapshot ?? checklist?.items ?? [];
  const disagreements = useMemo(
    () =>
      items
        .map((it, i) => ({ ...it, index: i }))
        .filter(
          (it) =>
            it.dimension && it.aiSuggestedDimension && it.dimension !== it.aiSuggestedDimension
        ),
    [items]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-bold text-slate-900">모둠 상세</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <SkeletonList count={3} />
        ) : !detail ? (
          <p className="text-sm text-rose-700">
            모둠 데이터를 읽지 못했어요. 보안 규칙(교사 읽기 권한)이 배포됐는지 확인해주세요.
          </p>
        ) : (
          <div className="space-y-6">
            <section>
              <h4 className="mb-2 text-sm font-bold text-ink">지표 배정 결과</h4>
              {items.length === 0 ? (
                <p className="text-xs text-slate-500">아직 체크리스트가 없어요.</p>
              ) : (
                <div className="space-y-1.5">
                  {items.map((it, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="w-8 shrink-0 text-slate-400">{i + 1}.</span>
                      <span className="flex-1 text-ink-variant">{it.question}</span>
                      <span className="shrink-0 font-bold text-brand-600">
                        {it.dimension ?? "미배정"}
                      </span>
                      {it.aiSuggestedDimension && it.aiSuggestedDimension !== it.dimension && (
                        <span className="shrink-0 text-[10px] text-amber-700">
                          (AI: {it.aiSuggestedDimension})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-sm font-bold text-ink">
                AI와 다르게 판단한 항목 ({disagreements.length}건)
              </h4>
              {disagreements.length === 0 ? (
                <p className="text-xs text-slate-500">AI 제안과 모두 같게 배정했어요.</p>
              ) : (
                <div className="space-y-2">
                  {disagreements.map((it) => (
                    <div key={it.index} className="rounded-xl bg-surface-low px-4 py-3">
                      <p className="text-xs font-semibold text-ink">
                        {it.index + 1}. {it.question}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-muted">
                        AI {it.aiSuggestedDimension} → 학생 {it.dimension}
                      </p>
                      <p className="mt-1 text-xs text-ink-variant">
                        "{it.disagreeReason || "(사유 없음)"}"
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-sm font-bold text-ink">
                빠뜨린 지표에 대한 성찰 ({detail.reflections.length}건)
              </h4>
              {detail.reflections.length === 0 ? (
                <p className="text-xs text-slate-500">기록된 성찰이 없어요.</p>
              ) : (
                <div className="space-y-2">
                  {detail.reflections.map((r) => (
                    <div key={r.id} className="rounded-xl bg-amber-50 px-4 py-3">
                      <p className="text-xs font-bold text-amber-900">
                        {r.dimension} {DIMENSION_INFO[r.dimension]?.name ?? ""}
                      </p>
                      <p className="mt-1 text-xs text-amber-800">"{r.reason}"</p>
                      {r.writtenByName && (
                        <p className="mt-0.5 text-[10px] text-amber-700">— {r.writtenByName}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-sm font-bold text-ink">
                성찰 답변 ({detail.reflectionAnswers.length}명 제출)
              </h4>
              {detail.reflectionAnswers.length === 0 ? (
                <p className="text-xs text-slate-500">아직 제출된 답변이 없어요.</p>
              ) : (
                <div className="space-y-3">
                  {detail.reflectionAnswers.map((a) => (
                    <div key={a.id} className="rounded-xl bg-surface-low px-4 py-3">
                      <p className="text-xs font-bold text-ink">{a.name ?? a.uid}</p>
                      {Object.entries(a.answers ?? {}).map(([k, v]) => (
                        <p key={k} className="mt-1 text-[11px] leading-5 text-ink-variant">
                          <span className="font-semibold">{k}.</span> {v}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-sm font-bold text-ink">
                원인 유형 기록 ({detail.causeTags.length}명)
              </h4>
              {detail.causeTags.length === 0 ? (
                <p className="text-xs text-slate-500">아직 기록이 없어요.</p>
              ) : (
                <div className="space-y-2">
                  {detail.causeTags.map((t) => (
                    <div key={t.id} className="rounded-xl bg-surface-low px-4 py-3">
                      <p className="text-xs font-bold text-ink">{t.name ?? t.uid}</p>
                      {Object.entries(t.items ?? {}).map(([idx, v]) => (
                        <p key={idx} className="mt-0.5 text-[11px] text-ink-variant">
                          항목 {Number(idx) + 1} · {causeTypeLabel(v.type)}
                          {v.note ? ` — "${v.note}"` : ""}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}
