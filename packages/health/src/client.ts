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
}

interface DataPoint {
  name?: string;
  dataSource?: { platform?: string; recordingMethod?: string };
  exercise?: {
    interval?: { startTime?: string; endTime?: string };
    exerciseType?: string;
    displayName?: string;
    activeDuration?: string;
    metricsSummary?: {
      distanceMillimeters?: number;
      steps?: string | number;
      averagePaceSecondsPerMeter?: number;
    };
    exerciseMetadata?: { hasGps?: boolean };
  };
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
  return sessions.sort((a, b) => b.startMs - a.startMs);
}

function civilFilter(startCivil?: string, endCivil?: string): string | undefined {
  const parts: string[] = [];
  if (startCivil) parts.push(`exercise.interval.civil_start_time >= "${startCivil}"`);
  if (endCivil) parts.push(`exercise.interval.civil_start_time < "${endCivil}"`);
  return parts.length ? parts.join(" AND ") : undefined;
}

export function toSession(point: DataPoint): ExerciseSession {
  const exercise = point.exercise ?? {};
  const startMs = parseRfc3339Ms(exercise.interval?.startTime);
  const endMs = parseRfc3339Ms(exercise.interval?.endTime);
  const id = point.name?.split("/").pop() ?? point.name ?? `${startMs}`;
  return {
    id,
    displayName: exercise.displayName ?? exercise.exerciseType ?? "Workout",
    exerciseType: exercise.exerciseType ?? "UNKNOWN",
    startMs,
    endMs,
    activeDurationMs: parseDurationMs(exercise.activeDuration, Math.max(0, endMs - startMs)),
    distanceMillimeters: Number(exercise.metricsSummary?.distanceMillimeters ?? 0),
    steps: exercise.metricsSummary?.steps !== undefined ? Number(exercise.metricsSummary.steps) : undefined,
    averagePaceSecondsPerMeter: exercise.metricsSummary?.averagePaceSecondsPerMeter,
    hasGps: exercise.exerciseMetadata?.hasGps,
  };
}
