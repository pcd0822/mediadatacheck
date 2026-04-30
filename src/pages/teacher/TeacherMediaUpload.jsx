import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { createMediaItem } from "../../services/firestore.js";
import { uploadThumbnail } from "../../services/storage.js";

export default function TeacherMediaUpload() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState({ title: "", content: "", link: "" });
  const [thumbFile, setThumbFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onChange = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setThumbFile(file);
    setPreview(URL.createObjectURL(file));
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
      const thumbnailUrl = thumbFile ? await uploadThumbnail(thumbFile, user.uid) : "";
      const mediaId = await createMediaItem(user.uid, {
        ...form,
        thumbnailUrl,
      });
      navigate(`/teacher/evaluate/${mediaId}`, { replace: true });
    } catch (err) {
      console.error(err);
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout
      title="미디어 자료 등록"
      subtitle="학생들이 모델링과 팩트체크에 사용할 자료를 등록합니다"
      actions={
        <Button variant="secondary" onClick={() => navigate("/teacher")}>
          ← 대시보드
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="card grid gap-5">
        <div>
          <label className="label" htmlFor="title">미디어 제목 *</label>
          <input id="title" className="input" value={form.title} onChange={onChange("title")} placeholder="예) ○○ 사건 보도 기사" />
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
          <input id="link" type="url" className="input" value={form.link} onChange={onChange("link")} placeholder="https://..." />
        </div>

        <div>
          <label className="label">썸네일 이미지</label>
          <input type="file" accept="image/*" onChange={onFile} />
          {preview && (
            <img src={preview} alt="" className="mt-3 h-32 w-48 rounded-xl object-cover ring-1 ring-slate-200" />
          )}
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate("/teacher")} disabled={submitting}>취소</Button>
          <Button type="submit" variant="primary" loading={submitting}>저장하고 평가 작성</Button>
        </div>
      </form>
    </Layout>
  );
}
