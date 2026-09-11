import type { ObservationRecorder } from "@stakefit/agent";
import type { Observation, Severity } from "@stakefit/shared";
import { Contract, JsonRpcProvider, Wallet, id } from "ethers";
import type { OrchestratorConfig } from "./config";

const OBSERVATION_LOG_ABI = [
  "function record(bytes32 scanId, string agent, string target, string findingType, uint8 severity, bytes32 digest, string note)",
];

const SEVERITY_CODE: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/**
 * Writes observations to ObservationLog.sol on Sepolia. The StakeFit subgraph
 * indexes the emitted events, turning them into the swarm memory. Returns
 * undefined when Sepolia is not configured, so scans still run locally.
 */
export function makeObservationRecorder(config: OrchestratorConfig): ObservationRecorder | undefined {
  if (!config.observationLogAddress || !config.sepoliaRpcUrl || !config.deployerPrivateKey) {
    return undefined;
  }
  const wallet = new Wallet(config.deployerPrivateKey, new JsonRpcProvider(config.sepoliaRpcUrl));
  const contract = new Contract(config.observationLogAddress, OBSERVATION_LOG_ABI, wallet);

  return {
    async record(observation: Observation): Promise<{ txHash?: string }> {
      const tx = await contract.record(
        id(observation.scanId),
        observation.agent,
        observation.target,
        observation.findingType,
        SEVERITY_CODE[observation.severity],
        id(observation.digest),
        observation.note,
      );
      const receipt = await tx.wait();
      return { txHash: receipt?.hash };
    },
  };
}
