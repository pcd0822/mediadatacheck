import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import MediaForm from "../../components/MediaForm.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import {
  createMediaItem,
  deleteMediaItem,
  getMediaItem,
  listGroupMediaItems,
  mediaImageUrl,
  updateMediaItem,
} from "../../services/firestore.js";
import { subscribeGroup } from "../../services/groups.js";
import { uploadMediaImage } from "../../services/storage.js";
import { invalidate } from "../../utils/dataCache.js";

/**
 * 모둠 자료 등록·관리 (조장 전용).
 *
 * 모둠이 등록한 자료는 그 모둠만 열람·평가할 수 있다(firestore.rules에서 격리).
 * 조장 여부는 groups/{groupId}.leaderUid로 판정하며, 화면 게이트는 편의 장치이고
 * 실제 경계는 보안 규칙이다.
 */
export default function GroupMediaUpload() {
  const { mediaId } = useParams();
  const isEdit = Boolean(mediaId);
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { activeWorkspace: ws, isGroup } = useWorkspace();

  const [group, setGroup] = useState(null);
  const [list, setList] = useState([]);
  const [initial, setInitial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (!isGroup || !ws?.id) return undefined;
    const unsub = subscribeGroup(ws.id, (g) => setGroup(g));
    return () => unsub();
  }, [isGroup, ws?.id]);

  const refreshList = async () => {
    if (!ws?.id) return;
    const items = await listGroupMediaItems(ws.id);
    setList(items);
  };

  useEffect(() => {
    if (!isGroup || !ws?.id) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      await refreshList();
      if (isEdit) {
        const m = await getMediaItem(mediaId);
        if (m) {
          setInitial({
            title: m.title ?? "",
            subtitle: m.subtitle ?? "",
            content: m.content ?? "",
            publisher: m.publisher ?? "",
            publishedAt: m.publishedAt ?? "",
            link: m.link ?? "",
            imageUrl: mediaImageUrl(m),
          });
        }
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, ws?.id, mediaId, isEdit]);

  const isLeader = group?.leaderUid === user?.uid;

  const handleSubmit = async ({ form, imageFile, removeImage }) => {
    setSubmitting(true);
    try {
      let imageUrl = initial?.imageUrl ?? "";
      if (imageFile) imageUrl = await uploadMediaImage(imageFile, user.uid);
      else if (removeImage) imageUrl = "";

      if (isEdit) {
        await updateMediaItem(mediaId, { ...form, imageUrl });
      } else {
        await createMediaItem(
          {
            uid: user.uid,
            name: profile?.displayName ?? user.displayName ?? null,
            registeredBy: "group",
            groupId: ws.id,
          },
          { ...form, imageUrl }
        );
      }
      invalidate("media");
      navigate("/student/factcheck");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("이 모둠 자료를 삭제할까요? 모둠원 모두의 목록에서 사라집니다.")) return;
    setDeletingId(id);
    try {
      await deleteMediaItem(id);
      invalidate("media");
      await refreshList();
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <LoadingOverlay message="모둠 자료 불러오는 중..." />;

  if (!isGroup) {
    return (
      <Layout title="모둠 자료 등록">
        <div className="card text-center">
          <p className="text-slate-600">
            모둠 자료는 모둠 작업실에서만 등록할 수 있어요. 대시보드에서 모둠 작업실로 전환해주세요.
          </p>
          <Button variant="primary" className="mt-3" onClick={() => navigate("/student")}>
            ← 대시보드
          </Button>
        </div>
      </Layout>
    );
  }

  if (!isLeader) {
    return (
      <Layout title="모둠 자료 등록" subtitle={group?.groupName ?? "우리 모둠"}>
        <div className="card text-center">
          <p className="text-slate-600">
            모둠 자료 등록은 <strong>조장</strong>만 할 수 있어요
            {group?.leaderName ? ` (조장: ${group.leaderName})` : ""}.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => navigate("/student/factcheck")}>
            팩트체크로 가기 →
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title={isEdit ? "모둠 자료 수정" : "모둠 자료 등록"}
      subtitle={`${group?.groupName ?? "우리 모둠"} · 우리 모둠만 열람·평가할 수 있는 자료예요`}
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/student")}>← 대시보드</Button>
          <Button variant="secondary" onClick={() => navigate("/student/factcheck")}>
            팩트체크 →
          </Button>
        </>
      }
    >
      <MediaForm
        initial={initial}
        submitLabel={isEdit ? "변경사항 저장" : "우리 모둠 자료로 등록"}
        busy={submitting}
        onSubmit={handleSubmit}
        onCancel={() => navigate("/student/factcheck")}
      />

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold text-slate-900">우리 모둠이 등록한 자료</h2>
        {list.length === 0 ? (
          <div className="card text-center text-sm text-slate-500">
            아직 등록한 모둠 자료가 없어요.
          </div>
        ) : (
          <div className="grid gap-3">
            {list.map((m) => (
              <div key={m.id} className="card flex flex-col gap-3 sm:flex-row sm:items-start">
                {mediaImageUrl(m) ? (
                  <img
                    src={mediaImageUrl(m)}
                    alt=""
                    className="w-full rounded-xl object-contain ring-1 ring-slate-100 sm:w-48"
                    style={{ maxHeight: "320px" }}
                  />
                ) : null}
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-slate-900">{m.title}</h3>
                  {m.subtitle && <p className="text-xs text-slate-500">{m.subtitle}</p>}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
                    {m.publisher && <span>언론사: {m.publisher}</span>}
                    {m.publishedAt && <span>작성일: {m.publishedAt}</span>}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{m.content}</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => navigate(`/student/group-media/${m.id}`)}
                    >
                      수정
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => handleDelete(m.id)}
                      loading={deletingId === m.id}
                    >
                      삭제
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}
