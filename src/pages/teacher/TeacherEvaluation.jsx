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

// 5대 검증 행동 기반 기본 평가 항목 (VAPM v3.0)
const DEFAULT_ITEMS = [
  {
    question:
      "이 자료의 발행 매체나 사이트가 신뢰할 만하며, 알려진 매체를 위장하거나 의심스러운 도메인을 사용하지 않는가?",
    score: 3,
    verification_action: "출처 확인 (Source Check)",
  },
  {
    question:
      "작성자의 이름·이력·전문성이 확인 가능하며, 봇이나 자동화 계정의 특징이 보이지 않는가?",
    score: 3,
    verification_action: "저자 확인 (Author Check)",
  },
  {
    question:
      "이 자료의 핵심 주장이 다른 신뢰할 만한 매체·공공기관·NGO의 보도와 일치하며, 인용된 통계·사실이 원자료에서 검증되는가?",
    score: 3,
    verification_action: "콘텐츠 교차 확인 (Content Cross-check)",
  },
  {
    question:
      "자료에 포함된 사진·영상이 실제 내용과 맥락이 일치하며, 다른 사건의 이미지 재사용이나 딥페이크·AI 생성의 신호는 없는가?",
    score: 3,
    verification_action: "이미지·영상 확인 (Visual Verification)",
  },
  {
    question:
      "이 자료가 부정적 감정(분노·공포·혐오·충격)을 강하게 자극하여 비판적 사고를 흐리고 즉각 공유·반응을 유도하려는 의도가 보이지 않는가?",
    score: 3,
    verification_action: "감정 반응 점검 (Emotional Reaction Check)",
  },
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
            <img
              src={media.thumbnailUrl}
              alt=""
              className="mt-4 w-full rounded-xl object-contain"
              style={{ maxWidth: "1092px", maxHeight: "1080px" }}
            />
          )}
        </div>
      </div>

      <div className="mt-6 card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">평가 항목 (1~5점)</h3>
          <Button variant="secondary" onClick={addItem}>+ 항목 추가</Button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          저장 시 각 질문은 5대 검증 행동(V1~V5)으로 자동 분류되어 학생 모델 학습의 기준이 됩니다.
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
                ) : it.dimension === "V6" ? (
                  <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                    V6 · 사용자 정의
                  </span>
                ) : null}
                {it.verification_action && (
                  <span className="ml-1 mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[10px] text-brand-700">
                    검증 행동: {it.verification_action}
                  </span>
                )}
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
