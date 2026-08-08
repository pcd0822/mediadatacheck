import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import {
  deleteFactCheckHistory,
  getFactCheckHistory,
} from "../../services/firestore.js";
import {
  DIMENSIONS,
  DIMENSION_INFO,
  ITEM_FLOOR,
  aggregateItemsToDimensions,
  computeChecklistScore,
  isLegacyDimMap,
  migrateLegacyDimensionScores,
} from "../../utils/hpfm.js";

// 등급(band)별 표시 메타. hpfm.js PERCENT_BANDS의 key와 1:1 대응.
const BAND_META = {
  high: {
    label: "신뢰 높음",
    cls: "bg-emerald-50 text-emerald-700",
    hint: "체크리스트 기준을 대체로 충족하는 자료로 판단됐어요.",
  },
  caution: {
    label: "주의",
    cls: "bg-amber-50 text-amber-700",
    hint: "전체적으로는 무난하지만 일부 항목을 더 확인하는 게 좋아요.",
  },
  low: {
    label: "신뢰 낮음",
    cls: "bg-rose-50 text-rose-700",
    hint: "비판적 점검이 강하게 권장돼요. (팩트체크 경고)",
  },
  veryLow: {
    label: "매우 낮음",
    cls: "bg-rose-100 text-rose-800",
    hint: "신뢰하기 어려운 자료예요. 다른 자료를 우선 참고하세요.",
  },
};

/** AI의 인식 한계 — 수업에서 다루는 학습 내용이므로 결과 화면에 항상 표시한다. */
function AiLimitNotice() {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
      <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          info
        </span>
        AI가 확인하지 못한 것
      </p>
      <p className="mt-1.5 text-[13px] leading-6 text-amber-800">
        AI는 <strong>입력된 출처 정보를 그대로 전제하고 판단</strong>했으며, 해당 매체가
        실재하는지, 작성일이 정확한지는 확인하지 못했습니다. 아래 점수는 "이 정보가 사실이라면"
        이라는 가정 위의 판단이에요. 출처 자체가 지어낸 것이라면 점수는 의미를 잃습니다 —
        그 확인은 <strong>여러분이 직접</strong> 해야 하는 몫이에요.
      </p>
    </div>
  );
}

