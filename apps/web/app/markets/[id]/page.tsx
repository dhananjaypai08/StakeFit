"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Action } from "../../../components/Action";
import { Breadcrumbs } from "../../../components/Breadcrumbs";
import { PageHero } from "../../../components/PageHero";
import { PageSkeleton } from "../../../components/PageSkeleton";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { formatActivityName, formatDuration, formatTinybars } from "../../../lib/format";
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
      const hederaAccount = await connectWallet();
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
  const mineEntry = view.entries?.find((row) => row.mine || row.userId === user.id);
  const selfieNeeded = Boolean(view.partners?.world?.selfieRequired);
  const selfieDone = !selfieNeeded || Boolean(view.partners?.world?.verified || user.worldVerified);

  const openSteps: GuideStep[] = [
    {
      title: "Pay with HashPack",
      body: view.entered
        ? `Paid ${formatTinybars(view.entryTinybars)} into the pot.`
        : `Pay ${formatTinybars(view.entryTinybars)} from HashPack. That is HBAR, Hedera's coin.`,
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
      title: "Fitbit time",
      body:
        view.yours?.timeMs != null
          ? "This Fitbit session is the one on the race."
          : view.entered
            ? "Watching Fitbit for a session that started today and covered this distance."
            : "Pay first. We then pick the fastest qualifying Fitbit session automatically.",
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
      title: canResolve ? "Resolve the day" : "Wait for resolve",
      body: canResolve
        ? "Close this race whenever you want. No entries or times is fine — it just resolves with no winner."
        : "Times stay hidden until the day is resolved. Come back for the podium, selfie, and run card.",
      state: canResolve ? "active" : view.entered ? "active" : "locked",
      action: canResolve
        ? { label: "Resolve this day", busy: busy === "resolve", onClick: () => void resolveHeat() }
        : undefined,
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
      <PageHero
        src={PHOTOS.track}
        alt=""
        eyebrow={view.yours?.timeMs != null ? `${view.label} race` : "Race"}
        title={view.yours?.timeMs != null ? formatDuration(view.yours.timeMs) : view.label}
      >
        {view.yours?.timeMs != null ? (
          <p className="mt-3 max-w-xl text-base text-white/90">
            Your time
            {view.yours.displayName ? ` · ${formatActivityName(view.yours.displayName)}` : ""}
            {view.yours.startMs ? ` · ${new Date(view.yours.startMs).toLocaleString()}` : ""}
          </p>
        ) : (
          <p className="mt-4 max-w-xl text-base leading-7 text-white/90">
            Fastest Fitbit session that started today and covered this distance. Entry {formatTinybars(view.entryTinybars)}.
            {view.hidden ? " Other times stay hidden until resolve." : ""}
          </p>
        )}
        <p className="mt-3 text-xs text-white/55">Scored privately. Only the time leaves.</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: "/app", label: "Races" }, { label: view.label }]} />
          {canResolve && view.status !== "resolved" ? (
            <Action tone="quiet" disabled={busy === "resolve"} onClick={() => void resolveHeat()}>
              {busy === "resolve" ? "Resolving…" : "Resolve race"}
            </Action>
          ) : null}
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

      <section className="page-x w-full pb-14">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Runners</p>
        {view.results.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            {view.entered ? "Your time will land here as soon as Fitbit has a qualifying session." : "Pay to put a time on this race."}
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {view.results.map((row) => {
              const mine = row.userId === user.id;
              return (
                <div
                  key={row.userId}
                  className={`rounded-2xl border px-5 py-5 ${
                    mine ? "border-white/30 bg-white/[0.07]" : "border-white/[0.08] bg-ink-900"
                  }`}
                >
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">{mine ? "You" : "Runner"}</p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
                    {row.hidden ? "Hidden" : row.timeMs != null ? formatDuration(row.timeMs) : "—"}
                  </p>
                  {mine && view.yours?.displayName ? (
                    <p className="mt-2 text-sm text-white/70">{formatActivityName(view.yours.displayName)}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {view.status === "resolved" && view.noWinner ? (
          <p className="mt-4 text-sm text-zinc-500">Resolved with no qualifying times.</p>
        ) : null}
      </section>
    </main>
  );
}
