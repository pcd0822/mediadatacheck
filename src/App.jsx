import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext.jsx";
import { WorkspaceProvider } from "./contexts/WorkspaceContext.jsx";
import LoadingOverlay from "./components/Loading/LoadingOverlay.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import TeacherCodePage from "./pages/TeacherCodePage.jsx";
import TeacherDashboard from "./pages/teacher/TeacherDashboard.jsx";
import TeacherMediaUpload from "./pages/teacher/TeacherMediaUpload.jsx";
import TeacherProgress from "./pages/teacher/TeacherProgress.jsx";
import TeacherClassStats from "./pages/teacher/TeacherClassStats.jsx";
import StudentDashboard from "./pages/student/StudentDashboard.jsx";
import ChecklistEditor from "./pages/student/ChecklistEditor.jsx";
import GroupMediaUpload from "./pages/student/GroupMediaUpload.jsx";
import FactCheckPage from "./pages/student/FactCheckPage.jsx";
import Stage1Assign from "./pages/student/Stage1Assign.jsx";
import Stage2Media from "./pages/student/Stage2Media.jsx";
import Stage3Blind from "./pages/student/Stage3Blind.jsx";
import Stage4Reveal from "./pages/student/Stage4Reveal.jsx";
import Stage4Dashboard from "./pages/student/Stage4Dashboard.jsx";
import ResultPage from "./pages/student/ResultPage.jsx";
import JoinGroupPage from "./pages/student/JoinGroupPage.jsx";

function ProtectedRoute({ role, children }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingOverlay message="사용자 확인 중..." />;
  if (!user) return <Navigate to="/" replace />;
  if (role && profile?.role !== role) {
    return <Navigate to={profile?.role === "teacher" ? "/teacher" : "/student"} replace />;
  }
  return children;
}

export default function App() {
  return (
    <WorkspaceProvider>
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/teacher-code" element={<TeacherCodePage />} />

      {/* 공유 링크 진입점 — 로그인 여부와 무관하게 페이지에서 처리 */}
      <Route path="/student/join/:code" element={<JoinGroupPage />} />

      <Route
        path="/teacher"
        element={
          <ProtectedRoute role="teacher">
            <TeacherDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/upload"
        element={
          <ProtectedRoute role="teacher">
            <TeacherMediaUpload />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/edit/:mediaId"
        element={
          <ProtectedRoute role="teacher">
            <TeacherMediaUpload />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/progress"
        element={
          <ProtectedRoute role="teacher">
            <TeacherProgress />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/class-stats"
        element={
          <ProtectedRoute role="teacher">
            <TeacherClassStats />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student"
        element={
          <ProtectedRoute role="student">
            <StudentDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/checklist"
        element={
          <ProtectedRoute role="student">
            <ChecklistEditor />
          </ProtectedRoute>
        }
      />
      {/* ===== 수업 활동 (순차 게이트, 모둠 작업실 전용) ===== */}
      <Route
        path="/student/lesson/assign"
        element={
          <ProtectedRoute role="student">
            <Stage1Assign />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/lesson/media"
        element={
          <ProtectedRoute role="student">
            <Stage2Media />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/lesson/blind"
        element={
          <ProtectedRoute role="student">
            <Stage3Blind />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/lesson/reveal"
        element={
          <ProtectedRoute role="student">
            <Stage4Reveal />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/lesson/dashboard"
        element={
          <ProtectedRoute role="student">
            <Stage4Dashboard />
          </ProtectedRoute>
        }
      />

      {/* 모둠 자료 등록·수정 (조장 전용 — 페이지 내부에서 leaderUid로 게이트) */}
      <Route
        path="/student/group-media"
        element={
          <ProtectedRoute role="student">
            <GroupMediaUpload />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/group-media/:mediaId"
        element={
          <ProtectedRoute role="student">
            <GroupMediaUpload />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/factcheck"
        element={
          <ProtectedRoute role="student">
            <FactCheckPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/result/:historyId"
        element={
          <ProtectedRoute role="student">
            <ResultPage />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </WorkspaceProvider>
  );
}
