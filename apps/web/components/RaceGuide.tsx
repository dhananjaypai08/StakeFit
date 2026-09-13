import type { ReactNode } from "react";
import { Action } from "./Action";

export interface GuideStep {
  title: string;
  body?: string;
  state: "done" | "active" | "locked";
  /** `busyLabel` names the stage in flight so the runner knows something is happening. */
  action?: { label: string; busy?: boolean; busyLabel?: string; onClick: () => void };
  /** Shown inside the step, next to the button that failed. */
  error?: string;
  extra?: ReactNode;
}

export function RaceGuide({ steps }: { steps: GuideStep[] }) {
  const activeIndex = steps.findIndex((step) => step.state === "active");
  const lastDone = [...steps].map((step) => step.state).lastIndexOf("done");
  const current = activeIndex >= 0 ? activeIndex : Math.max(0, lastDone);

  return (
    <ol className="flex h-full flex-col gap-2">
      {steps.map((step, index) => {
        if (index > current) return null;
        const done = step.state === "done";
        const active = step.state === "active";
        if (done && index !== current) {
          return (
            <li key={step.title} className="flex items-center gap-2 text-sm text-white/50">
              <span className="text-lime-300">✓</span>
              <span>{step.title}</span>
            </li>
          );
        }
        return (
          <li
            key={step.title}
            className={`flex flex-1 flex-col justify-center rounded-xl border px-4 py-4 ${
              active ? "border-white/20 bg-ink-900" : "border-white/[0.08] bg-ink-900/70"
            }`}
          >
            <h2 className="text-base font-medium text-white">{step.title}</h2>
            {step.body ? <p className="mt-1 text-sm leading-6 text-white/70">{step.body}</p> : null}
            {step.extra}
            {step.action && active ? (
              <div className="mt-3">
                <Action
                  className="h-10 gap-2 px-4"
                  aria-busy={step.action.busy ? true : undefined}
                  disabled={step.action.busy}
                  onClick={step.action.onClick}
                >
                  {step.action.busy ? (
                    <>
                      <span className="spinner" aria-hidden />
                      {step.action.busyLabel || "Working"}…
                    </>
                  ) : (
                    step.action.label
                  )}
                </Action>
              </div>
            ) : null}
            {step.error && !step.action?.busy ? (
              <p className="mt-3 rounded-lg border border-red-400/25 bg-red-400/[0.07] px-3 py-2 text-sm leading-6 text-red-100">
                {step.error}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
