import type { ReactNode } from "react";
import { Action } from "./Action";

export interface GuideStep {
  title: string;
  body: string;
  state: "done" | "active" | "locked";
  action?: { label: string; busy?: boolean; onClick: () => void };
  extra?: ReactNode;
}

export function RaceGuide({ steps }: { steps: GuideStep[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => {
        const n = String(index + 1).padStart(2, "0");
        const locked = step.state === "locked";
        const done = step.state === "done";
        const active = step.state === "active";
        return (
          <li
            key={step.title}
            className={`rounded-xl border px-4 py-4 ${
              active ? "border-white/25 bg-ink-900" : "border-white/[0.08] bg-ink-900/70"
            } ${locked ? "opacity-45" : ""}`}
          >
            <p className="text-xs text-white/55">
              {n}
              {done ? " · done" : active ? " · now" : " · next"}
            </p>
            <h2 className="mt-1.5 text-base font-medium text-white">{step.title}</h2>
            <p className="mt-1.5 text-sm leading-6 text-white/80">{step.body}</p>
            {step.extra}
            {step.action && active ? (
              <div className="mt-4">
                <Action disabled={step.action.busy} onClick={step.action.onClick}>
                  {step.action.busy ? "Working…" : step.action.label}
                </Action>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
