import { useEffect, useMemo, useState } from "react";
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
  getChecklist,
  listChecklists,
  listGroupMediaItems,
  listTeacherMediaItems,
  mediaImageUrl,
  saveFactCheckHistory,
  subscribeFactCheckHistory,
  subscribeFactCheckRun,
} from "../../services/firestore.js";
import { evaluateMediaByChecklist } from "../../services/gemini.js";
import { uploadFactCheckImage } from "../../services/storage.js";
import { cached } from "../../utils/dataCache.js";
import { MODEL_VERSION, STANDARD_BASIS } from "../../constants/model.js";
import {
  aggregateItemsToDimensions,
  computeChecklistScore,
  normalizeItemResults,
} from "../../utils/hpfm.js";

// 같은 입력(미디어 + 체크리스트 내용)에 대한 모둠 내 중복 Gemini 호출을 막기 위한 결정적 키.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function lastChecklistStorageKey(uid, ws) {
  return `mdc:fc:lastChecklist:${uid}:${ws.type}:${ws.id}`;
}

/**
 * 채점 결과는 "미디어 × 체크리스트 항목 내용"으로 결정되므로 runKey에 질문 텍스트까지 넣는다.
 * (체크리스트 id만 쓰면 항목을 수정한 뒤에도 옛 결과가 재사용된다)
 */
function factcheckRunKey(form, imageUrl, checklistId, items) {
  const questions = (items ?? []).map((it) => (it?.question ?? "").trim()).join("¶");
  const norm = [
    form.title,
    form.subtitle,
    form.content,
    form.publisher,
    form.publishedAt,
    form.link,
    imageUrl,
    checklistId,
    questions,
  ]
    .map((x) => (x ?? "").trim())
    .join("");
  return `fc_${hashStr(norm)}`;
}

const EMPTY_FORM = {
  title: "",
  subtitle: "",
  content: "",
  publisher: "",
  publishedAt: "",
  link: "",
};

