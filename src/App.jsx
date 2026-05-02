import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext.jsx";
import LoadingOverlay from "./components/Loading/LoadingOverlay.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import TeacherCodePage from "./pages/TeacherCodePage.jsx";
import TeacherDashboard from "./pages/teacher/TeacherDashboard.jsx";
import TeacherMediaUpload from "./pages/teacher/TeacherMediaUpload.jsx";
import TeacherEvaluation from "./pages/teacher/TeacherEvaluation.jsx";
import StudentDashboard from "./pages/student/StudentDashboard.jsx";
import ChecklistEditor from "./pages/student/ChecklistEditor.jsx";
import ModelingPage from "./pages/student/ModelingPage.jsx";
import FactCheckPage from "./pages/student/FactCheckPage.jsx";
import ResultPage from "./pages/student/ResultPage.jsx";

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
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/teacher-code" element={<TeacherCodePage />} />

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
        path="/teacher/evaluate/:mediaId"
        element={
          <ProtectedRoute role="teacher">
            <TeacherEvaluation />
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
      <Route
        path="/student/modeling"
        element={
          <ProtectedRoute role="student">
            <ModelingPage />
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
  );
}
