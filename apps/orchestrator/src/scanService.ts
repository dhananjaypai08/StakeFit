import {
  StakeFitAgent,
  HttpGraphClient,
  LlmClient,
  loadGraphConfig,
  loadLlmConfig,
} from "@stakefit/agent";
import {
  hasEnsWriteAccess,
  loadEnsConfig,
  registerAgentIdentity,
  delegateReputationRole,
} from "@stakefit/ens";
import { renderReportHtml } from "@stakefit/ipfs";
import type { AuditReport, TargetKind } from "@stakefit/shared";
import { Wallet } from "ethers";
import { randomBytes } from "node:crypto";
import type { OrchestratorConfig } from "./config";
import type { EventHub } from "./eventHub";
import { makeObservationRecorder } from "./observation";
import { settleAudit } from "./settlement";

export interface StartScanInput {
  target: string;
  depth?: number;
  contract?: string;
}

export class ScanService {
  private readonly findingsStore = new Map<string, import("@stakefit/shared").Finding[]>();
  private readonly reports = new Map<string, AuditReport>();
  private readonly reportHtml = new Map<string, string>();
  private readonly claimed = new Set<string>();

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly hub: EventHub,
  ) {}

  /** Findings for a scan, served to the CRE confidential workflow as input. */
  getFindings(scanId: string): import("@stakefit/shared").Finding[] {
    return this.findingsStore.get(scanId) ?? [];
  }

  /** Start a scan and return its id immediately; work proceeds asynchronously. */
  start(input: StartScanInput): string {
    const scanId = `scan_${randomBytes(8).toString("hex")}`;
    void this.run(scanId, input).catch((err) => {
      this.hub.publish({ type: "scan.error", scanId, message: (err as Error).message, at: Date.now() });
    });
    return scanId;
  }

  private async run(scanId: string, input: StartScanInput): Promise<void> {
    const target = input.target;
    const kind: TargetKind = input.contract ? "web3" : "web2";
    const startedAt = Date.now();
    const emit = (e: Parameters<EventHub["publish"]>[0]) => this.hub.publish(e);

    emit({ type: "scan.started", scanId, target, kind, at: startedAt });

    const agentId = `probe-${randomBytes(3).toString("hex")}`;
    const ensName = await this.registerAgent(agentId).catch(() => undefined);
    emit({ type: "agent.spawned", scanId, agent: agentId, ensName, at: Date.now() });

    const llm = new LlmClient(loadLlmConfig());
    const graph = new HttpGraphClient(loadGraphConfig());
    const recorder = makeObservationRecorder(this.config);

    const agent = new StakeFitAgent({
      scanId,
      target,
      kind,
      agentId,
      ensName,
      contract: input.contract,
      maxSteps: Math.max(1, Math.min(30, input.depth ?? 12)),
      llm,
      graph,
      recorder,
      emit,
    });

    const result = await agent.run();
    this.findingsStore.set(scanId, result.findings);

    const report: AuditReport = {
      scanId,
      target,
      kind,
      startedAt,
      finishedAt: Date.now(),
      verdict: "MANUAL_REVIEW",
      score: 0,
      summary: "",
      findings: result.findings,
      observations: result.observations,
      graphIntel: result.graphIntel,
      agents: [{ agent: agentId, ensName }],
    };

    const settled = await settleAudit({ report, llm, config: this.config, emit });
    this.reports.set(scanId, settled);
    this.reportHtml.set(scanId, renderReportHtml(settled));
  }

  getReport(scanId: string): AuditReport | undefined {
    return this.reports.get(scanId);
  }

  getReportHtml(scanId: string): string | undefined {
    return this.reportHtml.get(scanId);
  }

  isClaimed(scanId: string): boolean {
    return this.claimed.has(scanId);
  }

  claim(scanId: string): boolean {
    if (!this.reports.has(scanId)) return false;
    this.claimed.add(scanId);
    return true;
  }

  /** Best effort ENSv2 agent identity with a delegated reputation role. */
  private async registerAgent(agentId: string): Promise<string | undefined> {
    const ensConfig = loadEnsConfig();
    if (!hasEnsWriteAccess(ensConfig) || !ensConfig.auditResolverAddress || !ensConfig.privateKey) {
      return undefined;
    }
    const owner = new Wallet(ensConfig.privateKey).address;
    const identity = await registerAgentIdentity(ensConfig, {
      label: agentId,
      owner,
      resolver: ensConfig.auditResolverAddress,
      durationSeconds: 60 * 60 * 24, // scan session identities expire after a day
    });
    // Delegate only the reputation text key to the orchestrator via EAC.
    await delegateReputationRole(ensConfig, {
      name: identity.name,
      key: "scans.completed",
      resolver: ensConfig.auditResolverAddress,
      orchestrator: owner,
    }).catch(() => undefined);
    return identity.name;
  }
}
