import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import LessonShell from "../../components/LessonShell.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import { listChecklists } from "../../services/firestore.js";
import {
  ensureChecklistSnapshot,
  getGroupFactCheck,
  getMyReflectionAnswers,
  listCauseTags,
  saveReflectionAnswers,
  subscribeBlindScores,
  subscribeProgress,
} from "../../services/lesson.js";
import { loadLessonMedia } from "./Stage3Blind.jsx";
import { DIMENSION_INFO } from "../../utils/hpfm.js";
import {
  aggregateCauseTags,
  buildCsv,
  buildScoreMatrix,
  computeDimensionStats,
  downloadCsv,
} from "../../utils/lessonStats.js";
import { CAUSE_TYPES, REFLECTION_QUESTIONS, citesNumber } from "../../constants/lesson.js";

export default function Stage4Dashboard() {
  return (
    <LessonShell
      stage={4}
      title="4단계 · 비교 대시보드"
      subtitle="우리 모둠과 AI의 판단이 어디서 얼마나 갈렸는지 지표별로 살펴봐요."
    >
      {(ctx) => <DashboardBody {...ctx} />}
    </LessonShell>
  );
}

function DashboardBody({ group, members, progress }) {
  const { user, profile } = useAuth();
  const { activeWorkspace: ws } = useWorkspace();
  const navigate = useNavigate();

  const [livePro, setLivePro] = useState(progress);
  const [medias, setMedias] = useState([]);
  const [aiByMedia, setAiByMedia] = useState({});
  const [blindScores, setBlindScores] = useState([]);
  const [causeTags, setCauseTags] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ws?.id) return undefined;
    const unsubP = subscribeProgress(ws.id, (p) => setLivePro(p));
    const unsubS = subscribeBlindScores(ws.id, (s) => setBlindScores(s));
    return () => {
      unsubP();
      unsubS();
    };
  }, [ws?.id]);

  const [items, setItems] = useState([]);
  const aiHistoryIds = livePro?.stage4?.aiHistoryIds ?? {};
  const excludedUids = livePro?.stage3?.excludedUids ?? [];

  useEffect(() => {
    if (!ws?.id) return;
    (async () => {
      setLoading(true);
      const ms = await loadLessonMedia(ws.id);
      setMedias(ms);
      const { items: frozen } = await ensureChecklistSnapshot(ws, livePro, listChecklists);
      setItems(frozen);
      setCauseTags(await listCauseTags(ws.id).catch(() => []));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id]);

  useEffect(() => {
    if (!ws?.id) return;
    (async () => {
      const next = {};
      for (const [mediaId, historyId] of Object.entries(aiHistoryIds)) {
        if (!historyId) continue;
        const doc = await getGroupFactCheck(ws.id, historyId).catch(() => null);
        if (doc) next[mediaId] = doc;
      }
      setAiByMedia(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, JSON.stringify(aiHistoryIds)]);

  const media = medias[activeIdx] ?? null;
  const ai = media ? aiByMedia[media.id] : null;

  // 통계에 포함되는 모둠원 = 해당 자료를 제출(잠금)했고 제외 명단에 없는 사람
  const includedMembers = useMemo(() => {
    if (!media) return [];
    return blindScores
      .filter((s) => s.mediaId === media.id && s.locked && !excludedUids.includes(s.uid))
      .map((s) => ({ uid: s.uid, name: s.name ?? "이름없음", scores: s.scores ?? {} }));
  }, [blindScores, media, excludedUids]);

  const excludedMembers = useMemo(
    () => members.filter((m) => excludedUids.includes(m.uid)),
    [members, excludedUids]
  );

  const aiResults = ai?.itemResults ?? [];
  const stats = useMemo(
    () => computeDimensionStats(items, aiResults, includedMembers),
    [items, aiResults, includedMembers]
  );
  const matrix = useMemo(
    () => buildScoreMatrix(items, aiResults, includedMembers),
    [items, aiResults, includedMembers]
  );
  const mediaTags = useMemo(
    () => causeTags.filter((t) => t.mediaId === media?.id),
    [causeTags, media]
  );
  const causeAgg = useMemo(() => aggregateCauseTags(mediaTags, items), [mediaTags, items]);

  const handleCsv = async () => {
    const payload = medias.map((m) => ({
      title: m.title,
      items,
      aiResults: aiByMedia[m.id]?.itemResults ?? [],
      members: blindScores
        .filter((s) => s.mediaId === m.id && s.locked && !excludedUids.includes(s.uid))
        .map((s) => ({ uid: s.uid, name: s.name ?? "", scores: s.scores ?? {} })),
      causeTags: causeTags.filter((t) => t.mediaId === m.id),
    }));
    const csv = buildCsv({
      groupName: group?.groupName ?? "모둠",
      medias: payload,
      reflectionAnswers: [],
    });
    downloadCsv(`${group?.groupName ?? "group"}_비교결과.csv`, csv);
  };

  if (loading) return <SkeletonList count={3} />;
  if (!medias.length) {
    return <div className="card text-center text-sm text-slate-500">평가할 자료가 없어요.</div>;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {medias.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 transition ${
                i === activeIdx
                  ? "bg-brand-600 text-white ring-brand-600"
                  : "bg-white text-ink-variant ring-slate-200 hover:bg-slate-50"
              }`}
            >
              자료 {i + 1} · {m.kind === "teacher" ? "선생님 자료" : "우리 모둠 자료"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate("/student/lesson/reveal")}>
            ← AI 판정 안내판
          </Button>
          <Button variant="secondary" onClick={handleCsv}>
            CSV 내보내기
          </Button>
        </div>
      </div>

      <div className="card mb-4">
        <p className="text-sm font-bold text-slate-900">{media?.title}</p>
        <p className="mt-1 text-xs text-slate-500">
          통계에 포함된 모둠원 <strong>{includedMembers.length}명</strong>
          {excludedMembers.length > 0 && (
            <span className="ml-1 font-semibold text-amber-700">
              · 미제출로 제외 {excludedMembers.length}명 (
              {excludedMembers.map((m) => m.name ?? "모둠원").join(", ")}) ⚠
            </span>
          )}
        </p>
      </div>

      {!ai ? (
        <div className="card text-center text-sm text-slate-500">
          이 자료의 AI 채점 결과가 아직 없어요. AI 판정 안내판에서 실행해주세요.
        </div>
      ) : includedMembers.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          이 자료를 제출한 모둠원이 없어 비교할 수 없어요.
        </div>
      ) : (
        <>
          <DimensionTable stats={stats} />
          <ScoreMatrix matrix={matrix} />
          <CauseDistribution agg={causeAgg} />
        </>
      )}

      <ReflectionSection
        groupId={ws.id}
        uid={user.uid}
        name={profile?.displayName ?? user?.displayName ?? null}
      />
    </>
  );
}

/* ===================== 지표별 통계 표 ===================== */

function DimensionTable({ stats }) {
  const [openDim, setOpenDim] = useState(null);
  return (
    <section className="card mb-6">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">지표별 비교</h2>
        <span className="badge bg-brand-50 text-brand-700">
          차이 절댓값 평균 오름차순 (일치 → 불일치)
        </span>
      </div>
      <p className="mb-4 text-xs leading-5 text-ink-muted">
        <strong>차이 절댓값 평균</strong>이 기본 기준이에요. 부호 있는 평균만 보면 +2와 −2가 서로
        지워져, 판단이 정반대로 갈린 상태가 "완전 일치"로 잘못 읽힙니다. 두 값을 반드시 함께 보세요.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-ink-muted">
              <th className="px-2 py-2 text-left font-semibold">지표</th>
              <th className="px-2 py-2 text-right font-semibold">차이 절댓값 평균 ★</th>
              <th className="px-2 py-2 text-right font-semibold">부호 있는 평균</th>
              <th className="px-2 py-2 text-right font-semibold">중앙값</th>
              <th className="px-2 py-2 text-right font-semibold">모둠원 표준편차</th>
              <th className="px-2 py-2 text-left font-semibold">읽기</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stats.map((s) => {
              const info = DIMENSION_INFO[s.dimension];
              const noData = s.absMean === null;
              return (
                <Fragment key={s.dimension}>
                  <tr
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setOpenDim(openDim === s.dimension ? null : s.dimension)}
                  >
                    <td className="px-2 py-2.5">
                      <span className="font-bold text-brand-600">{s.dimension}</span>{" "}
                      <span className="text-ink-variant">{info.name}</span>
                      <span className="ml-1 text-[10px] text-ink-muted">
                        문항 {s.itemCount}
                        {s.naItemCount > 0 && ` · N/A ${s.naItemCount}`}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right font-black">
                      {noData ? "–" : s.absMean.toFixed(2)}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {noData ? (
                        "–"
                      ) : (
                        <span
                          className={
                            s.signedMean > 0
                              ? "text-emerald-700"
                              : s.signedMean < 0
                              ? "text-rose-700"
                              : "text-ink-muted"
                          }
                        >
                          {s.signedMean > 0 ? "+" : ""}
                          {s.signedMean.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right text-ink-variant">
                      {noData ? "–" : s.medianDiff.toFixed(2)}
                    </td>
                    <td className="px-2 py-2.5 text-right text-ink-variant">
                      {s.memberStdev === null ? "–" : s.memberStdev.toFixed(2)}
                    </td>
                    <td className="px-2 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          s.flags.cancellation
                            ? "bg-rose-100 text-rose-700"
                            : s.flags.memberSplit
                            ? "bg-amber-100 text-amber-800"
                            : s.flags.medianGap
                            ? "bg-amber-50 text-amber-700"
                            : noData
                            ? "bg-slate-100 text-slate-500"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {s.flags.cancellation && "🔴 "}
                        {s.reading}
                      </span>
                    </td>
                  </tr>
                  {openDim === s.dimension && (
                    <tr className="bg-surface-low">
                      <td colSpan={6} className="px-4 py-3">
                        <DimensionExplain stat={s} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-5 text-ink-muted">
        · <strong>N/A 항목</strong>(AI가 판단하지 못한 항목)은 차이 통계에서 제외됩니다. 다만
        모둠원 표준편차는 AI와 무관하므로 N/A 항목도 포함해 계산해요.
        <br />· 표본이 모둠원 3~5명이라 <strong>최대·최소값 절사(trimmed mean)는 쓰지 않습니다.</strong>{" "}
        한 명이 크게 다르게 본 사실 자체가 중요한 신호이기 때문이에요.
      </p>
    </section>
  );
}

function DimensionExplain({ stat }) {
  const notes = [];
  if (stat.flags.cancellation) {
    notes.push(
      `부호 있는 평균은 ${stat.signedMean.toFixed(2)}로 0에 가깝지만, 차이 절댓값 평균은 ${stat.absMean.toFixed(
        2
      )}입니다. 한쪽은 AI보다 높게, 다른 쪽은 낮게 봐서 평균이 서로 지워진 거예요. "비슷하다"가 아니라 판단이 정반대로 갈린 상태입니다.`
    );
  }
  if (stat.flags.memberSplit) {
    notes.push(
      `모둠원 표준편차가 ${stat.memberStdev.toFixed(
        2
      )}로 큽니다. AI와의 평균 차이가 작더라도, 모둠원끼리 크게 갈렸다면 "우연히 평균이 맞은" 것일 수 있어요.`
    );
  }
  if (stat.flags.medianGap) {
    notes.push(
      `평균(${stat.signedMean.toFixed(2)})과 중앙값(${stat.medianDiff.toFixed(
        2
      )})이 벌어져 있어요. 대부분은 비슷하게 봤는데 한 명이 유독 다르게 봤다는 신호입니다.`
    );
  }
  if (stat.naItemCount > 0) {
    notes.push(
      `이 지표의 ${stat.naItemCount}개 문항은 AI가 판단하지 못해(N/A) 차이 통계에서 빠졌어요.`
    );
  }
  if (notes.length === 0) {
    notes.push(
      `관측치 ${stat.observationCount}개 기준으로 특별한 경고 신호는 없어요. 그래도 원자료(아래 표)에서 개별 항목을 확인해보세요.`
    );
  }
  return (
    <ul className="space-y-1.5">
      {notes.map((n, i) => (
        <li key={i} className="text-xs leading-5 text-ink-variant">
          · {n}
        </li>
      ))}
    </ul>
  );
}

/* ===================== 모둠 내 편차 뷰 (원자료) ===================== */

function ScoreMatrix({ matrix }) {
  return (
    <section className="card mb-6">
      <h2 className="text-lg font-bold text-slate-900">모둠 내 편차 (원자료)</h2>
      <p className="mb-4 text-xs text-ink-muted">
        같은 항목에 모둠원이 각각 몇 점을 줬는지 그대로 보여줍니다. 요약하지 않은 원자료예요.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-ink-muted">
              <th className="px-2 py-2 text-left font-semibold">항목</th>
              {matrix.members.map((m) => (
                <th key={m.uid} className="px-2 py-2 text-center font-semibold">
                  {m.name}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-semibold text-purple-600">AI</th>
              <th className="px-2 py-2 text-right font-semibold">|차이| 평균</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {matrix.rows.map((r) => (
              <tr key={r.itemIndex} className="hover:bg-slate-50">
                <td className="px-2 py-2">
                  <p className="line-clamp-1 text-xs font-medium text-ink">
                    {r.itemIndex + 1}. {r.question}
                  </p>
                  {r.dimension && (
                    <span className="text-[10px] font-bold text-brand-600">{r.dimension}</span>
                  )}
                </td>
                {r.cells.map((c) => (
                  <td key={c.uid} className="px-2 py-2 text-center font-semibold text-ink-variant">
                    {c.score ?? "–"}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-bold text-purple-600">
                  {r.aiScore === null ? "N/A" : r.aiScore}
                </td>
                <td className="px-2 py-2 text-right">
                  {r.absDiffMean === null ? (
                    <span className="text-slate-400">–</span>
                  ) : (
                    <span
                      className={
                        r.absDiffMean >= 2
                          ? "font-black text-rose-700"
                          : r.absDiffMean >= 1
                          ? "font-bold text-amber-700"
                          : "text-ink-variant"
                      }
                    >
                      {r.absDiffMean.toFixed(2)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ===================== 원인 유형 분포 ===================== */

function CauseDistribution({ agg }) {
  const dims = Object.keys(agg.byDimension).filter((d) =>
    Object.values(agg.byDimension[d]).some((n) => n > 0)
  );
  return (
    <section className="card mb-6">
      <h2 className="text-lg font-bold text-slate-900">원인 유형 분포</h2>
      <p className="mb-4 text-xs text-ink-muted">
        차이의 원인이 어느 지표에 몰려 있는지 보여줍니다. 총 {agg.total}건 기록됨.
      </p>
      {agg.total === 0 ? (
        <p className="text-sm text-slate-500">
          아직 기록된 원인 유형이 없어요. AI 판정 안내판에서 차이가 난 항목의 원인을 골라보세요.
        </p>
      ) : (
        <>
          <div className="mb-4 grid gap-2 sm:grid-cols-4">
            {CAUSE_TYPES.map((c, i) => {
              const n = agg.byType[c.key] ?? 0;
              const pct = agg.total ? Math.round((n / agg.total) * 100) : 0;
              return (
                <div key={c.key} className="rounded-xl bg-surface-low px-3 py-2.5">
                  <p className="text-[11px] font-bold text-ink">
                    {["①", "②", "③", "④"][i]} {c.label}
                  </p>
                  <p className="mt-1 text-lg font-black text-brand-600">
                    {n}
                    <span className="ml-1 text-xs font-semibold text-ink-muted">{pct}%</span>
                  </p>
                </div>
              );
            })}
          </div>
          <div className="space-y-2">
            {dims.map((d) => (
              <div key={d} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-xs text-ink-variant">
                  <span className="font-bold text-brand-600">{d}</span> {DIMENSION_INFO[d].name}
                </span>
                <div className="flex flex-1 flex-wrap gap-1">
                  {CAUSE_TYPES.map((c, i) => {
                    const n = agg.byDimension[d][c.key] ?? 0;
                    if (!n) return null;
                    return (
                      <span
                        key={c.key}
                        className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700"
                        title={c.label}
                      >
                        {["①", "②", "③", "④"][i]} {n}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* ===================== 성찰 답변 ===================== */

function ReflectionSection({ groupId, uid, name }) {
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    (async () => {
      const doc = await getMyReflectionAnswers(groupId, uid).catch(() => null);
      if (doc?.answers) setAnswers(doc.answers);
      if (doc?.submittedAt?.toDate) setSavedAt(doc.submittedAt.toDate());
    })();
  }, [groupId, uid]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveReflectionAnswers(groupId, { uid, name, answers });
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  };

  const filled = REFLECTION_QUESTIONS.filter((q) => (answers[q.key] ?? "").trim()).length;

  return (
    <section className="card">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">오늘의 마무리</h2>
        <span className="badge bg-slate-100 text-slate-600">
          {filled} / {REFLECTION_QUESTIONS.length} 작성
        </span>
      </div>
      <p className="mb-4 text-xs text-ink-muted">
        위 대시보드의 수치를 근거로 삼아 적어보세요. 답변은 선생님이 함께 봅니다.
      </p>

      <div className="space-y-5">
        {REFLECTION_QUESTIONS.map((q, i) => {
          const text = answers[q.key] ?? "";
          const needsNumberWarning = q.needsNumber && text.trim() && !citesNumber(text);
          return (
            <div key={q.key}>
              <label className="block text-sm font-semibold text-ink">
                {i + 1}) {q.title}
              </label>
              <p className="mt-0.5 text-[11px] text-brand-700">💡 {q.hint}</p>
              <textarea
                className="input mt-1.5 min-h-[110px] resize-y text-sm"
                value={text}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                placeholder="자유롭게 적어주세요."
              />
              {needsNumberWarning && (
                <p className="mt-1 text-[11px] text-amber-700">
                  ⚠ 아직 숫자가 인용되지 않았어요. (제출은 가능합니다)
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        {savedAt ? (
          <span className="text-xs text-emerald-700">
            저장됨 · {savedAt.toLocaleTimeString("ko-KR")}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">아직 저장하지 않았어요</span>
        )}
        <Button variant="primary" onClick={handleSave} loading={saving}>
          답변 저장
        </Button>
      </div>
    </section>
  );
}
