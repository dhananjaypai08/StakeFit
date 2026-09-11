import type { ExerciseSession } from "@stakefit/shared";
import { parseDurationMs, parseRfc3339Ms } from "./qualify";

export const HEALTH_API = "https://health.googleapis.com/v4";

export interface PairedDevice {
  name: string;
  deviceType?: string;
  deviceVersion?: string;
  lastSyncTime?: string;
  batteryLevel?: number;
}

export interface HealthClient {
  listExercises(opts?: { startCivil?: string; endCivil?: string; pageToken?: string }): Promise<{
    sessions: ExerciseSession[];
    nextPageToken?: string;
  }>;
  getExercise(id: string): Promise<ExerciseSession | undefined>;
  listPairedDevices(): Promise<PairedDevice[]>;
  listDistanceIntervals(): Promise<Array<{ startMs: number; endMs: number; millimeters: number }>>;
  listActiveEnergy(): Promise<Array<{ startMs: number; endMs: number; kcal: number }>>;
}

interface MetricsSummary {
  caloriesKcal?: number;
  distanceMillimeters?: number | string;
  steps?: string | number;
  averageSpeedMillimetersPerSecond?: number;
  averagePaceSecondsPerMeter?: number;
  averageHeartRateBeatsPerMinute?: string | number;
  elevationGainMillimeters?: number;
  activeZoneMinutes?: string | number;
  mobilityMetrics?: { avgStrideLengthMillimeters?: string | number };
}

interface SplitSummary {
  metricsSummary?: MetricsSummary;
}

interface DataPoint {
  name?: string;
  dataSource?: { platform?: string; recordingMethod?: string };
  exercise?: {
    interval?: { startTime?: string; endTime?: string };
    exerciseType?: string;
    displayName?: string;
    activeDuration?: string;
    splits?: SplitSummary[];
    splitSummaries?: SplitSummary[];
    metricsSummary?: MetricsSummary;
    exerciseMetadata?: { hasGps?: boolean };
  };
  distance?: { interval?: { startTime?: string; endTime?: string }; millimeters?: string | number };
  activeEnergyBurned?: { interval?: { startTime?: string; endTime?: string }; kcal?: number };
}

/**
 * Google Health API v4 client. Paths match
 * https://developers.google.com/health/reference/rest
 */
export function createHealthClient(accessToken: string, fetchImpl: typeof fetch = fetch): HealthClient {
  async function healthGet<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${HEALTH_API}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value) url.searchParams.set(key, value);
      }
    }
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Google Health ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  return {
    async listExercises(opts = {}) {
      const filter = civilFilter(opts.startCivil, opts.endCivil);
      const body = await healthGet<{ dataPoints?: DataPoint[]; nextPageToken?: string }>(
        "/users/me/dataTypes/exercise/dataPoints",
        { pageSize: "25", pageToken: opts.pageToken, filter },
      );
      return {
        sessions: (body.dataPoints ?? []).map(toSession),
        nextPageToken: body.nextPageToken,
      };
    },
    async getExercise(id: string) {
      const name = id.includes("/dataPoints/") ? id : `users/me/dataTypes/exercise/dataPoints/${id}`;
      const point = await healthGet<DataPoint>(`/${name}`);
      return point.exercise ? toSession(point) : undefined;
    },
    async listPairedDevices() {
      const body = await healthGet<{ pairedDevices?: PairedDevice[] }>("/users/me/pairedDevices");
      return body.pairedDevices ?? [];
    },
    async listDistanceIntervals() {
      const body = await healthGet<{ dataPoints?: DataPoint[] }>("/users/me/dataTypes/distance/dataPoints", {
        pageSize: "25",
      });
      return (body.dataPoints ?? [])
        .map((point) => ({
          startMs: parseRfc3339Ms(point.distance?.interval?.startTime),
          endMs: parseRfc3339Ms(point.distance?.interval?.endTime),
          millimeters: num(point.distance?.millimeters),
        }))
        .filter((row) => row.millimeters > 0);
    },
    async listActiveEnergy() {
      const body = await healthGet<{ dataPoints?: DataPoint[] }>(
        "/users/me/dataTypes/active-energy-burned/dataPoints",
        { pageSize: "25" },
      );
      return (body.dataPoints ?? [])
        .map((point) => ({
          startMs: parseRfc3339Ms(point.activeEnergyBurned?.interval?.startTime),
          endMs: parseRfc3339Ms(point.activeEnergyBurned?.interval?.endTime),
          kcal: num(point.activeEnergyBurned?.kcal),
        }))
        .filter((row) => row.kcal > 0);
    },
  };
}

