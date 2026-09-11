"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Action } from "../../../components/Action";
import { Breadcrumbs } from "../../../components/Breadcrumbs";
import { PageHero } from "../../../components/PageHero";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { formatTinybars } from "../../../lib/format";
import { PHOTOS } from "../../../lib/photos";
import { connectWallet, encodeXPaymentHeader, signScanPayment, type InvoiceRequirements } from "../../../lib/hederaWallet";
import { useViewMode } from "../../../lib/viewMode";

interface View {
  id: string;
  label: string;
  status: string;
  hidden: boolean;
  entryTinybars: number;
  potTinybars: number;
  startMs: number;
  endMs: number;
  results: Array<{ userId: string; timeMs?: number; hidden?: boolean }>;
  winners?: Array<{ userId: string; timeMs: number; rank: number; hederaAccount: string }>;
}

export default function MarketPage() {
  const { user, refresh } = useAuth();
  const { view: appView } = useViewMode();
  const isAdmin = appView === "admin";
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

  async function resolveHeat() {
    setBusy("resolve");
    setError("");
    try {
      await api(`/markets/${params.id}/resolve`, { method: "POST" });
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
  if (!view) return <p className="text-zinc-500">{error || "Loading…"}</p>;

  return (
    <main>
      <PageHero src={PHOTOS.track} alt="Athletes on a running track" eyebrow="Race" title={view.label}>
        <p className="mt-4 max-w-xl text-base leading-7 text-white/90">
          Pay {formatTinybars(view.entryTinybars)} to enter. We use your fastest Fitbit time that started in this window
          and covered the distance. Pot {formatTinybars(view.potTinybars)}.
          {view.hidden ? " Other people cannot see times until payout." : ""}
        </p>
        <p className="mt-2 text-sm text-white/80">
          {new Date(view.startMs).toLocaleString()} to {new Date(view.endMs).toLocaleString()} · {view.status}
        </p>
        <div className="mt-6">
          <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: "/app", label: "Races" }, { label: view.label }]} />
        </div>
      </PageHero>

      <section className="page-x w-full py-10">
        {isAdmin ? (
          <Action disabled={Boolean(busy) || view.status === "resolved"} onClick={() => void resolveHeat()}>
            {view.status === "resolved" ? "Paid out" : busy === "resolve" ? "Paying out…" : "Pay out this race"}
          </Action>
        ) : (
          <ol className="grid gap-4 sm:grid-cols-3">
            <li className="rounded-xl border border-white/[0.08] bg-ink-900 px-4 py-4">
              <p className="text-xs text-white/60">01</p>
              <button className="mt-1.5 text-left" type="button" disabled={Boolean(busy)} onClick={() => void enter()}>
                <h2 className="text-base font-medium text-white">{busy === "enter" ? "Paying…" : "Pay to enter"}</h2>
                <p className="mt-1.5 text-sm leading-6 text-white/85">Small HBAR entry from HashPack. Required to place.</p>
              </button>
            </li>
            <li className="rounded-xl border border-white/[0.08] bg-ink-900 px-4 py-4">
              <p className="text-xs text-white/60">02</p>
              <button className="mt-1.5 text-left" type="button" disabled={Boolean(busy)} onClick={() => void syncWorkout()}>
                <h2 className="text-base font-medium text-white">{busy === "sync" ? "Syncing…" : "Sync Fitbit"}</h2>
                <p className="mt-1.5 text-sm leading-6 text-white/85">Pull walks and runs after the phone has synced.</p>
              </button>
            </li>
            <li className="rounded-xl border border-white/[0.08] bg-ink-900 px-4 py-4">
              <p className="text-xs text-white/60">03</p>
              <button className="mt-1.5 text-left" type="button" disabled={Boolean(busy)} onClick={() => void mint()}>
                <h2 className="text-base font-medium text-white">{busy === "mint" ? "Minting…" : "Save a certificate"}</h2>
                <p className="mt-1.5 text-sm leading-6 text-white/85">Optional soulbound run ID on Hedera.</p>
              </button>
            </li>
          </ol>
        )}
        {error ? <p className="mt-6 text-sm text-red-200">{error}</p> : null}
      </section>

      <section className="page-x w-full pb-14">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Board</p>
        {view.results.length === 0 ? (
          <p className="py-8 text-sm text-zinc-500">No times yet. Pay to enter, then sync a session from this window.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Runner</th>
                <th className="px-5 py-2.5 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {view.results.map((row) => (
                <tr key={row.userId}>
                  <td className="px-5 py-3">{row.userId === user.id ? "You" : row.userId.slice(0, 10)}</td>
                  <td className="px-5 py-3 tabular-nums">
                    {row.hidden ? "hidden" : row.timeMs != null ? `${(row.timeMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.winners?.length ? (
          <p className="border-t border-white/[0.06] px-5 py-3 text-sm text-zinc-400">
            Top 3: {view.winners.map((w) => `#${w.rank} ${(w.timeMs / 1000).toFixed(1)}s`).join(" · ")}
          </p>
        ) : null}
      </section>
    </main>
  );
}
