import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import {
  createChecklist,
  deleteChecklist,
  listChecklists,
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

export default function ChecklistEditor() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [name, setName] = useState("");
  const [items, setItems] = useState([blankItem()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const refresh = async (selectId) => {
    setLoading(true);
    const list = await listChecklists(user.uid);
    setLists(list);
    if (selectId) {
      const found = list.find((l) => l.id === selectId);
      if (found) loadInto(found);
    } else if (!activeId && list.length) {
      loadInto(list[0]);
    } else if (!list.length) {
      setActiveId(null);
      setName("나의 팩트체크 기준");
      setItems([blankItem()]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadInto = (cl) => {
    setActiveId(cl.id);
    setName(cl.checklistName);
    setItems(cl.items?.length ? cl.items : [blankItem()]);
    setSavedAt(null);
  };

  const handleNew = () => {
    setActiveId(null);
    setName("새 체크리스트");
    setItems([blankItem()]);
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

  const handleSave = async () => {
    const err = validate();
    if (err) return alert(err);
    setSaving(true);
    try {
      const mapped = await ensureItemMappings(items);
      setItems(mapped);
      if (activeId) {
        await updateChecklist(user.uid, activeId, { checklistName: name, items: mapped });
        setSavedAt(new Date());
        await refresh(activeId);
      } else {
        const newId = await createChecklist(user.uid, { checklistName: name, items: mapped });
        setSavedAt(new Date());
        await refresh(newId);
      }
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
    await deleteChecklist(user.uid, activeId);
    setActiveId(null);
    await refresh();
  };

  return (
    <Layout
      title="체크리스트 작성"
      subtitle="팩트체크 질문과 1~5점 척도를 직접 설계해보세요"
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/student")}>← 대시보드</Button>
          <Button variant="ghost" onClick={handleNew}>+ 새 체크리스트</Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>저장</Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="card h-fit">
          <p className="label">내 체크리스트</p>
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
          </div>

          <div className="space-y-4">
            {items.map((it, idx) => (
              <div key={idx} className="card">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="badge">항목 {idx + 1}</span>
                    {it.dimension && DIMENSION_INFO[it.dimension] ? (
                      <span className="badge bg-emerald-50 text-emerald-700">
                        {it.dimension} · {DIMENSION_INFO[it.dimension].name}
                      </span>
                    ) : it.dimension === "C6" ? (
                      <span className="badge bg-slate-100 text-slate-600">C6 · 사용자 정의</span>
                    ) : (
                      <span className="badge bg-amber-50 text-amber-700">저장 시 자동 분류</span>
                    )}
                  </div>
                  <Button variant="ghost" onClick={() => removeItem(idx)}>삭제</Button>
                </div>
                <label className="label">평가 질문</label>
                <input
                  className="input"
                  value={it.question}
                  onChange={(e) => updateItem(idx, { question: e.target.value })}
                  placeholder="예) 출처가 명확하게 표시되어 있는가?"
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
