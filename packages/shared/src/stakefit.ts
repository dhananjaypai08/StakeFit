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

function zoneParts(at: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function zonedCivilToUtc(
  civil: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): number {
  const want = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour ?? 0,
    civil.minute ?? 0,
    civil.second ?? 0,
  );
  let utc = want;
  for (let i = 0; i < 4; i += 1) {
    const got = zoneParts(utc, timeZone);
    const gotUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    utc += want - gotUtc;
  }
  return utc;
}

/** Inclusive calendar day in `timeZone`. Defaults to the host zone. */
export function localDayBounds(now = Date.now(), timeZone?: string): { startMs: number; endMs: number } {
  const zone = timeZone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = zoneParts(now, zone);
  const startMs = zonedCivilToUtc({ year: parts.year, month: parts.month, day: parts.day }, zone);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const endMs =
    zonedCivilToUtc(
      { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
      zone,
    ) - 1;
  return { startMs, endMs };
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
const CIVIL_DAY_MIN_MS = 20 * 60 * 60_000;

/** True when a client window is one calendar day, not a short test span or a multi-week range. */
export function looksLikeCivilDay(startMs: number, endMs: number): boolean {
  const span = endMs - startMs;
  return Number.isFinite(span) && span >= CIVIL_DAY_MIN_MS && span <= MULTI_DAY_MS;
}

/**
 * A race scores the fastest qualifying session that started on one civil day.
 * Wider stored windows (from older admin creates) snap to that day.
 */
export function raceDayBounds(
  market: {
    startMs: number;
    endMs: number;
    graceSec?: number;
    timeZone?: string;
    resolvedAt?: number;
    status?: string;
  },
  now = Date.now(),
  timeZone?: string,
): { startMs: number; endMs: number } {
  const zone = timeZone?.trim() || market.timeZone;
  const wide = market.endMs - market.startMs > MULTI_DAY_MS;
  if (!zone && !wide) return { startMs: market.startMs, endMs: market.endMs };
  const resolved = Boolean(market.resolvedAt) || market.status === "resolved";
  return localDayBounds(resolved ? market.startMs : now, zone);
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
  timeZone?: string;
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

/** Time for `catalogMillimeters` at this session's average pace, not the full workout. */
export function scoreDistanceTimeMs(
  session: {
    activeDurationMs: number;
    distanceMillimeters: number;
    averagePaceSecondsPerMeter?: number;
  },
  catalogMillimeters: number,
): number {
  if (session.activeDurationMs <= 0 || catalogMillimeters <= 0) return 0;
  if (session.distanceMillimeters < catalogMillimeters) return 0;
  if (session.averagePaceSecondsPerMeter && session.averagePaceSecondsPerMeter > 0) {
    return Math.max(1, Math.round(session.averagePaceSecondsPerMeter * catalogMillimeters));
  }
  return Math.max(1, Math.round((session.activeDurationMs * catalogMillimeters) / session.distanceMillimeters));
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
