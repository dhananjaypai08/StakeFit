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
    const text = `${card.displayName} · ${formatDistance(card.distanceMillimeters)} · ${formatDuration(card.timeMs)} · ${card.label}`;
    if (navigator.share) {
      await navigator.share({ title: "StakeFit", text }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(text).catch(() => undefined);
  }

  return (
    <div className="run-card overflow-hidden rounded-2xl border border-white/[0.08]">
      <div className="px-5 pt-5">
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">StakeFit</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
          {formatActivityName(card.displayName)}
        </h2>
        <p className="mt-1 text-sm text-white/55">
          {when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          {" · "}
          {card.label}
          {card.rank ? ` · P${card.rank}` : ""}
        </p>
      </div>
      <div className="mt-6 px-5 pb-5">
        <p className="text-5xl font-semibold tabular-nums tracking-tight text-white">
          {formatDistance(card.distanceMillimeters)}
        </p>
        <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40">Time</p>
            <p className="mt-1 tabular-nums text-white">{formatDuration(card.timeMs)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40">Calories</p>
            <p className="mt-1 tabular-nums text-white">{card.caloriesKcal ? Math.round(card.caloriesKcal) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40">HR</p>
            <p className="mt-1 tabular-nums text-white">{card.heartRateBpm ? Math.round(card.heartRateBpm) : "—"}</p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between border-t border-white/[0.06] pt-3">
          {card.hashscan ? (
            <a className="text-[11px] text-white/55 underline-offset-2 hover:underline" href={card.hashscan} target="_blank" rel="noreferrer">
              {card.tokenId ? `${card.tokenId} · #${card.serial}` : `Run ID ${card.serial}`}
            </a>
          ) : (
            <p className="text-[11px] text-white/35">{card.serial ? `Run ID ${card.serial}` : "Soulbound run card"}</p>
          )}
          <button type="button" className="text-xs text-white/70 underline-offset-2 hover:underline" onClick={() => void share()}>
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
