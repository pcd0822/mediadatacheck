import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import {
  createChecklist,
  deleteChecklist,
  subscribeChecklist,
  subscribeChecklists,
  updateChecklist,
} from "../../services/firestore.js";
import { DIMENSION_INFO } from "../../utils/hpfm.js";
import { ensureItemMappings } from "../../utils/mappingCache.js";

const SCALE = [1, 2, 3, 4, 5];
const SCALE_LABEL = {
  1: "1점 (매우 부정확)",
  2: "2점",
  3: "3점 (보통)",
  4: "4점",
  5: "5점 (매우 정확)",
};

const blankItem = () => ({
  question: "",
  rubric: { 1: "", 2: "", 3: "", 4: "", 5: "" },
});

const serialize = (name, items) => JSON.stringify({ name, items });

export default function ChecklistEditor() {
  const { user } = useAuth();
  const { activeWorkspace, isGroup } = useWorkspace();
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [name, setName] = useState("");
  const [items, setItems] = useState([blankItem()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [remoteInfo, setRemoteInfo] = useState(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [creating, setCreating] = useState(false);

  const ws = activeWorkspace;
  const loadedRef = useRef("");
  const pendingRemoteRef = useRef(null);
  // 구독 콜백이 최신 편집 내용을 읽되 재구독을 유발하지 않도록 ref로 보관
  const nameRef = useRef(name);
  nameRef.current = name;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const loadInto = (cl) => {
    const its = cl.items?.length ? cl.items : [blankItem()];
    setActiveId(cl.id);
    setName(cl.checklistName ?? "");
    setItems(its);
    loadedRef.current = serialize(cl.checklistName ?? "", its);
    setRemoteChanged(false);
    pendingRemoteRef.current = null;
    setSavedAt(null);
  };

  // 사이드바 목록 실시간 구독
  useEffect(() => {
    if (!ws) return undefined;
    setLoading(true);
    const unsub = subscribeChecklists(
      ws,
      (list) => {
        setLists(list);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.type, ws?.id]);

  // 작업실이 바뀌면 선택 초기화
  useEffect(() => {
    setActiveId(null);
    setName("");
    setItems([blankItem()]);
    loadedRef.current = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.type, ws?.id]);

  // 아무것도 선택 안 했을 때 첫 체크리스트 자동 로드(없으면 빈 폼)
  useEffect(() => {
    if (activeId) return;
    if (lists.length) {
      loadInto(lists[0]);
    } else if (!name) {
      setName("나의 팩트체크 기준");
      setItems([blankItem()]);
      loadedRef.current = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, activeId]);

  // 활성 체크리스트 문서 실시간 구독 (원격 변경 감지)
  useEffect(() => {
    if (!ws || !activeId) return undefined;
    const unsub = subscribeChecklist(ws, activeId, (cl) => {
      if (!cl) return; // 삭제됨 — 목록 구독이 처리
      setRemoteInfo({
        lastEditedName: cl.lastEditedName ?? null,
        lastEditedBy: cl.lastEditedBy ?? null,
        updatedAt: cl.updatedAt ?? null,
      });
      const remoteItems = cl.items?.length ? cl.items : [blankItem()];
      const remoteSer = serialize(cl.checklistName ?? "", remoteItems);
      if (remoteSer === loadedRef.current) return; // 변화 없음(내 저장 포함)
      const dirty = serialize(nameRef.current, itemsRef.current) !== loadedRef.current;
      if (dirty) {
        // 내 미저장 편집 보호 — 자동 덮어쓰기 금지, 배너로 안내
        pendingRemoteRef.current = cl;
        setRemoteChanged(true);
      } else {
        loadInto(cl);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.type, ws?.id, activeId]);

  const applyRemote = () => {
    if (pendingRemoteRef.current) loadInto(pendingRemoteRef.current);
    setRemoteChanged(false);
  };

  const handleNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const baseName = "새 체크리스트";
      const existingNames = new Set(lists.map((l) => l.checklistName));
      let candidateName = baseName;
      let counter = 2;
      while (existingNames.has(candidateName)) {
        candidateName = `${baseName} ${counter}`;
        counter += 1;
      }
      const initialItems = [blankItem()];
      const newId = await createChecklist(ws, {
        checklistName: candidateName,
        items: initialItems,
        lastEditedBy: user.uid,
        lastEditedName: user.displayName ?? null,
      });
      setActiveId(newId);
      setName(candidateName);
      setItems(initialItems);
      loadedRef.current = serialize(candidateName, initialItems);
      pendingRemoteRef.current = null;
      setRemoteChanged(false);
      setSavedAt(null);
    } catch (e) {
      console.error(e);
      alert(`새 체크리스트 생성 중 오류: ${e.message}`);
    } finally {
      setCreating(false);
    }
  };

  const updateItem = (idx, patch) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const updateRubric = (idx, score, val) =>
    setItems((arr) =>
      arr.map((it, i) =>
        i === idx ? { ...it, rubric: { ...it.rubric, [score]: val } } : it
      )
    );

  const addItem = () => setItems((a) => [...a, blankItem()]);
  const removeItem = (idx) => setItems((a) => a.filter((_, i) => i !== idx));

  const validate = () => {
    if (!name.trim()) return "체크리스트 이름을 입력해주세요.";
    if (items.length === 0) return "최소 1개 항목이 필요합니다.";
    if (items.some((it) => !it.question.trim())) return "비어있는 질문이 있습니다.";
    return null;
  };

  const placeholderQuestions = [
    "이 사이트 진짜야? (예: 매체 이름이 들어본 곳인가)",
    "누가 썼고 사람 맞아? (예: 작성자 이름·이력이 검색되나)",
    "다른 데서도 확인돼? (예: 주요 일간지에서도 같은 내용을 다루나)",
    "이 사진·영상 진짜야? (예: 역이미지 검색해도 같은 사건의 이미지인가)",
    "나 너무 흥분한 거 아니야? (예: 자극적 어휘로 즉시 공유하고 싶은 충동이 드나)",
  ];

  const handleSave = async () => {
    const err = validate();
    if (err) return alert(err);
    setSaving(true);
    try {
      const mapped = await ensureItemMappings(items);
      setItems(mapped);
      const payload = {
        checklistName: name,
        items: mapped,
        lastEditedBy: user.uid,
        lastEditedName: user.displayName ?? null,
      };
      if (activeId) {
        await updateChecklist(ws, activeId, payload);
      } else {
        const newId = await createChecklist(ws, payload);
        setActiveId(newId);
      }
      loadedRef.current = serialize(name, mapped);
      setRemoteChanged(false);
      setSavedAt(new Date());
    } catch (e) {
      console.error(e);
      alert(`저장 중 오류: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!activeId) return;
    if (!confirm("이 체크리스트를 삭제하시겠습니까?")) return;
    await deleteChecklist(ws, activeId);
    setActiveId(null);
    setName("");
    setItems([blankItem()]);
    loadedRef.current = "";
  };

  return (
    <Layout
      title="체크리스트 작성"
      subtitle={
        isGroup
          ? `모둠 작업실 · ${ws?.name ?? "우리 모둠"} — 모둠원과 함께 실시간으로 편집해요`
          : "미디어를 평가할 때 쓸 질문과 1~5점 기준을 직접 만들어요"
      }
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/student")}>← 대시보드</Button>
          <Button variant="ghost" onClick={handleNew} loading={creating} disabled={creating || saving}>
            + 새 체크리스트
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving || creating}>저장</Button>
          {activeId && !remoteChanged && (
            <Button
              variant="secondary"
              onClick={() => navigate(`/student/factcheck?checklist=${activeId}`)}
            >
              이 체크리스트로 팩트체크 →
            </Button>
          )}
        </>
      }
    >
      {remoteChanged && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            다른 모둠원이 이 체크리스트를 방금 수정했어요
            {remoteInfo?.lastEditedName ? ` (${remoteInfo.lastEditedName})` : ""}.
            내 미저장 편집을 보호하기 위해 자동 반영하지 않았어요.
          </p>
          <Button variant="secondary" onClick={applyRemote}>최신 내용 불러오기</Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="card h-fit">
          <p className="label">{isGroup ? "모둠 체크리스트" : "내 체크리스트"}</p>
          {loading ? (
            <SkeletonList count={2} />
          ) : lists.length === 0 ? (
            <p className="text-sm text-slate-500">아직 만든 체크리스트가 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {lists.map((cl) => (
                <li key={cl.id}>
                  <button
                    type="button"
                    onClick={() => loadInto(cl)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                      cl.id === activeId
                        ? "bg-brand-50 font-semibold text-brand-700"
                        : "hover:bg-slate-100"
                    }`}
                  >
                    {cl.checklistName}
                    <span className="block text-[11px] text-slate-400">
                      항목 {cl.items?.length ?? 0}개
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="space-y-4">
          <div className="card">
            <label className="label" htmlFor="cl-name">체크리스트 이름</label>
            <input id="cl-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            {savedAt && <p className="mt-2 text-xs text-emerald-600">저장됨 · {savedAt.toLocaleTimeString()}</p>}
            {isGroup && remoteInfo?.lastEditedName && (
              <p className="mt-1 text-[11px] text-slate-400">마지막 편집: {remoteInfo.lastEditedName}</p>
            )}
          </div>

          <div className="space-y-4">
            {items.map((it, idx) => (
              <div key={idx} className="card">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="badge">항목 {idx + 1}</span>
                    {it.dimension && DIMENSION_INFO[it.dimension] ? (
                      <span className="badge bg-emerald-50 text-emerald-700">
                        {DIMENSION_INFO[it.dimension].name}
                      </span>
                    ) : it.dimension === "V6" ? (
                      <span className="badge bg-slate-100 text-slate-600">내가 만든 항목</span>
                    ) : (
                      <span className="badge bg-amber-50 text-amber-700">저장하면 검증 행동에 자동 분류돼요</span>
                    )}
                  </div>
                  <Button variant="ghost" onClick={() => removeItem(idx)}>삭제</Button>
                </div>
                <label className="label">평가 질문</label>
                <input
                  className="input"
                  value={it.question}
                  onChange={(e) => updateItem(idx, { question: e.target.value })}
                  placeholder={`예) ${placeholderQuestions[idx % placeholderQuestions.length]}`}
                />
                <p className="mt-4 label">루브릭 (각 점수의 의미)</p>
                <div className="grid gap-2">
                  {SCALE.map((score) => (
                    <div key={score} className="grid items-start gap-2 sm:grid-cols-[120px_1fr]">
                      <span className="rounded-lg bg-slate-100 px-2 py-2 text-center text-xs font-semibold text-slate-700">
                        {SCALE_LABEL[score]}
                      </span>
                      <input
                        className="input"
                        value={it.rubric?.[score] ?? ""}
                        onChange={(e) => updateRubric(idx, score, e.target.value)}
                        placeholder={`${score}점에 해당하는 자료의 특징`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-between">
            <Button variant="secondary" onClick={addItem}>+ 항목 추가</Button>
            {activeId && (
              <Button variant="danger" onClick={handleDelete}>이 체크리스트 삭제</Button>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
