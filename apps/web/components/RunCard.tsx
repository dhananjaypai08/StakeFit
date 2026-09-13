import { formatActivityName, formatDistance, formatDuration } from "../lib/format";

export interface RunCardData {
  label: string;
  displayName: string;
  startMs: number;
  distanceMillimeters: number;
  timeMs: number;
  heartRateBpm?: number;
  caloriesKcal?: number;
  rank?: number;
  serial?: string;
  tokenId?: string;
  hashscan?: string;
}

export function RunCard({ card }: { card: RunCardData }) {
  const when = new Date(card.startMs);

  async function share() {
    const text = `${card.displayName} · ${formatDuration(card.timeMs)} · ${card.label}`;
    if (navigator.share) {
      await navigator.share({ title: "StakeFit", text }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(text).catch(() => undefined);
  }

  return (
    <div className="run-card flex h-full flex-col overflow-hidden rounded-xl border border-white/[0.08]">
      <img src="/nft.png" alt="" className="h-28 w-full object-cover" />
      <div className="flex flex-1 flex-col px-4 py-4">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">
          {card.label}
          {card.rank ? ` · P${card.rank}` : ""}
        </p>
        <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight text-white">
          {formatDuration(card.timeMs)}
        </p>
        <p className="mt-1 text-sm text-white/60">
          {formatActivityName(card.displayName)}
          {card.distanceMillimeters ? ` · ${formatDistance(card.distanceMillimeters)} session` : ""}
          {" · "}
          {when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">Calories</p>
            <p className="mt-1 tabular-nums text-white">{card.caloriesKcal ? Math.round(card.caloriesKcal) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">HR</p>
            <p className="mt-1 tabular-nums text-white">{card.heartRateBpm ? Math.round(card.heartRateBpm) : "—"}</p>
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between border-t border-white/[0.06] pt-3">
          {card.hashscan ? (
            <a className="text-[11px] text-white/55 underline-offset-2 hover:underline" href={card.hashscan} target="_blank" rel="noreferrer">
              {card.tokenId ? `${card.tokenId} · #${card.serial}` : `Run ID ${card.serial}`}
            </a>
          ) : (
            <p className="text-[11px] text-white/35">{card.serial ? `Run ID ${card.serial}` : "Run card"}</p>
          )}
          <button type="button" className="text-xs text-white/70 underline-offset-2 hover:underline" onClick={() => void share()}>
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
