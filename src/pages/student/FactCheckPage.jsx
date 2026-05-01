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

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [cls, m, hist] = await Promise.all([
        listChecklists(user.uid),
        getAlgorithmModel(user.uid),
        listFactCheckHistory(user.uid),
      ]);
      setChecklists(cls);
      setModel(m);
      setHistory(hist);
      const initial = m?.checklistId && cls.find((c) => c.id === m.checklistId)
        ? m.checklistId
        : cls[0]?.id ?? null;
      setActiveChecklistId(initial);
      setLoading(false);
    })();
  }, [user]);

  const onChange = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

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
      for (const d of DIMENSIONS) {
        dimensionScores[d] = Number(dimsResult[d]?.score ?? 3);
        dimensionReasons[d] = dimsResult[d]?.reason ?? "";
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
        weightsSnapshot: weights,
        totalScore,
        variance,
        confidenceInterval95: ci95,
        accepted: false,
        version: "IPFM-2.0",
        standard_basis: "IFCN_5_principles",
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
      title="미디어 팩트체크 (IPFM)"
      subtitle="Gemini가 IFCN 5대 차원으로 1~5점 평가 → 내 베이지안 가중치로 50점 환산"
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
              ※ Cold Start 단계 (학습 데이터 {model?.trainingDataCount ?? 0}개): 균등 가중치로 환산합니다. 모델링 페이지에서 학습을 진행하면 정교화됩니다.
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

      {running && <LoadingOverlay message="Gemini가 IFCN 5대 차원으로 미디어를 평가하고 있어요..." />}
    </Layout>
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
              CI {ci[0]?.toFixed?.(1)} ~ {ci[1]?.toFixed?.(1)}
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
