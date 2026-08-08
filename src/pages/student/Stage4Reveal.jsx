import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import LessonShell from "../../components/LessonShell.jsx";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import { listChecklists } from "../../services/firestore.js";
import {
  ensureChecklistSnapshot,
  getMyBlindScore,
  getGroupFactCheck,
  saveCauseTag,
  subscribeMyCauseTags,
  subscribeProgress,
} from "../../services/lesson.js";
import { runLessonAi } from "../../services/lessonAi.js";
import { loadLessonMedia } from "./Stage3Blind.jsx";
import { DIMENSION_INFO } from "../../utils/hpfm.js";
import { BIG_DIFF_THRESHOLD, CAUSE_TYPES } from "../../constants/lesson.js";

/** AI의 인식 한계 고지 — 결과 화면에 항상 노출한다. */
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

export default function Stage4Reveal() {
  return (
    <LessonShell
      stage={4}
      title="4단계 · AI 판정 안내판"
      subtitle="이제 AI가 같은 체크리스트로 채점한 결과를 봅니다. 내 판단과 나란히 놓고 견줘보세요."
    >
      {(ctx) => <Stage4RevealBody {...ctx} />}
    </LessonShell>
  );
}

function Stage4RevealBody({ progress }) {
  const { user, profile } = useAuth();
  const { activeWorkspace: ws } = useWorkspace();
  const navigate = useNavigate();

  const [medias, setMedias] = useState([]);
  const [items, setItems] = useState([]);
  const [aiByMedia, setAiByMedia] = useState({}); // mediaId -> factcheck_history doc
  const [myScores, setMyScores] = useState({}); // mediaId -> { itemIndex: score }
  const [tags, setTags] = useState({}); // mediaId -> { itemIndex: {type, note} }
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [livePro, setLivePro] = useState(progress);
  const ranRef = useRef(false);

  const name = profile?.displayName ?? user?.displayName ?? null;
  const aiHistoryIds = livePro?.stage4?.aiHistoryIds ?? {};

  // 진행 문서 구독 — 다른 모둠원이 AI를 돌리면 그 결과가 실시간으로 들어온다.
  useEffect(() => {
    if (!ws?.id) return undefined;
    const unsub = subscribeProgress(ws.id, (p) => setLivePro(p));
    return () => unsub();
  }, [ws?.id]);

  // 기초 데이터 로드
  useEffect(() => {
    if (!ws?.id) return;
    (async () => {
      setLoading(true);
      try {
        const ms = await loadLessonMedia(ws.id);
        setMedias(ms);
        // 교사가 학생보다 먼저 강제 진행했다면 스냅샷이 없을 수 있으므로 여기서 메운다.
        const { items: frozen } = await ensureChecklistSnapshot(ws, livePro, listChecklists);
        setItems(frozen);
        const mine = {};
        for (const m of ms) {
          const doc = await getMyBlindScore(ws.id, user.uid, m.id);
          mine[m.id] = doc?.scores ?? {};
        }
        setMyScores(mine);
      } catch (e) {
        console.error(e);
        setError(e.message ?? "결과 화면을 준비하지 못했어요.");
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id]);

  // AI 채점 실행 (아직 안 돌았으면). single-flight라 동시에 열어도 1회만 호출된다.
  useEffect(() => {
    if (loading || ranRef.current) return;
    if (!medias.length || !items.length) return;
    const missing = medias.filter((m) => !aiHistoryIds[m.id]);
    if (missing.length === 0) return;
    ranRef.current = true;
    (async () => {
      setRunning(true);
      setError("");
      try {
        await runLessonAi(ws, {
          medias,
          items,
          checklistId: livePro?.checklistId ?? null,
          user,
          existing: aiHistoryIds,
        });
      } catch (e) {
        console.error(e);
        setError(e.message ?? "AI 채점 중 오류가 발생했어요.");
        ranRef.current = false; // 재시도 허용
      } finally {
        setRunning(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, medias, items, JSON.stringify(aiHistoryIds)]);

  // AI 결과 문서 로드
  useEffect(() => {
    if (!ws?.id) return;
    (async () => {
      const next = {};
      for (const [mediaId, historyId] of Object.entries(aiHistoryIds)) {
        if (!historyId) continue;
        if (aiByMedia[mediaId]?.id === historyId) {
          next[mediaId] = aiByMedia[mediaId];
          continue;
        }
        const doc = await getGroupFactCheck(ws.id, historyId).catch(() => null);
        if (doc) next[mediaId] = doc;
      }
      setAiByMedia(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, JSON.stringify(aiHistoryIds)]);

  // 내 원인 유형 태그 구독
  useEffect(() => {
    if (!ws?.id || !medias.length) return undefined;
    const unsubs = medias.map((m) =>
      subscribeMyCauseTags(ws.id, user.uid, m.id, (doc) =>
        setTags((t) => ({ ...t, [m.id]: doc?.items ?? {} }))
      )
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, medias.length]);

  const media = medias[activeIdx] ?? null;
  const ai = media ? aiByMedia[media.id] : null;
  const mine = media ? myScores[media.id] ?? {} : {};
  const myTags = media ? tags[media.id] ?? {} : {};

  const rows = useMemo(() => {
    if (!ai || !items.length) return [];
    const byIndex = new Map(
      (ai.itemResults ?? []).map((r) => [Number(r.index), r])
    );
    return items.map((it, i) => {
      const r = byIndex.get(i) ?? {};
      const aiScore = r.score ?? null;
      const myScore = Number.isFinite(Number(mine[i])) ? Number(mine[i]) : null;
      const diff = aiScore === null || myScore === null ? null : myScore - aiScore;
      return {
        index: i,
        question: it.question,
        dimension: it.dimension,
        aiScore,
        aiReason: r.reason ?? "",
        redFlags: r.redFlags ?? [],
        myScore,
        diff,
        big: diff !== null && Math.abs(diff) >= BIG_DIFF_THRESHOLD,
      };
    });
  }, [ai, items, mine]);

  const requiredRows = rows.filter((r) => r.big);
  const missingTags = requiredRows.filter((r) => !myTags[String(r.index)]?.type);

  const handleTag = async (itemIndex, patch) => {
    const cur = myTags[String(itemIndex)] ?? {};
    const next = { ...cur, ...patch };
    setTags((t) => ({
      ...t,
      [media.id]: { ...(t[media.id] ?? {}), [String(itemIndex)]: next },
    }));
    await saveCauseTag(ws.id, {
      uid: user.uid,
      name,
      mediaId: media.id,
      itemIndex,
      type: next.type ?? null,
      note: next.note ?? "",
    });
  };

  if (loading) return <SkeletonList count={3} />;

  if (running && !ai) {
    return (
      <>
        <AiLimitNotice />
        <LoadingOverlay message="AI가 우리 체크리스트로 두 자료를 채점하고 있어요..." />
      </>
    );
  }

  if (!medias.length) {
    return <div className="card text-center text-sm text-slate-500">평가할 자료가 없어요.</div>;
  }

  return (
    <>
      <AiLimitNotice />

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <Button
            variant="ghost"
            className="ml-2"
            onClick={() => {
              ranRef.current = false;
              setError("");
            }}
          >
            다시 시도
          </Button>
        </div>
      )}

      <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-2">
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
              자료 {i + 1}/{medias.length} ·{" "}
              {m.kind === "teacher" ? "선생님 자료" : "우리 모둠 자료"}
              {!aiByMedia[m.id] && " ⏳"}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => navigate("/student/lesson/dashboard")}>
          비교 대시보드 →
        </Button>
      </div>

      {media && (
        <div className="card mb-4">
          <h2 className="text-base font-bold text-slate-900">{media.title}</h2>
          {media.subtitle && <p className="text-sm text-slate-500">{media.subtitle}</p>}
          <p className="mt-1 text-[11px] text-slate-400">
            {media.publisher && <>언론사(미검증): {media.publisher} · </>}
            {media.publishedAt && <>작성일(미검증): {media.publishedAt}</>}
          </p>
        </div>
      )}

      {!ai ? (
        <div className="card text-center text-sm text-slate-500">
          이 자료는 아직 AI 채점 중이에요. 모둠원 중 한 명이 실행하면 모두에게 함께 표시됩니다.
        </div>
      ) : (
        <>
          {missingTags.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              ⚠️ 차이가 {BIG_DIFF_THRESHOLD}점 이상인 항목 {missingTags.length}개에 아직 원인
              유형을 고르지 않았어요. (항목{" "}
              {missingTags.map((r) => r.index + 1).join("·")})
            </div>
          )}

          <div className="space-y-4">
            {rows.map((r) => (
              <RevealRow
                key={r.index}
                row={r}
                tag={myTags[String(r.index)] ?? {}}
                onTag={(patch) => handleTag(r.index, patch)}
              />
            ))}
          </div>

          <div className="mt-8 flex justify-end">
            <Button variant="primary" onClick={() => navigate("/student/lesson/dashboard")}>
              비교 대시보드로 →
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function RevealRow({ row, tag, onTag }) {
  const info = row.dimension ? DIMENSION_INFO[row.dimension] : null;
  const na = row.aiScore === null;
  const needTag = row.big;

  const badge = na
    ? { label: "AI 판단 불가", cls: "bg-slate-100 text-slate-600" }
    : row.big
    ? { label: `차이 큼 (${Math.abs(row.diff)}점)`, cls: "bg-rose-100 text-rose-700" }
    : row.diff === 0
    ? { label: "일치", cls: "bg-emerald-50 text-emerald-700" }
    : { label: `차이 ${Math.abs(row.diff)}점`, cls: "bg-amber-50 text-amber-800" };

  return (
    <div
      className={`card ${
        row.big ? "border-rose-200 ring-1 ring-rose-100" : na ? "border-slate-200" : ""
      }`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              항목 {row.index + 1}
            </span>
            {info && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                {info.code} {info.name}
              </span>
            )}
          </div>
          <h3 className="text-base font-bold leading-6 text-ink">{row.question}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ScorePill label="내 점수" value={row.myScore} tone="brand" />
        <ScorePill label="AI 점수" value={row.aiScore} tone={na ? "slate" : "purple"} na={na} />
      </div>

      <div className="mt-3 rounded-xl bg-surface-low px-4 py-3">
        <p className="text-[11px] font-bold text-ink-variant">
          {na ? "🤖 판단하지 못한 이유" : "🤖 AI 근거"}
        </p>
        <p className="mt-1 text-sm leading-6 text-ink-variant">{row.aiReason || "(근거 없음)"}</p>
        {na && (
          <p className="mt-2 text-[11px] text-ink-muted">
            ℹ 이 항목은 차이를 계산할 수 없어 통계에서 제외돼요. 대신 "왜 AI가 못 했는가"를
            기록해두면 토의에 쓸 수 있어요.
          </p>
        )}
        {row.redFlags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {row.redFlags.map((f, i) => (
              <span
                key={i}
                className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700"
              >
                ⚠️ {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {(row.diff !== null && row.diff !== 0) || na ? (
        <CausePicker tag={tag} onTag={onTag} required={needTag} />
      ) : null}
    </div>
  );
}

function ScorePill({ label, value, tone, na }) {
  const toneCls =
    tone === "brand"
      ? "text-brand-600"
      : tone === "purple"
      ? "text-purple-600"
      : "text-slate-400";
  return (
    <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{label}</p>
      {na ? (
        <p className="mt-1 text-xl font-black text-slate-400">N/A</p>
      ) : value === null ? (
        <p className="mt-1 text-xl font-black text-slate-300">–</p>
      ) : (
        <div className="mt-1 flex items-baseline gap-2">
          <span className={`font-display text-3xl font-black ${toneCls}`}>{value}</span>
          <span className="text-sm text-ink-muted">/5</span>
        </div>
      )}
    </div>
  );
}

/**
 * 원인 유형 선택 — 네 유형은 우열이 없으므로 같은 크기·같은 색으로 대등하게 배치한다.
 * 어떤 유형도 "정답"이 아니며 차이의 성격을 분류할 뿐이라는 문구를 함께 둔다.
 */
function CausePicker({ tag, onTag, required }) {
  const [note, setNote] = useState(tag.note ?? "");
  useEffect(() => {
    setNote(tag.note ?? "");
  }, [tag.note]);

  return (
    <div
      className={`mt-3 rounded-xl border px-4 py-3 ${
        required && !tag.type ? "border-amber-300 bg-amber-50/60" : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-xs font-bold text-ink">
        왜 차이가 났다고 보나요? {required ? "(필수)" : "(선택)"}
      </p>
      <p className="mt-0.5 text-[10px] leading-4 text-ink-muted">
        네 유형은 우열이 없어요. 무엇이 맞고 틀린지가 아니라 <strong>차이의 성격</strong>을
        분류하는 것입니다.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {CAUSE_TYPES.map((c, i) => {
          const on = tag.type === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onTag({ type: c.key })}
              className={`rounded-xl px-3 py-2.5 text-left text-xs ring-1 transition ${
                on
                  ? "bg-brand-600 text-white ring-brand-600"
                  : "bg-white text-ink-variant ring-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className="font-bold">
                {["①", "②", "③", "④"][i]} {c.label}
              </span>
              <span className={`mt-0.5 block text-[10px] ${on ? "text-white/80" : "text-ink-muted"}`}>
                {c.hint}
              </span>
            </button>
          );
        })}
      </div>
      <textarea
        className="input mt-2 min-h-[64px] resize-y text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => onTag({ note })}
        placeholder="어떤 점에서 다르게 봤는지 짧게 적어주세요."
      />
      {required && !tag.type && (
        <p className="mt-1 text-[11px] font-semibold text-amber-700">
          ⚠ 차이가 {BIG_DIFF_THRESHOLD}점 이상인 항목이라 원인 유형 선택이 필요해요.
        </p>
      )}
    </div>
  );
}
