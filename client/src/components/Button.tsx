import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  loading?: boolean;
}

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const cls = [
    "btn",
    `btn--${variant}`,
    loading ? "btn--loading" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button {...rest} className={cls} disabled={disabled || loading} aria-busy={loading}>
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
