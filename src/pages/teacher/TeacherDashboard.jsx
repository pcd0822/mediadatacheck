import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Layout from "../../components/Layout.jsx";
import { SkeletonList } from "../../components/Loading/Skeleton.jsx";
import { deleteMediaItem, listTeacherMediaWithTeacherEvals } from "../../services/firestore.js";

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

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
        <Button variant="primary" onClick={() => navigate("/teacher/upload")}>
          + 새 미디어 자료 등록
        </Button>
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
    </Layout>
  );
}
