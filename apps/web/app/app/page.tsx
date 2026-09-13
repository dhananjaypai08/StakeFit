"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Action } from "../../components/Action";
import { Breadcrumbs } from "../../components/Breadcrumbs";
import { PageHero } from "../../components/PageHero";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatActivityName, formatDistance, formatDuration, formatTinybars } from "../../lib/format";
import { localDayBounds } from "@stakefit/shared";
import { PHOTOS } from "../../lib/photos";
import { PartnerStrip } from "../../components/PartnerStrip";
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
  const [fetching, setFetching] = useState(true);
  const [sessionsReady, setSessionsReady] = useState(false);
  const [lastSync, setLastSync] = useState(user?.lastSyncTime);
  const [graphIntel, setGraphIntel] = useState("");
  const [graphSource, setGraphSource] = useState("");
  const [partners, setPartners] = useState<Parameters<typeof PartnerStrip>[0]["partners"]>();
  const [raceTab, setRaceTab] = useState<"open" | "resolved">("open");
  const PAGE_SIZE = 8;

  async function loadMarkets() {
    const [list, catalog] = await Promise.all([
      api<{
        markets: MarketCard[];
        graph?: { source?: string; intel?: string };
        partners?: Parameters<typeof PartnerStrip>[0]["partners"];
      }>("/markets"),
      api<{ distances: Distance[] }>("/catalog"),
    ]);
    setMarkets(list.markets);
    setDistances(catalog.distances);
    if (list.graph?.intel) setGraphIntel(list.graph.intel);
    if (list.graph?.source) setGraphSource(list.graph.source);
    if (list.partners) setPartners(list.partners);
  }

  async function loadSessions(opts?: { sync?: boolean; quiet?: boolean; resetPage?: boolean }) {
    if (!user) return;
    if (!opts?.quiet) setFetching(true);
    try {
      if (opts?.sync) {
        const synced = await api<{ exercises?: Workout[]; lastSyncTime?: string }>("/me/sync", { method: "POST" });
        if (synced.exercises) {
          setWorkouts(synced.exercises);
          if (synced.lastSyncTime) setLastSync(synced.lastSyncTime);
          if (opts.resetPage) setPage(0);
          return;
        }
      }
      const hist = await api<{ exercises: Workout[]; lastSyncTime?: string }>("/me/exercises");
      setWorkouts(hist.exercises);
      if (hist.lastSyncTime) setLastSync(hist.lastSyncTime);
      if (opts?.resetPage) setPage(0);
    } finally {
      setFetching(false);
      setSessionsReady(true);
    }
  }

  async function load(opts?: { sync?: boolean; quiet?: boolean; resetPage?: boolean }) {
    await Promise.all([loadMarkets(), loadSessions(opts)]);
  }

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        await load({ sync: true, resetPage: true });
      } catch (err) {
        setError((err as Error).message);
        setFetching(false);
        setSessionsReady(true);
      }
    })();
    const tick = window.setInterval(() => {
      void load({ sync: true, quiet: true }).catch(() => undefined);
    }, 20_000);
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
          ...localDayBounds(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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

  if (!user?.connected) return null;

  const listed = [...workouts].sort((a, b) => {
    const score = (row: Workout) =>
      row.qualifiedMarkets.some((market) => market.submitted) ? 2 : row.qualifiedMarkets.some((market) => market.entered) ? 1 : 0;
    return score(b) - score(a) || b.startMs - a.startMs;
  });
  const last = workouts[0];
  const week = workouts.filter((row) => row.startMs >= Date.now() - 7 * 24 * 60 * 60_000);
  const weekMm = week.reduce((sum, row) => sum + row.distanceMillimeters, 0);
  const weekKcal = week.reduce((sum, row) => sum + (row.caloriesKcal ?? 0), 0);

  return (
    <main>
      <PageHero
        src={PHOTOS.hero}
        alt="Runner wearing a Fitbit"
        eyebrow={isAdmin ? "Admin" : "Today"}
        title={
          !sessionsReady || (fetching && !last)
            ? "Fetching Fitbit…"
            : last
              ? `${formatActivityName(last.displayName, last.exerciseType)}. ${formatDistance(last.distanceMillimeters)}.`
              : isAdmin
                ? "Start a race"
                : "No Fitbit sessions yet"
        }
      >
        <p className="mt-4 max-w-xl text-base leading-7 text-white/90">
          {!sessionsReady || (fetching && !last)
            ? "Pulling live walks and runs from Google Health."
            : last
              ? `${new Date(last.startMs).toLocaleString()} · ${formatDuration(last.activeDurationMs)}${
                  last.heartRateBpm ? ` · ${Math.round(last.heartRateBpm)} bpm` : ""
                }`
              : "After the phone syncs, we pull Fitbit on our own."}
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

      <PartnerStrip partners={partners} graphIntel={graphIntel} graphSource={graphSource} />

      <section className="page-x w-full space-y-6 pb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">Daily</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Races</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-white/85">
              One distance for the day. Fastest Fitbit time that started today and covered that distance. Resolved
              races live on their own tab.
            </p>
            <div className="mt-4 flex gap-2">
              {(["open", "resolved"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`h-8 rounded-lg px-3 text-sm ${
                    raceTab === tab ? "bg-white text-ink-950" : "border border-white/[0.1] text-zinc-400"
                  }`}
                  onClick={() => setRaceTab(tab)}
                >
                  {tab === "open" ? "Open" : "Resolved"}
                </button>
              ))}
            </div>
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

        {markets.filter((market) => (raceTab === "resolved" ? market.status === "resolved" : market.status !== "resolved")).length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.08] px-5 py-10 text-center text-sm text-zinc-500">
            {raceTab === "resolved"
              ? "No resolved race yet."
              : isAdmin
                ? "No open race. Start one so today’s walks can count."
                : "No race is open. Check back after one is started."}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {markets
              .filter((market) => (raceTab === "resolved" ? market.status === "resolved" : market.status !== "resolved"))
              .map((market) => (
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
                      {new Date(market.startMs).toLocaleDateString()}
                      {new Date(market.startMs).toLocaleDateString() !== new Date(market.endMs).toLocaleDateString()
                        ? ` to ${new Date(market.endMs).toLocaleDateString()}`
                        : " · fastest time that started today"}
                    </p>
                  </div>
                  <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-zinc-300">
                    {market.entryCount} entered
                  </span>
                </div>
                <div className="mt-5 flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Pot {formatTinybars(market.potTinybars)}</span>
                  {user.admin && market.status !== "resolved" ? (
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
              The race name appears only if the session started today and covered the race distance. A dash means it
              was another day, or no race is open today.
            </p>
          </div>
        </div>
      </section>

      <section className="page-x w-full space-y-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">Fitbit</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Your Fitbit sessions</h2>
            <p className="mt-2 flex items-center gap-2 text-sm text-white/70">
              {fetching ? <span className="live-dot" aria-hidden /> : null}
              {fetching
                ? "Fetching live sessions from Google Health…"
                : lastSync
                  ? `Live from Fitbit · updated ${new Date(lastSync).toLocaleTimeString()}`
                  : "Live from Fitbit"}
            </p>
          </div>
          <Action
            tone="ghost"
            disabled={fetching}
            onClick={() =>
              void load({ sync: true, resetPage: true })
                .then(() => refresh())
                .catch((err) => setError(err.message))
            }
          >
            {fetching ? "Fetching…" : "Refresh"}
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
              {fetching && listed.length === 0
                ? [0, 1, 2, 3, 4].map((row) => (
                    <tr key={`skel-${row}`}>
                      {Array.from({ length: 7 }).map((_, cell) => (
                        <td key={cell} className="px-4 py-3.5">
                          <div className="skel" style={{ width: cell === 0 ? "68%" : cell === 1 ? "52%" : "40%" }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : listed.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map((row) => {
                  const counting = row.qualifiedMarkets.find((market) => market.submitted);
                  const entered = row.qualifiedMarkets.find((market) => market.entered);
                  return (
                <tr
                  key={row.id}
                  className={counting ? "bg-white/[0.07]" : entered ? "bg-white/[0.03]" : undefined}
                >
                  <td className="px-4 py-3 text-zinc-400">{new Date(row.startMs).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className="flex flex-col gap-1">
                      <span>{formatActivityName(row.displayName, row.exerciseType)}</span>
                      {counting ? (
                        <span className="w-fit rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-ink-950">
                          On the {counting.label}
                        </span>
                      ) : null}
                    </span>
                  </td>
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
                            className={`underline-offset-2 hover:underline ${
                              market.submitted ? "font-medium text-white" : "text-zinc-200"
                            }`}
                            href={`/markets/${market.marketId}`}
                          >
                            {market.label}
                            {market.submitted ? " · counting" : market.entered ? " · entered" : ""}
                          </Link>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                  );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3 text-sm text-zinc-500">
            <span>
              {fetching && listed.length === 0
                ? "Fetching live Fitbit…"
                : listed.length === 0
                  ? "No sessions from Google Health yet"
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
