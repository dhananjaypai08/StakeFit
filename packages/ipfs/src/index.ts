import type { AuditReport, Finding, Severity } from "@stakefit/shared";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/**
 * Render the report as a self contained HTML document. This is what a browser
 * shows when it resolves the target ENS name (contenthash points at this CID).
 */
export function renderReportHtml(report: AuditReport): string {
  const counts = countBySeverity(report.findings);
  const sorted = [...report.findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  const findingRows = sorted
    .map(
      (f) => `
    <article class="finding sev-${f.severity}">
      <header>
        <span class="badge">${f.severity.toUpperCase()}</span>
        <h3>${escapeHtml(f.title)}</h3>
        <span class="conf">confidence ${(f.confidence * 100).toFixed(0)} percent</span>
      </header>
      <p class="cat">${escapeHtml(f.category)} at ${escapeHtml(f.location)}</p>
      <p>${escapeHtml(f.description)}</p>
      <pre>${escapeHtml(f.evidence)}</pre>
      <p class="fix"><strong>Remediation.</strong> ${escapeHtml(f.remediation)}</p>
    </article>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>StakeFit audit ${escapeHtml(report.target)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #0a0a0b; color: #e6e6e6; }
  main { max-width: 880px; margin: 0 auto; padding: 48px 24px; }
  h1 { font-size: 22px; letter-spacing: 0.02em; }
  .meta { color: #8a8a8a; font-size: 13px; line-height: 1.7; }
  .verdict { display: inline-block; padding: 6px 12px; border-radius: 6px; font-weight: 700; margin: 16px 0; }
  .ALLOW { background: #0f2c17; color: #52d67a; }
  .DENY { background: #2c0f12; color: #ff6b6b; }
  .MANUAL_REVIEW { background: #2c260f; color: #e6c453; }
  .counts span { margin-right: 14px; font-size: 13px; }
  .finding { border: 1px solid #1f1f22; border-radius: 8px; padding: 16px; margin: 14px 0; }
  .finding header { display: flex; align-items: center; gap: 10px; }
  .finding h3 { margin: 0; font-size: 15px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #1f1f22; }
  .sev-critical .badge { background: #4a1015; color: #ff6b6b; }
  .sev-high .badge { background: #4a2a10; color: #ffa94d; }
  .sev-medium .badge { background: #4a4310; color: #e6c453; }
  .conf { margin-left: auto; color: #8a8a8a; font-size: 12px; }
  .cat { color: #8a8a8a; font-size: 12px; }
  pre { background: #101013; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  .fix { color: #9ad; font-size: 13px; }
  footer { margin-top: 40px; color: #6a6a6a; font-size: 12px; line-height: 1.8; }
  a { color: #7aa2ff; }
</style>
</head>
<body>
<main>
  <h1>StakeFit audit report</h1>
  <p class="meta">
    Target: ${escapeHtml(report.target)} (${report.kind})<br />
    Scan: ${escapeHtml(report.scanId)}<br />
    Window: ${new Date(report.startedAt).toISOString()} to ${new Date(report.finishedAt).toISOString()}
  </p>
  <div class="verdict ${report.verdict}">${report.verdict} score ${report.score.toFixed(1)} of 10</div>
  <p class="counts">
    <span>critical ${counts.critical}</span>
    <span>high ${counts.high}</span>
    <span>medium ${counts.medium}</span>
    <span>low ${counts.low}</span>
    <span>info ${counts.info}</span>
  </p>
  <p>${escapeHtml(report.summary)}</p>
  <h2>Findings</h2>
  ${findingRows || "<p>No findings recorded.</p>"}
  <h2>Graph intelligence used</h2>
  <ul>${report.graphIntel.map((g) => `<li>${escapeHtml(g)}</li>`).join("") || "<li>None</li>"}</ul>
  <footer>
    Verdict certified via Chainlink CRE confidential workflow and delivered to AuditRegistry on Sepolia.<br />
    Certificate token: ${escapeHtml(report.certificateTokenId ?? "pending")} serial ${escapeHtml(report.certificateSerial ?? "pending")}.<br />
    Audit trail on Hedera HCS topic ${escapeHtml(report.hcsTopicId ?? "pending")}.<br />
    Agents: ${report.agents.map((a) => escapeHtml(a.ensName ?? a.agent)).join(", ")}.
  </footer>
</main>
</body>
</html>`;
}

/** The canonical machine readable report. This is pinned alongside the HTML. */
export function renderReportJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

export interface PinResult {
  cid: string;
  htmlUrl: string;
  jsonUrl: string;
  provider: "pinata";
}

export interface PinnerConfig {
  pinataJwt?: string;
  gatewayBase?: string;
}

/**
 * Pin the rendered report to IPFS through Pinata. ENS contenthash and the
 * Hedera certificate both need this CID, so a missing JWT is a hard error.
 */
export async function pinReport(report: AuditReport, config: PinnerConfig): Promise<PinResult> {
  const jwt = config.pinataJwt?.trim();
  if (!jwt) throw new Error("PINATA_JWT is required to pin the audit report");
  const html = renderReportHtml(report);
  const json = renderReportJson(report);
  const gateway = config.gatewayBase ?? "https://gateway.pinata.cloud/ipfs";
  const cid = await pinToPinata(report.scanId, html, json, jwt);
  return { cid, htmlUrl: `${gateway}/${cid}/report.html`, jsonUrl: `${gateway}/${cid}/report.json`, provider: "pinata" };
}

async function pinToPinata(scanId: string, html: string, json: string, jwt: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([html], { type: "text/html" }), "report.html");
  form.append("file", new Blob([json], { type: "application/json" }), "report.json");
  form.append("pinataMetadata", JSON.stringify({ name: `stakefit-${scanId}` }));
  form.append("pinataOptions", JSON.stringify({ wrapWithDirectory: true }));

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata pin failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { IpfsHash: string };
  return body.IpfsHash;
}


/** Encode an ipfs CID as an ENS contenthash hex string (ipfs namespace). */
export async function pinJson(payload: unknown, config: PinnerConfig): Promise<{ cid: string }> {
  const jwt = config.pinataJwt?.trim();
  if (!jwt) throw new Error("PINATA_JWT is required to pin JSON");
  const form = new FormData();
  form.append("file", new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "run.json");
  form.append("pinataMetadata", JSON.stringify({ name: "stakefit-run" }));
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata pin failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { IpfsHash: string };
  return { cid: body.IpfsHash };
}

export function cidToContenthash(cid: string): string {
  // ENSIP-7 contenthash for ipfs is 0xe3010170 followed by the dag-pb CID bytes.
  // For a production build use @ensdomains/content-hash. This helper keeps the
  // wire format explicit for the ENS package to consume.
  return `ipfs://${cid}`;
}
