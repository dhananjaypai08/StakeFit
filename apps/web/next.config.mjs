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
  env: rootEnv("NEXT_PUBLIC_"),
  async rewrites() {
    const orch = rootEnv().NEXT_PUBLIC_ORCHESTRATOR_URL || process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://localhost:8787";
    return [{ source: "/orch/:path*", destination: `${orch}/:path*` }];
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
