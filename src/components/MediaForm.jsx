import { useState } from "react";
import Button from "./Button.jsx";

/**
 * 미디어 자료 등록·수정 공용 폼 (교사 / 모둠 조장 공통).
 *
 * v5.0 스키마: 표제·부제·본문·이미지·작성일·언론사.
 * ⚠️ 언론사·작성일은 **입력값을 검증하지 않는다.** AI도 이 값을 그대로 사실로 전제하고
 *    채점하므로, 그 사실을 폼에서도 학생·교사에게 알려준다(수업에서 다루는 학습 내용).
 */
export default function MediaForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  busy = false,
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    subtitle: initial?.subtitle ?? "",
    content: initial?.content ?? "",
    publisher: initial?.publisher ?? "",
    publishedAt: initial?.publishedAt ?? "",
    link: initial?.link ?? "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [existingImageUrl, setExistingImageUrl] = useState(initial?.imageUrl ?? "");
  const [removeImage, setRemoveImage] = useState(false);
  const [error, setError] = useState("");

  const onChange = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(`이미지 파일만 첨부할 수 있어요 (현재 형식: ${file.type || "알 수 없음"}).`);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(
        `이미지가 ${(file.size / 1024 / 1024).toFixed(1)}MB로 너무 커요. 10MB 이하로 압축한 뒤 다시 선택해주세요.`
      );
      return;
    }
    setImageFile(file);
    setPreview(URL.createObjectURL(file));
    setRemoveImage(false);
    setError("");
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setPreview("");
    setExistingImageUrl("");
    setRemoveImage(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.title.trim() || !form.content.trim()) {
      setError("표제와 본문은 필수 입력입니다.");
      return;
    }
    try {
      await onSubmit({ form, imageFile, removeImage });
    } catch (err) {
      console.error(err);
      setError(err.message || "저장 중 오류가 발생했습니다.");
    }
  };

  const imageToShow = preview || existingImageUrl;

  return (
    <form onSubmit={handleSubmit} className="card grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="mf-title">표제 *</label>
          <input
            id="mf-title"
            className="input"
            value={form.title}
            onChange={onChange("title")}
            placeholder="예) ○○ 사건 보도 기사 제목"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="mf-subtitle">부제</label>
          <input
            id="mf-subtitle"
            className="input"
            value={form.subtitle}
            onChange={onChange("subtitle")}
            placeholder="예) 기사 제목 아래 작은 제목"
          />
        </div>

        <div>
          <label className="label" htmlFor="mf-publisher">언론사</label>
          <input
            id="mf-publisher"
            className="input"
            value={form.publisher}
            onChange={onChange("publisher")}
            placeholder="예) ○○일보"
          />
        </div>

        <div>
          <label className="label" htmlFor="mf-published">작성일</label>
          <input
            id="mf-published"
            type="date"
            className="input"
            value={form.publishedAt}
            onChange={onChange("publishedAt")}
          />
        </div>
      </div>

      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
        ⚠️ 여기 입력한 <strong>언론사·작성일·링크는 검증되지 않습니다.</strong> AI도 이 값을 그대로
        사실로 전제하고 채점하므로, 실제로 그 매체가 존재하는지·날짜가 맞는지는 확인되지 않아요.
        수업에서 이 한계를 함께 다뤄보세요.
      </p>

      <div>
        <label className="label" htmlFor="mf-content">본문 *</label>
        <textarea
          id="mf-content"
          className="input min-h-[200px] resize-y"
          value={form.content}
          onChange={onChange("content")}
          placeholder="기사 본문 또는 영상 스크립트 등 미디어 본문을 붙여넣어 주세요."
        />
      </div>

      <div>
        <label className="label" htmlFor="mf-link">원본 링크</label>
        <input
          id="mf-link"
          type="url"
          className="input"
          value={form.link}
          onChange={onChange("link")}
          placeholder="https://..."
        />
      </div>

      <div>
        <label className="label">이미지</label>
        <p className="mb-2 text-[11px] text-slate-500">
          자료에 포함된 사진·스크린샷·그래프를 올리면 시각 자료를 묻는 체크리스트 항목을
          AI가 이미지를 직접 보고 채점해요. 없으면 그런 항목은 N/A로 처리될 수 있어요.
        </p>
        <input type="file" accept="image/*" onChange={onFile} />
        {imageToShow && (
          <div className="mt-3 flex flex-col items-start gap-3">
            <img
              src={imageToShow}
              alt="미디어 이미지 미리보기"
              className="rounded-xl object-contain ring-1 ring-slate-200"
              style={{ maxWidth: "100%", maxHeight: "480px" }}
            />
            <div className="flex items-center gap-3">
              {imageFile && (
                <p className="text-xs text-slate-500">
                  {imageFile.name} · {(imageFile.size / 1024 / 1024).toFixed(2)}MB
                </p>
              )}
              <Button type="button" variant="ghost" onClick={handleRemoveImage}>
                이미지 제거
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={busy} type="button">
            취소
          </Button>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
