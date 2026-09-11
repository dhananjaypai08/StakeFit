/**
 * Shared domain types for StakeFit.
 *
 * These types are the contract between the agent engine, the orchestrator,
 * the live frontend, and the on-chain and off-chain settlement packages.
 */

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Verdict = "ALLOW" | "DENY" | "MANUAL_REVIEW";

export type TargetKind = "web2" | "web3";

/** A single vulnerability finding produced during a scan. */
export interface Finding {
  id: string;
  scanId: string;
  title: string;
  category: string;
  severity: Severity;
  /** Confidence from the reasoning model, 0 to 1. */
  confidence: number;
  description: string;
  evidence: string;
  location: string;
  /** Suggested remediation, plain text. */
  remediation: string;
  createdAt: number;
}

/**
 * A structured observation the agent chooses to persist. Observations are the
 * write side of the tight loop: they are emitted on-chain and indexed by the
 * StakeFit subgraph so future steps and future scans can recall them.
 */
export interface Observation {
  scanId: string;
  agent: string;
  target: string;
  findingType: string;
  severity: Severity;
  /** keccak digest of the full observation payload, for on-chain compactness. */
  digest: string;
  note: string;
  createdAt: number;
}

/** Belief state the agent maintains about the target as it learns. */
export interface BeliefState {
  target: string;
  kind: TargetKind;
  routes: string[];
  endpoints: string[];
  forms: Array<{ action: string; method: string; fields: string[] }>;
  fingerprint: Record<string, string>;
  /** Contract address when the target is a web3 dApp. */
  contract?: string;
  notes: string[];
}

/** Names of the tools the reasoning model can call each step. */
export type ToolName =
  | "navigate"
  | "click"
  | "scroll"
  | "fill"
  | "submit"
  | "readDom"
  | "listEndpoints"
  | "listLinks"
  | "readConsole"
  | "readNetwork"
  | "probe"
  | "screenshot"
  | "querySubgraph"
  | "recordObservation"
  | "finish";

export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
  reason: string;
  /** Model rationale shown as the think step in the live loop. */
  thought?: string;
}

export interface ToolResult {
  tool: ToolName;
  ok: boolean;
  summary: string;
  data?: unknown;
}

/**
 * Events streamed from the orchestrator to the live frontend over WebSocket.
 * The frontend renders these as the live browser viewport, the decision
 * timeline, the network and console feed, and the findings panel.
 */
export type ScanEvent =
  | { type: "scan.started"; scanId: string; target: string; kind: TargetKind; at: number }
  | { type: "agent.spawned"; scanId: string; agent: string; ensName?: string; at: number }
  | { type: "agent.thought"; scanId: string; agent: string; text: string; at: number }
  | { type: "agent.action"; scanId: string; agent: string; call: ToolCall; at: number }
  | { type: "agent.observation"; scanId: string; agent: string; result: ToolResult; at: number }
  | { type: "browser.frame"; scanId: string; agent: string; jpegBase64: string; at: number }
  | { type: "network.entry"; scanId: string; method: string; url: string; status: number; at: number }
  | { type: "console.entry"; scanId: string; level: string; text: string; at: number }
  | { type: "finding.added"; scanId: string; finding: Finding; at: number }
  | { type: "graph.read"; scanId: string; query: string; summary: string; at: number }
  | { type: "graph.write"; scanId: string; observation: Observation; txHash?: string; at: number }
  | { type: "verdict.ready"; scanId: string; verdict: Verdict; score: number; at: number }
  | { type: "report.ready"; scanId: string; url: string; cid?: string; at: number }
  | { type: "report.pinned"; scanId: string; cid: string; at: number }
  | { type: "ens.updated"; scanId: string; name: string; contenthash: string; at: number }
  | { type: "certificate.minted"; scanId: string; tokenId: string; serial: string; at: number }
  | { type: "hcs.logged"; scanId: string; topicId: string; sequenceNumber: string; at: number }
  | { type: "scan.finished"; scanId: string; verdict: Verdict; reportCid: string; at: number }
  | { type: "scan.error"; scanId: string; message: string; at: number };

/** The confidential verdict produced inside the CRE TEE. */
export interface AuditVerdict {
  scanId: string;
  verdict: Verdict;
  /** CVSS style aggregate score, 0 to 10. */
  score: number;
  rationale: string;
  /** Signature material returned after crossing back to the DON. */
  signature?: string;
  createdAt: number;
}

/** The final report that gets pinned to IPFS and certified. */
export interface AuditReport {
  scanId: string;
  target: string;
  kind: TargetKind;
  startedAt: number;
  finishedAt: number;
  verdict: Verdict;
  score: number;
  summary: string;
  findings: Finding[];
  observations: Observation[];
  graphIntel: string[];
  agents: Array<{ agent: string; ensName?: string }>;
  /** Populated as settlement completes. */
  reportCid?: string;
  ensName?: string;
  certificateTokenId?: string;
  certificateSerial?: string;
  hcsTopicId?: string;
  auditRegistryTx?: string;
}

export const SEVERITY_SCORE: Record<Severity, number> = {
  info: 0,
  low: 2.5,
  medium: 5,
  high: 7.5,
  critical: 9.5,
};

export function nowMs(): number {
  return Date.now();
}

export * from "./stakefit";
