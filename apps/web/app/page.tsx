"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

interface MarketCard {
  id: string;
  label: string;
  distanceId: string;
  status: string;
  hidden: boolean;
  entryCount: number;
  potTinybars: number;
  entryTinybars: number;
  startMs: number;
  endMs: number;
}

interface Distance {
  id: string;
  label: string;
}

interface Workout {
  id: string;
  exerciseType: string;
  startMs: number;
  distanceMillimeters: number;
  activeDurationMs: number;
  qualifiedMarkets: Array<{ marketId: string; label: string }>;
}

export default function HomePage() {
  const { user, refresh } = useAuth();
  const [markets, setMarkets] = useState<MarketCard[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [distances, setDistances] = useState<Distance[]>([]);
  const [distanceId, setDistanceId] = useState("50m");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

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
    }
  }

  useEffect(() => {
    if (!user) return;
    void load().catch((err) => setError(err.message));
  }, [user]);

  async function createHeat() {
    setCreating(true);
    setError("");
    try {
      await api("/markets", {
        method: "POST",
        body: JSON.stringify({
          distanceId,
          startMs: Date.now(),
          endMs: Date.now() + 60 * 60_000,
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

  const nextStep = !user.lastSyncTime
    ? "Walk 50m, open the Fitbit or Google Health app, then hit Sync Fitbit up top."
    : markets.length === 0
      ? user.admin
        ? "Create a 50m heat, then open it and enter with HashPack."
        : "Ask an admin to open a heat, then enter with HashPack."
      : "Open a heat, pay to enter, then Sync Fitbit after the phone uploads.";

  return (
    <main className="stack">
      <section className="banner">
        <div>
          <h2>What to do</h2>
          <p>{nextStep}</p>
          <p className="meta">
            {user.deviceVersion ?? "No device yet"}
            {user.lastSyncTime ? ` · last sync ${new Date(user.lastSyncTime).toLocaleString()}` : ""}
          </p>
        </div>
      </section>

      {error ? <p className="callout">{error}</p> : null}

      <section className="card">
        <div className="row spread">
          <h2>Heats</h2>
          {user.admin ? (
            <div className="row">
              <select value={distanceId} onChange={(e) => setDistanceId(e.target.value)}>
                {distances.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
              <button className="btn primary" type="button" disabled={creating} onClick={() => void createHeat()}>
                {creating ? "Creating…" : "Create heat"}
              </button>
            </div>
          ) : null}
        </div>
        {markets.length === 0 ? <p className="muted">No heats yet.</p> : null}
        <table className="table">
          <thead>
            <tr>
              <th>Heat</th>
              <th>Status</th>
              <th>Entries</th>
              <th>Pot</th>
              {user.admin ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {markets.map((market) => (
              <tr key={market.id}>
                <td>
                  <Link href={`/markets/${market.id}`}>{market.label}</Link>
                </td>
                <td>{market.status}</td>
                <td>{market.entryCount}</td>
                <td>{market.potTinybars} tinybar</td>
                {user.admin ? (
                  <td>
                    {market.status !== "resolved" ? (
                      <button className="btn" type="button" onClick={() => void resolve(market.id)}>
                        Resolve
                      </button>
                    ) : (
                      "resolved"
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="row spread">
          <h2>Your workouts</h2>
          <button
            className="btn"
            type="button"
            onClick={() =>
              void api("/me/sync", { method: "POST" })
                .then(() => refresh())
                .then(() => load())
                .catch((err) => setError(err.message))
            }
          >
            Sync again
          </button>
        </div>
        {workouts.length === 0 ? (
          <p className="muted">Nothing from Google Health yet. Sync the phone first, then Sync Fitbit.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Distance</th>
                <th>Time</th>
                <th>Heat</th>
              </tr>
            </thead>
            <tbody>
              {workouts.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.startMs).toLocaleString()}</td>
                  <td>{row.exerciseType}</td>
                  <td>{(row.distanceMillimeters / 1000).toFixed(1)} m</td>
                  <td>{(row.activeDurationMs / 1000).toFixed(1)}s</td>
                  <td>{row.qualifiedMarkets.map((m) => m.label).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
