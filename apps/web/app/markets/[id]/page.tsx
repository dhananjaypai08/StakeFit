"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Breadcrumbs } from "../../../components/Breadcrumbs";
import { PageHero } from "../../../components/PageHero";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { formatDistance, formatDuration, formatTinybars } from "../../../lib/format";
import { PHOTOS } from "../../../lib/photos";
import { connectWallet, encodeXPaymentHeader, signScanPayment, type InvoiceRequirements } from "../../../lib/hederaWallet";
import { PartnerStrip } from "../../../components/PartnerStrip";
import { Podium } from "../../../components/Podium";
import { RaceGuide, type GuideStep } from "../../../components/RaceGuide";
import { RunCard, type RunCardData } from "../../../components/RunCard";
import { SelfieCheck } from "../../../components/SelfieCheck";
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
  yours?: {
    status: string;
    note: string;
    timeMs?: number;
    nearest?: { startMs: number; name: string; distanceMillimeters: number };
  };
  partners?: {
    hedera?: { x402?: boolean; hcsTopic?: string; htsToken?: string; payTo?: string; network?: string };
    chainlink?: { confidentialScore?: boolean; vrf?: boolean };
    graph?: { live?: boolean };
    world?: { selfieRequired?: boolean; verified?: boolean };
  };
  noWinner?: boolean;
  entered?: boolean;
  entries?: Array<{ userId: string; hederaAccount?: string; paymentRef?: string; paidAt?: number; mine?: boolean }>;
  payouts?: Array<{ userId: string; tinybars: number; paid?: boolean; mine?: boolean }>;
  claim?: { rank: number; tinybars: number; paid: boolean; hederaAccount?: string; txId?: string };
  certificate?: { serial: string; cid?: string; tokenId?: string; txId?: string; hashscan?: string; ipfs?: string };
  runCard?: RunCardData;
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

  async function claimPayout() {
    setBusy("claim");
    setError("");
    try {
      const hederaAccount = user?.hederaAccount || (await connectWallet());
      await api("/me/hedera", { method: "POST", body: JSON.stringify({ accountId: hederaAccount }) });
      await api(`/markets/${params.id}/claim`, { method: "POST", body: JSON.stringify({ hederaAccount }) });
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
      if (view?.partners?.world?.selfieRequired && !view.partners.world.verified && !user?.worldVerified) {
        throw new Error("Complete Selfie Check first. It is the fairness check before a run ID mints.");
      }
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
  const mineEntry = view.entries?.find((row) => row.mine || row.userId === user.id);
  const selfieNeeded = Boolean(view.partners?.world?.selfieRequired);
  const selfieDone = !selfieNeeded || Boolean(view.partners?.world?.verified || user.worldVerified);

  const openSteps: GuideStep[] = [
    {
      title: "Pay with HashPack",
      body: `Send ${formatTinybars(view.entryTinybars)}${view.partners?.hedera?.payTo ? ` to ${view.partners.hedera.payTo}` : ""} on Hedera testnet. HashPack opens so you can sign.`,
      state: view.entered ? "done" : "active",
      action: view.entered ? undefined : { label: "Open HashPack and pay", busy: busy === "enter", onClick: () => void enter() },
      extra: view.entered ? (
        <p className="mt-2 text-xs text-zinc-400">
          {mineEntry?.paymentRef ? `Payment ${mineEntry.paymentRef}. ` : "Paid. "}
          {mineEntry?.hederaAccount ? (
            <a className="underline-offset-2 hover:underline" href={`https://hashscan.io/testnet/account/${mineEntry.hederaAccount}`} target="_blank" rel="noreferrer">
              Your account
            </a>
          ) : null}
          {view.partners?.hedera?.payTo ? (
            <>
              {" · "}
              <a className="underline-offset-2 hover:underline" href={`https://hashscan.io/testnet/account/${view.partners.hedera.payTo}`} target="_blank" rel="noreferrer">
                Pot
              </a>
            </>
          ) : null}
        </p>
      ) : user.hederaAccount ? (
        <p className="mt-2 text-xs text-zinc-500">Wallet {user.hederaAccount}</p>
      ) : null,
    },
    {
      title: "Sync Fitbit",
      body: "CRE scores the fastest qualifying time. Health tokens stay in the TEE. Only the time leaves.",
      state: !view.entered ? "locked" : view.yours?.timeMs != null ? "done" : "active",
      action:
        view.entered && view.yours?.timeMs == null
          ? { label: "Sync Fitbit now", busy: busy === "sync", onClick: () => void syncWorkout() }
          : undefined,
    },
    {
      title: isAdmin ? "Resolve the day" : "Wait for resolve",
      body: isAdmin
        ? "After Fitbit times are in, resolve. Top 3 share the pot."
        : "Times stay hidden until the day is resolved. Come back for the podium, selfie, and run card.",
      state: !view.entered ? "locked" : "active",
      action: isAdmin ? { label: "Resolve this day", busy: busy === "resolve", onClick: () => void resolveHeat() } : undefined,
    },
  ];

  const resolvedSteps: GuideStep[] = [
    {
      title: "Selfie Check",
      body: "World proves a live person before you claim HBAR or mint. The photo stays in World App. We only keep the nullifier.",
      state: selfieDone ? "done" : "active",
      extra: (
        <div className="mt-3">
          <SelfieCheck
            marketId={view.id}
            disabled={Boolean(busy) || selfieDone}
            verified={selfieDone}
            onDone={async () => {
              await refresh();
              await load();
            }}
          />
        </div>
      ),
    },
    ...(view.claim
      ? [
          {
            title: "Claim HBAR",
            body: view.claim.paid
              ? `Sent ${formatTinybars(view.claim.tinybars)} to ${view.claim.hederaAccount ?? "your HashPack"}.`
              : `Connect HashPack to receive ${formatTinybars(view.claim.tinybars)} for P${view.claim.rank}.`,
            state: !selfieDone && selfieNeeded ? "locked" : view.claim.paid ? "done" : "active",
            action:
              view.claim.paid || (!selfieDone && selfieNeeded)
                ? undefined
                : { label: "Connect HashPack and claim", busy: busy === "claim", onClick: () => void claimPayout() },
            extra: view.claim.txId ? (
              <p className="mt-2 text-xs text-zinc-400">
                Tx {view.claim.txId}
              </p>
            ) : null,
          } satisfies GuideStep,
        ]
      : []),
    {
      title: "Mint run card",
      body: "Soulbound HTS NFT for this run. Metadata points at IPFS (time, nullifier). Not the selfie photo.",
      state: !selfieDone && selfieNeeded ? "locked" : view.certificate ? "done" : "active",
      action:
        view.certificate || (!selfieDone && selfieNeeded)
          ? undefined
          : { label: "Mint run card", busy: busy === "mint", onClick: () => void mint() },
      extra: view.certificate ? (
        <div className="mt-2 space-y-1 text-xs text-zinc-400">
          <p>Serial {view.certificate.serial}{view.certificate.tokenId ? ` · ${view.certificate.tokenId}` : ""}</p>
          {view.certificate.txId ? <p>Tx {view.certificate.txId}</p> : null}
          {view.certificate.hashscan ? (
            <a className="underline-offset-2 hover:underline" href={view.certificate.hashscan} target="_blank" rel="noreferrer">
              Open on HashScan
            </a>
          ) : null}
          {view.certificate.ipfs ? (
            <>
              {" · "}
              <a className="underline-offset-2 hover:underline" href={view.certificate.ipfs} target="_blank" rel="noreferrer">
                IPFS metadata
              </a>
            </>
          ) : null}
        </div>
      ) : null,
    },
  ];

  return (
    <main>
      <PageHero src={PHOTOS.track} alt="Athletes on a running track" eyebrow="Race" title={view.label}>
        <p className="mt-4 max-w-xl text-base leading-7 text-white/90">
          Fastest Fitbit time that started today and covered this distance. Pay {formatTinybars(view.entryTinybars)} to
          place. Pot {formatTinybars(view.potTinybars)}.
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
        {view.status === "resolved" ? (
          <div className="space-y-6">
            <Podium winners={view.winners ?? []} viewerId={user.id} payouts={view.payouts} />
            {view.entered && !view.claim && !view.noWinner ? (
              <p className="text-sm text-zinc-500">You entered. You did not place in the top 3. You can still mint a run card.</p>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
              <RaceGuide steps={resolvedSteps} />
              {view.runCard ? (
                <div className={view.certificate ? "" : "opacity-70"}>
                  <RunCard card={view.runCard} />
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <RaceGuide steps={openSteps} />
        )}
        {error ? <p className="mt-6 text-sm text-red-200">{error}</p> : null}
      </section>

      <PartnerStrip partners={view.partners} />

      <section className="page-x w-full pb-14">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Board</p>
        {view.yours ? (
          <div className="mt-3 mb-6 max-w-2xl rounded-xl border border-white/[0.08] bg-ink-900 px-5 py-4">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Your time today</p>
            <p className="mt-2 text-sm leading-6 text-white/85">
              {view.yours.timeMs != null ? `${formatDuration(view.yours.timeMs)}. ` : ""}
              {view.yours.note}
            </p>
            {view.yours.nearest ? (
              <p className="mt-2 text-sm text-zinc-400">
                Closest Fitbit session: {view.yours.nearest.name} · {formatDistance(view.yours.nearest.distanceMillimeters)} on{" "}
                {new Date(view.yours.nearest.startMs).toLocaleDateString()}.
              </p>
            ) : null}
          </div>
        ) : null}
        {view.results.length === 0 ? (
          <p className="py-8 text-sm text-zinc-500">
            No time on the board yet. A walk that starts today and covers the distance will count after you enter.
          </p>
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
        {view.status === "resolved" && view.noWinner ? (
          <p className="px-5 py-3 text-sm text-zinc-500">Resolved with no qualifying times.</p>
        ) : null}
      </section>
    </main>
  );
}
