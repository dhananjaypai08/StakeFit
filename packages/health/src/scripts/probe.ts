/**
 * Live Google Health spike. Reads GOOGLE_* from the repo-root .env and calls
 * the documented v4 endpoints. Does not print tokens.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHealthClient, listAllExercises } from "../client";
import { exchangeCode, refreshAccessToken, type GoogleOAuthConfig } from "../oauth";

function loadEnv(): void {
  for (const path of [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function oauthConfig(): GoogleOAuthConfig | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:8787/auth/google/callback";
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret, redirectUri };
}

async function accessToken(config: GoogleOAuthConfig): Promise<string> {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    const tokens = await refreshAccessToken(config, process.env.GOOGLE_REFRESH_TOKEN);
    return tokens.accessToken;
  }
  if (process.env.GOOGLE_AUTH_CODE) {
    const tokens = await exchangeCode(config, process.env.GOOGLE_AUTH_CODE);
    console.log("refresh token present:", Boolean(tokens.refreshToken));
    return tokens.accessToken;
  }
  throw new Error("Set GOOGLE_ACCESS_TOKEN or GOOGLE_REFRESH_TOKEN (or GOOGLE_AUTH_CODE once)");
}

async function main(): Promise<void> {
  loadEnv();
  const config = oauthConfig();
  if (!config) {
    console.log("SKIP: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. Create a GCP OAuth client and retry.");
    process.exitCode = 2;
    return;
  }
  const token = await accessToken(config);
  const client = createHealthClient(token);
  const devices = await client.listPairedDevices();
  console.log(
    "pairedDevices",
    devices.map((d) => ({ version: d.deviceVersion, type: d.deviceType, lastSyncTime: d.lastSyncTime })),
  );
  const air = devices.find((d) => /air/i.test(d.deviceVersion ?? "") || /air/i.test(d.deviceType ?? ""));
  console.log("fitbitAirSeen", Boolean(air), air?.lastSyncTime ?? null);
  const sessions = await listAllExercises(client, { maxPages: 3 });
  console.log(
    "exercises",
    sessions.slice(0, 8).map((s) => ({
      id: s.id,
      type: s.exerciseType,
      mm: s.distanceMillimeters,
      activeMs: s.activeDurationMs,
      start: new Date(s.startMs).toISOString(),
    })),
  );
  console.log("exerciseCount", sessions.length);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
