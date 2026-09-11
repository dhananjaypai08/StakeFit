"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { connectWallet, encodeXPaymentHeader, signScanPayment, type InvoiceRequirements } from "../../../lib/hederaWallet";

interface View {
  id: string;
  label: string;
  status: string;
  hidden: boolean;
  entryTinybars: number;
  potTinybars: number;
  results: Array<{ userId: string; timeMs?: number; hidden?: boolean }>;
  winners?: Array<{ userId: string; timeMs: number; rank: number; hederaAccount: string }>;
}

export default function MarketPage() {
  const { user, refresh } = useAuth();
  const params = useParams<{ id: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const body = await api<View>(`/markets/${params.id}`);
    setView(body);
  }

  useEffect(() => {
    if (!user) return;
    void load().catch((err) => setError(err.message));
  }, [params.id, user]);

  async function enter() {
    setBusy("enter");
    setError("");
    try {
      const hederaAccount = user?.hederaAccount || (await connectWallet());
      await api("/me/hedera", { method: "POST", body: JSON.stringify({ accountId: hederaAccount }) });
      try {
        await api(`/markets/${params.id}/enter`, { method: "POST", body: JSON.stringify({ hederaAccount }) });
      } catch (err) {
        const status = (err as Error & { status?: number; body?: { accepts?: InvoiceRequirements[] } }).status;
        const accepts = (err as Error & { body?: { accepts?: InvoiceRequirements[] } }).body?.accepts;
        if (status !== 402 || !accepts?.[0]) throw err;
        const signed = await signScanPayment(accepts[0], hederaAccount);
        await api(`/markets/${params.id}/enter`, {
          method: "POST",
          headers: { "X-PAYMENT": encodeXPaymentHeader(accepts[0], signed) },
          body: JSON.stringify({ hederaAccount }),
        });
      }
      await refresh();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function syncWorkout() {
    setBusy("sync");
    setError("");
    try {
      await api("/me/sync", { method: "POST" });
      await refresh();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function mint() {
    setBusy("mint");
    setError("");
    try {
      await api(`/markets/${params.id}/world`, { method: "POST", body: JSON.stringify({}) });
      await api(`/markets/${params.id}/certificate`, { method: "POST" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (!user) return null;
  if (!view) return <main className="card">{error || "Loading…"}</main>;

  return (
    <main className="stack">
      <p className="muted">
        <Link href="/">All heats</Link>
      </p>
      <section className="card">
        <h2>{view.label}</h2>
        <p className="muted">
          {view.status} · {view.hidden ? "times hidden until resolve" : "live board"} · entry {view.entryTinybars} tinybar
          · pot {view.potTinybars} tinybar
        </p>
        <p className="muted">1. Enter with HashPack · 2. Walk, sync the phone, then Sync workout · 3. Mint run ID</p>
        <div className="row">
          <button className="btn primary" type="button" disabled={Boolean(busy)} onClick={() => void enter()}>
            {busy === "enter" ? "Paying…" : "1. Enter with HashPack"}
          </button>
          <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void syncWorkout()}>
            {busy === "sync" ? "Syncing…" : "2. Sync workout"}
          </button>
          <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void mint()}>
            {busy === "mint" ? "Minting…" : "3. Mint run ID"}
          </button>
        </div>
        {error ? <p className="callout">{error}</p> : null}
        <h3>Board</h3>
        {view.results.length === 0 ? <p className="muted">No times yet.</p> : null}
        <table className="table">
          <thead>
            <tr>
              <th>Runner</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {view.results.map((row) => (
              <tr key={row.userId}>
                <td>{row.userId === user.id ? "You" : row.userId.slice(0, 10)}</td>
                <td>{row.hidden ? "hidden" : row.timeMs != null ? `${(row.timeMs / 1000).toFixed(1)}s` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {view.winners?.length ? (
          <p>Top 3: {view.winners.map((w) => `#${w.rank} ${(w.timeMs / 1000).toFixed(1)}s`).join(" · ")}</p>
        ) : null}
      </section>
    </main>
  );
}
