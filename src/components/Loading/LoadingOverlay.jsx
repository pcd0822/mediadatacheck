import Spinner from "./Spinner.jsx";

export default function LoadingOverlay({ message = "처리 중입니다...", show = true }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-white px-8 py-7 shadow-soft">
        <Spinner size={36} className="text-brand-600" />
        <p className="text-sm font-semibold text-slate-700">{message}</p>
      </div>
    </div>
  );
}
