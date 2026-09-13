import type { Express, Request, Response } from "express";
import { catalogById, type DistanceId } from "@stakefit/shared";
import { buildAccepts, settlePayment } from "./x402gate";
import type { OrchestratorConfig } from "./config";
import { parseCookies, sessionCookie, signSession, verifySession } from "./sessionAuth";
import { StakeFitService, type StakeUser } from "./stakeFitService";

function parseTimeZone(raw?: string): string | undefined {
  const zone = raw?.trim();
  if (!zone || zone.length > 64) return undefined;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

function requestTimeZone(req: Request): string | undefined {
  return parseTimeZone(req.header("x-timezone") ?? undefined);
}

export function mountStakeFit(app: Express, config: OrchestratorConfig, service: StakeFitService): void {
  const userFrom = (req: Request): StakeUser | undefined => {
    const cookies = parseCookies(req.header("cookie"));
    const userId = verifySession(cookies.stakefit_session, config.sessionSecret);
    const user = service.sessionUser(userId);
    if (user) service.rememberTimeZone(user.id, requestTimeZone(req));
    return user;
  };

  const requireUser = (req: Request, res: Response): StakeUser | undefined => {
    const user = userFrom(req);
    if (!user) {
      res.status(401).json({ error: "sign in first" });
      return undefined;
    }
    return user;
  };

  app.get("/auth/google", (_req, res) => {
    try {
      res.redirect(service.beginGoogleLogin());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/auth/google/callback", async (req, res) => {
    const web = process.env.PUBLIC_WEB_URL || "http://localhost:3000";
    if (req.query.error) {
      res.redirect(`${web}/?auth=${encodeURIComponent(String(req.query.error))}`);
      return;
    }
    try {
      const user = await service.finishGoogleLogin(String(req.query.code ?? ""), String(req.query.state ?? ""));
      const token = signSession(user.id, config.sessionSecret);
      res.setHeader("Set-Cookie", sessionCookie(token));
      res.redirect(`${web}/auth/complete?session=${encodeURIComponent(token)}`);
    } catch {
      res.redirect(`${web}/?auth=callback`);
    }
  });

  app.post("/auth/dev", (_req, res) => {
    if (!config.healthMock) {
      res.status(403).json({ error: "HEALTH_MOCK is off" });
      return;
    }
    const user = service.upsertDevUser();
    res.setHeader("Set-Cookie", sessionCookie(signSession(user.id, config.sessionSecret)));
    res.json({ user: publicUser(user, service) });
  });

  app.post("/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", "stakefit_session=; Path=/; Max-Age=0");
    res.json({ ok: true });
  });

  app.get("/me", (req, res) => {
    const user = userFrom(req);
    if (!user) {
      res.status(401).json({ error: "signed out" });
      return;
    }
    res.json({ user: publicUser(user, service) });
  });

  app.post("/me/hedera", (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const accountId = String(req.body?.accountId ?? "");
    if (!accountId) {
      res.status(400).json({ error: "accountId required" });
      return;
    }
    service.setHederaAccount(user.id, accountId);
    res.json({ ok: true, accountId });
  });

  app.post("/me/sync", async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const result = await service.syncExercises(user.id);
      res.json({
        ...result,
        exercises: service.history(user.id, requestTimeZone(req)),
        lastSyncTime: user.lastSyncTime,
        deviceVersion: user.deviceVersion,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/me/exercises", async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const stale = !user.fetchedAt || Date.now() - user.fetchedAt > 45_000;
    if (stale) {
      try {
        await service.syncExercises(user.id);
      } catch (err) {
        console.warn("page sync skipped:", err instanceof Error ? err.message : err);
      }
    }
    res.json({
      exercises: service.history(user.id, requestTimeZone(req)),
      lastSyncTime: user.lastSyncTime,
      deviceVersion: user.deviceVersion,
    });
  });

  app.get("/catalog", (_req, res) => {
    res.json({ distances: service.catalog() });
  });

  app.get("/graph/markets", async (_req, res) => {
    try {
      res.json(await queryGraph(service));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  app.get("/partners", (req, res) => {
    res.json(service.partners(userFrom(req)));
  });

  app.get("/markets", async (req, res) => {
    const user = userFrom(req);
    const graph = await queryGraph(service).catch(() => ({ source: "local" as const, intel: "The Graph is unreachable; using the live orchestrator board." }));
    res.json({
      markets: service.listMarkets().map((market) => service.publicView(market, user?.id, requestTimeZone(req))),
      graph,
      partners: service.partners(user),
    });
  });

  app.get("/markets/:id", async (req, res) => {
    const user = userFrom(req);
    if (user) {
      await service.refreshViewerIfStale(user.id).catch((err) => {
        console.warn("race sync skipped:", err instanceof Error ? err.message : err);
      });
    }
    const market = service.getMarket(req.params.id);
    if (!market) {
      res.status(404).json({ error: "market not found" });
      return;
    }
    res.json(service.publicView(market, user?.id, requestTimeZone(req)));
  });

  app.post("/markets", (req, res) => {
    const user = userFrom(req);
    if (!user && req.header("x-admin-secret") !== config.adminSecret) {
      res.status(401).json({ error: "sign in first" });
      return;
    }
    const distanceId = String(req.body?.distanceId ?? "") as DistanceId;
    const now = Date.now();
    const timeZone = parseTimeZone(typeof req.body?.timeZone === "string" ? req.body.timeZone : undefined) || requestTimeZone(req);
    service
      .createMarket({
        distanceId,
        startMs: Number(req.body?.startMs ?? now),
        endMs: Number(req.body?.endMs ?? now + 60 * 60_000),
        graceSec: Number(req.body?.graceSec ?? 900),
        hidden: Boolean(req.body?.hidden),
        houseBps: Number(req.body?.houseBps ?? 1000),
        entryTinybars: Number(req.body?.entryTinybars ?? config.scanPriceTinybars),
        timeZone,
      })
      .then((market) => res.json(market))
      .catch((err) => res.status(400).json({ error: (err as Error).message }));
  });

  app.post("/markets/:id/enter", async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const market = service.getMarket(req.params.id);
    if (!market) {
      res.status(404).json({ error: "market not found" });
      return;
    }
    const hederaAccount = String(req.body?.hederaAccount ?? user.hederaAccount ?? "");
    if (!hederaAccount) {
      res.status(400).json({ error: "connect HashPack first" });
      return;
    }

    if (config.skipPayment) {
      res.json({ entry: service.enter(market.id, user.id, hederaAccount, "skipped"), payment: { skipped: true } });
      return;
    }

    let accepts;
    try {
      accepts = await buildAccepts(config, market.entryTinybars);
    } catch (err) {
      res.status(503).json({ error: `x402 facilitator unavailable: ${(err as Error).message}` });
      return;
    }
    if (!accepts) {
      res.status(503).json({ error: "SCAN_PAYTO_ACCOUNT is required; entry will not open unpaid" });
      return;
    }
    const header = req.header("X-PAYMENT");
    if (!header) {
      res.status(402).json({ x402Version: 2, accepts: [accepts] });
      return;
    }
    const outcome = await settlePayment(header, accepts);
    if (!outcome.ok) {
      res.status(402).json({ x402Version: 2, accepts: [accepts], error: outcome.message });
      return;
    }
    const entry = service.enter(market.id, user.id, hederaAccount, outcome.txHash ?? outcome.payer ?? "x402");
    res.json({ entry, payment: { payer: outcome.payer, txHash: outcome.txHash } });
  });

  app.post("/markets/:id/enter-manual", (req, res) => {
    const user = userFrom(req);
    if (!service.isAdmin(user) && req.header("x-admin-secret") !== config.adminSecret) {
      res.status(403).json({ error: "admin only" });
      return;
    }
    const userId = String(req.body?.userId ?? user?.id ?? "");
    const account = String(req.body?.hederaAccount ?? "");
    try {
      res.json({ entry: service.markPaid(req.params.id, userId, account) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post("/markets/:id/claim", async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const hederaAccount = String(req.body?.hederaAccount ?? user.hederaAccount ?? "");
    try {
      const payout = await service.claimPayout(req.params.id, user.id, hederaAccount);
      res.json({ payout, partners: service.partners(user) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post("/markets/:id/resolve", async (req, res) => {
    const user = userFrom(req);
    if (!service.isAdmin(user) && req.header("x-admin-secret") !== config.adminSecret) {
      res.status(403).json({ error: "admin only" });
      return;
    }
    try {
      const market = await service.resolveMarket(req.params.id, { admin: true });
      res.json(service.publicView(market, user?.id, requestTimeZone(req)));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post("/health/webhook", (req, res) => {
    const secret = process.env.GOOGLE_HEALTH_WEBHOOK_SECRET;
    if (secret && req.header("authorization") !== secret && req.header("Authorization") !== secret) {
      res.status(401).json({ error: "bad webhook secret" });
      return;
    }
    const healthUserId = String(req.body?.healthUserId ?? req.body?.user ?? "");
    if (healthUserId) void service.syncByHealthUserId(healthUserId);
    res.status(204).end();
  });

  app.get("/world/rp-context", (_req, res) => {
    if (!config.worldRpId || !config.worldRpSigningKey) {
      res.status(503).json({ error: "Set WORLD_RP_ID and WORLD_RP_SIGNING_KEY for Selfie Check" });
      return;
    }
    void import("@worldcoin/idkit-core/signing")
      .then(({ signRequest }) => {
        const signed = signRequest({ signingKeyHex: config.worldRpSigningKey as string, action: "stakefit-run" });
        res.json({
          rp_id: config.worldRpId,
          nonce: signed.nonce,
          created_at: signed.createdAt,
          expires_at: signed.expiresAt,
          signature: signed.sig,
        });
      })
      .catch((err) => res.status(500).json({ error: (err as Error).message }));
  });

  app.post("/markets/:id/world", async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!config.worldAppId) {
      service.setWorldNullifier(user.id, "world:skipped");
      res.json({ skipped: true, nullifier: "world:skipped" });
      return;
    }
    try {
      const nullifier = await verifyWorldProof(config, req.body);
      service.setWorldNullifier(user.id, nullifier);
      res.json({ ok: true, nullifier });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  const mintHandler = async (req: Request, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const market = service.getMarket(req.params.id);
    if (!market) {
      res.status(404).json({ error: "market not found" });
      return;
    }
    const existing = service.getCertificate(user.id, market.id);
    if (existing) {
      res.json(existing);
      return;
    }
    if (!user.worldNullifier && config.worldAppId) {
      res.status(400).json({ error: "complete Selfie Check first" });
      return;
    }
    if (!user.worldNullifier) service.setWorldNullifier(user.id, "world:skipped");
    try {
      const minted = await mintRunCertificate(user, market, service);
      res.json(minted);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  };
  app.post("/runs/:id/certificate", mintHandler);
  app.post("/markets/:id/certificate", mintHandler);

  const requireCre = (req: Request, res: Response): boolean => {
    const secret = config.creIngestSecret;
    if (!secret) return true;
    const header = String(req.header("x-cre-secret") ?? "");
    if (header !== secret) {
      res.status(401).json({ error: "CRE secret required" });
      return false;
    }
    return true;
  };

  app.get("/cre/workout/:userId", (req, res) => {
    if (!requireCre(req, res)) return;
    const user = service.getUser(req.params.userId);
    if (!user) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    res.json({
      userId: user.id,
      sessions: user.exercises.map((session) => ({
        id: session.id,
        startMs: session.startMs,
        endMs: session.endMs,
        activeDurationMs: session.activeDurationMs,
        distanceMillimeters: session.distanceMillimeters,
      })),
    });
  });

  app.get("/cre/open-workouts", (req, res) => {
    if (!requireCre(req, res)) return;
    res.json({ markets: service.openWorkoutsForCre() });
  });

  app.post("/cre/score", (req, res) => {
    if (!requireCre(req, res)) return;
    const marketId = String(req.body?.marketId ?? "");
    const userId = String(req.body?.userId ?? "");
    const timeMs = Number(req.body?.timeMs ?? 0);
    const exerciseId = String(req.body?.exerciseId ?? "");
    if (!marketId || !userId || !exerciseId || !Number.isFinite(timeMs) || timeMs <= 0) {
      res.status(400).json({ error: "marketId, userId, timeMs, exerciseId required" });
      return;
    }
    try {
      res.json({ applied: service.applyCreScore(marketId, userId, timeMs, exerciseId) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/cre/vrf-seed", (req, res) => {
    const marketId = String(req.query.marketId ?? "");
    const market = marketId ? service.getMarket(marketId) : undefined;
    res.type("text/plain").send(market?.vrfSeed ?? "0");
  });
}

async function queryGraph(service: StakeFitService): Promise<{
  source: "graph" | "local" | "sepolia";
  intel: string;
  markets?: unknown;
}> {
  const url = process.env.STAKEFIT_SUBGRAPH_QUERY_URL;
  if (!url) {
    return { source: "local", intel: "Subgraph URL is not set. Local race list is serving until Studio is queried." };
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.GRAPH_GATEWAY_API_KEY ? { Authorization: `Bearer ${process.env.GRAPH_GATEWAY_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      query: `{
        markets(first: 25, orderBy: createdAt, orderDirection: desc) {
          id hidden resolved firstTimeMs entryTinybars
          entries { id }
          results { id hasResult }
        }
      }`,
    }),
  });
  const body = (await response.json()) as {
    data?: { markets?: Array<{ id: string; resolved?: boolean; entries?: unknown[]; results?: unknown[] }> };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    return { source: "local", intel: `Graph error: ${body.errors[0]?.message}`, markets: service.listMarkets() };
  }
  const rows = body.data?.markets ?? [];
  const live = service.listMarkets();
  if (rows.length === 0 && live.length) {
    return {
      source: "sepolia",
      intel: `${live.length} races on Sepolia. Graph Studio has not indexed them yet.`,
      markets: live,
    };
  }
  const open = rows.filter((row) => !row.resolved).length;
  const entered = rows.reduce((sum, row) => sum + (row.entries?.length ?? 0), 0);
  const scored = rows.reduce((sum, row) => sum + (row.results?.length ?? 0), 0);
  return {
    source: "graph",
    intel: `${rows.length} races indexed. ${open} still open. ${entered} paid entries. ${scored} CRE results on Sepolia.`,
    markets: rows,
  };
}

async function verifyWorldProof(
  config: OrchestratorConfig,
  body: Record<string, unknown>,
): Promise<string> {
  const payload = (body.idkitResponse as Record<string, unknown> | undefined) ?? body;
  const responses = payload.responses as Array<{ nullifier?: string }> | undefined;
  const nullifier = String(
    body.nullifierHash ??
      body.nullifier_hash ??
      body.nullifier ??
      payload.nullifier ??
      responses?.[0]?.nullifier ??
      "",
  );
  if (!nullifier) throw new Error("World proof nullifier required");
  if (!config.worldRpId) return nullifier;
  const res = await fetch(`https://developer.world.org/api/v4/verify/${config.worldRpId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`World verify failed: ${res.status} ${await res.text()}`);
  return nullifier;
}

function publicUser(user: StakeUser, service: StakeFitService) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    hederaAccount: user.hederaAccount,
    connected: Boolean(service.sessionUser(user.id)),
    lastSyncTime: user.lastSyncTime,
    deviceVersion: user.deviceVersion,
    worldNullifier: user.worldNullifier,
    worldVerified: Boolean(user.worldNullifier && user.worldNullifier !== "world:skipped"),
    admin: service.isAdmin(user),
    partners: service.partners(user),
  };
}

function compactDuration(ms?: number): string {
  if (ms == null) return "";
  const sec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(sec / 60);
  return min === 0 ? `${sec}s` : `${min}:${String(sec % 60).padStart(2, "0")}`;
}

function placeLabel(rank?: number): string | undefined {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return undefined;
}

function distanceLabel(meters?: number): string | undefined {
  if (!meters) return undefined;
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters} m`;
}

/** Minutes per kilometre, the number runners actually compare. */
function paceLabel(timeMs?: number, meters?: number): string | undefined {
  if (!timeMs || !meters) return undefined;
  const secPerKm = Math.round(timeMs / 1000 / (meters / 1000));
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return undefined;
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")} /km`;
}

/** Walk up from the process cwd so the art resolves from any workspace root. */
function findAsset(relativePaths: string[], existsSync: (p: string) => boolean, join: (...p: string[]) => string): string | undefined {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    for (const rel of relativePaths) {
      const candidate = join(dir, rel);
      if (existsSync(candidate)) return candidate;
    }
    dir = join(dir, "..");
  }
  return undefined;
}

/** The run art is identical for every card, so pin it once per process. */
let runArtCid: string | undefined;

async function mintRunCertificate(
  user: StakeUser,
  market: { id: string; distanceId: string; label: string; winners?: Array<{ userId: string; rank: 1 | 2 | 3 }> },
  service: StakeFitService,
) {
  const { mintCertificate, hasHederaCredentials, loadHederaConfig, makeClient } = await import("@stakefit/hedera");
  const { pinJson, pinBytes } = await import("@stakefit/ipfs");
  const { readFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const path = await import("node:path");
  const hedera = loadHederaConfig();
  if (!hasHederaCredentials(hedera) || !hedera.certificateTokenId) {
    const serial = `local-${Date.now()}`;
    service.recordCertificate(user.id, market.id, serial);
    return { serial, skipped: true };
  }
  const result = service.getResult(market.id, user.id);
  const session = user.exercises.find((row) => row.id === result?.exerciseId);
  const startMs = session?.startMs ?? Date.now();
  const isoDay = new Date(startMs).toISOString().slice(0, 10);
  const humanDay = new Date(startMs).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const timeLabel = compactDuration(result?.timeMs);
  const sourceMeters = session ? Math.round(session.distanceMillimeters / 1000) : undefined;
  const raceMeters = catalogById(market.distanceId)?.meters;
  const place = placeLabel(market.winners?.find((row) => service.sameRunner(row.userId, user.id))?.rank);
  const memo = ["StakeFit", `${market.label} in ${timeLabel}`, place && `${place} place`, humanDay]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 100);
  let cid: string | undefined;
  try {
    const jwt = process.env.PINATA_JWT;
    if (!jwt) throw new Error("PINATA_JWT is not set");
    const art = findAsset(["apps/orchestrator/assets/run-nft.png", "apps/web/public/nft.png", "assets/run-nft.png"], existsSync, path.join);
    if (!runArtCid && art) {
      const pinned = await pinBytes(await readFile(art), "stakefit-run.png", "image/png", { pinataJwt: jwt });
      runArtCid = pinned.cid;
    }
    const image = runArtCid ? `ipfs://${runArtCid}` : undefined;
    if (!image) throw new Error("run art not found next to the orchestrator");
    const pin = await pinJson(
      {
        name: `StakeFit ${market.label}${place ? ` · ${place}` : ""}`,
        creator: "StakeFit",
        creatorDID: `hedera:${hedera.network}:${hedera.accountId}`,
        description: [
          `Soulbound run card for the StakeFit ${market.label} race on ${humanDay}.`,
          `Scored at ${timeLabel} from a qualifying Fitbit session read through Google Health.`,
          sourceMeters ? `Source session covered ${distanceLabel(sourceMeters)}.` : undefined,
          place ? `Finished ${place} and took a share of the pot.` : undefined,
          "Frozen on mint, so it stays with the runner who earned it.",
        ]
          .filter(Boolean)
          .join(" "),
        image,
        type: "image/png",
        format: "HIP412@2.0.0",
        files: image ? [{ uri: image, type: "image/png", is_default_file: true }] : undefined,
        attributes: [
          { trait_type: "Race", value: market.label },
          { trait_type: "Race time", value: timeLabel },
          ...(paceLabel(result?.timeMs, raceMeters) ? [{ trait_type: "Pace", value: paceLabel(result?.timeMs, raceMeters) }] : []),
          ...(place ? [{ trait_type: "Place", value: place }] : []),
          { trait_type: "Session", value: session?.displayName ?? "Run" },
          ...(sourceMeters ? [{ trait_type: "Session distance", value: distanceLabel(sourceMeters) }] : []),
          ...(session?.activeDurationMs ? [{ trait_type: "Session time", value: compactDuration(session.activeDurationMs) }] : []),
          ...(session?.heartRateBpm ? [{ trait_type: "Average heart rate", value: `${session.heartRateBpm} bpm` }] : []),
          { trait_type: "Date", value: isoDay },
          { trait_type: "Source", value: "Fitbit via Google Health" },
          { trait_type: "Verified by", value: user.worldNullifier === "world:skipped" ? "StakeFit" : "World Selfie Check" },
        ],
        properties: {
          marketId: market.id,
          distanceId: market.distanceId,
          raceMeters,
          timeMs: result?.timeMs,
          exerciseId: result?.exerciseId,
          sessionStartMs: session?.startMs,
          sessionDurationMs: session?.activeDurationMs,
          sessionDistanceMillimeters: session?.distanceMillimeters,
          scoredBy: result?.scoredBy ?? "orchestrator",
          hederaAccount: user.hederaAccount,
          hcsTopicId: process.env.HCS_AUDIT_TOPIC_ID,
        },
      },
      { pinataJwt: jwt },
    );
    cid = pin.cid;
  } catch (err) {
    console.warn("run card metadata not pinned, falling back to memo:", err instanceof Error ? err.message : err);
    cid = undefined;
  }
  const client = makeClient(hedera);
  try {
    const cert = await mintCertificate(client, hedera, hedera.certificateTokenId, {
      target: market.label,
      score: result?.timeMs ?? 0,
      reportCid: cid,
      memo,
    });
    service.recordCertificate(user.id, market.id, cert.serial, cid, {
      tokenId: hedera.certificateTokenId,
      txId: cert.txId,
    });
    void service.logHcs({
      type: "stakefit.certificate",
      marketId: market.id,
      userId: user.id,
      serial: cert.serial,
      cid,
      txId: cert.txId,
      worldNullifier: user.worldNullifier,
    });
    return { serial: cert.serial, tokenId: hedera.certificateTokenId, cid, txId: cert.txId };
  } finally {
    client.close();
  }
}