export default function FactCheckPage() {
  const { user } = useAuth();
  const { activeWorkspace: ws, isGroup } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedChecklistId = searchParams.get("checklist");
  const [checklists, setChecklists] = useState([]);
  const [activeChecklistId, setActiveChecklistId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [waiting, setWaiting] = useState(null); // {by} — 다른 모둠원이 실행 중
  const [activeRunKey, setActiveRunKey] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [pickedImageUrl, setPickedImageUrl] = useState("");
  const [imageSource, setImageSource] = useState(null); // "library" | "history" | null
  const [sourceMediaId, setSourceMediaId] = useState(null);
  const [history, setHistory] = useState([]);
  const [teacherMedia, setTeacherMedia] = useState([]);
  const [groupMedia, setGroupMedia] = useState([]);
  const [showLoadModal, setShowLoadModal] = useState(false);

  const activeChecklist = useMemo(
    () => checklists.find((c) => c.id === activeChecklistId) ?? null,
    [checklists, activeChecklistId]
  );

  // 체크리스트 + 사용 가능한 미디어 자료 로드 (자료 목록은 세션 캐시)
  useEffect(() => {
    if (!ws) return;
    setLoading(true);
    (async () => {
      const [cls, tm, gm] = await Promise.all([
        listChecklists(ws),
        cached("media:teacher", () => listTeacherMediaItems()),
        // 모둠 자료는 그 모둠만 읽을 수 있으므로 모둠 작업실일 때만 조회한다.
        isGroup
          ? cached(`media:group:${ws.id}`, () => listGroupMediaItems(ws.id))
          : Promise.resolve([]),
      ]);
      setChecklists(cls);
      setTeacherMedia(tm);
      setGroupMedia(gm);
      const fromUrl =
        requestedChecklistId && cls.find((c) => c.id === requestedChecklistId)
          ? requestedChecklistId
          : null;
      // 학번(uid) × 작업실 단위로 마지막 선택을 격리해 저장한다.
      let storedId = null;
      try {
        const raw = localStorage.getItem(lastChecklistStorageKey(user.uid, ws));
        if (raw && cls.find((c) => c.id === raw)) storedId = raw;
      } catch {
        // localStorage 접근 불가(프라이빗 모드 등) — 무시.
      }
      setActiveChecklistId(fromUrl ?? storedId ?? cls[0]?.id ?? null);
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

  // 드롭다운에서 바꾼 선택을 다음 진입 때도 유지하도록 localStorage에 기록.
  useEffect(() => {
    if (!activeChecklistId || !ws || !user?.uid) return;
    try {
      localStorage.setItem(lastChecklistStorageKey(user.uid, ws), activeChecklistId);
    } catch {
      // 무시
    }
  }, [activeChecklistId, ws?.type, ws?.id, user?.uid]);

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
    setPickedImageUrl("");
    setImageSource(null);
    setError("");
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview("");
    setPickedImageUrl("");
    setImageSource(null);
  };

  const handleResetForm = () => {
    setForm(EMPTY_FORM);
    setImageFile(null);
    setImagePreview("");
    setPickedImageUrl("");
    setImageSource(null);
    setSourceMediaId(null);
    setError("");
  };

  const hasFormData = !!(
    form.title ||
    form.content ||
    form.link ||
    form.publisher ||
    form.subtitle ||
    imagePreview ||
    imageFile
  );

  // 현재 활성 체크리스트로 검증된 카드만 노출 — 체크리스트 버전별로 결과 카드를 분리한다.
  const visibleHistory = useMemo(
    () => history.filter((h) => h.checklistId === activeChecklistId),
    [history, activeChecklistId]
  );

  // 모달 후보: 활성 체크리스트가 아닌 다른 체크리스트로 검증된 미디어(중복 제거).
  const loadableHistory = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const h of history) {
      if (h.checklistId === activeChecklistId) continue;
      const m = h.media ?? {};
      const key = [m.title, m.content, m.link, m.imageUrl]
        .map((x) => (x ?? "").trim())
        .join("|");
      if (!key.replaceAll("|", "")) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
    }
    return out;
  }, [history, activeChecklistId]);

  const loadFromHistory = (item) => {
    const m = item.media ?? {};
    setForm({
      title: m.title ?? "",
      subtitle: m.subtitle ?? "",
      content: m.content ?? "",
      publisher: m.publisher ?? "",
      publishedAt: m.publishedAt ?? "",
      link: m.link ?? "",
    });
    setImageFile(null);
    setImagePreview(m.imageUrl ?? "");
    setPickedImageUrl(m.imageUrl ?? "");
    setImageSource(m.imageUrl ? "history" : null);
    setSourceMediaId(m.mediaItemId ?? null);
    setError("");
    setShowLoadModal(false);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const fillFromLibrary = (m) => {
    const img = mediaImageUrl(m);
    setForm({
      title: m.title ?? "",
      subtitle: m.subtitle ?? "",
      content: m.content ?? "",
      publisher: m.publisher ?? "",
      publishedAt: m.publishedAt ?? "",
      link: m.link ?? "",
    });
    setSourceMediaId(m.id ?? null);
    if (!imageFile) {
      setPickedImageUrl(img);
      setImagePreview(img);
      setImageSource(img ? "library" : null);
    }
    setError("");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  /**
   * Gemini 항목별 채점 → 원점수·백분율 환산 → factcheck_history 저장. historyId 반환.
   * 교사 채점·보정은 어디에도 개입하지 않는다. 근거는 체크리스트 하나뿐이다.
   */
  const executeFactCheck = async ({ checklist, imageUrl }) => {
    const items = checklist.items ?? [];
    const aiResults = await evaluateMediaByChecklist({ ...form, imageUrl }, items);
    const itemResults = normalizeItemResults(items, aiResults);
    const score = computeChecklistScore(itemResults);

    if (score.scoredCount === 0) {
      throw new Error(
        "AI가 모든 항목을 판단하지 못했어요. 본문이 너무 짧거나 일시적인 오류일 수 있어요. 본문을 좀 더 길게 입력하거나 잠시 후 다시 시도해주세요."
      );
    }

    return saveFactCheckHistory(ws, {
      media: {
        ...form,
        imageUrl: imageUrl || "",
        mediaItemId: sourceMediaId ?? null,
      },
      checklistId: activeChecklistId,
      checklistName: checklist.checklistName ?? null,
      checklistSnapshot: items,
      itemResults,
      rawScore: score.rawScore,
      maxScore: score.maxScore,
      percent: score.percent,
      band: score.band,
      itemAlert: score.itemAlert,
      alertIndexes: score.alertIndexes,
      naCount: score.naCount,
      scoredCount: score.scoredCount,
      // 5대 검증 행동 평균 — 점수 계산과 무관한 분석·비교용 표시값.
      dimensionAverages: aggregateItemsToDimensions(itemResults),
      createdByUid: user.uid,
      createdByName: user.displayName ?? null,
      version: MODEL_VERSION,
      standard_basis: STANDARD_BASIS,
    });
  };

  const handleRun = async () => {
    setError("");
    if (!activeChecklistId) return setError("체크리스트를 먼저 선택해주세요.");
    if (!form.title.trim() || !form.content.trim()) {
      return setError("미디어 표제와 본문을 입력해주세요.");
    }
    setRunning(true);
    try {
      const checklist = await getChecklist(ws, activeChecklistId);
      if (!checklist) throw new Error("체크리스트를 찾을 수 없습니다.");
      if (!checklist.items?.length) {
        throw new Error("체크리스트에 항목이 없어요. 먼저 평가 질문을 만들어주세요.");
      }

      let imageUrl = pickedImageUrl;
      if (imageFile) imageUrl = await uploadFactCheckImage(imageFile, user.uid);

      if (isGroup) {
        // single-flight: 같은 미디어+체크리스트는 모둠 전체에서 1회만 Gemini 호출
        const runKey = factcheckRunKey(
          form,
          imageUrl,
          activeChecklistId,
          checklist.items
        );
        const decision = await claimFactCheckRun(ws, runKey, {
          uid: user.uid,
          name: user.displayName ?? null,
        });
        if (decision.role === "reuse") {
          navigate(`/student/result/${decision.historyId}`);
          return;
        }
        if (decision.role === "wait") {
          setWaiting({ by: decision.claimedByName });
          setActiveRunKey(runKey);
          setRunning(false);
          return;
        }
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

  const busy = running || !!waiting;
  const itemCount = activeChecklist?.items?.length ?? 0;

  return (
    <Layout
      title="미디어 팩트체크"
      subtitle={
        isGroup
          ? `모둠 작업실 · ${ws?.name ?? "우리 모둠"} — 같은 자료는 모둠에서 한 번만 AI를 호출해요`
          : "AI가 내 체크리스트 항목을 하나씩 적용해 1~5점을 매기고, 항목 점수를 합산해 보여줘요"
      }
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/student")}>← 대시보드</Button>
          {isGroup && (
            <Button variant="secondary" onClick={() => navigate("/student/group-media")}>
              모둠 자료 등록
            </Button>
          )}
        </>
      }
    >
      <div className="card grid gap-5">
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="label mb-0" htmlFor="fc-checklist">채점 기준 체크리스트</label>
            <div className="flex items-center gap-1">
              {hasFormData && (
                <Button
                  variant="ghost"
                  onClick={handleResetForm}
                  title="현재 폼에 입력·불러온 미디어 정보를 모두 비웁니다"
                >
                  불러온 자료 초기화
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => setShowLoadModal(true)}
                disabled={loadableHistory.length === 0}
                title={
                  loadableHistory.length === 0
                    ? "다른 체크리스트로 검증된 미디어가 아직 없어요"
                    : "다른 체크리스트로 검증했던 미디어를 가져와 이 체크리스트로 다시 평가해요"
                }
              >
                + 기존 자료 불러오기
              </Button>
            </div>
          </div>
          <select
            id="fc-checklist"
            className="input"
            value={activeChecklistId ?? ""}
            onChange={(e) => setActiveChecklistId(e.target.value)}
          >
            {checklists.map((c) => (
              <option key={c.id} value={c.id}>
                {c.checklistName} (항목 {c.items?.length ?? 0}개)
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500">
            AI가 이 체크리스트의 <strong>{itemCount}개 항목</strong>을 하나씩 적용해 채점해요.
            만점은 <strong>{itemCount * 5}점</strong>(항목당 5점)이 되고, 판단 단서가 없는 항목은
            점수 대신 N/A로 표시되며 만점에서도 빠져요.
          </p>
          <p className="mt-1 text-xs text-amber-700">
            ※ 모둠마다 문항 수가 달라 <strong>원점수만으로는 모둠 간 비교가 되지 않아요.</strong>{" "}
            모둠끼리 견줄 때는 백분율(%)을 보세요.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">표제 *</label>
            <input
              className="input"
              value={form.title}
              onChange={onChange("title")}
              placeholder="예) 새로운 다이어트 식품 효과 보도"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">부제</label>
            <input
              className="input"
              value={form.subtitle}
              onChange={onChange("subtitle")}
              placeholder="예) 제목 아래 작은 제목"
            />
          </div>
          <div>
            <label className="label">언론사</label>
            <input
              className="input"
              value={form.publisher}
              onChange={onChange("publisher")}
              placeholder="예) ○○일보"
            />
          </div>
          <div>
            <label className="label">작성일</label>
            <input
              type="date"
              className="input"
              value={form.publishedAt}
              onChange={onChange("publishedAt")}
            />
          </div>
        </div>

        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          ⚠️ AI는 여기 입력한 <strong>언론사·작성일·링크를 검증 없이 사실로 전제하고</strong> 채점해요.
          그 매체가 실제로 있는지, 날짜가 맞는지는 확인하지 못합니다. 일부러 없는 언론사 이름을
          넣어보고 결과가 어떻게 달라지는지 살펴보는 것도 좋은 실험이에요.
        </p>

        <div>
          <label className="label">본문 *</label>
          <textarea
            className="input min-h-[200px] resize-y"
            value={form.content}
            onChange={onChange("content")}
            placeholder="기사 본문 또는 영상 스크립트를 붙여넣어주세요."
          />
        </div>
        <div>
          <label className="label">원본 링크</label>
          <input
            type="url"
            className="input"
            value={form.link}
            onChange={onChange("link")}
            placeholder="https://..."
          />
        </div>

        <div>
          <label className="label">이미지 (선택)</label>
          <p className="mb-2 text-[11px] text-slate-500">
            자료에 포함된 사진·스크린샷·그래프를 첨부하면, 시각 자료를 묻는 체크리스트 항목을
            AI가 이미지를 직접 보고 채점해요. 첨부하지 않으면 그런 항목은 N/A로 빠질 수 있어요.
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
                ) : imageSource === "library" ? (
                  <p className="text-xs text-slate-500">등록된 자료의 이미지를 가져왔어요</p>
                ) : imageSource === "history" ? (
                  <p className="text-xs text-slate-500">기존 자료에서 가져온 이미지예요</p>
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
          <Button variant="primary" onClick={handleRun} loading={busy} disabled={busy}>
            팩트체크 실행
          </Button>
        </div>
      </div>

      <MediaLibrarySection
        title="선생님이 올린 공통 자료"
        hint="학급 전체가 함께 평가하는 필수 자료예요. 카드를 클릭하면 위 폼에 자동으로 채워져요."
        items={teacherMedia}
        emptyText="아직 선생님이 올린 자료가 없어요."
        badgeText="공통 필수"
        badgeClass="bg-emerald-50 text-emerald-700"
        onPick={fillFromLibrary}
      />

      {isGroup && (
        <MediaLibrarySection
          title="우리 모둠이 등록한 자료"
          hint="조장이 등록한 자료예요. 우리 모둠만 볼 수 있어요."
          items={groupMedia}
          emptyText="아직 우리 모둠이 등록한 자료가 없어요. 조장이 '모둠 자료 등록'에서 추가할 수 있어요."
          badgeText="모둠 자료"
          badgeClass="bg-brand-50 text-brand-700"
          onPick={fillFromLibrary}
        />
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {isGroup ? "우리 모둠 팩트체크 결과" : "내 팩트체크 결과"}
            </h2>
            <p className="text-xs text-slate-500">
              지금 선택한 체크리스트로 검증한 결과만 보여줘요. 체크리스트를 바꾸면 그 버전의 결과가 표시돼요.
            </p>
          </div>
          {visibleHistory.length > 0 && (
            <span className="badge bg-slate-100 text-slate-600">총 {visibleHistory.length}건</span>
          )}
        </div>

        {visibleHistory.length === 0 ? (
          <div className="card text-center text-sm text-slate-500">
            {history.length === 0
              ? "아직 검증한 자료가 없습니다. 위 양식에서 첫 팩트체크를 시작해보세요."
              : "이 체크리스트로 검증한 자료가 아직 없어요. 다른 체크리스트로 검증했던 자료를 가져오려면 위 '+ 기존 자료 불러오기'를 눌러보세요."}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleHistory.map((h) => (
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

      {running && (
        <LoadingOverlay message="AI 친구가 우리 체크리스트로 자료를 한 항목씩 살펴보고 있어요..." />
      )}
      {waiting && (
        <LoadingOverlay
          message={`${waiting.by ?? "모둠원"}이(가) 같은 자료를 팩트체크하고 있어요. 결과를 함께 받는 중...`}
        />
      )}

      {showLoadModal && (
        <LoadHistoryModal
          items={loadableHistory}
          onPick={loadFromHistory}
          onClose={() => setShowLoadModal(false)}
        />
      )}
    </Layout>
  );
}

function MediaLibrarySection({
  title,
  hint,
  items,
  emptyText,
  badgeText,
  badgeClass,
  onPick,
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        {items.length > 0 && (
          <span className={`badge ${badgeClass}`}>총 {items.length}건</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">{emptyText}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((m) => (
            <MediaCard
              key={m.id}
              item={m}
              badgeText={badgeText}
              badgeClass={badgeClass}
              onClick={() => onPick(m)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MediaCard({ item, badgeText, badgeClass, onClick }) {
  const img = mediaImageUrl(item);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group card flex h-full flex-col gap-3 overflow-hidden p-0 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      {img ? (
        <img
          src={img}
          alt=""
          className="w-full bg-slate-50 object-contain"
          style={{ maxHeight: "1080px" }}
        />
      ) : (
        <div className="grid h-56 w-full place-items-center bg-slate-100 text-xs text-slate-400">
          이미지 없음
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4 pt-2">
        <h3 className="line-clamp-2 text-sm font-bold text-slate-900 group-hover:text-brand-700">
          {item.title || "(표제 없음)"}
        </h3>
        {item.subtitle && (
          <p className="line-clamp-1 text-xs text-slate-500">{item.subtitle}</p>
        )}
        <p className="flex flex-wrap gap-x-2 text-[11px] text-slate-400">
          {item.publisher && <span>{item.publisher}</span>}
          {item.publishedAt && <span>{item.publishedAt}</span>}
        </p>
        <p className="line-clamp-3 text-xs leading-5 text-slate-600">{item.content || ""}</p>
        <div className="mt-auto flex items-center justify-between text-[11px] text-slate-400">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${badgeClass}`}>
            {badgeText}
          </span>
          <span className="font-semibold text-brand-600 group-hover:underline">
            폼에 가져오기 →
          </span>
        </div>
      </div>
    </button>
  );
}

function HistoryCard({ item, onClick, showAuthor }) {
  const created = item.createdAt?.toDate?.() ?? null;
  const isLegacy = !Array.isArray(item.itemResults);
  const raw = Number(item.rawScore ?? 0);
  const max = Number(item.maxScore ?? 0);
  const percent = Number(item.percent ?? 0);
  const hasAlert = item.itemAlert === true || item.dimensionAlert === true;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group card flex h-full flex-col gap-3 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-bold text-slate-900 group-hover:text-brand-700">
          {item.media?.title || "(표제 없음)"}
        </h3>
        {isLegacy && (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            이전 버전
          </span>
        )}
      </div>

      <p className="line-clamp-3 text-xs leading-5 text-slate-600">
        {item.media?.content || ""}
      </p>

      {showAuthor && item.createdByName && (
        <p className="text-[11px] text-slate-400">실행: {item.createdByName}</p>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 border-t border-slate-100 pt-3">
        <div>
          <p className="text-[10px] text-slate-400">
            {isLegacy ? "이전 버전 총점" : "원점수"}
          </p>
          {isLegacy ? (
            <p className="text-2xl font-extrabold text-slate-500">
              {Number(item.finalTotalScore ?? item.totalScore ?? 0).toFixed(1)}
              <span className="text-xs text-slate-400">/50</span>
            </p>
          ) : (
            <>
              <p className="text-2xl font-extrabold text-brand-700">
                {raw}
                <span className="text-xs text-slate-400">/{max}</span>
              </p>
              <p className="text-[11px] font-semibold text-brand-600">{percent}%</p>
            </>
          )}
          {hasAlert && <p className="text-[10px] font-semibold text-rose-600">⚠️ 항목 경고</p>}
        </div>
        <div className="text-right">
          {created && (
            <p className="text-[10px] text-slate-400">
              {created.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
            </p>
          )}
          {item.media?.link && <span className="text-[10px] text-brand-600">원본 링크 ✓</span>}
        </div>
      </div>
    </button>
  );
}

function LoadHistoryModal({ items, onPick, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-slate-900">기존 자료 불러오기</h3>
            <p className="mt-1 text-xs text-slate-500">
              다른 체크리스트로 검증했던 미디어예요. 불러오면 표제·부제·언론사·작성일·본문·이미지가
              폼에 채워지고, 지금 선택한 체크리스트로 다시 팩트체크할 수 있어요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            다른 체크리스트로 검증한 자료가 아직 없어요.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-xl ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="w-12 px-3 py-2 text-left font-semibold">연번</th>
                  <th className="px-3 py-2 text-left font-semibold">미디어 표제</th>
                  <th className="w-28 px-3 py-2 text-right font-semibold">불러오기</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it, idx) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                    <td className="px-3 py-2 text-slate-800">
                      <p className="line-clamp-2 font-medium">
                        {it.media?.title || "(표제 없음)"}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="secondary" onClick={() => onPick(it)}>불러오기</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </div>
  );
}
