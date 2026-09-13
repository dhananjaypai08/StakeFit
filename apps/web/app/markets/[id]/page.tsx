"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  const [stage, setStage] = useState("");
  /** Action failures stay pinned to their own step until the runner retries. */
  const [failure, setFailure] = useState<{ step: string; message: string } | null>(null);
  /** Polling must not overwrite the view or the error while an action is in flight. */
  const busyRef = useRef("");
  busyRef.current = busy;

  async function load() {
    const body = await api<View>(`/markets/${params.id}`);
    setView(body);
  }

  useEffect(() => {
    if (!user?.connected) return;
    let cancelled = false;
    const tick = async () => {
      if (busyRef.current) return;
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

  function start(step: string) {
    setBusy(step);
    setStage("");
    setError("");
    setFailure(null);
  }

  function fail(step: string, err: unknown) {
    setFailure({ step, message: friendlyError(err) });
  }

  async function enter() {
    start("enter");
    try {
      setStage("Opening HashPack");
      const hederaAccount = await connectWallet();
      await api("/me/hedera", { method: "POST", body: JSON.stringify({ accountId: hederaAccount }) });
      setStage("Paying the entry");
      try {
        await api(`/markets/${params.id}/enter`, { method: "POST", body: JSON.stringify({ hederaAccount }) });
      } catch (err) {
        const status = (err as Error & { status?: number; body?: { accepts?: InvoiceRequirements[] } }).status;
        const accepts = (err as Error & { body?: { accepts?: InvoiceRequirements[] } }).body?.accepts;
        if (status !== 402 || !accepts?.[0]) throw err;
        setStage("Approve in HashPack");
        const signed = await signScanPayment(accepts[0], hederaAccount);
        setStage("Settling on Hedera");
        await api(`/markets/${params.id}/enter`, {
          method: "POST",
          headers: { "X-PAYMENT": encodeXPaymentHeader(accepts[0], signed) },
          body: JSON.stringify({ hederaAccount }),
        });
      }
      await refresh();
      await load();
    } catch (err) {
      fail("enter", err);
    } finally {
      setBusy("");
      setStage("");
    }
  }

  async function resolveHeat() {
    start("resolve");
    try {
      setStage("Scoring the board");
      await api(`/markets/${params.id}/resolve`, { method: "POST" });
      await load();
    } catch (err) {
      fail("resolve", err);
    } finally {
      setBusy("");
      setStage("");
    }
  }

  async function claimPayout() {
    start("claim");
    try {
      setStage("Opening HashPack");
      const hederaAccount = await connectWallet({ prompt: true });
      setStage("Linking your account");
      await api("/me/hedera", { method: "POST", body: JSON.stringify({ accountId: hederaAccount }) });
      setStage("Sending your HBAR");
      await api(`/markets/${params.id}/claim`, { method: "POST", body: JSON.stringify({ hederaAccount }) });
      setStage("Confirming on Hedera");
      await refresh();
      await load();
    } catch (err) {
      fail("claim", err);
    } finally {
      setBusy("");
      setStage("");
    }
  }

  async function mint() {
    start("mint");
    try {
      if (view?.partners?.world?.selfieRequired && !view.partners.world.verified && !user?.worldVerified) {
        throw new Error("Finish Selfie Check first, then mint.");
      }
      setStage("Minting on Hedera");
      await api(`/markets/${params.id}/certificate`, { method: "POST" });
      await load();
    } catch (err) {
      fail("mint", err);
    } finally {
      setBusy("");
      setStage("");
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
      action: view.entered
        ? undefined
        : {
            label: failure?.step === "enter" ? "Try again" : "Open HashPack",
            busy: busy === "enter",
            busyLabel: stage,
            onClick: () => void enter(),
          },
      error: failure?.step === "enter" ? failure.message : undefined,
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
        ? {
            label: failure?.step === "resolve" ? "Try resolve again" : "Resolve race",
            busy: busy === "resolve",
            busyLabel: stage,
            onClick: () => void resolveHeat(),
          }
        : undefined,
      error: failure?.step === "resolve" ? failure.message : undefined,
    },
  ];

  const resolvedSteps: GuideStep[] = [
    ...(selfieNeeded
      ? [
          {
            title: "Selfie Check",
            body: selfieDone ? undefined : "A live check before you claim.",
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
            title: view.claim.paid ? "HBAR sent" : "Claim your HBAR",
            body: view.claim.paid
              ? `${formatTinybars(view.claim.tinybars)} for ${ordinal(view.claim.rank)} place went to ${view.claim.hederaAccount ?? "your account"}.`
              : `You finished ${ordinal(view.claim.rank)}. ${formatTinybars(view.claim.tinybars)} is held for you. One HashPack approval moves it to your account.`,
            state: !selfieDone && selfieNeeded ? "locked" : view.claim.paid ? "done" : "active",
            action:
              view.claim.paid || (!selfieDone && selfieNeeded)
                ? undefined
                : {
                    label: failure?.step === "claim" ? "Try claim again" : "Claim with HashPack",
                    busy: busy === "claim",
                    busyLabel: stage,
                    onClick: () => void claimPayout(),
                  },
            error: failure?.step === "claim" ? failure.message : undefined,
            extra: transferLink(view.claim.txId) ? (
              <a
                className="mt-2 inline-block text-xs text-white/60 underline-offset-2 hover:underline"
                href={transferLink(view.claim.txId)}
                target="_blank"
                rel="noreferrer"
              >
                View the transfer on HashScan
              </a>
            ) : null,
          } satisfies GuideStep,
        ]
      : []),
    {
      title: "Mint run card",
      body: view.certificate
        ? `Soulbound run card, serial ${view.certificate.serial}. It stays in your account.`
        : "A soulbound run card on Hedera as the receipt for this time.",
      state: !selfieDone && selfieNeeded ? "locked" : view.certificate ? "done" : "active",
      action:
        view.certificate || (!selfieDone && selfieNeeded)
          ? undefined
          : {
              label: failure?.step === "mint" ? "Try mint again" : "Mint run card",
              busy: busy === "mint",
              busyLabel: stage,
              onClick: () => void mint(),
            },
      error: failure?.step === "mint" ? failure.message : undefined,
      extra: view.certificate?.hashscan ? (
        <a className="mt-2 inline-block text-xs text-white/60 underline-offset-2 hover:underline" href={view.certificate.hashscan} target="_blank" rel="noreferrer">
          Open on HashScan
        </a>
      ) : null,
    },
  ];

  return (
    <main>
      <PageHero src={PHOTOS.hero} alt="" eyebrow={view.status === "resolved" ? "Resolved" : "Open"} title={view.label}>
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
            {view.claim && !view.claim.paid ? (
              <p className="text-sm text-zinc-400">
                Board is final. Claim your {formatTinybars(view.claim.tinybars)} below, then mint the run card.
              </p>
            ) : null}
            {!view.claim && onPodium(view, user) ? (
              <p className="text-sm text-amber-100/80">
                You are on the podium and your prize is still being read back from Hedera. This page refreshes on its own.
              </p>
            ) : null}
            {view.entered && !view.claim && !view.noWinner && !onPodium(view, user) ? (
              <p className="text-sm text-zinc-500">You entered and did not place. You can still mint the run card for your time.</p>
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

function onPodium(view: View, user: { id: string; hederaAccount?: string }): boolean {
  return (view.winners ?? []).some(
    (row) =>
      row.userId === user.id ||
      row.userId.toLowerCase() === user.id.toLowerCase() ||
      Boolean(user.hederaAccount && row.hederaAccount === user.hederaAccount),
  );
}

function ordinal(rank: number): string {
  if (rank === 1) return "first";
  if (rank === 2) return "second";
  if (rank === 3) return "third";
  return `${rank}th`;
}

/** Hedera tx ids look like `0.0.4759032@1789309219.442432286`. */
function transferLink(txId?: string): string | undefined {
  if (!txId || !txId.includes("@")) return undefined;
  return `https://hashscan.io/testnet/transaction/${txId}`;
}

/** Wallet and network errors arrive raw, so give the runner something to act on. */
function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/reject|denied|cancel/i.test(raw)) return "HashPack closed before approving. Nothing moved, so you can claim again.";
  if (/no wallet|not installed|extension/i.test(raw)) return "No HashPack found in this browser. Install it, then claim again.";
  if (/session|expired|unauthor/i.test(raw)) return "Your session expired. Reload the page and sign in again.";
  if (/failed to fetch|network|econnrefused/i.test(raw)) return "Could not reach StakeFit. Check your connection and try again.";
  if (!raw.trim()) return "That did not go through. Try again.";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
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
      return `From your ${ran} ${activity.toLowerCase()}${when ? ` at ${when}` : ""}. That session ran ${full}, and this is the same pace over ${view.label}. The full session time is not the race time.`;
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
