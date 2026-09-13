import type { ReactNode } from "react";
import { HERO_FOCUS } from "../lib/photos";

export function PageHero({
  src,
  alt,
  eyebrow,
  title,
  children,
  tall = false,
  focus = HERO_FOCUS,
}: {
  src: string;
  alt: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
  tall?: boolean;
  /** CSS object-position so the subject stays in the crop. */
  focus?: string;
}) {
  return (
    <section
      className={`relative w-full overflow-hidden bg-ink-950 ${
        tall ? "h-[64vh] max-h-[34rem] min-h-[20rem]" : "min-h-[20rem] py-12 md:min-h-[22rem] md:py-14"
      }`}
    >
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: focus }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/25 to-transparent" />
      <div className={`page-x relative flex flex-col justify-end ${tall ? "h-full pb-10 pt-8" : ""}`}>
        <div className="max-w-lg">
        {eyebrow ? <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/90">{eyebrow}</p> : null}
        <h1 className={`${eyebrow ? "mt-3" : ""} text-4xl font-semibold leading-[1.1] tracking-tight text-white md:text-5xl`}>{title}</h1>
        {children}
        </div>
      </div>
    </section>
  );
}
