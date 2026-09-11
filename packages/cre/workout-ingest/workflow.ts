import { cre, handlerInTee, httpRequest, Runner, type TeeRuntime } from "@chainlink/cre-sdk";

interface SessionLite {
  id: string;
  startMs: number;
  endMs: number;
  activeDurationMs: number;
  distanceMillimeters: number;
}

interface WorkflowConfig {
  schedule?: string;
  workoutUrl?: string;
  distanceMillimeters?: number;
  startMs?: number;
  endMs?: number;
}

/**
 * Confidential ingest: fetch the user's sessions (token stays in the TEE via
 * getSecret in a live deploy) and emit only the best qualifying time.
 */
const onIngest = (runtime: TeeRuntime<WorkflowConfig>, _trigger: unknown): { timeMs: number; exerciseId: string } => {
  runtime.getSecret({ id: "OPENROUTER_API_KEY" }).result();
  const url = runtime.config.workoutUrl ?? "http://localhost:8787/cre/workout/demo";
  const http = new cre.capabilities.ConfidentialHTTPClient();
  const response = http
    .sendRequest(runtime, {
      request: httpRequest({ url, method: "GET" }),
    })
    .result();
  const body = JSON.parse(Buffer.from(response.body ?? []).toString("utf8") || "{}") as { sessions?: SessionLite[] };
  const start = runtime.config.startMs ?? 0;
  const end = runtime.config.endMs ?? Date.now();
  const need = runtime.config.distanceMillimeters ?? 50_000;
  let best = { timeMs: 0, exerciseId: "" };
  for (const session of body.sessions ?? []) {
    if (session.startMs < start || session.startMs > end) continue;
    if (session.distanceMillimeters < need) continue;
    if (!best.exerciseId || session.activeDurationMs < best.timeMs) {
      best = { timeMs: session.activeDurationMs, exerciseId: session.id };
    }
  }
  runtime.usingTheDons().log(`best ${best.timeMs} ${best.exerciseId}`);
  return best;
};

const cron = new cre.capabilities.CronCapability();

export const workoutIngest = handlerInTee(
  cron.trigger({ schedule: "0 * * * * *" }),
  onIngest,
);

export async function main() {
  const runner = await Runner.newRunner<WorkflowConfig>();
  await runner.run(async (_runtime) => ({ workoutIngest }));
}
