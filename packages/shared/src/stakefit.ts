/** StakeFit domain types and the single distance catalog admins can create from. */

export type DistanceId = "50m" | "200m" | "5k" | "10k";

export interface DistanceCatalogEntry {
  id: DistanceId;
  label: string;
  meters: number;
  millimeters: number;
  demo: boolean;
}

/** Admin cannot invent distances. 50m exists so a short outdoor effort can demo. */
export const DISTANCE_CATALOG: readonly DistanceCatalogEntry[] = [
  { id: "50m", label: "50 metres", meters: 50, millimeters: 50_000, demo: true },
  { id: "200m", label: "200 metres", meters: 200, millimeters: 200_000, demo: false },
  { id: "5k", label: "5 kilometres", meters: 5_000, millimeters: 5_000_000, demo: false },
  { id: "10k", label: "10 kilometres", meters: 10_000, millimeters: 10_000_000, demo: false },
] as const;

export function catalogById(id: string): DistanceCatalogEntry | undefined {
  return DISTANCE_CATALOG.find((row) => row.id === id);
}

export function civilDate(at = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Inclusive local calendar day used when an admin starts a race. */
export function localDayBounds(now = Date.now()): { startMs: number; endMs: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/** Civil range for Health list filters. `endCivil` is exclusive. */
export function recentCivilRange(days = 90, now = new Date()): { startCivil: string; endCivil: string } {
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const end = new Date(now);
  end.setDate(end.getDate() + 1);
  return { startCivil: civilDate(start), endCivil: civilDate(end) };
}

const MULTI_DAY_MS = 36 * 60 * 60_000;

/**
 * A race scores the fastest qualifying session that started on one civil day.
 * Wider stored windows (from older admin creates) snap to that day.
 */
export function raceDayBounds(
  market: { startMs: number; endMs: number },
  now = Date.now(),
): { startMs: number; endMs: number } {
  if (market.endMs - market.startMs <= MULTI_DAY_MS) {
    return { startMs: market.startMs, endMs: market.endMs };
  }
  const anchor = Math.min(market.endMs, Math.max(market.startMs, now));
  return localDayBounds(anchor);
}

export type MarketStatus = "scheduled" | "open" | "grace" | "resolving" | "resolved";

export interface Market {
  id: string;
  distanceId: DistanceId;
  label: string;
  startMs: number;
  endMs: number;
  graceSec: number;
  hidden: boolean;
  houseBps: number;
  entryTinybars: number;
  status: MarketStatus;
  entryCount: number;
  potTinybars: number;
  vrfSeed?: string;
  winners?: Array<{ userId: string; hederaAccount: string; timeMs: number; rank: 1 | 2 | 3 }>;
  createdAt: number;
  resolvedAt?: number;
}

export interface MarketEntry {
  marketId: string;
  userId: string;
  hederaAccount: string;
  paymentRef: string;
  paidAt: number;
}

export interface ExerciseSession {
  id: string;
  displayName: string;
  exerciseType: string;
  startMs: number;
  endMs: number;
  activeDurationMs: number;
  distanceMillimeters: number;
  steps?: number;
  caloriesKcal?: number;
  heartRateBpm?: number;
  elevationGainMillimeters?: number;
  averagePaceSecondsPerMeter?: number;
  hasGps?: boolean;
  deviceVersion?: string;
  lastSyncTime?: string;
}

export interface QualifyingResult {
  ok: boolean;
  reason?: string;
  timeMs?: number;
  exerciseId?: string;
}

export interface HistoryRow extends ExerciseSession {
  qualifiedMarkets: Array<{
    marketId: string;
    label: string;
    distanceId: DistanceId;
    entered?: boolean;
    submitted?: boolean;
  }>;
  resultMarketId?: string;
  certificateSerial?: string;
  statusNote: string;
}

export interface PayoutSplit {
  houseTinybars: number;
  firstTinybars: number;
  secondTinybars: number;
  thirdTinybars: number;
}

export const SHARE_BPS = { first: 5000, second: 3000, third: 2000 } as const;

export function splitPot(potTinybars: number, houseBps: number, winnerCount: number): PayoutSplit {
  const house = Math.floor((potTinybars * Math.min(10_000, Math.max(0, houseBps))) / 10_000);
  const remainder = potTinybars - house;
  const first = winnerCount >= 1 ? Math.floor((remainder * SHARE_BPS.first) / 10_000) : 0;
  const second = winnerCount >= 2 ? Math.floor((remainder * SHARE_BPS.second) / 10_000) : 0;
  const third = winnerCount >= 3 ? Math.floor((remainder * SHARE_BPS.third) / 10_000) : 0;
  const paid = first + second + third;
  return {
    houseTinybars: house + (remainder - paid),
    firstTinybars: first,
    secondTinybars: second,
    thirdTinybars: third,
  };
}

export function marketStatusAt(market: Pick<Market, "startMs" | "endMs" | "graceSec" | "resolvedAt">, now = Date.now()): MarketStatus {
  if (market.resolvedAt) return "resolved";
  if (now < market.startMs) return "scheduled";
  if (now <= market.endMs) return "open";
  if (now <= market.endMs + market.graceSec * 1000) return "grace";
  return "resolving";
}

export type StakeEvent =
  | { type: "market.created"; marketId: string; at: number }
  | { type: "market.entered"; marketId: string; userId: string; at: number }
  | { type: "exercise.synced"; userId: string; count: number; at: number }
  | { type: "result.submitted"; marketId: string; userId: string; hidden: boolean; timeMs?: number; at: number }
  | { type: "market.resolved"; marketId: string; at: number }
  | { type: "payout.sent"; marketId: string; hederaAccount: string; tinybars: number; at: number }
  | { type: "certificate.minted"; userId: string; serial: string; at: number };
