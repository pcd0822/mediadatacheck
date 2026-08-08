import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import MediaForm from "../../components/MediaForm.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import {
  createMediaItem,
  getMediaItem,
  mediaImageUrl,
  updateMediaItem,
} from "../../services/firestore.js";
import { uploadMediaImage } from "../../services/storage.js";
import { invalidate } from "../../utils/dataCache.js";

export default function TeacherMediaUpload() {
  const navigate = useNavigate();
  const { mediaId } = useParams();
  const isEdit = Boolean(mediaId);
  const { user, profile } = useAuth();
  const [initial, setInitial] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setLoading(true);
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
      } else {
        setLoadError("자료를 찾을 수 없습니다.");
      }
      setLoading(false);
    })();
  }, [mediaId, isEdit]);

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
            registeredBy: "teacher",
          },
          { ...form, imageUrl }
        );
      }
      invalidate("media"); // 학생 화면의 자료 목록 캐시 무효화
      navigate("/teacher", { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingOverlay message="자료 불러오는 중..." />;

  if (loadError) {
    return (
      <Layout title="자료를 찾을 수 없습니다">
        <Button variant="secondary" onClick={() => navigate("/teacher")}>
          ← 대시보드
        </Button>
      </Layout>
    );
  }

  return (
    <Layout
      title={isEdit ? "미디어 자료 수정" : "미디어 자료 등록"}
      subtitle={
        isEdit
          ? "표제·부제·언론사·작성일·본문·이미지를 수정합니다"
          : "학급 전체가 팩트체크에 사용할 공통 자료를 등록합니다 (모든 모둠이 열람·평가 가능)"
      }
      actions={
        <Button variant="secondary" onClick={() => navigate("/teacher")}>
          ← 대시보드
        </Button>
      }
    >
      <MediaForm
        initial={initial}
        submitLabel={isEdit ? "변경사항 저장" : "자료 등록"}
        busy={submitting}
        onSubmit={handleSubmit}
        onCancel={() => navigate("/teacher")}
      />
    </Layout>
  );
}
