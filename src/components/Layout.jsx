import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import Button from "./Button.jsx";

export default function Layout({ title, subtitle, children, actions }) {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const initial =
    (profile?.displayName ?? user?.email ?? "?").trim().charAt(0).toUpperCase();
  const roleLabel = profile?.role === "teacher" ? "교사" : "학생";

  return (
    <div className="min-h-screen bg-page-gradient">
      <header className="glass-nav sticky top-0 z-40">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3.5">
          <Link
            to={profile?.role === "teacher" ? "/teacher" : "/student"}
            className="flex items-center gap-2.5"
          >
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-glow">
              <span
                className="material-symbols-outlined text-[20px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                verified
              </span>
            </div>
            <div className="leading-tight">
              <p className="text-sm font-extrabold tracking-tight text-brand-700">
                미디어 리터러시
              </p>
              <p className="text-[11px] text-ink-muted">팩트체크 학습 플랫폼</p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            {profile?.role && (
              <div className="hidden items-center gap-2.5 rounded-full border border-brand-100 bg-brand-50/60 px-3 py-1.5 sm:flex">
                <span className="text-xs font-semibold text-ink-variant">
                  {roleLabel} · {profile.displayName ?? user?.email}
                </span>
                <div className="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-white ring-2 ring-white">
                  {initial}
                </div>
              </div>
            )}
            <Button variant="secondary" onClick={handleSignOut}>
              <span
                className="material-symbols-outlined text-[18px]"
                aria-hidden
              >
                logout
              </span>
              로그아웃
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            {title && (
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="mt-1.5 text-sm text-ink-variant">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}
