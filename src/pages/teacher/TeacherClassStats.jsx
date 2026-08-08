import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import {
  getGroupDetailForTeacher,
  getGroupFactCheck,
  listAllGroupsWithProgress,
} from "../../services/lesson.js";
import { listTeacherMediaItems } from "../../services/firestore.js";
import { DIMENSION_INFO } from "../../utils/hpfm.js";
import {
  aggregateCauseTags,
  buildCsv,
  computeClassStats,
  downloadCsv,
} from "../../utils/lessonStats.js";
import { CAUSE_TYPES } from "../../constants/lesson.js";

/**
 * 교사용 학급 집계 (D).
 *
 * ⚠️ **교사 등록 공통 자료에 한해서만** 집계한다. 모둠 자료는 모둠마다 다르므로 합칠 수 없다.
 *    모둠마다 체크리스트도 다르지만, "각 모둠이 자기 도구로 채점했을 때 AI와 얼마나
 *    벌어졌는가"는 지표 단위로 모을 수 있다. 모둠 간 우열 비교가 아니라
 *    "어떤 지표가 사람 판단을 요구하는가"를 읽는 자료다.
 */
export default function TeacherClassStats() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [teacherMedia, setTeacherMedia] = useState(null);
  const [groupData, setGroupData] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [allAnswers, setAllAnswers] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const media = (await listTeacherMediaItems())[0] ?? null;
        setTeacherMedia(media);
        if (!media) {
          setLoading(false);
          return;
        }

        const groups = await listAllGroupsWithProgress();
        const collected = [];
        const tags = [];
        const answers = [];

        for (const g of groups) {
          const historyId = g.progress?.stage4?.aiHistoryIds?.[media.id];
          if (!historyId) continue; // 아직 AI 채점 전인 모둠은 집계에서 제외

          const [detail, ai] = await Promise.all([
            getGroupDetailForTeacher(g.groupId).catch(() => null),
            getGroupFactCheck(g.groupId, historyId).catch(() => null),
          ]);
          if (!detail || !ai) continue;

          const excluded = g.progress?.stage3?.excludedUids ?? [];
          const members = detail.blindScores
            .filter((s) => s.mediaId === media.id && s.locked && !excluded.includes(s.uid))
            .map((s) => ({ uid: s.uid, name: s.name ?? "", scores: s.scores ?? {} }));

          collected.push({
            groupId: g.groupId,
            groupName: g.groupName,
            items: g.progress?.checklistSnapshot ?? detail.checklists?.[0]?.items ?? [],
            aiResults: ai.itemResults ?? [],
            members,
            causeTags: detail.causeTags.filter((t) => t.mediaId === media.id),
            excludedCount: excluded.length,
          });
          tags.push(
            ...detail.causeTags
              .filter((t) => t.mediaId === media.id)
              .map((t) => ({ ...t, _items: g.progress?.checklistSnapshot ?? [] }))
          );
          answers.push(
            ...detail.reflectionAnswers.map((a) => ({ ...a, groupName: g.groupName }))
          );
        }

        setGroupData(collected);
        setAllTags(tags);
        setAllAnswers(answers);
      } catch (e) {
        console.error(e);
        setError(e.message ?? "학급 집계를 불러오지 못했어요.");
      }
      setLoading(false);
    })();
  }, []);

  const classStats = useMemo(() => computeClassStats(groupData), [groupData]);

  // 원인 유형은 모둠마다 항목 인덱스가 다르므로 모둠별로 집계한 뒤 합친다.
  const causeAgg = useMemo(() => {
    const byType = {};
    const byDimension = {};
    let total = 0;
    for (const g of groupData) {
      const agg = aggregateCauseTags(g.causeTags, g.items);
      total += agg.total;
      for (const [k, v] of Object.entries(agg.byType)) byType[k] = (byType[k] ?? 0) + v;
      for (const [d, m] of Object.entries(agg.byDimension)) {
        byDimension[d] = byDimension[d] ?? {};
        for (const [k, v] of Object.entries(m)) {
          byDimension[d][k] = (byDimension[d][k] ?? 0) + v;
        }
      }
    }
    return { byType, byDimension, total };
  }, [groupData]);

  const handleCsv = () => {
    const csv = buildCsv({
      groupName: "학급 전체",
      medias: groupData.map((g) => ({
        title: `${g.groupName} · ${teacherMedia?.title ?? ""}`,
        items: g.items,
        aiResults: g.aiResults,
        members: g.members,
        causeTags: g.causeTags,
      })),
      reflectionAnswers: allAnswers,
    });
    downloadCsv("학급집계_공통자료.csv", csv);
  };

  const maxAbs = Math.max(
    ...classStats.byDimension.map((d) => d.absMean ?? 0),
    1
  );

  return (
    <Layout
      title="학급 집계"
      subtitle="교사 등록 공통 자료에 대한 학급 전체 지표별 결과"
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/teacher/progress")}>
            ← 진행 현황
          </Button>
          {groupData.length > 0 && (
            <Button variant="secondary" onClick={handleCsv}>
              전체 CSV 내보내기
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <SkeletonList count={3} />
      ) : error ? (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : !teacherMedia ? (
        <div className="card text-center text-sm text-slate-500">
          공통 필수 자료가 없어요. 먼저 미디어 자료를 등록해주세요.
        </div>
      ) : groupData.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          아직 AI 채점을 마친 모둠이 없어요. 모둠들이 4단계에 도달하면 여기에 집계됩니다.
        </div>
      ) : (
        <>
          <div className="card mb-6">
            <p className="text-sm font-bold text-slate-900">{teacherMedia.title}</p>
            <p className="mt-1 text-xs text-slate-500">
              참여 {classStats.groupCount}개 모둠 · 학생 {classStats.studentCount}명
              {groupData.some((g) => g.excludedCount > 0) && (
                <span className="ml-1 text-amber-700">
                  (미제출 제외{" "}
                  {groupData.reduce((s, g) => s + g.excludedCount, 0)}명)
                </span>
              )}
            </p>
          </div>

          <section className="card mb-6">
            <h2 className="text-lg font-bold text-slate-900">지표별 학급 전체 차이 절댓값 평균</h2>
            <p className="mb-4 text-xs text-ink-muted">
              값이 클수록 <strong>사람 판단이 더 필요한 지표</strong>예요. 마무리 토의의 근거로 쓰세요.
            </p>
            <div className="space-y-2.5">
              {classStats.byDimension.map((d) => {
                const info = DIMENSION_INFO[d.dimension];
                const pct = d.absMean === null ? 0 : (d.absMean / maxAbs) * 100;
                return (
                  <div key={d.dimension} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 truncate text-xs text-ink-variant">
                      <span className="font-bold text-brand-600">{d.dimension}</span> {info.name}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-base">
                      <div
                        className={`h-full rounded-full ${
                          d.absMean >= 1.5
                            ? "bg-rose-500"
                            : d.absMean >= 1
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-24 text-right text-xs font-bold text-ink-variant">
                      {d.absMean === null ? "–" : d.absMean.toFixed(2)}
                      <span className="ml-1 font-normal text-ink-muted">
                        ({d.observationCount})
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 rounded-xl bg-surface-low px-4 py-3 text-[11px] leading-5 text-ink-muted">
              ℹ️ 모둠마다 체크리스트가 다르므로, 이 수치는 <strong>"각 모둠이 자기 도구로
              채점했을 때 AI와 얼마나 벌어졌는가"</strong>를 지표 단위로 모은 값입니다. 모둠 간
              우열 비교가 아니라 <strong>어떤 지표가 사람 판단을 요구하는가</strong>를 읽는
              용도예요. 괄호 안 숫자는 관측치 수입니다.
            </p>
          </section>

          <section className="card mb-6">
            <h2 className="text-lg font-bold text-slate-900">원인 유형 학급 분포</h2>
            <p className="mb-4 text-xs text-ink-muted">총 {causeAgg.total}건</p>
            {causeAgg.total === 0 ? (
              <p className="text-sm text-slate-500">아직 기록된 원인 유형이 없어요.</p>
            ) : (
              <>
                <div className="mb-4 grid gap-2 sm:grid-cols-4">
                  {CAUSE_TYPES.map((c, i) => {
                    const n = causeAgg.byType[c.key] ?? 0;
                    const pct = causeAgg.total ? Math.round((n / causeAgg.total) * 100) : 0;
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
                  {Object.keys(causeAgg.byDimension)
                    .filter((d) => Object.values(causeAgg.byDimension[d]).some((n) => n > 0))
                    .map((d) => (
                      <div key={d} className="flex items-center gap-3">
                        <span className="w-36 shrink-0 truncate text-xs text-ink-variant">
                          <span className="font-bold text-brand-600">{d}</span>{" "}
                          {DIMENSION_INFO[d].name}
                        </span>
                        <div className="flex flex-1 flex-wrap gap-1">
                          {CAUSE_TYPES.map((c, i) => {
                            const n = causeAgg.byDimension[d][c.key] ?? 0;
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

          <section className="card mb-6">
            <h2 className="text-lg font-bold text-slate-900">모둠별 비교</h2>
            <p className="mb-4 text-xs text-ink-muted">
              모둠 전체의 차이 절댓값 평균입니다. 문항 구성이 달라 우열로 읽지 마세요.
            </p>
            <div className="flex flex-wrap gap-2">
              {classStats.perGroup.map((g) => (
                <span
                  key={g.groupId}
                  className="rounded-xl bg-surface-low px-3 py-2 text-xs text-ink-variant"
                >
                  <strong>{g.groupName}</strong>{" "}
                  <span className="font-black text-brand-600">
                    {g.absMean === null ? "–" : g.absMean.toFixed(2)}
                  </span>
                  <span className="ml-1 text-[10px] text-ink-muted">({g.memberCount}명)</span>
                </span>
              ))}
            </div>
          </section>

          <section className="card">
            <h2 className="text-lg font-bold text-slate-900">
              성찰 답변 ({allAnswers.length}명 제출)
            </h2>
            {allAnswers.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">아직 제출된 답변이 없어요.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {allAnswers.map((a) => (
                  <div key={`${a.groupName}-${a.uid}`} className="rounded-xl bg-surface-low px-4 py-3">
                    <p className="text-xs font-bold text-ink">
                      {a.groupName} · {a.name ?? a.uid}
                    </p>
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
        </>
      )}
    </Layout>
  );
}
