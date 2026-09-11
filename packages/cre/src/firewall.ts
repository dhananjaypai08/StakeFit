import { type AuditVerdict, type Finding, SEVERITY_SCORE, type Verdict } from "@stakefit/shared";
import { ruleFor } from "./rubric";

export interface FirewallInput {
  scanId: string;
  target: string;
  findings: Finding[];
  /** Unpredictable seed sourced from Chainlink VRF; perturbs audit sampling. */
  fuzzSeed?: number;
}

/** Optional model hook, so the firewall can run two independent LLM audits. */
export type AuditModel = (prompt: string) => Promise<string>;

/**
 * The audit firewall. It aggregates findings under the secret rubric into a
 * single ALLOW, DENY, or MANUAL_REVIEW verdict plus a CVSS style score.
 *
 * When two model hooks are provided it runs two independent audits and merges
 * their risk flags, mirroring the Chainlink AI Smart Contract Audit Firewall
 * pattern. Without models it applies the deterministic rubric so the pipeline
 * always produces a verdict.
 */
export async function runAuditFirewall(input: FirewallInput, models?: [AuditModel, AuditModel]): Promise<AuditVerdict> {
  const rubricScore = scoreByRubric(input.findings);

  let modelFlags = 0;
  let rationaleExtra = "";
  if (models) {
    const [a, b] = models;
    const prompt = buildAuditPrompt(input);
    const [ra, rb] = await Promise.all([safeModel(a, prompt), safeModel(b, prompt)]);
    const flagsA = extractRiskFlag(ra);
    const flagsB = extractRiskFlag(rb);
    modelFlags = Math.max(flagsA, flagsB);
    rationaleExtra = ` Two independent audits returned risk levels ${flagsA} and ${flagsB}.`;
  }

  // Fuzz seed nudges borderline cases toward manual review to avoid gaming.
  const seedJitter = input.fuzzSeed ? (input.fuzzSeed % 100) / 200 : 0;
  const score = Math.min(10, Math.max(rubricScore, modelFlags * 2.5) + seedJitter);

  const verdict = decideVerdict(score, input.findings);
  const rationale =
    `Aggregate score ${score.toFixed(2)} of 10 across ${input.findings.length} findings under the confidential rubric.` +
    rationaleExtra;

  return { scanId: input.scanId, verdict, score, rationale, createdAt: Date.now() };
}

function scoreByRubric(findings: Finding[]): number {
  if (findings.length === 0) return 0;
  let max = 0;
  for (const f of findings) {
    const rule = ruleFor(f.category);
    const weighted = SEVERITY_SCORE[f.severity] * rule.weight * (0.5 + f.confidence / 2);
    if (weighted > max) max = weighted;
  }
  return max;
}

function decideVerdict(score: number, findings: Finding[]): Verdict {
  const hasCritical = findings.some((f) => f.severity === "critical");
  if (score >= 8 || hasCritical) return "DENY";
  if (score >= 5) return "MANUAL_REVIEW";
  return "ALLOW";
}

function buildAuditPrompt(input: FirewallInput): string {
  const lines = input.findings.map((f) => `- [${f.severity}] ${f.category}: ${f.title} (${f.description})`);
  return `Assess the security risk of ${input.target}. Findings:\n${lines.join("\n")}\nReturn a single line: RISK=<0-4> where 4 is critical.`;
}

function extractRiskFlag(text: string): number {
  const m = text.match(/RISK\s*=\s*(\d)/i);
  if (m) return Math.min(4, Math.max(0, Number(m[1])));
  if (/critical/i.test(text)) return 4;
  if (/high/i.test(text)) return 3;
  if (/medium/i.test(text)) return 2;
  if (/low/i.test(text)) return 1;
  return 0;
}

async function safeModel(model: AuditModel, prompt: string): Promise<string> {
  try {
    return await model(prompt);
  } catch {
    return "RISK=0";
  }
}
