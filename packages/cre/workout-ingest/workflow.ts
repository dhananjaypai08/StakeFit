import { cre, handlerInTee, httpRequest, Runner, type TeeRuntime } from "@chainlink/cre-sdk";

interface SessionLite {
  id: string;
  startMs: number;
  endMs: number;
  activeDurationMs: number;
  distanceMillimeters: number;
}

interface OpenMarket {
  id: string;
  distanceMillimeters: number;
  startMs: number;
  endMs: number;
  runners: Array<{ userId: string; sessions: SessionLite[] }>;
}

interface WorkflowConfig {
  schedule?: string;
  workoutUrl?: string;
  scoreUrl?: string;
  distanceMillimeters?: number;
  startMs?: number;
  endMs?: number;
}

const onIngest = (runtime: TeeRuntime<WorkflowConfig>, _trigger: unknown): { posted: number } => {
  runtime.getSecret({ id: "GOOGLE_REFRESH_TOKEN" }).result();
  const healthToken = runtime.getSecret({ id: "GOOGLE_HEALTH_ACCESS_TOKEN" }).result().value;
  const ingestSecret = runtime.getSecret({ id: "CRE_INGEST_SECRET" }).result().value;
  runtime.getSecret({ id: "OPENROUTER_API_KEY" }).result();
  const headers: Record<string, string> = {};
  if (healthToken) headers.Authorization = `Bearer ${healthToken}`;
  if (ingestSecret) headers["x-cre-secret"] = ingestSecret;
  const url = runtime.config.workoutUrl ?? "http://localhost:8787/cre/open-workouts";
  const http = new cre.capabilities.ConfidentialHTTPClient();
  const response = http
    .sendRequest(runtime, {
      request: httpRequest({ url, method: "GET", headers }),
    })
    .result();
  const body = JSON.parse(Buffer.from(response.body ?? []).toString("utf8") || "{}") as {
    markets?: OpenMarket[];
    sessions?: SessionLite[];
  };
  const markets =
    body.markets ??
    [
      {
        id: "demo",
        distanceMillimeters: runtime.config.distanceMillimeters ?? 50_000,
        startMs: runtime.config.startMs ?? 0,
        endMs: runtime.config.endMs ?? Date.now(),
        runners: [{ userId: "demo", sessions: body.sessions ?? [] }],
      },
    ];
  let posted = 0;
  for (const market of markets) {
    for (const runner of market.runners) {
      let best = { timeMs: 0, exerciseId: "" };
      for (const session of runner.sessions) {
        if (session.startMs < market.startMs || session.startMs > market.endMs) continue;
        if (session.distanceMillimeters < market.distanceMillimeters) continue;
        const timeMs = Math.max(
          1,
          Math.round((session.activeDurationMs * market.distanceMillimeters) / session.distanceMillimeters),
        );
        if (!best.exerciseId || timeMs < best.timeMs) {
          best = { timeMs, exerciseId: session.id };
        }
      }
      if (!best.exerciseId || !runtime.config.scoreUrl) continue;
      http
        .sendRequest(runtime, {
          request: httpRequest({
            url: runtime.config.scoreUrl,
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({
              marketId: market.id,
              userId: runner.userId,
              timeMs: best.timeMs,
              exerciseId: best.exerciseId,
            }),
          }),
        })
        .result();
      posted += 1;
      runtime.usingTheDons().log(`scored ${runner.userId} ${best.timeMs} ${best.exerciseId}`);
    }
  }
  return { posted };
};

const cron = new cre.capabilities.CronCapability();

export const workoutIngest = handlerInTee(
  cron.trigger({ schedule: "0 0 * * * *" }),
  onIngest,
);

export async function main() {
  const runner = await Runner.newRunner<WorkflowConfig>();
  await runner.run(async (_runtime) => ({ workoutIngest }));
}
