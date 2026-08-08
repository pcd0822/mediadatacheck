import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import LessonShell, { StageGateFooter } from "../../components/LessonShell.jsx";
import MediaForm from "../../components/MediaForm.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import {
  createMediaItem,
  deleteMediaItem,
  listGroupMediaItems,
  listTeacherMediaItems,
  mediaImageUrl,
  updateMediaItem,
} from "../../services/firestore.js";
import { completeStage } from "../../services/lesson.js";
import { uploadMediaImage } from "../../services/storage.js";
import { invalidate } from "../../utils/dataCache.js";
import { mediaGate } from "../../utils/lessonGates.js";

export default function Stage2Media() {
  return (
    <LessonShell
      stage={2}
      title="2단계 · 평가할 자료 확인하고 등록하기"
      subtitle="우리 모둠이 평가할 자료는 선생님 자료 1건 + 우리 모둠 자료 1건, 총 2건이에요."
    >
      {(ctx) => <Stage2Body {...ctx} />}
    </LessonShell>
  );
}

function Stage2Body({ group, isLeader }) {
  const { user, profile } = useAuth();
  const { activeWorkspace: ws } = useWorkspace();
  const navigate = useNavigate();

  const [teacherMedia, setTeacherMedia] = useState([]);
  const [groupMedia, setGroupMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [editing, setEditing] = useState(null); // 수정 중인 모둠 자료
  const [error, setError] = useState("");

  const name = profile?.displayName ?? user?.displayName ?? null;

  const refresh = async () => {
    const [tm, gm] = await Promise.all([
      listTeacherMediaItems(),
      listGroupMediaItems(ws.id),
    ]);
    setTeacherMedia(tm);
    setGroupMedia(gm);
  };

  useEffect(() => {
    if (!ws?.id) return;
    (async () => {
      setLoading(true);
      try {
        await refresh();
      } catch (e) {
        console.error(e);
        setError(e.message ?? "자료를 불러오지 못했어요.");
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id]);

  const handleSubmit = async ({ form, imageFile, removeImage }) => {
    setSubmitting(true);
    setError("");
    try {
      let imageUrl = editing ? mediaImageUrl(editing) : "";
      if (imageFile) imageUrl = await uploadMediaImage(imageFile, user.uid);
      else if (removeImage) imageUrl = "";

      if (editing) {
        await updateMediaItem(editing.id, { ...form, imageUrl });
      } else {
        await createMediaItem(
          { uid: user.uid, name, registeredBy: "group", groupId: ws.id },
          { ...form, imageUrl }
        );
      }
      invalidate("media");
      setEditing(null);
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("이 자료를 삭제할까요? 모둠원 모두의 목록에서 사라집니다.")) return;
    await deleteMediaItem(id);
    invalidate("media");
    await refresh();
  };

  const { blockers } = mediaGate({
    teacherCount: teacherMedia.length,
    groupCount: groupMedia.length,
    isLeader,
  });

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await completeStage(ws.id, 2, {
        completedBy: user.uid,
        teacherMediaIds: teacherMedia.slice(0, 1).map((m) => m.id),
        groupMediaIds: groupMedia.slice(0, 1).map((m) => m.id),
      });
      navigate("/student/lesson/blind");
    } catch (e) {
      console.error(e);
      setError(e.message ?? "단계 완료 중 오류가 발생했어요.");
      setCompleting(false);
    }
  };

  if (loading) return <SkeletonList count={3} />;

  return (
    <>
      <section className="mb-8">
        <div className="mb-3 flex items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900">1) 선생님이 등록한 공통 필수 자료</h2>
            <p className="text-xs text-slate-500">
              모든 모둠이 같은 자료를 평가해요. 그래야 모둠끼리 결과를 견줄 수 있습니다. (읽기 전용)
            </p>
          </div>
          {teacherMedia.length > 0 && (
            <span className="badge bg-emerald-50 text-emerald-700">공통 필수</span>
          )}
        </div>

        {teacherMedia.length === 0 ? (
          <div className="card border-amber-200 bg-amber-50/50 text-center">
            <p className="text-sm font-semibold text-amber-800">
              선생님이 아직 공통 자료를 등록하지 않았어요.
            </p>
            <p className="mt-1 text-xs text-amber-700">
              선생님이 등록하면 이 자리에 나타나요. 그동안 아래에서 우리 모둠 자료를 골라두세요.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {teacherMedia.slice(0, 1).map((m) => (
              <MediaPreviewCard key={m.id} item={m} badge="공통 필수" tone="emerald" />
            ))}
            {teacherMedia.length > 1 && (
              <div className="card flex items-center justify-center text-center text-xs text-slate-500">
                선생님 자료가 {teacherMedia.length}건 등록되어 있어요.
                <br />
                이 수업에서는 가장 최근 자료 1건을 공통 대상으로 씁니다.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3">
          <h2 className="text-lg font-bold text-slate-900">2) 우리 모둠이 고를 자료</h2>
          <p className="text-xs text-slate-500">
            {isLeader
              ? "조장이 등록합니다. 모둠원과 상의해서 고르세요."
              : "조장이 등록해요. 함께 상의해서 골라주세요. (모둠원은 읽기 전용)"}
          </p>
        </div>

        <div className="mb-4 rounded-2xl border border-brand-200 bg-brand-50/50 px-5 py-4">
          <p className="text-sm font-bold text-brand-800">💡 자료 선정 기준</p>
          <p className="mt-1.5 text-[13px] leading-6 text-ink-variant">
            <strong>가짜 같은 자료가 아니라, 모둠원끼리 판단이 갈릴 것 같은 자료를 고르세요.</strong>
            <br />
            한눈에 가짜인 자료는 모두가 낮은 점수를 줄 테니 토론할 거리가 없습니다. 반대로
            "이건 믿어도 될까?"에서 의견이 갈리는 자료라야, 왜 다르게 봤는지 이야기할 수 있어요.
          </p>
        </div>

        {groupMedia.length > 0 && (
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            {groupMedia.map((m) => (
              <MediaPreviewCard
                key={m.id}
                item={m}
                badge="우리 모둠 자료"
                tone="brand"
                actions={
                  isLeader && (
                    <div className="mt-3 flex gap-2">
                      <Button variant="secondary" onClick={() => setEditing(m)}>
                        수정
                      </Button>
                      <Button variant="danger" onClick={() => handleDelete(m.id)}>
                        삭제
                      </Button>
                    </div>
                  )
                }
              />
            ))}
          </div>
        )}

        {isLeader ? (
          groupMedia.length === 0 || editing ? (
            <>
              {editing && (
                <div className="mb-2 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-2">
                  <span className="text-xs font-semibold text-amber-800">
                    "{editing.title}" 수정 중
                  </span>
                  <Button variant="ghost" onClick={() => setEditing(null)}>
                    수정 취소
                  </Button>
                </div>
              )}
              <MediaForm
                key={editing?.id ?? "new"}
                initial={
                  editing
                    ? {
                        title: editing.title ?? "",
                        subtitle: editing.subtitle ?? "",
                        content: editing.content ?? "",
                        publisher: editing.publisher ?? "",
                        publishedAt: editing.publishedAt ?? "",
                        link: editing.link ?? "",
                        imageUrl: mediaImageUrl(editing),
                      }
                    : null
                }
                submitLabel={editing ? "변경사항 저장" : "우리 모둠 자료로 등록"}
                busy={submitting}
                onSubmit={handleSubmit}
              />
            </>
          ) : (
            <p className="card text-center text-sm text-slate-500">
              자료 1건이 등록됐어요. 수정하려면 위 카드의 '수정'을 누르세요.
            </p>
          )
        ) : (
          groupMedia.length === 0 && (
            <div className="card text-center text-sm text-slate-500">
              조장이 자료를 고르는 중이에요. 어떤 자료가 좋을지 함께 이야기해보세요.
            </div>
          )
        )}
      </section>

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      <StageGateFooter
        blockers={blockers}
        label="2단계 완료하고 3단계 열기"
        busy={completing}
        onComplete={handleComplete}
        note="선생님 자료 1건 + 우리 모둠 자료 1건이 준비되면 조장이 다음 단계를 열 수 있어요."
      />
    </>
  );
}

function MediaPreviewCard({ item, badge, tone = "brand", actions }) {
  const img = mediaImageUrl(item);
  const badgeCls =
    tone === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-brand-50 text-brand-700";
  return (
    <div className="card overflow-hidden">
      {img ? (
        <img
          src={img}
          alt=""
          className="mb-3 w-full rounded-xl bg-slate-50 object-contain"
          style={{ maxHeight: "320px" }}
        />
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{item.title || "(표제 없음)"}</h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeCls}`}>
          {badge}
        </span>
      </div>
      {item.subtitle && <p className="mt-0.5 text-xs text-slate-500">{item.subtitle}</p>}
      <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
        {item.publisher && <span>언론사: {item.publisher}</span>}
        {item.publishedAt && <span>작성일: {item.publishedAt}</span>}
      </p>
      <p className="mt-2 line-clamp-4 text-xs leading-5 text-slate-600">{item.content}</p>
      {item.link && (
        <a
          href={item.link}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[11px] text-brand-700 underline"
        >
          원본 링크 ↗
        </a>
      )}
      {actions}
    </div>
  );
}
