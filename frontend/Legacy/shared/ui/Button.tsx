import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  tone?: "primary" | "quiet" | "danger";
}

export function Button({ icon, tone = "quiet", className = "", children, ...props }: ButtonProps) {
  return (
    <button className={`button button--${tone} ${className}`} {...props}>
      {icon ? <span className="button__icon">{icon}</span> : null}
      {children}
    </button>
  );
}
