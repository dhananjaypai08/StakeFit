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
  if (!winners.length) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-ink-900 px-5 py-8 text-center">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Today</p>
        <h2 className="mt-2 text-xl font-semibold text-white">No winner</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Nobody had a qualifying Fitbit time on this day. The pot stays with the house.
        </p>
      </div>
    );
  }

  const ordered = [1, 2, 3]
    .map((rank) => winners.find((row) => row.rank === rank))
    .filter((row): row is Winner => Boolean(row));

  return (
    <div className="rounded-xl border border-white/[0.08] bg-ink-900 px-5 py-5">
      <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Podium</p>
      <ul className="mt-4 divide-y divide-white/[0.06]">
        {ordered.map((winner) => {
          const pay = payouts?.find((row) => row.userId === winner.userId);
          const mine = winner.userId === viewerId || winner.mine;
          return (
            <li key={winner.userId} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium text-white">
                  P{winner.rank}
                  {mine ? " · You" : ""}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {formatDuration(winner.timeMs)}
                  {winner.hederaAccount ? ` · ${winner.hederaAccount}` : ""}
                </p>
              </div>
              <p className="text-sm tabular-nums text-white">{pay ? formatTinybars(pay.tinybars) : "—"}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
