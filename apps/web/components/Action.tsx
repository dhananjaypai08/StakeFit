import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tone = "primary" | "quiet" | "ghost";

const tones: Record<Tone, string> = {
  primary: "action action-primary",
  quiet: "action action-quiet",
  ghost: "action action-ghost",
};

export function Action({
  tone = "primary",
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; children: ReactNode }) {
  return (
    <button className={`${tones[tone]} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
