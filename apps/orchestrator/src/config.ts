import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadRootEnv(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env"), resolve(process.cwd(), "../.env")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}

export interface OrchestratorConfig {
  port: number;
  scanPriceTinybars: number;
  payToAccount: string;
  skipPayment: boolean;
  claimPriceTinybars: number;
  observationLogAddress?: string;
  auditRegistryAddress?: string;
  marketRegistryAddress?: string;
  sepoliaRpcUrl?: string;
  deployerPrivateKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri: string;
  sessionSecret: string;
  adminEmails: string[];
  adminSecret?: string;
  healthMock: boolean;
  worldAppId?: string;
  worldRpId?: string;
  worldRpSigningKey?: string;
  vrfCoordinator?: string;
  vrfSubscriptionId?: string;
  vrfKeyHash?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  loadRootEnv();
  return {
    port: Number(env.PORT ?? 8787),
    scanPriceTinybars: Number(env.SCAN_PRICE_TINYBARS ?? 10000),
    payToAccount: env.SCAN_PAYTO_ACCOUNT || "",
    skipPayment: env.SCAN_SKIP_PAYMENT === "1" || env.SCAN_SKIP_PAYMENT === "true",
    claimPriceTinybars: Number(env.SCAN_CLAIM_PRICE_TINYBARS ?? env.SCAN_PRICE_TINYBARS ?? 10000),
    observationLogAddress: env.OBSERVATION_LOG_ADDRESS || undefined,
    auditRegistryAddress: env.AUDIT_REGISTRY_ADDRESS || undefined,
    marketRegistryAddress: env.MARKET_REGISTRY_ADDRESS || undefined,
    sepoliaRpcUrl: env.SEPOLIA_RPC_URL || undefined,
    deployerPrivateKey: env.DEPLOYER_PRIVATE_KEY || undefined,
    googleClientId: env.GOOGLE_CLIENT_ID || undefined,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || undefined,
    googleRedirectUri: env.GOOGLE_REDIRECT_URI || "http://localhost:8787/auth/google/callback",
    sessionSecret: env.SESSION_SECRET || "stakefit-dev-secret",
    adminEmails: (env.ADMIN_EMAILS ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean),
    adminSecret: env.ADMIN_SECRET || undefined,
    healthMock: env.HEALTH_MOCK === "1" || env.HEALTH_MOCK === "true",
    worldAppId: env.WORLD_APP_ID || undefined,
    worldRpId: env.WORLD_RP_ID || undefined,
    worldRpSigningKey: env.WORLD_RP_SIGNING_KEY || undefined,
    vrfCoordinator: env.VRF_COORDINATOR || undefined,
    vrfSubscriptionId: env.VRF_SUBSCRIPTION_ID || undefined,
    vrfKeyHash: env.VRF_KEY_HASH || undefined,
  };
}
