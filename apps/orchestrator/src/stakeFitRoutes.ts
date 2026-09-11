import type { Express, Request, Response } from "express";
import type { DistanceId } from "@stakefit/shared";
import { buildAccepts, settlePayment } from "./x402gate";
import type { OrchestratorConfig } from "./config";
import { parseCookies, sessionCookie, signSession, verifySession } from "./sessionAuth";
import { StakeFitService, type StakeUser } from "./stakeFitService";

export function mountStakeFit(app: Express, config: OrchestratorConfig, service: StakeFitService): void {
  const userFrom = (req: Request): StakeUser | undefined => {
    const cookies = parseCookies(req.header("cookie"));
    const userId = verifySession(cookies.stakefit_session, config.sessionSecret);
    return userId ? service.getUser(userId) : undefined;
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
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/me/exercises", (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    res.json({ exercises: service.history(user.id), lastSyncTime: user.lastSyncTime, deviceVersion: user.deviceVersion });
  });

  app.get("/catalog", (_req, res) => {
    res.json({ distances: service.catalog() });
  });

  app.get("/graph/markets", async (_req, res) => {
    const url = process.env.STAKEFIT_SUBGRAPH_QUERY_URL;
    if (!url) {
      res.json({ source: "local", markets: service.listMarkets() });
      return;
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.GRAPH_GATEWAY_API_KEY ? { Authorization: `Bearer ${process.env.GRAPH_GATEWAY_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          query: "{ markets(first: 25, orderBy: createdAt, orderDirection: desc) { id hidden resolved firstTimeMs entryTinybars } }",
        }),
      });
      res.json({ source: "graph", ...(await response.json()) });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  app.get("/markets", (req, res) => {
    const user = userFrom(req);
    res.json({ markets: service.listMarkets().map((market) => service.publicView(market, user?.id)) });
  });

  app.get("/markets/:id", (req, res) => {
    const market = service.getMarket(req.params.id);
    if (!market) {
      res.status(404).json({ error: "market not found" });
      return;
    }
    res.json(service.publicView(market, userFrom(req)?.id));
  });

  app.post("/markets", (req, res) => {
    const user = userFrom(req);
    if (!service.isAdmin(user) && req.header("x-admin-secret") !== config.adminSecret) {
      res.status(403).json({ error: "admin only" });
      return;
    }
    const distanceId = String(req.body?.distanceId ?? "") as DistanceId;
    const now = Date.now();
    service
      .createMarket({
        distanceId,
        startMs: Number(req.body?.startMs ?? now),
        endMs: Number(req.body?.endMs ?? now + 60 * 60_000),
        graceSec: Number(req.body?.graceSec ?? 900),
        hidden: Boolean(req.body?.hidden),
        houseBps: Number(req.body?.houseBps ?? 1000),
        entryTinybars: Number(req.body?.entryTinybars ?? config.scanPriceTinybars),
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

  app.post("/markets/:id/resolve", async (req, res) => {
    const user = userFrom(req);
    if (!service.isAdmin(user) && req.header("x-admin-secret") !== config.adminSecret) {
      res.status(403).json({ error: "admin only" });
      return;
    }
    try {
      const market = await service.resolveMarket(req.params.id, { admin: true });
      res.json(service.publicView(market, user?.id));
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

  app.get("/cre/workout/:userId", (req, res) => {
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

  app.get("/cre/vrf-seed", (req, res) => {
    const marketId = String(req.query.marketId ?? "");
    const market = marketId ? service.getMarket(marketId) : undefined;
    res.type("text/plain").send(market?.vrfSeed ?? "0");
  });
}

async function verifyWorldProof(
  config: OrchestratorConfig,
  body: Record<string, unknown>,
): Promise<string> {
  const nullifier = String(body.nullifierHash ?? body.nullifier ?? "");
  if (!nullifier) throw new Error("World proof nullifier required");
  if (!config.worldRpId) return nullifier;
  const res = await fetch(`https://developer.world.org/api/v4/verify/${config.worldRpId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      app_id: config.worldAppId,
      action: body.action ?? "stakefit-run",
    }),
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
    connected: Boolean(user.tokens) || Boolean(user.exercises.length),
    lastSyncTime: user.lastSyncTime,
    deviceVersion: user.deviceVersion,
    worldNullifier: user.worldNullifier,
    admin: service.isAdmin(user),
  };
}

async function mintRunCertificate(user: StakeUser, market: { id: string; distanceId: string; label: string }, service: StakeFitService) {
  const { mintCertificate, hasHederaCredentials, loadHederaConfig, makeClient } = await import("@stakefit/hedera");
  const { pinJson } = await import("@stakefit/ipfs");
  const hedera = loadHederaConfig();
  if (!hasHederaCredentials(hedera) || !hedera.certificateTokenId) {
    const serial = `local-${Date.now()}`;
    service.recordCertificate(user.id, market.id, serial);
    return { serial, skipped: true };
  }
  const result = service.getResult(market.id, user.id);
  let cid: string | undefined;
  try {
    const pin = await pinJson(
      {
        type: "stakefit-run",
        marketId: market.id,
        distance: market.distanceId,
        label: market.label,
        timeMs: result?.timeMs,
        exerciseId: result?.exerciseId,
        lastSyncTime: user.lastSyncTime,
        worldNullifier: user.worldNullifier,
        hederaAccount: user.hederaAccount,
        email: user.email,
      },
      { pinataJwt: process.env.PINATA_JWT },
    );
    cid = pin.cid;
  } catch {
    cid = undefined;
  }
  const client = makeClient(hedera);
  try {
    const cert = await mintCertificate(client, hedera, hedera.certificateTokenId, {
      scanId: `${market.id}:${user.id}`,
      target: market.label,
      verdict: "ALLOW",
      score: result?.timeMs ?? 0,
      reportCid: cid,
    });
    service.recordCertificate(user.id, market.id, cert.serial, cid);
    return { serial: cert.serial, tokenId: hedera.certificateTokenId, cid };
  } finally {
    client.close();
  }
}

