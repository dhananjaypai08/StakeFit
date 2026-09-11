import type { ReactNode } from "react";

export function PageHero({
  src,
  alt,
  eyebrow,
  title,
  children,
  tall = false,
}: {
  src: string;
  alt: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
  tall?: boolean;
}) {
  return (
    <section className={`relative w-full overflow-hidden bg-ink-950 ${tall ? "h-[70vh] max-h-[36rem]" : "h-[52vh] max-h-[24rem]"} min-h-[18rem]`}>
      <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/50 to-black/15" />
      <div className="page-x relative flex h-full flex-col justify-end pb-8 pt-24">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/90">{eyebrow}</p>
        <h1 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight text-white md:text-5xl">{title}</h1>
        {children}
      </div>
    </section>
  );
}
