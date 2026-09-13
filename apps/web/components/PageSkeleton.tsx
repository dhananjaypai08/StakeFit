export function PageSkeleton({ label = "Opening the race" }: { label?: string }) {
  return (
    <main>
      <section className="relative min-h-[18rem] w-full overflow-hidden bg-ink-950">
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-900 to-ink-950" />
        <div className="page-x relative flex min-h-[22rem] flex-col justify-end pb-10 pt-24">
          <div className="skel h-3 w-24" />
          <div className="skel mt-4 h-12 w-56" />
          <p className="mt-4 text-sm text-white/55">{label}</p>
        </div>
      </section>
      <section className="page-x grid w-full gap-3 py-10 md:grid-cols-2">
        <div className="h-36 rounded-xl border border-white/[0.08] bg-ink-900" />
        <div className="h-36 rounded-xl border border-white/[0.08] bg-ink-900" />
      </section>
    </main>
  );
}
