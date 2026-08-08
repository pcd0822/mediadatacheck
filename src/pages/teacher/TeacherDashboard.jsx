import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import {
  backfillLegacyMediaItems,
  deleteMediaItem,
  getTeacherAuthConfig,
  listMediaItemsByUploader,
  mediaImageUrl,
  updateTeacherAuthCode,
} from "../../services/firestore.js";
import { invalidate } from "../../utils/dataCache.js";
import { makeCodeRecord, verifyCode } from "../../utils/teacherCode.js";

const MIN_CODE_LEN = 4;

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [migratedCount, setMigratedCount] = useState(0);

  const refresh = async () => {
    if (!user?.uid) return;
    setLoading(true);
    let list = await listMediaItemsByUploader(user.uid);

    // v4.0 이전 문서에는 registeredBy/isRequired가 없다. 학생 화면은
    // registeredBy로 좁힌 쿼리를 쓰므로, 여기서 한 번 채워야 목록에 다시 나타난다.
    // 이미 채워진 문서는 건드리지 않으므로 재진입해도 쓰기가 발생하지 않는다.
    const migrated = await backfillLegacyMediaItems(list).catch((e) => {
      console.error("레거시 미디어 메타 보정 실패", e);
      return 0;
    });
    if (migrated > 0) {
      setMigratedCount(migrated);
      list = await listMediaItemsByUploader(user.uid);
      invalidate("media");
    }

    setItems(list);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const handleDelete = async (mediaId) => {
    if (!confirm("이 미디어 자료를 삭제하시겠습니까? 학생들의 자료 목록에서도 사라집니다.")) return;
    setDeletingId(mediaId);
    try {
      await deleteMediaItem(mediaId);
      invalidate("media");
      await refresh();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Layout
      title="교사 대시보드"
      subtitle="학급 전체가 팩트체크에 사용할 공통 미디어 자료를 관리합니다"
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate("/teacher/progress")}>
            수업 진행 현황
          </Button>
          <Button variant="secondary" onClick={() => setShowCodeModal(true)}>
            인증 코드 변경
          </Button>
          <Button variant="primary" onClick={() => navigate("/teacher/upload")}>
            + 새 미디어 자료 등록
          </Button>
        </>
      }
    >
      <div className="mb-6 rounded-2xl border border-brand-100 bg-brand-50/50 px-5 py-4 text-sm leading-6 text-ink-variant">
        <p className="font-semibold text-brand-800">교사 자료의 역할 (VAPM v5.0)</p>
        <p className="mt-1 text-[13px]">
          선생님이 등록한 자료는 <strong>모든 모둠이 열람·평가할 수 있는 공통 필수 자료</strong>입니다.
          학생 점수는 각 모둠이 직접 만든 체크리스트만으로 산출되며,{" "}
          <strong>교사 채점이 학생 점수에 반영되는 경로는 없습니다.</strong> 모둠이 직접 등록한
          자료는 그 모둠만 볼 수 있어 여기 목록에는 나오지 않습니다.
        </p>
      </div>

      {migratedCount > 0 && (
        <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          이전 버전에서 등록된 자료 {migratedCount}건에 v5.0 등록 정보를 채웠어요. 학생 화면에 정상 표시됩니다.
        </p>
      )}

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
            const img = mediaImageUrl(m);
            return (
              <div key={m.id} className="card flex flex-col gap-4 sm:flex-row sm:items-start">
                {img ? (
                  <img
                    src={img}
                    alt=""
                    className="w-full rounded-xl object-contain ring-1 ring-slate-100 sm:w-72"
                    style={{ maxHeight: "1080px" }}
                  />
                ) : (
                  <div className="grid h-44 w-full place-items-center rounded-xl bg-slate-100 text-slate-400 sm:w-72">
                    이미지 없음
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{m.title}</h3>
                    <span className="badge bg-emerald-50 text-emerald-700">공통 필수</span>
                  </div>
                  {m.subtitle && (
                    <p className="mt-0.5 text-sm text-slate-500">{m.subtitle}</p>
                  )}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
                    {m.publisher && <span>언론사: {m.publisher}</span>}
                    {m.publishedAt && <span>작성일: {m.publishedAt}</span>}
                  </p>
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
                    <Link to={`/teacher/edit/${m.id}`} className="btn-secondary">
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
