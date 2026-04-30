import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import {
  getMediaItem,
  getTeacherEvaluation,
  setTeacherEvaluation,
} from "../../services/firestore.js";
import { DIMENSION_INFO, aggregateToDimensions } from "../../utils/hpfm.js";
import { ensureItemMappings } from "../../utils/mappingCache.js";

const DEFAULT_ITEMS = [
  { question: "출처가 명확하게 표시되어 있는가?", score: 3 },
  { question: "근거가 되는 자료(데이터·사례)가 제시되었는가?", score: 3 },
  { question: "다른 시각이나 반론이 함께 다뤄졌는가?", score: 3 },
];

export default function TeacherEvaluation() {
  const { mediaId } = useParams();
  const navigate = useNavigate();
  const [media, setMedia] = useState(null);
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const m = await getMediaItem(mediaId);
      setMedia(m);
      const teacherEval = await getTeacherEvaluation(mediaId);
      if (teacherEval?.items?.length) setItems(teacherEval.items);
      setLoading(false);
    })();
  }, [mediaId]);

  const totalScore = useMemo(() => {
    if (!items.length) return 0;
    const avg = items.reduce((s, it) => s + Number(it.score || 0), 0) / items.length;
    return Math.round(avg * 10 * 10) / 10;
  }, [items]);

  const updateItem = (idx, patch) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const addItem = () => setItems((arr) => [...arr, { question: "", score: 3 }]);
  const removeItem = (idx) => setItems((arr) => arr.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (items.some((it) => !it.question.trim())) {
      alert("비어있는 평가 항목이 있습니다.");
      return;
    }
    setSaving(true);
    try {
      const mapped = await ensureItemMappings(items);
      setItems(mapped);
      const scoresByIndex = mapped.map((it) => Number(it.score));
      const dimensionScores = aggregateToDimensions(mapped, scoresByIndex);
      await setTeacherEvaluation(mediaId, {
        items: mapped,
        totalScore,
        dimensionScores,
      });
      setSavedAt(new Date());
    } catch (e) {
      console.error(e);
      alert(`저장 중 오류: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingOverlay message="자료를 불러오는 중..." />;
  if (!media)
    return (
      <Layout title="자료를 찾을 수 없습니다">
        <Button variant="secondary" onClick={() => navigate("/teacher")}>← 대시보드</Button>
      </Layout>
    );

  return (
    <Layout
      title="교사 팩트체크 평가"
      subtitle="학생 평가의 정답지(reference)로 활용됩니다"
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/teacher")}>← 대시보드</Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>저장</Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="card">
          <h3 className="text-lg font-bold text-slate-900">{media.title}</h3>
          {media.link && (
            <a href={media.link} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">
              원본 링크 ↗
            </a>
          )}
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{media.content}</p>
        </div>

        <div className="card">
          <p className="text-sm text-slate-500">현재 평균 환산 점수</p>
          <p className="mt-1 text-4xl font-bold text-brand-700">{totalScore.toFixed(1)}<span className="text-base text-slate-400">/50</span></p>
          {savedAt && <p className="mt-2 text-xs text-emerald-600">저장됨 · {savedAt.toLocaleTimeString()}</p>}
          {media.thumbnailUrl && (
            <img src={media.thumbnailUrl} alt="" className="mt-4 w-full rounded-xl object-cover" />
          )}
        </div>
      </div>

      <div className="mt-6 card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">평가 항목 (1~5점)</h3>
          <Button variant="secondary" onClick={addItem}>+ 항목 추가</Button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          저장 시 각 질문은 7대 차원(D1~D7)으로 자동 분류되어 학생 모델 학습의 기준이 됩니다.
        </p>
        <div className="space-y-3">
          {items.map((it, idx) => (
            <div key={idx} className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_220px_auto]">
              <div>
                <input
                  className="input bg-white"
                  value={it.question}
                  onChange={(e) => updateItem(idx, { question: e.target.value })}
                  placeholder="평가 질문"
                />
                {it.dimension && DIMENSION_INFO[it.dimension] ? (
                  <span className="mt-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    {it.dimension} · {DIMENSION_INFO[it.dimension].name}
                  </span>
                ) : it.dimension === "D8" ? (
                  <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                    D8 · 사용자 정의
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={it.score}
                  onChange={(e) => updateItem(idx, { score: Number(e.target.value) })}
                  className="flex-1 accent-brand-600"
                />
                <span className="w-8 text-right text-sm font-bold text-brand-700">{it.score}</span>
              </div>
              <Button variant="ghost" onClick={() => removeItem(idx)}>삭제</Button>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
