import Link from "next/link";
import { PHOTOS } from "../lib/photos";

const STEPS = [
  {
    n: "01",
    title: "Sign in with Google",
    body: "Connects Google Health. Fitbit must sync to your phone first. We do not read the watch live.",
  },
  {
    n: "02",
    title: "Pay to enter",
    body: "Pick an open race and pay from HashPack. Until you pay, a qualifying walk cannot place.",
  },
  {
    n: "03",
    title: "Sync, then get paid",
    body: "Lowest Fitbit time in the window that covered the distance. We keep 10%. Top three split the rest 50 / 30 / 20.",
  },
];

export default function HomePage() {
  return (
    <div className="w-full">
      <section className="relative w-full overflow-hidden">
        <div className="relative h-[70vh] min-h-[22rem] w-full max-h-[36rem]">
          <img
            src={PHOTOS.hero}
            alt="Athlete in starting position on a running track"
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/45 to-black/10" />
          <div className="page-x relative flex h-full flex-col justify-end pb-10 pt-8">
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-white md:text-6xl">
              Race a set distance.
              <br />
              Fastest time wins the pot.
            </h1>
            <p className="mt-4 text-base text-white/90">
              Pay to enter. We time the walk or run you already logged on Fitbit.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link className="action action-primary h-11 px-5" href="/app">
                See races
              </Link>
              <a className="action action-quiet h-11 px-5" href="#how">
                How it works
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="page-x w-full py-12 md:py-14">
        <p className="text-xs uppercase tracking-[0.16em] text-white/70">How it works</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
          Connect Fitbit. Pay. We use the time you already recorded.
        </h2>
        <ol className="mt-8 grid w-full gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.n} className="rounded-xl border border-white/[0.08] bg-ink-900 px-4 py-4">
              <p className="text-xs text-white/60">{step.n}</p>
              <h3 className="mt-1.5 text-base font-medium text-white">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-white/85">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 grid w-full items-stretch overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900 md:grid-cols-2">
          <img
            src={PHOTOS.fitbit}
            alt="Athlete checking a Fitbit"
            className="h-56 w-full object-cover object-[center_42%] md:h-full"
          />
          <div className="flex flex-col justify-center px-5 py-6 sm:px-8">
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">What counts</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white md:text-2xl">
              Start in the race window. Cover the distance.
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/85">
              Bike or gym with no GPS distance cannot place. Times stay hidden until payout.
            </p>
          </div>
        </div>
      </section>

      <footer className="page-x w-full border-t border-white/[0.06] py-6 text-xs text-white/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>StakeFit</p>
          <p>Fitbit via Google Health API.</p>
        </div>
      </footer>
    </div>
  );
}