export async function listAllExercises(
  client: HealthClient,
  opts?: { startCivil?: string; endCivil?: string; maxPages?: number },
): Promise<ExerciseSession[]> {
  const sessions: ExerciseSession[] = [];
  let pageToken: string | undefined;
  const maxPages = opts?.maxPages ?? 20;
  for (let page = 0; page < maxPages; page++) {
    const batch = await client.listExercises({ ...opts, pageToken });
    sessions.push(...batch.sessions);
    if (!batch.nextPageToken) break;
    pageToken = batch.nextPageToken;
  }
  const [distances, energy] = await Promise.all([
    client.listDistanceIntervals().catch(() => []),
    client.listActiveEnergy().catch(() => []),
  ]);
  for (const session of sessions) {
    if (session.distanceMillimeters <= 0) {
      session.distanceMillimeters = overlapSum(
        distances,
        session.startMs,
        session.endMs,
        (row) => row.millimeters,
      );
    }
    if (!session.caloriesKcal) {
      const kcal = overlapSum(energy, session.startMs, session.endMs, (row) => row.kcal);
      if (kcal) session.caloriesKcal = Math.round(kcal);
    }
  }
  return sessions.sort((a, b) => b.startMs - a.startMs);
}

function civilFilter(startCivil?: string, endCivil?: string): string | undefined {
  const parts: string[] = [];
  if (startCivil) parts.push(`exercise.interval.civil_start_time >= "${startCivil}"`);
  if (endCivil) parts.push(`exercise.interval.civil_start_time < "${endCivil}"`);
  return parts.length ? parts.join(" AND ") : undefined;
}

function overlapSum<T extends { startMs: number; endMs: number }>(
  rows: T[],
  startMs: number,
  endMs: number,
  value: (row: T) => number,
): number {
  let total = 0;
  for (const row of rows) {
    if (row.endMs < startMs || row.startMs > endMs) continue;
    total += value(row);
  }
  return total;
}

export function toSession(point: DataPoint): ExerciseSession {
  const exercise = point.exercise ?? {};
  const summary = exercise.metricsSummary ?? {};
  const startMs = parseRfc3339Ms(exercise.interval?.startTime);
  const endMs = parseRfc3339Ms(exercise.interval?.endTime);
  const activeDurationMs = parseDurationMs(exercise.activeDuration, Math.max(0, endMs - startMs));
  const splits = [...(exercise.splitSummaries ?? []), ...(exercise.splits ?? [])];
  const id = point.name?.split("/").pop() ?? point.name ?? `${startMs}`;
  return {
    id,
    displayName: prettyActivityName(exercise.displayName, exercise.exerciseType),
    exerciseType: exercise.exerciseType ?? "UNKNOWN",
    startMs,
    endMs,
    activeDurationMs,
    distanceMillimeters: resolveDistanceMm(summary, splits),
    steps: summary.steps !== undefined ? num(summary.steps) : undefined,
    caloriesKcal: summary.caloriesKcal ? num(summary.caloriesKcal) : undefined,
    heartRateBpm: summary.averageHeartRateBeatsPerMinute
      ? num(summary.averageHeartRateBeatsPerMinute)
      : undefined,
    elevationGainMillimeters: summary.elevationGainMillimeters
      ? num(summary.elevationGainMillimeters)
      : undefined,
    averagePaceSecondsPerMeter: summary.averagePaceSecondsPerMeter,
    hasGps: exercise.exerciseMetadata?.hasGps,
  };
}

export function resolveDistanceMm(summary: MetricsSummary, splits: SplitSummary[]): number {
  const direct = num(summary.distanceMillimeters);
  if (direct > 0) return direct;
  const fromSplits = splits.reduce((sum, split) => sum + num(split.metricsSummary?.distanceMillimeters), 0);
  if (fromSplits > 0) return fromSplits;
  return 0;
}

function prettyActivityName(displayName?: string, exerciseType?: string): string {
  const source = displayName?.trim() && !/^(UNKNOWN|OTHER)$/i.test(displayName.trim())
    ? displayName.trim()
    : exerciseType || "Workout";
  const spaced = source.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!spaced) return "Workout";
  if (!/[a-z]/.test(spaced)) {
    return spaced.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  return spaced;
}

function num(value: string | number | undefined): number {
  if (value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
