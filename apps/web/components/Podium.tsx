import { formatDuration, formatTinybars } from "../lib/format";

interface Winner {
  userId: string;
  timeMs: number;
  rank: number;
  hederaAccount?: string;
  mine?: boolean;
}

export function Podium({
  winners,
  viewerId,
  payouts,
}: {
  winners: Winner[];
  viewerId?: string;
  payouts?: Array<{ userId: string; tinybars: number; paid?: boolean; mine?: boolean }>;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {([1, 2, 3] as const).map((rank) => {
        const winner = winners.find((row) => row.rank === rank);
        const mine = Boolean(winner && (winner.userId === viewerId || winner.mine));
        const pay = winner ? payouts?.find((row) => row.userId === winner.userId) : undefined;
        return (
          <div
            key={rank}
            className={`rounded-xl border px-3 py-3 ${
              winner ? "border-white/[0.12] bg-ink-900" : "border-white/[0.06] bg-ink-900/50"
            }`}
          >
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">P{rank}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-white">
              {winner ? formatDuration(winner.timeMs) : "—"}
            </p>
            <p className="mt-0.5 truncate text-xs text-white/55">
              {winner ? (mine ? "You" : winner.hederaAccount || "Runner") : "Open"}
            </p>
            <p className="mt-1 text-[11px] tabular-nums text-white/40">{pay ? formatTinybars(pay.tinybars) : "\u00a0"}</p>
          </div>
        );
      })}
    </div>
  );
}
