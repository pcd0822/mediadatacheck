import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import {
  getAlgorithmModel,
  getChecklist,
  listChecklists,
  listFactCheckHistory,
  listMediaItems,
  saveFactCheckHistory,
} from "../../services/firestore.js";
import { evaluateMediaDimensions } from "../../services/gemini.js";
import {
  DIMENSIONS,
  computeFinalScore,
  confidenceInterval95,
  initialWeights,
  isColdStart,
  scoreVariance,
} from "../../utils/hpfm.js";

export default function FactCheckPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [checklists, setChecklists] = useState([]);
  const [activeChecklistId, setActiveChecklistId] = useState(null);
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", content: "", link: "" });
  const [history, setHistory] = useState([]);
  const [teacherMedia, setTeacherMedia] = useState([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [cls, m, hist, tm] = await Promise.all([
        listChecklists(user.uid),
        getAlgorithmModel(user.uid),
        listFactCheckHistory(user.uid),
        listMediaItems(),
      ]);
      setChecklists(cls);
      setModel(m);
      setHistory(hist);
      setTeacherMedia(tm);
      const initial = m?.checklistId && cls.find((c) => c.id === m.checklistId)
        ? m.checklistId
        : cls[0]?.id ?? null;
      setActiveChecklistId(initial);
      setLoading(false);
    })();
  }, [user]);

  const onChange = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const fillFromTeacher = (m) => {
    setForm({
      title: m.title ?? "",
      content: m.content ?? "",
      link: m.link ?? "",
    });
    setError("");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleRun = async () => {
    setError("");
    if (!activeChecklistId) return setError("체크리스트를 먼저 선택해주세요.");
    if (!form.title.trim() || !form.content.trim()) {
      return setError("미디어 제목과 본문을 입력해주세요.");
    }
    setRunning(true);
    try {
      const checklist = await getChecklist(user.uid, activeChecklistId);
      if (!checklist) throw new Error("체크리스트를 찾을 수 없습니다.");

      const dimsResult = await evaluateMediaDimensions(form);
      const dimensionScores = {};
      const dimensionReasons = {};
      const dimensionRedFlags = {};
      const dimensionSkipped = {};
      const fallbacks = [];
      for (const d of DIMENSIONS) {
        const entry = dimsResult[d] ?? {};
        if (entry.skipped === true || entry.score === null) {
          // V4 N/A: 점수 없이 보존, 최종 점수 산출에서 자동 제외됨
          dimensionScores[d] = null;
          dimensionSkipped[d] = true;
        } else {
          const raw = Number(entry.score);
          if (Number.isFinite(raw)) {
            dimensionScores[d] = Math.max(1, Math.min(5, Math.round(raw)));
          } else {
            dimensionScores[d] = 3;
            fallbacks.push(d);
          }
        }
        dimensionReasons[d] = entry.reason ?? "";
        if (Array.isArray(entry.redFlags) && entry.redFlags.length) {
          dimensionRedFlags[d] = entry.redFlags;
        }
      }
      // 모든 행동이 fallback 또는 skipped라면 응답이 사실상 비어있는 상태 — 저장하지 않고 종료
      const usableCount = DIMENSIONS.filter(
        (d) => Number.isFinite(dimensionScores[d]) && !fallbacks.includes(d)
      ).length;
      if (usableCount === 0) {
        throw new Error(
          "AI 평가 결과를 읽지 못했어요. 본문이 너무 짧거나 일시적인 오류일 수 있어요. 본문을 좀 더 길게 입력하거나 잠시 후 다시 시도해주세요."
        );
      }

      const weights = model?.weights ?? initialWeights();
      const totalScore = computeFinalScore(weights, dimensionScores);
      const variance = scoreVariance(weights, dimensionScores);
      const ci95 = confidenceInterval95(totalScore, variance);

      const historyId = await saveFactCheckHistory(user.uid, {
        media: { ...form },
        checklistId: activeChecklistId,
        checklistSnapshot: checklist.items,
        dimensionScores,
        dimensionReasons,
        dimensionRedFlags,
        dimensionSkipped,
        weightsSnapshot: weights,
        totalScore,
        variance,
        confidenceInterval95: ci95,
        accepted: false,
        version: "VAPM-3.0",
        standard_basis: "5_verification_actions",
      });

      navigate(`/student/result/${historyId}`);
    } catch (e) {
      console.error(e);
      setError(e.message || "팩트체크 실행 중 오류가 발생했습니다.");
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <LoadingOverlay message="준비 중..." />;

  if (!checklists.length) {
    return (
      <Layout title="미디어 팩트체크">
        <div className="card text-center">
          <p className="text-slate-600">먼저 체크리스트를 만들어야 합니다.</p>
          <Button variant="primary" className="mt-3" onClick={() => navigate("/student/checklist")}>
            체크리스트 만들러 가기
          </Button>
        </div>
      </Layout>
    );
  }

  const cold = isColdStart(model?.trainingDataCount ?? 0);

  return (
    <Layout
      title="미디어 팩트체크"
      subtitle="AI가 5대 검증 행동(출처·저자·콘텐츠·이미지·감정)으로 미디어를 1~5점으로 평가하고, 내 가중치를 적용해 50점 만점으로 보여줘요"
      actions={<Button variant="secondary" onClick={() => navigate("/student")}>← 대시보드</Button>}
    >
      <div className="card grid gap-5">
        <div>
          <label className="label">사용 체크리스트</label>
          <select
            className="input"
            value={activeChecklistId ?? ""}
            onChange={(e) => setActiveChecklistId(e.target.value)}
          >
            {checklists.map((c) => (
              <option key={c.id} value={c.id}>{c.checklistName}</option>
            ))}
          </select>
          {cold && (
            <p className="mt-2 text-xs text-amber-700">
              ※ 아직 평가가 적게 쌓여 있어요(현재 {model?.trainingDataCount ?? 0}개). 지금은 5대 검증 행동을 똑같이 보고 점수를 계산해요. "기준 다듬기"를 더 진행하면 너만의 기준이 반영됩니다.
            </p>
          )}
        </div>

        <div>
          <label className="label">미디어 제목 *</label>
          <input className="input" value={form.title} onChange={onChange("title")} placeholder="예) 새로운 다이어트 식품 효과 보도" />
        </div>
        <div>
          <label className="label">본문 내용 *</label>
          <textarea
            className="input min-h-[200px] resize-y"
            value={form.content}
            onChange={onChange("content")}
            placeholder="기사 본문 또는 영상 스크립트를 붙여넣어주세요."
          />
        </div>
        <div>
          <label className="label">원본 링크</label>
          <input type="url" className="input" value={form.link} onChange={onChange("link")} placeholder="https://..." />
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <div className="flex justify-end">
          <Button variant="primary" onClick={handleRun} loading={running}>팩트체크 실행</Button>
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">선생님이 올린 미디어</h2>
            <p className="text-xs text-slate-500">
              카드를 클릭하면 위 폼에 자동으로 채워져요. 그대로 팩트체크를 실행해보세요.
            </p>
          </div>
          {teacherMedia.length > 0 && (
            <span className="badge bg-brand-50 text-brand-700">
              총 {teacherMedia.length}건
            </span>
          )}
        </div>

        {teacherMedia.length === 0 ? (
          <div className="card text-center text-sm text-slate-500">
            아직 선생님이 올린 미디어가 없어요.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {teacherMedia.map((m) => (
              <TeacherMediaCard
                key={m.id}
                item={m}
                onClick={() => fillFromTeacher(m)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">내가 등록한 미디어</h2>
            <p className="text-xs text-slate-500">
              지금까지 팩트체크한 자료들이에요. 카드를 클릭하면 결과 화면으로 이동합니다.
            </p>
          </div>
          {history.length > 0 && (
            <span className="badge bg-slate-100 text-slate-600">총 {history.length}건</span>
          )}
        </div>

        {history.length === 0 ? (
          <div className="card text-center text-sm text-slate-500">
            아직 등록한 미디어가 없습니다. 위 양식에서 첫 팩트체크를 시작해보세요.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {history.map((h) => (
              <HistoryCard
                key={h.id}
                item={h}
                onClick={() => navigate(`/student/result/${h.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      {running && <LoadingOverlay message="AI 친구가 5대 검증 행동으로 미디어를 살펴보고 있어요..." />}
    </Layout>
  );
}

function TeacherMediaCard({ item, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group card flex h-full flex-col gap-3 overflow-hidden p-0 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      {item.thumbnailUrl ? (
        <img
          src={item.thumbnailUrl}
          alt=""
          className="h-36 w-full object-cover"
        />
      ) : (
        <div className="grid h-36 w-full place-items-center bg-slate-100 text-xs text-slate-400">
          썸네일 없음
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4 pt-2">
        <h3 className="line-clamp-2 text-sm font-bold text-slate-900 group-hover:text-brand-700">
          {item.title || "(제목 없음)"}
        </h3>
        <p className="line-clamp-3 text-xs leading-5 text-slate-600">
          {item.content || ""}
        </p>
        <div className="mt-auto flex items-center justify-between text-[11px] text-slate-400">
          <span>선생님 자료</span>
          <span className="font-semibold text-brand-600 group-hover:underline">
            폼에 가져오기 →
          </span>
        </div>
      </div>
    </button>
  );
}

function HistoryCard({ item, onClick }) {
  const score = Number(item.finalTotalScore ?? item.totalScore ?? 0);
  const ci = item.confidenceInterval95;
  const created = item.createdAt?.toDate?.() ?? null;
  const status = item.refined
    ? { label: "정교화됨", cls: "bg-amber-50 text-amber-700" }
    : item.accepted
    ? { label: "수용됨", cls: "bg-emerald-50 text-emerald-700" }
    : { label: "미반영", cls: "bg-slate-100 text-slate-600" };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group card flex h-full flex-col gap-3 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-bold text-slate-900 group-hover:text-brand-700">
          {item.media?.title || "(제목 없음)"}
        </h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>
          {status.label}
        </span>
      </div>

      <p className="line-clamp-3 text-xs leading-5 text-slate-600">
        {item.media?.content || ""}
      </p>

      <div className="mt-auto flex items-end justify-between gap-2 border-t border-slate-100 pt-3">
        <div>
          <p className="text-[10px] text-slate-400">최종 점수</p>
          <p className="text-2xl font-extrabold text-brand-700">
            {score.toFixed(1)}<span className="text-xs text-slate-400">/50</span>
          </p>
          {Array.isArray(ci) && ci.length === 2 && (
            <p className="text-[10px] text-slate-400">
              오차범위 {ci[0]?.toFixed?.(1)} ~ {ci[1]?.toFixed?.(1)}
            </p>
          )}
        </div>
        <div className="text-right">
          {created && (
            <p className="text-[10px] text-slate-400">
              {created.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
            </p>
          )}
          {item.media?.link && (
            <span className="text-[10px] text-brand-600">원본 링크 ✓</span>
          )}
        </div>
      </div>
    </button>
  );
}
