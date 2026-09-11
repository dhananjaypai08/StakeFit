import type { Finding, Severity } from "@stakefit/shared";
import type { ConsoleEntry, NetworkEntry } from "./browser";

export interface CheckInput {
  scanId: string;
  dom: string;
  endpoints: string[];
  network: NetworkEntry[];
  console: ConsoleEntry[];
}

interface PartialFinding {
  title: string;
  category: string;
  severity: Severity;
  confidence: number;
  description: string;
  evidence: string;
  location: string;
  remediation: string;
}

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "AWS access key id", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Slack token", re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: "Stripe live key", re: /sk_live_[0-9A-Za-z]{16,}/ },
  { name: "Generic bearer secret", re: /(secret|api[_-]?key|token)\s*[:=]\s*["'][0-9A-Za-z_-]{16,}["']/i },
  { name: "PEM private key", re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
];

/**
 * Non-destructive first pass. These findings are deterministic and run as a
 * baseline; the reasoning model builds on top of them with hypothesis testing.
 */
export function runPassiveChecks(input: CheckInput): PartialFinding[] {
  const findings: PartialFinding[] = [];

  for (const { name, re } of SECRET_PATTERNS) {
    const match = input.dom.match(re);
    if (match) {
      findings.push({
        title: `Possible ${name} exposed in client payload`,
        category: "Sensitive data exposure",
        severity: "high",
        confidence: 0.6,
        description: `A string matching a ${name} pattern was found in content served to the browser.`,
        evidence: match[0].slice(0, 12) + "...",
        location: "client bundle or DOM",
        remediation: "Remove secrets from client delivered code; rotate the exposed credential.",
      });
    }
  }

  const insecureForms = (input.dom.match(/<form[^>]*action=["']http:\/\/[^"']+["']/gi) ?? []).length;
  if (insecureForms > 0) {
    findings.push({
      title: "Form submits over plaintext HTTP",
      category: "Transport security",
      severity: "medium",
      confidence: 0.7,
      description: `${insecureForms} form(s) post to an http endpoint, exposing submitted data.`,
      evidence: `${insecureForms} insecure form action(s)`,
      location: "HTML forms",
      remediation: "Submit all forms over HTTPS.",
    });
  }

  const verbose = input.console.filter((c) => c.level === "error" && /at .*\(.*:\d+:\d+\)/.test(c.text));
  if (verbose.length > 0) {
    findings.push({
      title: "Verbose stack traces leaked to the client",
      category: "Information disclosure",
      severity: "low",
      confidence: 0.5,
      description: "Detailed error stack traces are visible in the browser console.",
      evidence: verbose[0].text.slice(0, 160),
      location: "console",
      remediation: "Disable verbose error output in production builds.",
    });
  }

  const serverErrors = input.network.filter((n) => n.status >= 500);
  if (serverErrors.length > 0) {
    findings.push({
      title: "Server errors observed during interaction",
      category: "Reliability and disclosure",
      severity: "low",
      confidence: 0.5,
      description: `${serverErrors.length} response(s) returned a 5xx status while probing.`,
      evidence: serverErrors
        .slice(0, 3)
        .map((n) => `${n.status} ${n.url}`)
        .join("; "),
      location: "network",
      remediation: "Investigate unhandled server errors and ensure they do not leak internals.",
    });
  }

  const idorLike = input.endpoints.filter((e) => /[?&](id|user|account|uid)=/i.test(e) || /\/\d+(\/|$)/.test(e));
  if (idorLike.length > 0) {
    findings.push({
      title: "Identifier bearing endpoints worth IDOR testing",
      category: "Access control",
      severity: "info",
      confidence: 0.4,
      description: "Endpoints reference direct object identifiers that may allow horizontal access.",
      evidence: idorLike.slice(0, 5).join("; "),
      location: "endpoints",
      remediation: "Verify authorization checks on object level access.",
    });
  }

  return findings;
}

export function toFinding(scanId: string, partial: PartialFinding, index: number): Finding {
  return {
    id: `${scanId}-f${index}`,
    scanId,
    ...partial,
    createdAt: Date.now(),
  };
}