export default function ResultPage() {
  const { historyId } = useParams();
  const { activeWorkspace: ws } = useWorkspace();
  const navigate = useNavigate();
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const h = await getFactCheckHistory(ws, historyId);
      setHistory(h);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId, ws?.type, ws?.id]);

  const itemResults = useMemo(
    () => (Array.isArray(history?.itemResults) ? history.itemResults : null),
    [history]
  );

  // 저장된 값이 정본이지만, 표시 직전에 한 번 더 계산해 저장값과 어긋나지 않게 한다.
  const score = useMemo(
    () => (itemResults ? computeChecklistScore(itemResults) : null),
    [itemResults]
  );

  const dimensionAverages = useMemo(() => {
    if (history?.dimensionAverages) return history.dimensionAverages;
    return itemResults ? aggregateItemsToDimensions(itemResults) : null;
  }, [history, itemResults]);

  const handleDelete = async () => {
    if (deleting) return;
    const ok = window.confirm(
      "이 팩트체크 결과를 삭제할까요?\n\n자료와 항목별 점수가 사라져요. 되돌릴 수 없습니다."
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

  if (loading) return <LoadingOverlay message="결과 불러오는 중..." />;
  if (!history) {
    return (
      <Layout title="결과를 찾을 수 없습니다">
        <Button variant="secondary" onClick={() => navigate("/student")}>
          ← 대시보드
        </Button>
      </Layout>
    );
  }

  const actions = (
    <>
      <Button variant="secondary" onClick={() => navigate("/student")}>
        ← 대시보드
      </Button>
      <Button variant="primary" onClick={() => navigate("/student/factcheck")}>
        다른 자료 팩트체크하기 →
      </Button>
      <Button variant="danger" onClick={handleDelete} loading={deleting} disabled={deleting}>
        이 결과 삭제
      </Button>
    </>
  );

  // v4.0 이전 기록 — 읽기 전용으로 저장된 값을 그대로 보여준다.
  if (!itemResults) {
    return (
      <LegacyResultView history={history} actions={actions} />
    );
  }

  const bandMeta = BAND_META[score.band] ?? BAND_META.veryLow;
  const alertSet = new Set(score.alertIndexes);

  return (
    <Layout
      title={
        <span className="flex items-center gap-3">
          <span className="material-symbols-outlined text-brand-600" style={{ fontSize: 32 }}>
            fact_check
          </span>
          팩트체크 결과
        </span>
      }
      subtitle={`${history.media?.title ?? "(표제 없음)"}${
        history.checklistName ? ` · 기준: ${history.checklistName}` : ""
      }`}
      actions={actions}
    >
      <div className="mb-6">
        <AiLimitNotice />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">
              체크리스트 항목별 채점
            </h2>
            <span className="flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-xs font-bold tracking-wider text-brand-700">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                auto_awesome
              </span>
              AI 채점 · 항목 {itemResults.length}개
            </span>
          </div>

          <div className="space-y-4">
            {itemResults.map((r, i) => (
              <ItemCard
                key={i}
                result={r}
                order={i + 1}
                isAlert={alertSet.has(r.index ?? i)}
              />
            ))}
          </div>
        </div>

        <aside className="lg:col-span-1">
          <div className="sticky top-24 rounded-2xl border border-brand-50 bg-white p-7 shadow-glow-lg">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-ink-muted">
              총점 (항목 점수 합계)
            </p>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="font-display text-[52px] font-black leading-none text-brand-600">
                {score.rawScore}
              </span>
              <span className="text-2xl font-bold text-slate-300">/ {score.maxScore}점</span>
            </div>
            <p className="mb-5 font-display text-2xl font-extrabold text-brand-700">
              {score.percent}%
            </p>

            <div className="mb-4 flex items-center justify-between gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${bandMeta.cls}`}>
                {bandMeta.label}
              </span>
              <p className="text-[11px] text-ink-muted">백분율 기준 등급</p>
            </div>
            <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-surface-base">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-700"
                style={{ width: `${Math.max(0, Math.min(100, score.percent))}%` }}
              />
            </div>
            <p className="mb-5 text-center text-xs font-medium text-ink-variant">
              {bandMeta.hint}
            </p>

            <div className="mb-4 rounded-xl bg-surface-low px-4 py-3 text-[11px] leading-5 text-ink-variant">
              <p>
                채점된 항목 <strong>{score.scoredCount}개</strong> × 5점 ={" "}
                <strong>{score.maxScore}점 만점</strong>
                {score.naCount > 0 && (
                  <>
                    {" "}· 판단 불가(N/A) <strong>{score.naCount}개</strong>는 만점에서 제외
                  </>
                )}
              </p>
              <p className="mt-1.5 text-amber-700">
                ※ 모둠마다 문항 수가 달라 <strong>원점수만으로는 모둠 간 비교가 되지 않아요.</strong>{" "}
                비교할 때는 백분율(%)을 보세요.
              </p>
            </div>

            {score.itemAlert && (
              <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                ⚠️ 총점과 별개로 {score.alertIndexes.length}개 항목이 {ITEM_FLOOR}점 미만이에요.
                총점이 괜찮아도 이 항목들은 반드시 다시 살펴보세요.
              </p>
            )}
            {score.naCount > 0 && (
              <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-600">
                AI가 판단하지 못한 항목이 {score.naCount}개 있어요. 각 항목 카드에서 그 이유를
                확인하고, <strong>그 부분은 직접 조사해보세요.</strong>
              </p>
            )}

            {dimensionAverages && (
              <DimensionSummary averages={dimensionAverages} />
            )}
          </div>
        </aside>
      </div>

      <MediaSection media={history.media} />
    </Layout>
  );
}

function ItemCard({ result, order, isAlert }) {
  const info = result.dimension ? DIMENSION_INFO[result.dimension] : null;
  const na = result.score === null || result.score === undefined;
  return (
    <div
      className={`rounded-2xl border bg-white p-6 shadow-glow transition-transform hover:scale-[1.01] ${
        isAlert ? "border-rose-200 ring-1 ring-rose-100" : "border-slate-100"
      }`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              항목 {order}
            </span>
            {info && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                {info.code} · {info.name}
              </span>
            )}
            {result.dimension === "V6" && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                우리가 만든 항목
              </span>
            )}
            {isAlert && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                항목 경고
              </span>
            )}
          </div>
          <h3 className="text-base font-bold leading-6 text-ink">{result.question}</h3>
        </div>
        <div className="shrink-0 text-right">
          {na ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              판단 불가 (N/A)
            </span>
          ) : (
            <span className="font-display text-2xl font-extrabold text-brand-600">
              {result.score}
              <span className="text-base text-ink-muted">/5</span>
            </span>
          )}
        </div>
      </div>

      {na ? (
        <div className="mb-1 rounded-lg bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] font-bold text-slate-600">AI가 판단하지 못한 이유</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-variant">{result.reason}</p>
          <p className="mt-1.5 text-[11px] text-slate-500">
            이 항목은 점수 계산과 만점에서 모두 빠졌어요. 직접 조사해서 우리 판단을 채워보세요.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-base">
            <div
              className={`h-2 rounded-full bg-gradient-to-r transition-all duration-500 ${
                isAlert ? "from-rose-400 to-rose-600" : "from-brand-500 to-brand-600"
              }`}
              style={{ width: `${(Number(result.score) / 5) * 100}%` }}
            />
          </div>
          {result.reason && (
            <p className="text-sm leading-relaxed text-ink-variant">
              <span className="font-bold text-brand-700">근거:</span> {result.reason}
            </p>
          )}
        </>
      )}

      {Array.isArray(result.redFlags) && result.redFlags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {result.redFlags.map((flag, i) => (
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
}

/** 5대 검증 행동별 평균 — 점수 계산과 무관한 분석·비교용 표시. */
function DimensionSummary({ averages }) {
  const rows = DIMENSIONS.map((d) => ({
    code: d,
    name: DIMENSION_INFO[d].name,
    value: Number.isFinite(Number(averages?.[d])) ? Number(averages[d]) : null,
  }));
  if (rows.every((r) => r.value == null)) return null;

  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-ink-muted">
        검증 행동별 평균
      </p>
      <p className="mb-3 text-[10px] leading-4 text-ink-muted">
        총점 계산에는 쓰이지 않아요. 우리 체크리스트가 어떤 검증 행동을 얼마나 다뤘는지
        비교해보는 참고용 표시예요.
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.code} className="flex items-center gap-2">
            <span className="w-28 truncate text-[11px] text-ink-variant">
              <span className="font-bold text-brand-600">{r.code}</span> {r.name}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-base">
              <div
                className="h-full rounded-full bg-brand-400"
                style={{ width: r.value == null ? "0%" : `${(r.value / 5) * 100}%` }}
              />
            </div>
            <span className="w-10 text-right text-[11px] font-bold text-ink-variant">
              {r.value == null ? "–" : r.value.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MediaSection({ media }) {
  return (
    <section className="mt-12 rounded-2xl border border-slate-200 bg-surface-low p-7">
      <h4 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
        <span className="material-symbols-outlined text-ink-variant" style={{ fontSize: 22 }}>
          article
        </span>
        평가 대상
      </h4>
      <div className="rounded-xl border border-slate-100 bg-white p-6">
        <p className="text-sm font-bold text-ink">{media?.title}</p>
        {media?.subtitle && (
          <p className="mt-0.5 text-sm text-ink-variant">{media.subtitle}</p>
        )}
        <p className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-ink-muted">
          {media?.publisher && <span>언론사(미검증): {media.publisher}</span>}
          {media?.publishedAt && <span>작성일(미검증): {media.publishedAt}</span>}
        </p>
        {media?.link && (
          <a
            href={media.link}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-brand-700 underline"
          >
            원본 링크 ↗
          </a>
        )}
        {media?.imageUrl && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              첨부 이미지
            </p>
            <img
              src={media.imageUrl}
              alt="평가 대상 첨부 이미지"
              className="rounded-xl object-contain ring-1 ring-slate-200"
              style={{ maxWidth: "100%", maxHeight: "480px" }}
            />
          </div>
        )}
        <p className="mt-3 whitespace-pre-wrap text-[15px] italic leading-relaxed text-ink-variant">
          "{media?.content}"
        </p>
      </div>
    </section>
  );
}

/**
 * v4.0 이전(검증 행동 5개 채점 + 교사 기준 보정) 기록의 읽기 전용 뷰.
 * 그 시절 저장된 값을 그대로 보여주기만 하고 다시 계산하지 않는다.
 */
function LegacyResultView({ history, actions }) {
  const raw = history.dimensionScores ?? {};
  const dims = isLegacyDimMap(raw) ? migrateLegacyDimensionScores(raw) : raw;
  const total = Number(history.finalTotalScore ?? history.totalScore ?? 0);

  return (
    <Layout
      title="팩트체크 결과 (이전 버전)"
      subtitle={history.media?.title ?? "(표제 없음)"}
      actions={actions}
    >
      <div className="mb-6 rounded-2xl border border-slate-300 bg-slate-50 px-5 py-4">
        <p className="text-sm font-bold text-slate-800">이전 버전(v4.0) 기록이에요</p>
        <p className="mt-1.5 text-[13px] leading-6 text-slate-600">
          이 결과는 <strong>5대 검증 행동에 AI가 점수를 매기고 교사 기준 보정을 더하던 방식</strong>으로
          저장됐어요. 지금은 <strong>우리 체크리스트 항목으로 직접 채점하는 방식</strong>으로
          바뀌었기 때문에, 이 기록은 그때 저장된 값을 그대로 보여주기만 합니다.
          같은 자료를 새 방식으로 다시 검증하려면 팩트체크 화면에서 '기존 자료 불러오기'를 쓰세요.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {DIMENSIONS.map((d) => {
            const info = DIMENSION_INFO[d];
            const v = Number(dims?.[d]);
            const has = Number.isFinite(v);
            return (
              <div key={d} className="rounded-2xl border border-slate-100 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-ink">
                      {info.code} · {info.name}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-ink-muted">{info.description}</p>
                  </div>
                  <span className="font-display text-xl font-extrabold text-slate-500">
                    {has ? v.toFixed(1) : "N/A"}
                    {has && <span className="text-sm text-ink-muted">/5</span>}
                  </span>
                </div>
                {history.dimensionReasons?.[d] && (
                  <p className="mt-2 text-sm leading-relaxed text-ink-variant">
                    <span className="font-bold text-slate-600">근거:</span>{" "}
                    {history.dimensionReasons[d]}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <aside>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">
              당시 저장된 총점
            </p>
            <p className="mt-2 font-display text-[44px] font-black leading-none text-slate-500">
              {total.toFixed(1)}
              <span className="text-xl text-slate-300">/50</span>
            </p>
            <p className="mt-3 text-[11px] leading-5 text-ink-muted">
              v4.0 방식(AI 점수 + 교사 기준 보정)의 50점 환산 값이에요. 지금 방식의 원점수·백분율과
              직접 비교할 수 없습니다.
            </p>
          </div>
        </aside>
      </div>

      <MediaSection media={history.media} />
    </Layout>
  );
}
