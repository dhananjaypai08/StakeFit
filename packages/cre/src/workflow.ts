/**
 * StakeFit confidential audit firewall, as a Chainlink CRE Confidential Workflow.
 *
 * Simulate from packages/cre:
 *   cre workflow simulate audit-firewall --target staging-settings --non-interactive --trigger-index 0
 */
import { cre, Runner, type Report, type TeeRuntime } from "@chainlink/cre-sdk";

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

function loadFindings(http: InstanceType<typeof cre.HttpClient>, runtime: TeeRuntime<WorkflowConfig>): FindingLite[] {
  const url = runtime.config.findingsUrl;
  if (url) {
    return JSON.parse(http.sendRequest(runtime, { url }).result().body) as FindingLite[];
  }
  return runtime.config.findings ?? [];
}

function loadFuzzSeed(http: InstanceType<typeof cre.HttpClient>, runtime: TeeRuntime<WorkflowConfig>): number {
  const url = runtime.config.vrfSeedUrl;
  if (url) {
    return Number(http.sendRequest(runtime, { url }).result().body) || 0;
  }
  return runtime.config.fuzzSeed ?? 0;
}

/** The confidential handler. Everything in this callback runs inside the TEE. */
export const auditFirewall = cre.handlerInTee<WorkflowConfig>(
  cre.cron.trigger("0 */6 * * * *"),
  (runtime, _trigger) => {
    const apiKey = runtime.getSecret({ id: "OPENROUTER_API_KEY" }).result().value;
    const rubricRaw = runtime.getSecret({ id: "STAKEFIT_RUBRIC" }).result().value;
    runtime.log("secrets fetched inside enclave");

    const http = new cre.HttpClient();
    const findings = loadFindings(http, runtime);
    const fuzzSeed = loadFuzzSeed(http, runtime);

    const riskA = auditOnceSync(http, runtime, apiKey, findings, 0.1);
    const riskB = auditOnceSync(http, runtime, apiKey, findings, 0.5);

    const rubricMax = findings.reduce((m, f) => Math.max(m, severityScore(f.severity) * (0.5 + f.confidence / 2)), 0);
    const seedJitter = (fuzzSeed % 100) / 200;
    const score = Math.min(10, Math.max(rubricMax, Math.max(riskA, riskB) * 2.5) + seedJitter);
    const verdict = score >= 8 ? "DENY" : score >= 5 ? "MANUAL_REVIEW" : "ALLOW";
    runtime.log(`rubric length ${rubricRaw.length} verdict ${verdict} score ${score.toFixed(2)}`);

    const don = runtime.usingTheDons();
    const report: Report = runtime.reportFromDon({ verdict, score }).result();
    const evm = new cre.EvmClient(runtime.config.targetChain);
    const write = evm
      .writeReport(don, {
        chain: runtime.config.targetChain,
        address: runtime.config.auditRegistryAddress,
        report,
        args: [verdict, Math.round(score * 100)],
      })
      .result();

    return { verdict, score, txHash: write.txHash };
  },
  [{ tee: "nitro", regions: ["us-west-2"] }],
);

function auditOnceSync(
  http: InstanceType<typeof cre.HttpClient>,
  runtime: TeeRuntime<WorkflowConfig>,
  apiKey: string,
  findings: FindingLite[],
  temperature: number,
): number {
  if (!apiKey || findings.length === 0) return 0;
  const prompt = findings.map((f) => `- [${f.severity}] ${f.category}: ${f.title}`).join("\n");
  const res = http
    .sendRequest(runtime, {
      url: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4.6",
        temperature,
        messages: [
          { role: "system", content: "You are a security auditor. Return a single line RISK=<0-4>." },
          { role: "user", content: `Findings:\n${prompt}` },
        ],
      }),
    })
    .result();
  return extractRisk(res.body);
}

export async function main(): Promise<void> {
  const runner = await Runner.newRunner<WorkflowConfig>();
  await runner.run(() => [auditFirewall]);
}
