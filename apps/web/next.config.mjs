import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function rootEnv(prefix) {
  const path = resolve(process.cwd(), "../../.env");
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
    if (prefix && !key.startsWith(prefix)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_ORCHESTRATOR_URL:
      process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || rootEnv().NEXT_PUBLIC_ORCHESTRATOR_URL || "",
    NEXT_PUBLIC_ORCHESTRATOR_WS_URL:
      process.env.NEXT_PUBLIC_ORCHESTRATOR_WS_URL || rootEnv().NEXT_PUBLIC_ORCHESTRATOR_WS_URL || "",
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || rootEnv().NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
    NEXT_PUBLIC_WORLD_APP_ID: process.env.NEXT_PUBLIC_WORLD_APP_ID || rootEnv().NEXT_PUBLIC_WORLD_APP_ID || "",
  },
  transpilePackages: ["@stakefit/shared", "@hashgraph/sdk", "@hashgraph/hedera-wallet-connect", "@worldcoin/idkit", "@worldcoin/idkit-core"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        encoding: false,
      };
    }
    return config;
  },
};

export default nextConfig;
