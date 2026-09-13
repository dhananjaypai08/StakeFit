import {
  catalogById,
  scoreDistanceTimeMs,
  type DistanceId,
  type ExerciseSession,
  type QualifyingResult,
} from "@stakefit/shared";

/**
 * A session qualifies when it starts inside the heat window and covers at least
 * the catalog distance. Score is pace applied to that distance, not the full lap.
 */
export function qualifySession(
  session: ExerciseSession,
  distanceId: DistanceId,
  window: { startMs: number; endMs: number },
): QualifyingResult {
  const catalog = catalogById(distanceId);
  if (!catalog) return { ok: false, reason: `unknown distance ${distanceId}` };
  if (session.startMs < window.startMs || session.startMs > window.endMs) {
    return { ok: false, reason: "session start is outside the heat window" };
  }
  if (session.distanceMillimeters < catalog.millimeters) {
    return {
      ok: false,
      reason: `distance ${session.distanceMillimeters}mm is short of ${catalog.millimeters}mm`,
    };
  }
  const timeMs = scoreDistanceTimeMs(session, catalog.millimeters);
  if (timeMs <= 0) {
    return { ok: false, reason: "session has no active duration" };
  }
  return { ok: true, timeMs, exerciseId: session.id };
}

/** Best (lowest) qualifying time in the window. */
export function bestQualifying(
  sessions: ExerciseSession[],
  distanceId: DistanceId,
  window: { startMs: number; endMs: number },
): QualifyingResult {
  let best: QualifyingResult = { ok: false, reason: "no qualifying session" };
  for (const session of sessions) {
    const result = qualifySession(session, distanceId, window);
    if (!result.ok || result.timeMs === undefined) continue;
    if (!best.ok || best.timeMs === undefined || result.timeMs < best.timeMs) {
      best = result;
    }
  }
  return best;
}

export function parseDurationMs(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const match = value.match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  if (!match) return fallbackMs;
  return Math.round(Number(match[1]) * 1000);
}

export function parseRfc3339Ms(value: string | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function rankWithTies<T extends { timeMs: number; userId: string }>(
  rows: T[],
  vrfSeed = 0n,
): T[] {
  return [...rows].sort((a, b) => {
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    const ha = fnv(a.userId, vrfSeed);
    const hb = fnv(b.userId, vrfSeed);
    if (ha === hb) return a.userId.localeCompare(b.userId);
    return ha < hb ? -1 : 1;
  });
}

function fnv(input: string, seed: bigint): bigint {
  let hash = 0xcbf29ce484222325n ^ seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}
