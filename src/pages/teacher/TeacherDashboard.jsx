import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import {
  deleteMediaItem,
  getTeacherAuthConfig,
  listTeacherMediaWithTeacherEvals,
  updateTeacherAuthCode,
} from "../../services/firestore.js";
import { makeCodeRecord, verifyCode } from "../../utils/teacherCode.js";

const MIN_CODE_LEN = 4;

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [showCodeModal, setShowCodeModal] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const list = await listTeacherMediaWithTeacherEvals();
    setItems(list);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleDelete = async (mediaId) => {
    if (!confirm("이 미디어 자료를 삭제하시겠습니까? 학생 평가 데이터도 함께 사라집니다.")) return;
    setDeletingId(mediaId);
    try {
      await deleteMediaItem(mediaId);
      await refresh();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Layout
      title="교사 대시보드"
      subtitle="미디어 자료를 등록하고 정답지(팩트체크 평가)를 관리합니다"
      actions={
        <>
          <Button variant="secondary" onClick={() => setShowCodeModal(true)}>
            인증 코드 변경
          </Button>
          <Button variant="primary" onClick={() => navigate("/teacher/upload")}>
            + 새 미디어 자료 등록
          </Button>
        </>
      }
    >
      {loading ? (
        <SkeletonList count={3} />
      ) : items.length === 0 ? (
        <div className="card text-center">
          <p className="text-slate-600">아직 등록된 미디어 자료가 없습니다.</p>
          <Button
            variant="primary"
            className="mt-4"
            onClick={() => navigate("/teacher/upload")}
          >
            첫 미디어 등록하기
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((m) => {
            const evalCount = m.teacherEvaluation?.items?.length ?? 0;
            return (
              <div key={m.id} className="card flex flex-col gap-4 sm:flex-row sm:items-start">
                {m.thumbnailUrl ? (
                  <img
                    src={m.thumbnailUrl}
                    alt=""
                    className="w-full rounded-xl object-contain ring-1 ring-slate-100 sm:w-72"
                    style={{ maxHeight: "1080px" }}
                  />
                ) : (
                  <div className="grid h-44 w-full place-items-center rounded-xl bg-slate-100 text-slate-400 sm:w-72">
                    No Thumbnail
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{m.title}</h3>
                    {evalCount > 0 ? (
                      <span className="badge bg-emerald-50 text-emerald-700">
                        교사 평가 {evalCount}항목
                      </span>
                    ) : (
                      <span className="badge bg-amber-50 text-amber-700">평가 미작성</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">{m.content}</p>
                  {m.link && (
                    <a
                      href={m.link}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-xs text-brand-700 underline"
                    >
                      원본 링크 ↗
                    </a>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      to={`/teacher/evaluate/${m.id}`}
                      className="btn-primary"
                    >
                      팩트체크 평가
                    </Link>
                    <Link
                      to={`/teacher/edit/${m.id}`}
                      className="btn-secondary"
                    >
                      자료 수정
                    </Link>
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
            );
          })}
        </div>
      )}

      {showCodeModal && (
        <ChangeCodeModal onClose={() => setShowCodeModal(false)} />
      )}
    </Layout>
  );
}

function ChangeCodeModal({ onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const n = next.trim();
    if (n.length < MIN_CODE_LEN) {
      setError(`새 인증 코드는 ${MIN_CODE_LEN}자 이상이어야 합니다.`);
      return;
    }
    if (n !== confirm.trim()) {
      setError("새 코드가 서로 일치하지 않습니다.");
      return;
    }
    setSaving(true);
    try {
      const cfg = await getTeacherAuthConfig();
      const ok = cfg && (await verifyCode(current.trim(), cfg));
      if (!ok) {
        setError("현재 인증 코드가 올바르지 않습니다.");
        setSaving(false);
        return;
      }
      const record = await makeCodeRecord(n);
      await updateTeacherAuthCode(record);
      setDone(true);
    } catch (err) {
      console.error(err);
      setError("코드 변경 중 오류가 발생했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-slate-900">교사 인증 코드 변경</h3>
            <p className="mt-1 text-xs text-slate-500">
              현재 코드를 확인한 뒤 새 코드로 바꿉니다. 변경 후에는 새 코드로만 교사 로그인이 가능합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              인증 코드가 변경되었어요.
            </p>
            <div className="flex justify-end">
              <Button variant="primary" onClick={onClose}>확인</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="cur-code" className="label">현재 인증 코드</label>
              <input
                id="cur-code"
                type="password"
                autoComplete="off"
                maxLength={32}
                className="input"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="new-code" className="label">새 인증 코드 ({MIN_CODE_LEN}자 이상)</label>
              <input
                id="new-code"
                type="password"
                autoComplete="new-password"
                maxLength={32}
                className="input"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="new-confirm" className="label">새 인증 코드 확인</label>
              <input
                id="new-confirm"
                type="password"
                autoComplete="new-password"
                maxLength={32}
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} type="button">취소</Button>
              <Button
                type="submit"
                variant="primary"
                loading={saving}
                disabled={!current.trim() || !next.trim() || !confirm.trim()}
              >
                코드 변경
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
