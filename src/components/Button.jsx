import Spinner from "./Loading/Spinner.jsx";

const VARIANTS = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  accent: "btn-accent",
  ghost: "btn text-slate-600 hover:bg-slate-100",
  danger: "btn bg-rose-600 text-white hover:bg-rose-700 shadow-soft",
};

export default function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  className = "",
  type = "button",
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${VARIANTS[variant] ?? VARIANTS.primary} ${className}`}
      {...rest}
    >
      {loading && <Spinner size={14} className="text-current" />}
      <span>{children}</span>
    </button>
  );
}
