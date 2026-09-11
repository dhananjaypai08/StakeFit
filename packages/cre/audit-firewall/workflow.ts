import { cre, handlerInTee, httpRequest, Runner, text, type TeeRuntime } from "@chainlink/cre-sdk";

interface FindingLite {
  category: string;
  severity: string;
  confidence: number;
  title: string;
}

interface WorkflowConfig {
  schedule?: string;
  auditRegistryAddress: string;
  targetChain: string;
  findingsUrl?: string;
  vrfSeedUrl?: string;
  fuzzSeed?: number;
  findings?: FindingLite[];
}

function severityScore(sev: string): number {
  return { info: 0, low: 2.5, medium: 5, high: 7.5, critical: 9.5 }[sev] ?? 0;
}

function extractRisk(text: string): number {
  const m = text.match(/RISK\s*=\s*(\d)/i);
  return m ? Math.min(4, Math.max(0, Number(m[1]))) : 0;
}

const onAudit = (runtime: TeeRuntime<WorkflowConfig>, _trigger: unknown): { verdict: string; score: number } => {
  const apiKey = runtime.getSecret({ id: "OPENROUTER_API_KEY" }).result().value;
  const rubricRaw = runtime.getSecret({ id: "STAKEFIT_RUBRIC" }).result().value;
  runtime.log("secrets fetched inside enclave");

  const findings = runtime.config.findings ?? [];
  const fuzzSeed = runtime.config.fuzzSeed ?? 0;
  const riskA = auditOnce(runtime, apiKey, findings, 0.1);
  const riskB = auditOnce(runtime, apiKey, findings, 0.5);
  const rubricMax = findings.reduce((m, f) => Math.max(m, severityScore(f.severity) * (0.5 + f.confidence / 2)), 0);
  const seedJitter = (fuzzSeed % 100) / 200;
  const score = Math.min(10, Math.max(rubricMax, Math.max(riskA, riskB) * 2.5) + seedJitter);
  const verdict = score >= 8 ? "DENY" : score >= 5 ? "MANUAL_REVIEW" : "ALLOW";
  runtime.log(`rubric length ${rubricRaw.length} verdict ${verdict} score ${score.toFixed(2)}`);

  const don = runtime.usingTheDons();
  don.log(`consensus verdict ${verdict}`);
  return { verdict, score };
};

function auditOnce(
  runtime: TeeRuntime<WorkflowConfig>,
  apiKey: string,
  findings: FindingLite[],
  temperature: number,
): number {
  if (!apiKey || findings.length === 0) return 0;
  const http = new cre.capabilities.ConfidentialHTTPClient();
  const prompt = findings.map((f) => `- [${f.severity}] ${f.category}: ${f.title}`).join("\n");
  const response = http
    .sendRequest(runtime, {
      request: httpRequest({
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: {
          model: "anthropic/claude-sonnet-4.6",
          temperature,
          messages: [
            { role: "system", content: "You are a security auditor. Return a single line RISK=<0-4>." },
            { role: "user", content: `Findings:\n${prompt}` },
          ],
        },
      }),
    })
    .result();
  return extractRisk(text(response));
}

const cron = new cre.capabilities.CronCapability();

export const auditFirewall = handlerInTee(
  cron.trigger({ schedule: "0 */6 * * * *" }),
  onAudit,
  [{ tee: "nitro", regions: ["us-west-2"] }],
);

export async function main(): Promise<void> {
  const runner = await Runner.newRunner<WorkflowConfig>();
  await runner.run(() => [auditFirewall]);
}
