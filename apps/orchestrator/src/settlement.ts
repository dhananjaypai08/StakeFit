import { LlmClient } from "@stakefit/agent";
import { runAuditFirewall, type AuditModel } from "@stakefit/cre";
import {
  loadEnsConfig,
  hasEnsWriteAccess,
  publishAuditIdentity,
  setReputation,
  targetLabel,
} from "@stakefit/ens";
import {
  createAuditTopic,
  hasHederaCredentials,
  loadHederaConfig,
  logAction,
  makeClient,
  mintCertificate,
} from "@stakefit/hedera";
import { pinReport } from "@stakefit/ipfs";
import type { AuditReport, ScanEvent, Verdict } from "@stakefit/shared";
import { Contract, JsonRpcProvider, Wallet, id } from "ethers";
import type { OrchestratorConfig } from "./config";

const AUDIT_REGISTRY_ABI = [
  "function submitVerdict(bytes32 scanId, string target, uint8 verdict, uint16 score, string reportCid)",
];

const VERDICT_CODE: Record<Verdict, number> = { ALLOW: 0, MANUAL_REVIEW: 1, DENY: 2 };

export interface SettleParams {
  report: AuditReport;
  llm: LlmClient;
  config: OrchestratorConfig;
  emit: (event: ScanEvent) => void;
}

/**
 * Runs the on-chain and off-chain settlement after the scan loop finishes:
 * confidential verdict, IPFS pin, ENS publish, soulbound certificate, HCS trail,
 * and the Sepolia verdict registry. Every step is best effort and degrades
 * gracefully when a given integration is not configured.
 */
export async function settleAudit(params: SettleParams): Promise<AuditReport> {
  const { report, llm, config, emit } = params;
  const scanId = report.scanId;

  // 1. Confidential audit firewall verdict (mirrors the CRE TEE logic locally).
  const models: [AuditModel, AuditModel] | undefined = llm.available
    ? [
        (p) => llm.chat([{ role: "user", content: p }], { temperature: 0.1 }),
        (p) => llm.chat([{ role: "user", content: p }], { temperature: 0.5 }),
      ]
    : undefined;
  const fuzzSeed = Math.floor(Math.random() * 1_000_000);
  const verdict = await runAuditFirewall({ scanId, target: report.target, findings: report.findings, fuzzSeed }, models);
  report.verdict = verdict.verdict;
  report.score = verdict.score;
  report.summary = verdict.rationale;
  emit({ type: "verdict.ready", scanId, verdict: verdict.verdict, score: verdict.score, at: Date.now() });

  // 2. Render the report and pin to IPFS when Pinata is available.
  emit({
    type: "report.ready",
    scanId,
    url: `/scan/${scanId}/report`,
    cid: report.reportCid,
    at: Date.now(),
  });
  try {
    const pin = await pinReport(report, {
      pinataJwt: process.env.PINATA_JWT,
    });
    report.reportCid = pin.cid;
    emit({ type: "report.pinned", scanId, cid: pin.cid, at: Date.now() });
    emit({
      type: "report.ready",
      scanId,
      url: `/scan/${scanId}/report`,
      cid: pin.cid,
      at: Date.now(),
    });
  } catch (err) {
    emit({ type: "scan.error", scanId, message: `IPFS pin failed: ${(err as Error).message}`, at: Date.now() });
  }

  // 3. Deliver the verdict to AuditRegistry.sol on Sepolia.
  if (config.auditRegistryAddress && config.sepoliaRpcUrl && config.deployerPrivateKey) {
    try {
      const wallet = new Wallet(config.deployerPrivateKey, new JsonRpcProvider(config.sepoliaRpcUrl));
      const registry = new Contract(config.auditRegistryAddress, AUDIT_REGISTRY_ABI, wallet);
      const tx = await registry.submitVerdict(
        id(scanId),
        report.target,
        VERDICT_CODE[report.verdict],
        Math.round(report.score * 100),
        report.reportCid ?? "",
      );
      const receipt = await tx.wait();
      report.auditRegistryTx = receipt?.hash;
    } catch (err) {
      emit({ type: "scan.error", scanId, message: `AuditRegistry submit failed: ${(err as Error).message}`, at: Date.now() });
    }
  }

  // 4. Publish the target ENS subname. Text records go on-chain even without a CID.
  const ensConfig = loadEnsConfig();
  if (!hasEnsWriteAccess(ensConfig) || !ensConfig.auditResolverAddress) {
    emit({
      type: "scan.error",
      scanId,
      message: "ENS publish skipped: registrar, resolver, or deployer key is not configured.",
      at: Date.now(),
    });
  } else {
    try {
      const name = `${targetLabel(report.target)}.${ensConfig.parentName}`;
      const res = await publishAuditIdentity(ensConfig, {
        targetName: name,
        resolver: ensConfig.auditResolverAddress,
        scanId,
        target: report.target,
        verdict: report.verdict,
        cid: report.reportCid,
      });
      report.ensName = name;
      emit({ type: "ens.updated", scanId, name, contenthash: res.contenthash, at: Date.now() });

      // Update agent reputation records after the audit.
      for (const agent of report.agents) {
        if (!agent.ensName) continue;
        try {
          await setReputation(ensConfig, {
            name: agent.ensName,
            resolver: ensConfig.auditResolverAddress,
            records: {
              "scans.completed": "1",
              "last.audit": scanId,
              "last.verdict": report.verdict,
            },
          });
        } catch {
          // reputation update is non-critical
        }
      }
    } catch (err) {
      emit({ type: "scan.error", scanId, message: `ENS publish failed: ${(err as Error).message}`, at: Date.now() });
    }
  }

  // 5. Hedera artifacts: HCS audit trail and soulbound HTS certificate.
  const hederaConfig = loadHederaConfig();
  if (hasHederaCredentials(hederaConfig)) {
    const client = makeClient(hederaConfig);
    try {
      const topicId = hederaConfig.auditTopicId ?? (await createAuditTopic(client));
      report.hcsTopicId = topicId;
      const seq = await logAction(client, topicId, {
        scanId,
        target: report.target,
        verdict: report.verdict,
        score: report.score,
        reportCid: report.reportCid,
        findings: report.findings.length,
      });
      emit({ type: "hcs.logged", scanId, topicId, sequenceNumber: seq.sequenceNumber, at: Date.now() });

      if (!hederaConfig.certificateTokenId) {
        emit({
          type: "scan.error",
          scanId,
          message: "Hedera certificate skipped: HTS_CERTIFICATE_TOKEN_ID is not set.",
          at: Date.now(),
        });
      } else {
        const cert = await mintCertificate(client, hederaConfig, hederaConfig.certificateTokenId, {
          scanId,
          target: report.target,
          verdict: report.verdict,
          score: report.score,
          reportCid: report.reportCid,
        });
        report.certificateTokenId = hederaConfig.certificateTokenId;
        report.certificateSerial = cert.serial;
        emit({ type: "certificate.minted", scanId, tokenId: hederaConfig.certificateTokenId, serial: cert.serial, at: Date.now() });
      }
    } catch (err) {
      emit({ type: "scan.error", scanId, message: `Hedera settlement failed: ${(err as Error).message}`, at: Date.now() });
    } finally {
      client.close();
    }
  }

  report.finishedAt = Date.now();
  emit({ type: "scan.finished", scanId, verdict: report.verdict, reportCid: report.reportCid ?? "", at: Date.now() });
  return report;
}
