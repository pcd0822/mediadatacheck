import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import LoadingOverlay from "../../components/Loading/LoadingOverlay.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import {
  createMediaItem,
  getMediaItem,
  updateMediaItem,
} from "../../services/firestore.js";
import { uploadThumbnail } from "../../services/storage.js";

export default function TeacherMediaUpload() {
  const navigate = useNavigate();
  const { mediaId } = useParams();
  const isEdit = Boolean(mediaId);
  const { user } = useAuth();
  const [form, setForm] = useState({ title: "", content: "", link: "" });
  const [thumbFile, setThumbFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [existingThumbUrl, setExistingThumbUrl] = useState("");
  const [removeThumb, setRemoveThumb] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setLoading(true);
      const m = await getMediaItem(mediaId);
      if (m) {
        setForm({
          title: m.title ?? "",
          content: m.content ?? "",
          link: m.link ?? "",
        });
        setExistingThumbUrl(m.thumbnailUrl ?? "");
      } else {
        setError("자료를 찾을 수 없습니다.");
      }
      setLoading(false);
    })();
  }, [mediaId, isEdit]);

  const onChange = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setThumbFile(file);
    setPreview(URL.createObjectURL(file));
    setRemoveThumb(false);
    if (file.size > 10 * 1024 * 1024) {
      setError(
        `이미지가 ${(file.size / 1024 / 1024).toFixed(1)}MB로 너무 커요. 10MB 이하로 압축한 뒤 다시 선택해주세요.`
      );
    } else {
      setError("");
    }
  };

  const handleRemoveThumb = () => {
    setThumbFile(null);
    setPreview("");
    setExistingThumbUrl("");
    setRemoveThumb(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.title.trim() || !form.content.trim()) {
      setError("제목과 본문은 필수 입력입니다.");
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit) {
        const update = { ...form };
        if (thumbFile) {
          update.thumbnailUrl = await uploadThumbnail(thumbFile, user.uid);
        } else if (removeThumb) {
          update.thumbnailUrl = "";
        }
        await updateMediaItem(mediaId, update);
        navigate("/teacher", { replace: true });
      } else {
        const thumbnailUrl = thumbFile
          ? await uploadThumbnail(thumbFile, user.uid)
          : "";
        const newMediaId = await createMediaItem(user.uid, {
          ...form,
          thumbnailUrl,
        });
        navigate(`/teacher/evaluate/${newMediaId}`, { replace: true });
      }
    } catch (err) {
      console.error(err);
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingOverlay message="자료 불러오는 중..." />;

  const thumbToShow = preview || existingThumbUrl;

  return (
    <Layout
      title={isEdit ? "미디어 자료 수정" : "미디어 자료 등록"}
      subtitle={
        isEdit
          ? "표제·본문·썸네일·링크를 수정합니다"
          : "학생들이 모델링과 팩트체크에 사용할 자료를 등록합니다"
      }
      actions={
        <Button variant="secondary" onClick={() => navigate("/teacher")}>
          ← 대시보드
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="card grid gap-5">
        <div>
          <label className="label" htmlFor="title">미디어 제목 *</label>
          <input
            id="title"
            className="input"
            value={form.title}
            onChange={onChange("title")}
            placeholder="예) ○○ 사건 보도 기사"
          />
        </div>

        <div>
          <label className="label" htmlFor="content">본문 내용 *</label>
          <textarea
            id="content"
            className="input min-h-[180px] resize-y"
            value={form.content}
            onChange={onChange("content")}
            placeholder="기사 본문 또는 영상 스크립트 등 미디어 본문을 붙여넣어 주세요."
          />
        </div>

        <div>
          <label className="label" htmlFor="link">원본 링크</label>
          <input
            id="link"
            type="url"
            className="input"
            value={form.link}
            onChange={onChange("link")}
            placeholder="https://..."
          />
        </div>

        <div>
          <label className="label">썸네일 이미지</label>
          <input type="file" accept="image/*" onChange={onFile} />
          {thumbToShow ? (
            <div className="mt-3 flex flex-col items-start gap-3">
              <img
                src={thumbToShow}
                alt=""
                className="rounded-xl object-contain ring-1 ring-slate-200"
                style={{ maxWidth: "1092px", maxHeight: "1080px", width: "100%", height: "auto" }}
              />
              <div className="flex items-center gap-3">
                {thumbFile && (
                  <p className="text-xs text-slate-500">
                    {thumbFile.name} · {(thumbFile.size / 1024 / 1024).toFixed(2)}MB
                  </p>
                )}
                <Button type="button" variant="ghost" onClick={handleRemoveThumb}>
                  썸네일 제거
                </Button>
              </div>
            </div>
          ) : (
            isEdit && (
              <p className="mt-2 text-xs text-slate-400">
                현재 썸네일이 없습니다. 새 이미지를 선택하면 추가돼요.
              </p>
            )
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => navigate("/teacher")}
            disabled={submitting}
          >
            취소
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            {isEdit ? "변경사항 저장" : "저장하고 평가 작성"}
          </Button>
        </div>
      </form>
    </Layout>
  );
}
