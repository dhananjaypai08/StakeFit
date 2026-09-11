import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AccountId,
  Client,
  PrivateKey,
} from "@hashgraph/sdk";

function loadRootEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../.env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}

export type HederaNetwork = "testnet" | "mainnet" | "previewnet";

export interface HederaConfig {
  network: HederaNetwork;
  accountId: string;
  privateKey: string;
  facilitatorUrl: string;
  certificateTokenId?: string;
  auditTopicId?: string;
}

export function loadHederaConfig(env: NodeJS.ProcessEnv = process.env): HederaConfig {
  loadRootEnv();
  const network = (env.HEDERA_NETWORK as HederaNetwork) ?? "testnet";
  const accountId = env.HEDERA_ACCOUNT_ID ?? "";
  const privateKey = (env.HEDERA_PRIVATE_KEY ?? "").replace(/^0x/i, "");
  const facilitatorUrl = env.BLOCKY402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com";
  return {
    network,
    accountId,
    privateKey,
    facilitatorUrl,
    certificateTokenId: env.HTS_CERTIFICATE_TOKEN_ID || undefined,
    auditTopicId: env.HCS_AUDIT_TOPIC_ID || undefined,
  };
}

/** Parse a Hedera private key string, tolerating both ECDSA and ED25519 keys. */
export function parsePrivateKey(key: string): PrivateKey {
  try {
    return PrivateKey.fromStringECDSA(key);
  } catch {
    return PrivateKey.fromStringED25519(key);
  }
}

/** Build a configured Hedera client. Throws when credentials are missing. */
export function makeClient(config: HederaConfig): Client {
  if (!config.accountId || !config.privateKey) {
    throw new Error("Hedera credentials missing: set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY");
  }
  const client =
    config.network === "mainnet"
      ? Client.forMainnet()
      : config.network === "previewnet"
        ? Client.forPreviewnet()
        : Client.forTestnet();
  client.setOperator(AccountId.fromString(config.accountId), parsePrivateKey(config.privateKey));
  return client;
}

export function hasHederaCredentials(config: HederaConfig): boolean {
  return Boolean(config.accountId && config.privateKey);
}
