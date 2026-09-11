import { JsonRpcProvider, Wallet } from "ethers";

export interface EnsConfig {
  rpcUrl: string;
  privateKey?: string;
  registrarAddress: string;
  parentName: string;
  /** Optional explicit resolver used for target audit records. */
  auditResolverAddress?: string;
}

export function loadEnsConfig(env: NodeJS.ProcessEnv = process.env): EnsConfig {
  return {
    rpcUrl: env.SEPOLIA_RPC_URL ?? "",
    privateKey: env.DEPLOYER_PRIVATE_KEY || undefined,
    registrarAddress: env.ENS_REGISTRAR_ADDRESS ?? "",
    parentName: env.ENS_PARENT_NAME ?? "stakefit.eth",
    auditResolverAddress: env.ENS_AUDIT_RESOLVER_ADDRESS || undefined,
  };
}

export function makeProvider(config: EnsConfig): JsonRpcProvider {
  if (!config.rpcUrl) throw new Error("SEPOLIA_RPC_URL is required for ENS operations");
  return new JsonRpcProvider(config.rpcUrl);
}

export function makeWallet(config: EnsConfig): Wallet {
  if (!config.privateKey) throw new Error("DEPLOYER_PRIVATE_KEY is required to write ENS records");
  return new Wallet(config.privateKey, makeProvider(config));
}

export function hasEnsWriteAccess(config: EnsConfig): boolean {
  return Boolean(config.rpcUrl && config.privateKey && config.registrarAddress);
}
