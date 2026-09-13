"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Action } from "../../../components/Action";
import { PageHero } from "../../../components/PageHero";
import { PageSkeleton } from "../../../components/PageSkeleton";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { formatActivityName, formatDistance, formatDuration, formatTinybars } from "../../../lib/format";
import { PHOTOS } from "../../../lib/photos";
import { connectWallet, encodeXPaymentHeader, signScanPayment, type InvoiceRequirements } from "../../../lib/hederaWallet";
import { Podium } from "../../../components/Podium";
import { RaceGuide, type GuideStep } from "../../../components/RaceGuide";
import { RunCard, type RunCardData } from "../../../components/RunCard";
import { SelfieCheck } from "../../../components/SelfieCheck";

interface View {
  id: string;
  label: string;
  status: string;
  hidden: boolean;
  entryTinybars: number;
  potTinybars: number;
  startMs: number;
  endMs: number;
  results: Array<{ userId: string; timeMs?: number; hidden?: boolean; exerciseId?: string }>;
  winners?: Array<{ userId: string; timeMs: number; rank: number; hederaAccount: string }>;
  yours?: {
    status: string;
    note: string;
    timeMs?: number;
    exerciseId?: string;
    displayName?: string;
    startMs?: number;
    distanceMillimeters?: number;
    sessionDurationMs?: number;
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
  const canResolve = Boolean(user?.admin);
  const params = useParams<{ id: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const body = await api<View>(`/markets/${params.id}`);
    setView(body);
  }

  useEffect(() => {
    if (!user?.connected) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const body = await api<View>(`/markets/${params.id}`);
        if (!cancelled) {
          setView(body);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [params.id, user?.id, user?.connected]);

  async function enter() {
    setBusy("enter");
    setError("");
    try {
      const hederaAccount = await connectWallet();
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
      const hederaAccount = await connectWallet({ prompt: true });
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
  if (!view) return <PageSkeleton label={error || "Pulling this race"} />;
  const selfieNeeded = Boolean(view.partners?.world?.selfieRequired);
  const selfieDone = !selfieNeeded || Boolean(view.partners?.world?.verified || user.worldVerified);

  const openSteps: GuideStep[] = [
    {
      title: "Pay to enter",
      body: view.entered ? `Paid ${formatTinybars(view.entryTinybars)}.` : `Pay ${formatTinybars(view.entryTinybars)} with HashPack.`,
      state: view.entered ? "done" : "active",
      action: view.entered ? undefined : { label: "Open HashPack", busy: busy === "enter", onClick: () => void enter() },
    },
    {
      title: "Fitbit time",
      body: view.yours?.timeMs != null ? undefined : "Watching Fitbit for a session that covered this distance today.",
      state: !view.entered ? "locked" : view.yours?.timeMs != null ? "done" : "active",
      extra:
        view.entered && view.yours?.timeMs == null ? (
          <p className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
            <span className="live-dot" aria-hidden />
            Watching Fitbit…
          </p>
        ) : null,
    },
    {
      title: canResolve ? "Resolve" : "Waiting to resolve",
      state: !view.entered ? "locked" : canResolve ? "active" : "locked",
      action: canResolve
        ? { label: "Resolve race", busy: busy === "resolve", onClick: () => void resolveHeat() }
        : undefined,
    },
  ];

  const resolvedSteps: GuideStep[] = [
    ...(selfieNeeded
      ? [
          {
            title: "Selfie Check",
            body: selfieDone ? undefined : "Confirm a live person, then claim and mint.",
            state: selfieDone ? "done" : "active",
            extra: (
              <SelfieCheck
                marketId={view.id}
                disabled={Boolean(busy) || selfieDone}
                verified={selfieDone}
                onDone={async () => {
                  await refresh();
                  await load();
                }}
              />
            ),
          } satisfies GuideStep,
        ]
      : []),
    ...(view.claim
      ? [
          {
            title: "Claim HBAR",
            body: view.claim.paid
              ? `Sent ${formatTinybars(view.claim.tinybars)}.`
              : `P${view.claim.rank} · ${formatTinybars(view.claim.tinybars)}`,
            state: !selfieDone && selfieNeeded ? "locked" : view.claim.paid ? "done" : "active",
            action:
              view.claim.paid || (!selfieDone && selfieNeeded)
                ? undefined
                : { label: "Open HashPack and claim", busy: busy === "claim", onClick: () => void claimPayout() },
          } satisfies GuideStep,
        ]
      : []),
    {
      title: "Mint run card",
      body: view.certificate ? `Serial ${view.certificate.serial}` : "Soulbound run NFT for this time.",
      state: !selfieDone && selfieNeeded ? "locked" : view.certificate ? "done" : "active",
      action:
        view.certificate || (!selfieDone && selfieNeeded)
          ? undefined
          : { label: "Mint run card", busy: busy === "mint", onClick: () => void mint() },
      extra: view.certificate?.hashscan ? (
        <a className="mt-2 inline-block text-xs text-white/60 underline-offset-2 hover:underline" href={view.certificate.hashscan} target="_blank" rel="noreferrer">
          Open on HashScan
        </a>
      ) : null,
    },
  ];

  return (
    <main>
      <PageHero src={PHOTOS.start} alt="" focus="50% 62%" eyebrow="Race" title={view.label}>
        {view.yours?.timeMs != null ? (
          <>
            <p className="mt-3 text-4xl font-semibold tabular-nums tracking-tight text-white">
              {formatDuration(view.yours.timeMs)}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">{view.yours.note || scoreNote(view)}</p>
          </>
        ) : (
          <p className="mt-3 max-w-xl text-sm text-white/75">
            Fastest pace today over {view.label}. Entry {formatTinybars(view.entryTinybars)}.
          </p>
        )}
        {canResolve && view.status !== "resolved" ? (
          <div className="mt-4">
            <Action tone="quiet" disabled={busy === "resolve"} onClick={() => void resolveHeat()}>
              {busy === "resolve" ? "Resolving…" : "Resolve race"}
            </Action>
          </div>
        ) : null}
      </PageHero>

      <section className="page-x w-full space-y-4 py-6">
        {view.status === "resolved" ? (
          <>
            <Podium winners={view.winners ?? []} viewerId={user.id} payouts={view.payouts} />
            {view.entered && !view.claim && !view.noWinner ? (
              <p className="text-sm text-zinc-500">You entered. You did not place. You can still mint a run card.</p>
            ) : null}
            <div className="grid items-stretch gap-3 lg:grid-cols-2">
              <div className="min-h-[16rem]">
                <RaceGuide steps={resolvedSteps} />
              </div>
              {view.runCard ? (
                <div className={view.certificate ? "min-h-[16rem]" : "min-h-[16rem] opacity-80"}>
                  <RunCard card={view.runCard} />
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <RaceGuide steps={openSteps} />
        )}
        {view.status !== "resolved" && view.results.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {view.results.map((row) => {
              const mine = row.userId === user.id;
              return (
                <div
                  key={row.userId}
                  className={`rounded-xl border px-4 py-3 ${
                    mine ? "border-white/25 bg-white/[0.06]" : "border-white/[0.08] bg-ink-900"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{mine ? "You" : "Runner"}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {row.hidden ? "Hidden" : row.timeMs != null ? formatDuration(row.timeMs) : "—"}
                  </p>
                  {mine && view.yours?.note ? <p className="mt-1 text-sm text-white/65">{view.yours.note}</p> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {view.status === "resolved" && view.noWinner ? (
          <p className="text-sm text-zinc-500">Resolved with no qualifying times.</p>
        ) : null}
        {error ? <p className="text-sm text-red-200">{error}</p> : null}
      </section>
    </main>
  );
}

function scoreNote(view: View): string {
  const yours = view.yours;
  if (!yours?.timeMs) return "";
  const activity = yours.displayName ? formatActivityName(yours.displayName) : "Fitbit session";
  const when = yours.startMs ? new Date(yours.startMs).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
  const ran = yours.distanceMillimeters ? formatDistance(yours.distanceMillimeters) : "";
  const full = yours.sessionDurationMs ? formatDuration(yours.sessionDurationMs) : "";
  if (yours.distanceMillimeters && yours.distanceMillimeters > 0 && ran && ran !== view.label.replace("metres", "m").replace("kilometres", "km")) {
    const longer = yours.distanceMillimeters > (catalogMeters(view.label) * 1000 * 1.15 || yours.distanceMillimeters);
    if (longer && full) {
      return `From your ${ran} ${activity.toLowerCase()}${when ? ` at ${when}` : ""}. That run was ${full}; this is the same pace over ${view.label}.`;
    }
  }
  return `From your ${activity.toLowerCase()}${when ? ` at ${when}` : ""}.`;
}

function catalogMeters(label: string): number {
  const match = label.match(/([\d.]+)\s*(kilo)?metr/i);
  if (!match) return 0;
  const n = Number(match[1]);
  return match[2] ? n * 1000 : n;
}
