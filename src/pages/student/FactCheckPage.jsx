import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import {
  claimFactCheckRun,
  completeFactCheckRun,
  failFactCheckRun,
  getAlgorithmModel,
  getChecklist,
  listChecklists,
  listMediaItems,
  saveFactCheckHistory,
  subscribeFactCheckHistory,
  subscribeFactCheckRun,
} from "../../services/firestore.js";
import { evaluateMediaDimensions } from "../../services/gemini.js";
import { uploadFactCheckImage } from "../../services/storage.js";
import { cached } from "../../utils/dataCache.js";
import {
  DIMENSIONS,
  computeFinalScore,
  confidenceInterval95,
  initialWeights,
  isColdStart,
  scoreVariance,
} from "../../utils/hpfm.js";

// 같은 입력(미디어)에 대한 모둠 내 중복 Gemini 호출을 막기 위한 결정적 키.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function factcheckRunKey(form, imageUrl) {
  const norm = [form.title, form.content, form.link, imageUrl]
    .map((x) => (x ?? "").trim())
    .join("");
  return `fc_${hashStr(norm)}`;
}

export default function FactCheckPage() {
  const { user } = useAuth();
  const { activeWorkspace: ws, isGroup } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedChecklistId = searchParams.get("checklist");
  const [checklists, setChecklists] = useState([]);
  const [activeChecklistId, setActiveChecklistId] = useState(null);
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [waiting, setWaiting] = useState(null); // {by} — 다른 모둠원이 실행 중
  const [activeRunKey, setActiveRunKey] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", content: "", link: "" });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [teacherImageUrl, setTeacherImageUrl] = useState("");
  const [history, setHistory] = useState([]);
  const [teacherMedia, setTeacherMedia] = useState([]);

  // 체크리스트/모델/교사 미디어 로드 (교사 미디어는 세션 캐시)
  useEffect(() => {
    if (!ws) return;
    setLoading(true);
    (async () => {
      const [cls, m, tm] = await Promise.all([
        listChecklists(ws),
        getAlgorithmModel(ws),
        cached("mediaItems", () => listMediaItems()),
      ]);
      setChecklists(cls);
      setModel(m);
      setTeacherMedia(tm);
      const fromUrl =
        requestedChecklistId && cls.find((c) => c.id === requestedChecklistId)
          ? requestedChecklistId
          : null;
      const initial =
        fromUrl ??
        (m?.checklistId && cls.find((c) => c.id === m.checklistId)
          ? m.checklistId
          : cls[0]?.id ?? null);
      setActiveChecklistId(initial);
      if (fromUrl) {
        // 한 번 반영했으면 URL은 정리 — 사이드바·체크리스트 변경에 다시 끌려가지 않도록.
        const next = new URLSearchParams(searchParams);
        next.delete("checklist");
        setSearchParams(next, { replace: true });
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.type, ws?.id]);

  // 팩트체크 기록 실시간(limit 30) — 모둠원 실행 결과를 서로 즉시 확인
  useEffect(() => {
    if (!ws) return undefined;
    const unsub = subscribeFactCheckHistory(
      ws,
      (h) => setHistory(h),
      { limit: 30, onError: (e) => console.error(e) }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.type, ws?.id]);

  // 다른 모둠원이 실행 중일 때 완료를 구독해 같은 결과로 이동
  useEffect(() => {
    if (!isGroup || !activeRunKey || !ws) return undefined;
    const unsub = subscribeFactCheckRun(ws, activeRunKey, (run) => {
      if (!run) {
        setWaiting(null);
        setActiveRunKey(null);
        setError("앞선 실행이 중단됐어요. 다시 시도해주세요.");
        return;
      }
      if (run.status === "done" && run.historyId) {
        setActiveRunKey(null);
        setWaiting(null);
        navigate(`/student/result/${run.historyId}`);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, activeRunKey, ws?.type, ws?.id]);

  const onChange = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onImageFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError(
        `이미지가 ${(file.size / 1024 / 1024).toFixed(1)}MB로 너무 커요. 10MB 이하로 압축한 뒤 다시 선택해주세요.`
      );
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError(`이미지 파일만 첨부할 수 있어요 (현재 형식: ${file.type || "알 수 없음"}).`);
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setTeacherImageUrl("");
    setError("");
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview("");
    setTeacherImageUrl("");
  };

  const fillFromTeacher = (m) => {
    setForm({
      title: m.title ?? "",
      content: m.content ?? "",
      link: m.link ?? "",
    });
    if (!imageFile) {
      setTeacherImageUrl(m.thumbnailUrl ?? "");
      setImagePreview(m.thumbnailUrl ?? "");
    }
    setError("");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Gemini 평가 → 점수 환산 → factcheck_history 저장. historyId 반환.
  const executeFactCheck = async ({ checklist, imageUrl }) => {
    const dimsResult = await evaluateMediaDimensions({ ...form, imageUrl });
    const dimensionScores = {};
    const dimensionReasons = {};
    const dimensionRedFlags = {};
    const dimensionSkipped = {};
    const fallbacks = [];
    for (const d of DIMENSIONS) {
      const entry = dimsResult[d] ?? {};
      if (entry.skipped === true || entry.score === null) {
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

    return saveFactCheckHistory(ws, {
      media: { ...form, imageUrl: imageUrl || "" },
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
      createdByUid: user.uid,
      createdByName: user.displayName ?? null,
      version: "VAPM-3.0",
      standard_basis: "5_verification_actions",
    });
  };

  const handleRun = async () => {
    setError("");
    if (!activeChecklistId) return setError("체크리스트를 먼저 선택해주세요.");
    if (!form.title.trim() || !form.content.trim()) {
      return setError("미디어 제목과 본문을 입력해주세요.");
    }
    setRunning(true);
    try {
      const checklist = await getChecklist(ws, activeChecklistId);
      if (!checklist) throw new Error("체크리스트를 찾을 수 없습니다.");

      let imageUrl = teacherImageUrl;
      if (imageFile) imageUrl = await uploadFactCheckImage(imageFile, user.uid);

      if (isGroup) {
        // single-flight: 같은 미디어는 모둠 전체에서 1회만 Gemini 호출
        const runKey = factcheckRunKey(form, imageUrl);
        const decision = await claimFactCheckRun(ws, runKey, {
          uid: user.uid,
          name: user.displayName ?? null,
        });
        if (decision.role === "reuse") {
          navigate(`/student/result/${decision.historyId}`);
          return;
        }
        if (decision.role === "wait") {
          // 다른 모둠원이 실행 중 — 완료되면 구독 effect가 이동시킴
          setWaiting({ by: decision.claimedByName });
          setActiveRunKey(runKey);
          setRunning(false);
          return;
        }
        // role === "run": 내가 실행자
        try {
          const historyId = await executeFactCheck({ checklist, imageUrl });
          await completeFactCheckRun(ws, runKey, historyId);
          navigate(`/student/result/${historyId}`);
        } catch (e) {
          await failFactCheckRun(ws, runKey); // claim 해제 → 재시도 가능
          throw e;
        }
        return;
      }

      // 개인 작업실: 직접 실행
      const historyId = await executeFactCheck({ checklist, imageUrl });
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
  const busy = running || !!waiting;

  return (
    <Layout
      title="미디어 팩트체크"
      subtitle={
        isGroup
          ? `모둠 작업실 · ${ws?.name ?? "우리 모둠"} — 같은 미디어는 모둠에서 한 번만 AI 호출해요`
          : "AI가 5대 검증 행동(출처·저자·콘텐츠·이미지·감정)으로 미디어를 1~5점으로 평가하고, 내 가중치를 적용해 50점 만점으로 보여줘요"
      }
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
              ※ 아직 평가가 적게 쌓여 있어요(현재 {model?.trainingDataCount ?? 0}개). 지금은 5대 검증 행동을 똑같이 보고 점수를 계산해요. "기준 다듬기"를 더 진행하면 {isGroup ? "모둠" : "너"}만의 기준이 반영됩니다.
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

        <div>
          <label className="label">첨부 이미지 (선택)</label>
          <p className="mb-2 text-[11px] text-slate-500">
            기사·게시물에 포함된 사진·스크린샷·그래프를 첨부하면 AI가 V4(이미지·영상 확인)에서
            실제 이미지를 분석해 점수를 매겨요. 첨부하지 않으면 V4는 본문 언급 여부로 판단합니다.
          </p>
          <input type="file" accept="image/*" onChange={onImageFile} />
          {imagePreview && (
            <div className="mt-3 flex flex-col items-start gap-3">
              <img
                src={imagePreview}
                alt="첨부 이미지 미리보기"
                className="rounded-xl object-contain ring-1 ring-slate-200"
                style={{ maxWidth: "100%", maxHeight: "360px" }}
              />
              <div className="flex items-center gap-3">
                {imageFile ? (
                  <p className="text-xs text-slate-500">
                    {imageFile.name} · {(imageFile.size / 1024 / 1024).toFixed(2)}MB
                  </p>
                ) : teacherImageUrl ? (
                  <p className="text-xs text-slate-500">선생님 자료의 이미지를 가져왔어요</p>
                ) : null}
                <Button type="button" variant="ghost" onClick={handleRemoveImage}>
                  이미지 제거
                </Button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <div className="flex justify-end">
          <Button variant="primary" onClick={handleRun} loading={busy} disabled={busy}>팩트체크 실행</Button>
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
            <h2 className="text-lg font-bold text-slate-900">
              {isGroup ? "우리 모둠 팩트체크" : "내가 등록한 미디어"}
            </h2>
            <p className="text-xs text-slate-500">
              {isGroup
                ? "모둠원이 실행한 팩트체크가 모두 모여요. 카드를 클릭하면 결과 화면으로 이동합니다."
                : "지금까지 팩트체크한 자료들이에요. 카드를 클릭하면 결과 화면으로 이동합니다."}
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
                showAuthor={isGroup}
                onClick={() => navigate(`/student/result/${h.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      {running && <LoadingOverlay message="AI 친구가 5대 검증 행동으로 미디어를 살펴보고 있어요..." />}
      {waiting && (
        <LoadingOverlay
          message={`${waiting.by ?? "모둠원"}이(가) 같은 미디어를 팩트체크하고 있어요. 결과를 함께 받는 중...`}
        />
      )}
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
          className="w-full bg-slate-50 object-contain"
          style={{ maxHeight: "1080px" }}
        />
      ) : (
        <div className="grid h-56 w-full place-items-center bg-slate-100 text-xs text-slate-400">
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

function HistoryCard({ item, onClick, showAuthor }) {
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

      {showAuthor && item.createdByName && (
        <p className="text-[11px] text-slate-400">실행: {item.createdByName}</p>
      )}

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
