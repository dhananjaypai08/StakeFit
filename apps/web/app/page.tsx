import Link from "next/link";
import { HERO_FOCUS, PHOTOS } from "../lib/photos";

const STEPS = [
  {
    n: "01",
    title: "Connect Fitbit",
    body: "Sign in with Google. We read the sessions already on your phone.",
  },
  {
    n: "02",
    title: "Pay to enter",
    body: "Pick today’s distance and pay the pot from HashPack.",
  },
  {
    n: "03",
    title: "Fastest pace wins",
    body: "We score that distance at your session pace. Top three split the pot 50 / 30 / 20.",
  },
];

export default function HomePage() {
  return (
    <div className="w-full">
      <section className="relative w-full overflow-hidden">
        <div className="relative h-[72vh] min-h-[24rem] w-full max-h-[42rem]">
          <img
            src={PHOTOS.hero}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: HERO_FOCUS }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-transparent" />
          <div className="page-x relative flex h-full flex-col justify-end pb-10 pt-8">
            <div className="max-w-md">
              <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-white md:text-6xl">
                Race a distance.
                <br />
                Win the pot.
              </h1>
              <p className="mt-4 text-base text-white/90">
                Daily Fitbit races. Pay in HBAR. Fastest pace wins.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link className="action action-primary h-11 px-5" href="/app">
                  See today’s races
                </Link>
                <a className="action action-quiet h-11 px-5" href="#how">
                  How it works
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="page-x w-full py-12 md:py-14">
        <p className="text-xs uppercase tracking-[0.16em] text-white/70">How it works</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
          Connect. Pay. Race.
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
            alt=""
            className="h-56 w-full object-cover object-[center_42%] md:h-full"
          />
          <div className="flex flex-col justify-center px-5 py-6 sm:px-8">
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">What counts</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white md:text-2xl">
              Started today. Covered the distance.
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/85">
              Session pace over the race distance. Other times stay hidden until resolve.
            </p>
          </div>
        </div>
      </section>

      <footer className="page-x w-full border-t border-white/[0.06] py-6 text-xs text-white/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>StakeFit</p>
          <p>Daily Fitbit races on Hedera.</p>
        </div>
      </footer>
    </div>
  );
}
