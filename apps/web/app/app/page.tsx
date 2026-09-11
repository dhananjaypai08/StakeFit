"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Action } from "../../components/Action";
import { Breadcrumbs } from "../../components/Breadcrumbs";
import { PageHero } from "../../components/PageHero";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatActivityName, formatDistance, formatDuration, formatTinybars } from "../../lib/format";
import { PHOTOS } from "../../lib/photos";
import { useViewMode } from "../../lib/viewMode";

interface MarketCard {
  id: string;
  label: string;
  status: string;
  hidden: boolean;
  entryCount: number;
  potTinybars: number;
  startMs: number;
  endMs: number;
}

interface Distance {
  id: string;
  label: string;
}

interface Workout {
  id: string;
  displayName?: string;
  exerciseType: string;
  startMs: number;
  distanceMillimeters: number;
  activeDurationMs: number;
  caloriesKcal?: number;
  heartRateBpm?: number;
  steps?: number;
  qualifiedMarkets: Array<{ marketId: string; label: string; entered?: boolean; submitted?: boolean }>;
}

export default function AppPage() {
  const { user, refresh } = useAuth();
  const { view } = useViewMode();
  const isAdmin = view === "admin";
  const [markets, setMarkets] = useState<MarketCard[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [distances, setDistances] = useState<Distance[]>([]);
  const [distanceId, setDistanceId] = useState("50m");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;

  async function load() {
    const [list, catalog] = await Promise.all([
      api<{ markets: MarketCard[] }>("/markets"),
      api<{ distances: Distance[] }>("/catalog"),
    ]);
    setMarkets(list.markets);
    setDistances(catalog.distances);
    if (user) {
      const hist = await api<{ exercises: Workout[] }>("/me/exercises");
      setWorkouts(hist.exercises);
      setPage(0);
    }
  }

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        await load();
      } catch (err) {
        setError((err as Error).message);
      }
    })();
    const tick = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(tick);
  }, [user]);

  async function createHeat() {
    setCreating(true);
    setError("");
    try {
      await api("/markets", {
        method: "POST",
        body: JSON.stringify({
          distanceId,
          startMs: Date.now() - 16 * 24 * 60 * 60_000,
          endMs: Date.now() + 2 * 60 * 60_000,
          graceSec: 900,
          hidden: true,
          houseBps: 1000,
          entryTinybars: 10_000,
        }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function resolve(id: string) {
    setError("");
    try {
      await api(`/markets/${id}/resolve`, { method: "POST" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!user) return null;

  const listed = workouts.filter((row) => row.distanceMillimeters > 0);
  const last = listed[0];
  const week = listed.filter((row) => row.startMs >= Date.now() - 7 * 24 * 60 * 60_000);
  const weekMm = week.reduce((sum, row) => sum + row.distanceMillimeters, 0);
  const weekKcal = week.reduce((sum, row) => sum + (row.caloriesKcal ?? 0), 0);

  return (
    <main>
      <PageHero
        src={PHOTOS.hero}
        alt="Runner wearing a Fitbit"
        eyebrow={isAdmin ? "Admin" : "Today"}
        title={
          last
            ? `${formatActivityName(last.displayName, last.exerciseType)}. ${formatDistance(last.distanceMillimeters)}.`
            : isAdmin
              ? "Start a race"
              : "No Fitbit sessions yet"
        }
      >
        <p className="mt-4 max-w-xl text-base leading-7 text-white/90">
          {last
            ? `${new Date(last.startMs).toLocaleString()} · ${formatDuration(last.activeDurationMs)}${
                last.heartRateBpm ? ` · ${Math.round(last.heartRateBpm)} bpm` : ""
              }`
            : "Sync Fitbit after the Health app updates, then pay to enter a race."}
        </p>
        <div className="mt-6">
          <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Races" }]} />
        </div>
      </PageHero>

      {listed.length ? (
        <section className="page-x grid w-full gap-6 py-10 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">Distance · 7d</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{formatDistance(weekMm)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">Calories · 7d</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{weekKcal ? Math.round(weekKcal) : "0"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">Last HR</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {last?.heartRateBpm ? Math.round(last.heartRateBpm) : "0"}
            </p>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="page-x w-full text-sm text-red-200">{error}</p>
      ) : null}

      <section className="page-x w-full space-y-6 pb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">Open now</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Races</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-white/85">
              A race is one distance and a time window. Pay to enter. Your fastest qualifying Fitbit time is what we use.
            </p>
          </div>
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-lg border border-white/[0.1] bg-ink-900 px-3 text-sm"
                value={distanceId}
                onChange={(e) => setDistanceId(e.target.value)}
              >
                {distances.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
              <Action disabled={creating} onClick={() => void createHeat()}>
                {creating ? "Creating…" : "Start a race"}
              </Action>
            </div>
          ) : null}
        </div>

        {markets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.08] px-5 py-10 text-center text-sm text-zinc-500">
            {isAdmin
              ? "No race yet. Start one so the walks below can count."
              : "No race is open. Check back after one is started."}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {markets.map((market) => (
              <Link
                key={market.id}
                href={`/markets/${market.id}`}
                className="rounded-xl border border-white/[0.08] bg-ink-900 p-5 transition hover:border-white/[0.16]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{market.label}</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {market.status} · {market.hidden ? "hidden times" : "live board"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {new Date(market.startMs).toLocaleDateString()} to {new Date(market.endMs).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-zinc-300">
                    {market.entryCount} entered
                  </span>
                </div>
                <div className="mt-5 flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Pot {formatTinybars(market.potTinybars)}</span>
                  {isAdmin && market.status !== "resolved" ? (
                    <Action
                      tone="quiet"
                      onClick={(event) => {
                        event.preventDefault();
                        void resolve(market.id);
                      }}
                    >
                      Resolve
                    </Action>
                  ) : (
                    <span className="text-zinc-400">View race</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="page-x w-full pb-8">
        <div className="grid items-center gap-6 overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900 md:grid-cols-[minmax(0,16rem)_1fr]">
          <img
            src={PHOTOS.track}
            alt="Athlete in starting position on a running track"
            className="h-44 w-full bg-ink-900 object-cover md:h-full md:min-h-[12rem]"
          />
          <div className="px-5 py-5 md:pr-7">
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">The rule</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white md:text-2xl">
              What the Race column means
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/85">
              If a walk started during an open race and covered that distance, the race name appears. Empty means no
              matching race, or you have not started one yet.
            </p>
          </div>
        </div>
      </section>

      <section className="page-x w-full space-y-6 py-10">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">Fitbit</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Your Fitbit sessions</h2>
          </div>
          <Action
            tone="ghost"
            onClick={() =>
              void api("/me/sync", { method: "POST" })
                .then(() => refresh())
                .then(() => load())
                .catch((err) => setError(err.message))
            }
          >
            Refresh
          </Action>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/[0.08]">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Distance</th>
                <th className="px-4 py-2.5 font-medium">Calories</th>
                <th className="px-4 py-2.5 font-medium">HR</th>
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Race</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {listed.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-zinc-400">{new Date(row.startMs).toLocaleString()}</td>
                  <td className="px-4 py-3">{formatActivityName(row.displayName, row.exerciseType)}</td>
                  <td className="px-4 py-3 tabular-nums">{formatDistance(row.distanceMillimeters)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {row.caloriesKcal ? `${Math.round(row.caloriesKcal)}` : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {row.heartRateBpm ? Math.round(row.heartRateBpm) : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatDuration(row.activeDurationMs)}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {row.qualifiedMarkets.length ? (
                      <span className="flex flex-wrap gap-x-2 gap-y-1">
                        {row.qualifiedMarkets.map((market) => (
                          <Link
                            key={market.marketId}
                            className="text-zinc-200 underline-offset-2 hover:underline"
                            href={`/markets/${market.marketId}`}
                          >
                            {market.label}
                            {market.submitted ? " · submitted" : market.entered ? " · entered" : ""}
                          </Link>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3 text-sm text-zinc-500">
            <span>
              {listed.length === 0
                ? "No sessions with distance"
                : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, listed.length)} of ${listed.length}`}
            </span>
            <div className="flex gap-2">
              <Action tone="quiet" disabled={page === 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>
                Previous
              </Action>
              <Action
                tone="quiet"
                disabled={(page + 1) * PAGE_SIZE >= listed.length}
                onClick={() => setPage((n) => n + 1)}
              >
                Next
              </Action>
            </div>
          </div>
        </div>
      </section>
      <footer className="page-x w-full border-t border-white/[0.06] py-6 text-xs text-white/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>StakeFit</p>
          <p>Fitbit via Google Health API.</p>
        </div>
      </footer>
    </main>
  );
}
