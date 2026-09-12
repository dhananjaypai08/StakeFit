import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  authorizationUrl,
  createHealthClient,
  exchangeCode,
  fetchProfile,
  listAllExercises,
  refreshAccessToken,
  type GoogleOAuthConfig,
  type GoogleTokens,
} from "@stakefit/health";
import { ingestWorkout } from "@stakefit/cre";
import { rankWithTies } from "@stakefit/health";
import {
  DISTANCE_CATALOG,
  catalogById,
  localDayBounds,
  marketStatusAt,
  raceDayBounds,
  splitPot,
  type DistanceId,
  type ExerciseSession,
  type HistoryRow,
  type Market,
  type MarketEntry,
} from "@stakefit/shared";
import type { OrchestratorConfig } from "./config";
import { STAKEFIT_MARKET_ABI } from "./marketAbi";

export interface StakeUser {
  id: string;
  email: string;
  name?: string;
  tokens?: GoogleTokens;
  hederaAccount?: string;
  worldNullifier?: string;
  healthUserId?: string;
  exercises: ExerciseSession[];
  lastSyncTime?: string;
  fetchedAt?: number;
  deviceVersion?: string;
}

interface StoredResult {
  userId: string;
  timeMs: number;
  exerciseId: string;
  scoredBy?: "cre";
}

interface Certificate {
  serial: string;
  cid?: string;
  marketId: string;
  tokenId?: string;
  txId?: string;
}

export interface PayoutRecord {
  userId: string;
  rank: 1 | 2 | 3;
  tinybars: number;
  hederaAccount?: string;
  paidAt?: number;
  txId?: string;
}

export class StakeFitService {
  readonly users = new Map<string, StakeUser>();
  readonly markets = new Map<string, Market>();
  readonly entries = new Map<string, MarketEntry[]>();
  readonly results = new Map<string, StoredResult[]>();
  readonly certificates = new Map<string, Certificate>();
  readonly payouts = new Map<string, PayoutRecord[]>();
  readonly oauthStates = new Map<string, number>();
  private localMarketSeq = 1;
  private chainTail: Promise<void> = Promise.resolve();
  private lastAutoSync = new Map<string, number>();
  private autoSyncing = false;

  constructor(private readonly config: OrchestratorConfig) {
    this.restore();
  }

  catalog() {
    return DISTANCE_CATALOG;
  }

  oauthConfig(): GoogleOAuthConfig | undefined {
    if (!this.config.googleClientId || !this.config.googleClientSecret) return undefined;
    return {
      clientId: this.config.googleClientId,
      clientSecret: this.config.googleClientSecret,
      redirectUri: this.config.googleRedirectUri,
    };
  }

  beginGoogleLogin(): string {
    const config = this.oauthConfig();
    if (!config) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set");
    const state = randomBytes(16).toString("hex");
    this.oauthStates.set(state, Date.now());
    return authorizationUrl(config, state);
  }

  async finishGoogleLogin(code: string, state: string): Promise<StakeUser> {
    if (!this.oauthStates.has(state)) throw new Error("invalid OAuth state");
    this.oauthStates.delete(state);
    const config = this.oauthConfig();
    if (!config) throw new Error("Google OAuth is not configured");
    const tokens = await exchangeCode(config, code);
    const profile = await fetchProfile(tokens.accessToken);
    const user: StakeUser = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      tokens,
      exercises: this.users.get(profile.id)?.exercises ?? [],
      hederaAccount: this.users.get(profile.id)?.hederaAccount,
      worldNullifier: this.users.get(profile.id)?.worldNullifier,
      healthUserId: profile.id,
    };
    this.users.set(user.id, user);
    this.persist();
    void this.syncExercises(user.id).catch((err) => {
      console.warn("login sync skipped:", err instanceof Error ? err.message : err);
    });
    return user;
  }

  async syncByHealthUserId(healthUserId: string): Promise<void> {
    const user = [...this.users.values()].find((row) => row.healthUserId === healthUserId || row.id === healthUserId);
    if (!user) return;
    await this.syncExercises(user.id);
  }

  getUser(id: string): StakeUser | undefined {
    return this.users.get(id);
  }

  upsertDevUser(email = "demo@stakefit.local"): StakeUser {
    const existing = [...this.users.values()].find((user) => user.email === email);
    if (existing) return existing;
    const user: StakeUser = {
      id: `dev-${email}`,
      email,
      name: "Demo",
      exercises: [],
    };
    this.users.set(user.id, user);
    return user;
  }

  isAdmin(user?: StakeUser): boolean {
    if (!user) return false;
    if (this.config.adminEmails.includes(user.email.toLowerCase())) return true;
    if (this.config.adminEmails.length === 0 && this.users.size === 1) return true;
    return false;
  }

  setHederaAccount(userId: string, accountId: string): void {
    const user = this.users.get(userId);
    if (user) user.hederaAccount = accountId;
  }

  async syncExercises(userId: string): Promise<{ sessions: ExerciseSession[]; lastSyncTime?: string; devices: string[] }> {
    const user = this.users.get(userId);
    if (!user) throw new Error("not signed in");
    if (this.config.healthMock) {
      user.exercises = mockSessions(this.listMarkets());
      user.lastSyncTime = new Date().toISOString();
      user.deviceVersion = "Fitbit Air (mock)";
      this.ingestOpenMarkets(user);
      this.persist();
      return { sessions: user.exercises, lastSyncTime: user.lastSyncTime, devices: ["Fitbit Air (mock)"] };
    }
    const token = await this.freshAccessToken(user);
    const client = createHealthClient(token);
    let devices: Awaited<ReturnType<typeof client.listPairedDevices>> = [];
    try {
      devices = await client.listPairedDevices();
    } catch {
      // pairedDevices needs settings.readonly. Workouts still load with activity scope.
    }
    const sessions = await listAllExercises(client, { maxPages: 40 });
    const byId = new Map(user.exercises.map((row) => [row.id, row]));
    for (const row of sessions) byId.set(row.id, row);
    user.exercises = [...byId.values()].sort((a, b) => b.startMs - a.startMs);
    console.log(
      "health sync",
      user.email,
      sessions.length,
      "newest",
      sessions[0] ? new Date(sessions[0].startMs).toISOString() : "none",
      "pages=all",
    );
    user.fetchedAt = Date.now();
    user.lastSyncTime = new Date().toISOString();
    user.deviceVersion =
      devices.find((d) => /air/i.test(d.deviceVersion ?? ""))?.deviceVersion ??
      devices[0]?.deviceVersion ??
      sessions[0]?.deviceVersion;
    for (const session of sessions) {
      session.deviceVersion = user.deviceVersion;
      session.lastSyncTime = user.lastSyncTime;
    }
    this.ingestOpenMarkets(user);
    this.persist();
    return { sessions: user.exercises, lastSyncTime: user.lastSyncTime, devices: devices.map((d) => d.deviceVersion ?? d.name) };
  }

  history(userId: string): HistoryRow[] {
    const user = this.users.get(userId);
    if (!user) return [];
    return user.exercises.map((session) => {
      const qualifiedMarkets: HistoryRow["qualifiedMarkets"] = [];
      let resultMarketId: string | undefined;
      for (const market of this.markets.values()) {
        const catalog = catalogById(market.distanceId);
        if (!catalog) continue;
        const day = raceDayBounds(market);
        const inWindow = session.startMs >= day.startMs && session.startMs <= day.endMs;
        const submitted = (this.results.get(market.id) ?? []).find((row) => row.exerciseId === session.id);
        const entered = (this.entries.get(market.id) ?? []).some((row) => row.userId === userId);
        if (inWindow && session.distanceMillimeters >= catalog.millimeters) {
          qualifiedMarkets.push({
            marketId: market.id,
            label: market.label,
            distanceId: market.distanceId,
            entered,
            submitted: Boolean(submitted),
          });
        }
        if (submitted) resultMarketId = market.id;
      }
      let statusNote = "Has a measured distance";
      if (session.distanceMillimeters <= 0) {
        statusNote = "No distance from Fitbit";
      } else if (this.markets.size === 0) {
        statusNote = "No race is open yet";
      } else if (qualifiedMarkets.length === 0) {
        statusNote = "Started on a different day than the open race";
      } else {
        statusNote = `Qualifies for ${qualifiedMarkets.map((row) => row.label).join(", ")}`;
      }
      return {
        ...session,
        qualifiedMarkets,
        resultMarketId,
        certificateSerial: this.certificates.get(`${userId}:${resultMarketId}`)?.serial,
        statusNote,
      };
    });
  }

  listMarkets(): Market[] {
    return [...this.markets.values()]
      .map((market) => this.refreshStatus(market))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getMarket(id: string): Market | undefined {
    const market = this.markets.get(id);
    return market ? this.refreshStatus(market) : undefined;
  }

  publicView(market: Market, viewerId?: string) {
    const entries = this.entries.get(market.id) ?? [];
    const results = this.results.get(market.id) ?? [];
    const hideTimes = market.hidden && market.status !== "resolved";
    const catalog = catalogById(market.distanceId);
    return {
      ...market,
      entries: entries.map((entry) => ({
        userId: entry.userId,
        hederaAccount: entry.hederaAccount,
        paymentRef: entry.userId === viewerId ? entry.paymentRef : undefined,
        paidAt: entry.userId === viewerId ? entry.paidAt : undefined,
        mine: entry.userId === viewerId,
      })),
      results: results.map((row) => ({
        userId: row.userId,
        exerciseId: row.exerciseId,
        timeMs: hideTimes && row.userId !== viewerId ? undefined : row.timeMs,
        hidden: hideTimes && row.userId !== viewerId,
        scoredBy: row.scoredBy,
      })),
      yours: viewerId ? this.viewerQualify(market, viewerId, catalog?.millimeters ?? 0, catalog?.label ?? "the distance") : undefined,
      partners: this.partners(viewerId ? this.users.get(viewerId) : undefined),
      noWinner: market.status === "resolved" && !(market.winners?.length),
      payouts: (this.payouts.get(market.id) ?? []).map((row) => ({
        userId: row.userId,
        rank: row.rank,
        tinybars: row.tinybars,
        paid: Boolean(row.paidAt),
        hederaAccount: row.hederaAccount,
        mine: row.userId === viewerId,
      })),
      entered: viewerId ? entries.some((row) => row.userId === viewerId) : false,
      claim: viewerId ? this.claimView(market.id, viewerId) : undefined,
      certificate: viewerId
        ? (() => {
            const cert = this.getCertificate(viewerId, market.id);
            if (!cert) return undefined;
            const tokenId = cert.tokenId || process.env.HTS_CERTIFICATE_TOKEN_ID;
            return {
              ...cert,
              tokenId,
              hashscan: tokenId
                ? `https://hashscan.io/testnet/token/${tokenId}/${cert.serial}`
                : undefined,
              ipfs: cert.cid ? `https://gateway.pinata.cloud/ipfs/${cert.cid}` : undefined,
            };
          })()
        : undefined,
      runCard: viewerId ? this.runCard(market, viewerId) : undefined,
    };
  }

  private claimView(marketId: string, userId: string) {
    const payout = (this.payouts.get(marketId) ?? []).find((row) => row.userId === userId);
    if (!payout) return undefined;
    return {
      rank: payout.rank,
      tinybars: payout.tinybars,
      paid: Boolean(payout.paidAt),
      hederaAccount: payout.hederaAccount,
      txId: payout.txId,
    };
  }

  private runCard(market: Market, userId: string) {
    const result = this.getResult(market.id, userId);
    const user = this.users.get(userId);
    if (!result || !user) return undefined;
    const session = user.exercises.find((row) => row.id === result.exerciseId);
    const payout = (this.payouts.get(market.id) ?? []).find((row) => row.userId === userId);
    const cert = this.getCertificate(userId, market.id);
    return {
      label: market.label,
      displayName: session?.displayName ?? "Run",
      startMs: session?.startMs ?? market.startMs,
      distanceMillimeters: session?.distanceMillimeters ?? 0,
      timeMs: result.timeMs,
      heartRateBpm: session?.heartRateBpm,
      caloriesKcal: session?.caloriesKcal,
      rank: payout?.rank ?? market.winners?.find((row) => row.userId === userId)?.rank,
      serial: cert?.serial,
      cid: cert?.cid,
      tokenId: cert?.tokenId || process.env.HTS_CERTIFICATE_TOKEN_ID,
      hashscan:
        (cert?.tokenId || process.env.HTS_CERTIFICATE_TOKEN_ID) && cert?.serial
          ? `https://hashscan.io/testnet/token/${cert.tokenId || process.env.HTS_CERTIFICATE_TOKEN_ID}/${cert.serial}`
          : undefined,
    };
  }

  partners(viewer?: StakeUser) {
    return {
      hedera: {
        network: "testnet",
        x402: Boolean(this.config.payToAccount) && !this.config.skipPayment,
        payTo: this.config.payToAccount || undefined,
        hcsTopic: process.env.HCS_AUDIT_TOPIC_ID || undefined,
        htsToken: process.env.HTS_CERTIFICATE_TOKEN_ID || undefined,
      },
      chainlink: {
        confidentialScore: true,
        holdsSecrets: true,
        vrf: Boolean(this.config.vrfSubscriptionId),
      },
      graph: {
        live: Boolean(process.env.STAKEFIT_SUBGRAPH_QUERY_URL),
      },
      world: {
        selfieRequired: Boolean(this.config.worldAppId),
        verified: Boolean(viewer?.worldNullifier && viewer.worldNullifier !== "world:skipped"),
      },
    };
  }

  async logHcs(entry: Record<string, unknown>): Promise<void> {
    try {
      const { loadHederaConfig, makeClient, hasHederaCredentials, logAction } = await import("@stakefit/hedera");
      const hedera = loadHederaConfig();
      if (!hasHederaCredentials(hedera) || !hedera.auditTopicId) return;
      const client = makeClient(hedera);
      try {
        await logAction(client, hedera.auditTopicId, entry);
      } finally {
        client.close();
      }
    } catch (err) {
      console.warn("HCS skipped:", err instanceof Error ? err.message : err);
    }
  }

  private viewerQualify(
    market: Market,
    viewerId: string,
    needMm: number,
    distanceLabel: string,
  ): { status: string; note: string; timeMs?: number; nearest?: { startMs: number; name: string; distanceMillimeters: number } } {
    const result = (this.results.get(market.id) ?? []).find((row) => row.userId === viewerId);
    if (result) {
      return { status: "counted", note: "Chainlink CRE scored your fastest qualifying time on this day.", timeMs: result.timeMs };
    }
    const user = this.users.get(viewerId);
    if (!user) {
      return { status: "none", note: `We use the fastest Fitbit time that started today and covered ${distanceLabel}.` };
    }
    const day = raceDayBounds(market);
    const inDay = user.exercises.filter((session) => session.startMs >= day.startMs && session.startMs <= day.endMs);
    const covered = inDay.filter((session) => session.distanceMillimeters >= needMm && session.activeDurationMs > 0);
    if (covered.length) {
      const best = covered.reduce((a, b) => (a.activeDurationMs < b.activeDurationMs ? a : b));
      return {
        status: "ready",
        note: "This session counts once you pay to enter.",
        timeMs: best.activeDurationMs,
      };
    }
    if (inDay.length) {
      return {
        status: "short",
        note: `You have a session today, but none covered ${distanceLabel}.`,
      };
    }
    const nearby = user.exercises
      .filter((session) => session.distanceMillimeters > 0)
      .sort((a, b) => Math.abs(a.startMs - market.startMs) - Math.abs(b.startMs - market.startMs))[0];
    return {
      status: "none",
      note: `No Fitbit session started on this day. Fastest ${distanceLabel} is what counts.`,
      nearest: nearby
        ? { startMs: nearby.startMs, name: nearby.displayName, distanceMillimeters: nearby.distanceMillimeters }
        : undefined,
    };
  }

  async createMarket(input: {
    distanceId: DistanceId;
    startMs: number;
    endMs: number;
    graceSec: number;
    hidden: boolean;
    houseBps: number;
    entryTinybars: number;
  }): Promise<Market> {
    const catalog = catalogById(input.distanceId);
    if (!catalog) throw new Error("distance is not in the catalog");
    const day = localDayBounds(input.startMs || Date.now());
    const id = String(this.localMarketSeq++);
    const market: Market = {
      id,
      distanceId: catalog.id,
      label: catalog.label,
      startMs: day.startMs,
      endMs: day.endMs,
      graceSec: input.graceSec,
      hidden: input.hidden,
      houseBps: input.houseBps,
      entryTinybars: input.entryTinybars,
      status: "scheduled",
      entryCount: 0,
      potTinybars: 0,
      createdAt: Date.now(),
    };
    this.markets.set(id, this.refreshStatus(market));
    this.entries.set(id, []);
    this.results.set(id, []);
    this.persist();
    this.enqueueChain(() => this.chainCreate(market));
    return market;
  }

  enter(marketId: string, userId: string, hederaAccount: string, paymentRef: string): MarketEntry {
    const market = this.getMarket(marketId);
    if (!market) throw new Error("market not found");
    if (market.status === "resolved") throw new Error("market already resolved");
    const existing = (this.entries.get(marketId) ?? []).find((row) => row.userId === userId);
    if (existing) return existing;
    const user = this.users.get(userId);
    if (user) user.hederaAccount = hederaAccount;
    const entry: MarketEntry = { marketId, userId, hederaAccount, paymentRef, paidAt: Date.now() };
    const list = this.entries.get(marketId) ?? [];
    list.push(entry);
    this.entries.set(marketId, list);
    market.entryCount = list.length;
    market.potTinybars += market.entryTinybars;
    this.persist();
    this.enqueueChain(() => this.chainRecordEntry(market, userId, hederaAccount, paymentRef));
    if (user) this.ingestOpenMarkets(user);
    void this.logHcs({
      type: "stakefit.enter",
      protocol: "x402",
      identity: "hcs-14",
      marketId,
      userId,
      hederaAccount,
      paymentRef,
    });
    void this.syncExercises(userId).catch((err) => {
      console.warn("enter sync skipped:", err instanceof Error ? err.message : err);
    });
    return entry;
  }

  startBackgroundSync(intervalMs = 60_000): void {
    const tick = async () => {
      await this.syncEnteredUsers();
      await this.resolveEndedMarkets();
    };
    void tick();
    setInterval(() => void tick(), intervalMs);
  }

  async resolveEndedMarkets(): Promise<void> {
    for (const market of this.markets.values()) {
      this.refreshStatus(market);
      if (market.status !== "resolving") continue;
      try {
        await this.resolveMarket(market.id);
      } catch (err) {
        console.warn("auto-resolve skipped:", market.id, err instanceof Error ? err.message : err);
      }
    }
  }

  async syncEnteredUsers(): Promise<void> {
    if (this.autoSyncing) return;
    this.autoSyncing = true;
    try {
      const userIds = new Set<string>();
      for (const market of this.markets.values()) {
        this.refreshStatus(market);
        if (!["scheduled", "open", "grace"].includes(market.status)) continue;
        for (const entry of this.entries.get(market.id) ?? []) userIds.add(entry.userId);
      }
      const now = Date.now();
      for (const userId of userIds) {
        const last = this.lastAutoSync.get(userId) ?? 0;
        if (now - last < 45_000) continue;
        this.lastAutoSync.set(userId, now);
        try {
          await this.syncExercises(userId);
        } catch (err) {
          console.warn("auto-sync skipped:", userId, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      this.autoSyncing = false;
    }
  }

  markPaid(marketId: string, userId: string, hederaAccount: string): MarketEntry {
    return this.enter(marketId, userId, hederaAccount, `manual:${Date.now()}`);
  }

  ingestOpenMarkets(user: StakeUser): void {
    for (const market of this.markets.values()) {
      this.refreshStatus(market);
      if (!["open", "grace", "resolving"].includes(market.status)) continue;
      if (!(this.entries.get(market.id) ?? []).some((row) => row.userId === user.id)) continue;
      const day = raceDayBounds(market);
      const scored = ingestWorkout({
        userId: user.id,
        distanceId: market.distanceId,
        startMs: day.startMs,
        endMs: day.endMs,
        sessions: user.exercises,
      });
      if (!scored.ok || scored.timeMs === undefined || !scored.exerciseId) continue;
      this.applyCreScore(market.id, user.id, scored.timeMs, scored.exerciseId);
    }
  }

  applyCreScore(marketId: string, userId: string, timeMs: number, exerciseId: string): boolean {
    const market = this.getMarket(marketId);
    if (!market) throw new Error("market not found");
    this.refreshStatus(market);
    if (!["open", "grace", "resolving"].includes(market.status)) throw new Error("race is not accepting times");
    if (!(this.entries.get(marketId) ?? []).some((row) => row.userId === userId)) {
      throw new Error("user has not entered");
    }
    const list = this.results.get(marketId) ?? [];
    const prev = list.find((row) => row.userId === userId);
    if (prev && timeMs >= prev.timeMs) return false;
    const next = list.filter((row) => row.userId !== userId);
    next.push({ userId, timeMs, exerciseId, scoredBy: "cre" });
    this.results.set(marketId, next);
    this.persist();
    this.enqueueChain(() => this.chainSubmitResult(market, userId, timeMs, exerciseId));
    void this.logHcs({
      type: "stakefit.result",
      scoredBy: "cre",
      marketId,
      userId,
      timeMs,
      exerciseId,
    });
    return true;
  }

  openWorkoutsForCre() {
    return [...this.markets.values()]
      .map((market) => {
        this.refreshStatus(market);
        if (!["open", "grace", "resolving"].includes(market.status)) return undefined;
        const catalog = catalogById(market.distanceId);
        const day = raceDayBounds(market);
        return {
          id: market.id,
          distanceMillimeters: catalog?.millimeters ?? 0,
          startMs: day.startMs,
          endMs: day.endMs,
          runners: (this.entries.get(market.id) ?? []).map((entry) => {
            const user = this.users.get(entry.userId);
            return {
              userId: entry.userId,
              sessions: (user?.exercises ?? []).map((session) => ({
                id: session.id,
                startMs: session.startMs,
                endMs: session.endMs,
                activeDurationMs: session.activeDurationMs,
                distanceMillimeters: session.distanceMillimeters,
              })),
            };
          }),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }

  async resolveMarket(marketId: string, opts?: { admin?: boolean; seed?: bigint }): Promise<Market> {
    const market = this.getMarket(marketId);
    if (!market) throw new Error("market not found");
    if (market.status === "resolved") return market;
    const seed = opts?.seed ?? this.vrfSeed(market);
    market.vrfSeed = seed.toString();
    const ranked = rankWithTies(
      (this.results.get(marketId) ?? []).map((row) => ({
        ...row,
        hederaAccount: this.users.get(row.userId)?.hederaAccount ?? "",
      })),
      seed,
    ).slice(0, 3);
    market.winners = ranked.map((row, index) => ({
      userId: row.userId,
      hederaAccount: row.hederaAccount,
      timeMs: row.timeMs,
      rank: (index + 1) as 1 | 2 | 3,
    }));
    const split = splitPot(market.potTinybars, market.houseBps, market.winners.length);
    const amounts = [split.firstTinybars, split.secondTinybars, split.thirdTinybars];
    this.payouts.set(
      market.id,
      market.winners.map((winner, index) => ({
        userId: winner.userId,
        rank: winner.rank,
        tinybars: amounts[index] ?? 0,
        hederaAccount: winner.hederaAccount || undefined,
      })),
    );
    market.status = "resolved";
    market.resolvedAt = Date.now();
    this.persist();
    this.enqueueChain(() => this.chainResolve(market, opts?.admin ?? false));
    void this.payMappedWinners(market.id);
    void this.logHcs({
      type: "stakefit.resolve",
      marketId: market.id,
      winners: market.winners,
      potTinybars: market.potTinybars,
      vrf: Boolean(this.config.vrfSubscriptionId),
    });
    return market;
  }

  setWorldNullifier(userId: string, nullifier: string): void {
    const user = this.users.get(userId);
    if (user) user.worldNullifier = nullifier;
  }

  recordCertificate(
    userId: string,
    marketId: string,
    serial: string,
    cid?: string,
    extra?: { tokenId?: string; txId?: string },
  ): void {
    this.certificates.set(`${userId}:${marketId}`, { serial, cid, marketId, ...extra });
  }

  getCertificate(userId: string, marketId: string): Certificate | undefined {
    return this.certificates.get(`${userId}:${marketId}`);
  }

  async claimPayout(marketId: string, userId: string, hederaAccount: string): Promise<PayoutRecord> {
    const market = this.getMarket(marketId);
    if (!market) throw new Error("market not found");
    if (market.status !== "resolved") throw new Error("race is still open");
    const list = this.payouts.get(marketId) ?? [];
    const payout = list.find((row) => row.userId === userId);
    if (!payout) throw new Error("you did not place in the top 3");
    if (!hederaAccount) throw new Error("connect HashPack first");
    this.setHederaAccount(userId, hederaAccount);
    payout.hederaAccount = hederaAccount;
    if (!payout.paidAt && payout.tinybars > 0) {
      const txId = await this.sendPayout(payout);
      payout.paidAt = Date.now();
      payout.txId = txId;
      void this.logHcs({
        type: "stakefit.payout",
        marketId,
        userId,
        rank: payout.rank,
        tinybars: payout.tinybars,
        hederaAccount,
        txId,
      });
    } else if (!payout.paidAt) {
      payout.paidAt = Date.now();
    }
    this.persist();
    return payout;
  }

  getResult(marketId: string, userId: string): StoredResult | undefined {
    return (this.results.get(marketId) ?? []).find((row) => row.userId === userId);
  }

  evmUser(userId: string): string {
    return ethers.getAddress(`0x${ethers.id(userId).slice(26)}`);
  }

  private refreshStatus(market: Market): Market {
    if (market.status !== "resolved") market.status = marketStatusAt(market);
    return market;
  }

  private async freshAccessToken(user: StakeUser): Promise<string> {
    if (this.config.healthMock) return "mock";
    const config = this.oauthConfig();
    if (!user.tokens || !config) throw new Error("Fitbit / Google Health is not connected");
    if (user.tokens.expiresAt - 60_000 > Date.now()) return user.tokens.accessToken;
    if (!user.tokens.refreshToken) throw new Error("Google refresh token missing; reconnect Fitbit");
    user.tokens = await refreshAccessToken(config, user.tokens.refreshToken);
    return user.tokens.accessToken;
  }

  private vrfSeed(market: Market): bigint {
    if (this.config.vrfSubscriptionId && market.vrfSeed) return BigInt(market.vrfSeed);
    const hash = createHash("sha256").update(`${market.id}:${Date.now()}`).digest("hex");
    return BigInt(`0x${hash.slice(0, 16)}`);
  }

  private statePath(): string {
    if (process.env.STAKEFIT_STATE_PATH) return resolve(process.env.STAKEFIT_STATE_PATH);
    return resolve(dirname(fileURLToPath(import.meta.url)), "../../../.data/stakefit.json");
  }

  private persist(): void {
    try {
      const path = this.statePath();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({
          seq: this.localMarketSeq,
          markets: [...this.markets.values()],
          entries: Object.fromEntries(this.entries),
          results: Object.fromEntries(this.results),
          payouts: Object.fromEntries(this.payouts),
          certificates: [...this.certificates.entries()],
          users: [...this.users.values()],
        }),
      );
    } catch (err) {
      console.warn("Could not persist heats:", err instanceof Error ? err.message : err);
    }
  }

  private restore(): void {
    try {
      const raw = JSON.parse(readFileSync(this.statePath(), "utf8")) as {
        seq?: number;
        markets?: Market[];
        entries?: Record<string, MarketEntry[]>;
        results?: Record<string, StoredResult[]>;
        payouts?: Record<string, PayoutRecord[]>;
        certificates?: Array<[string, Certificate]>;
        users?: StakeUser[];
      };
      this.localMarketSeq = raw.seq ?? 1;
      let clamped = false;
      for (const market of raw.markets ?? []) {
        if (this.clampToRaceDay(market)) clamped = true;
        this.markets.set(market.id, market);
      }
      for (const [id, rows] of Object.entries(raw.entries ?? {})) this.entries.set(id, rows);
      for (const [id, rows] of Object.entries(raw.results ?? {})) this.results.set(id, rows);
      for (const [id, rows] of Object.entries(raw.payouts ?? {})) this.payouts.set(id, rows);
      for (const [key, cert] of raw.certificates ?? []) this.certificates.set(key, cert);
      for (const user of raw.users ?? []) {
        this.users.set(user.id, { ...user, exercises: user.exercises ?? [] });
      }
      if (clamped) {
        this.dropResultsOutsideRaceDay();
        this.persist();
      }
    } catch {
      // First boot, or the file is missing.
    }
  }

  private clampToRaceDay(market: Market): boolean {
    if (market.status === "resolved") return false;
    const day = raceDayBounds(market);
    if (day.startMs === market.startMs && day.endMs === market.endMs) return false;
    market.startMs = day.startMs;
    market.endMs = day.endMs;
    return true;
  }

  private dropResultsOutsideRaceDay(): void {
    for (const [id, rows] of this.results) {
      const market = this.markets.get(id);
      if (!market) continue;
      const day = raceDayBounds(market);
      this.results.set(
        id,
        rows.filter((row) => {
          const session = this.users.get(row.userId)?.exercises.find((item) => item.id === row.exerciseId);
          return Boolean(session && session.startMs >= day.startMs && session.startMs <= day.endMs);
        }),
      );
    }
  }

  private enqueueChain(work: () => Promise<void>): Promise<void> {
    const run = this.chainTail.then(work, work).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (/already known|nonce too low|replacement transaction underpriced|could not coalesce/i.test(message)) {
        return;
      }
      console.warn("Sepolia write skipped:", message);
    });
    this.chainTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private signer() {
    if (!this.config.sepoliaRpcUrl || !this.config.deployerPrivateKey || !this.config.marketRegistryAddress) return undefined;
    const provider = new ethers.JsonRpcProvider(this.config.sepoliaRpcUrl);
    return new ethers.Wallet(this.config.deployerPrivateKey, provider);
  }

  private contract() {
    const signer = this.signer();
    if (!signer || !this.config.marketRegistryAddress) return undefined;
    return new ethers.Contract(this.config.marketRegistryAddress, STAKEFIT_MARKET_ABI, signer);
  }

  private async chainCreate(market: Market): Promise<void> {
    const contract = this.contract();
    if (!contract) return;
    const tx = await contract.createMarket(
      ethers.encodeBytes32String(market.distanceId),
      Math.floor(market.startMs / 1000),
      Math.floor(market.endMs / 1000),
      market.graceSec,
      market.hidden,
      market.houseBps,
      market.entryTinybars,
    );
    await tx.wait();
  }

  private async chainRecordEntry(market: Market, userId: string, hederaAccount: string, paymentRef: string): Promise<void> {
    const contract = this.contract();
    if (!contract) return;
    const tx = await contract.recordEntry(
      market.id,
      this.evmUser(userId),
      this.evmUser(hederaAccount || userId),
      ethers.id(paymentRef),
    );
    await tx.wait();
  }

  private async chainSubmitResult(market: Market, userId: string, timeMs: number, exerciseId: string): Promise<void> {
    const contract = this.contract();
    if (!contract) return;
    const tx = await contract.submitResult(market.id, this.evmUser(userId), timeMs, ethers.id(exerciseId));
    await tx.wait();
  }

  private async chainResolve(market: Market, admin: boolean): Promise<void> {
    const contract = this.contract();
    if (!contract) return;
    const winners = market.winners ?? [];
    const args = [
      market.id,
      winners[0] ? this.evmUser(winners[0].userId) : ethers.ZeroAddress,
      winners[1] ? this.evmUser(winners[1].userId) : ethers.ZeroAddress,
      winners[2] ? this.evmUser(winners[2].userId) : ethers.ZeroAddress,
      winners[0]?.timeMs ?? 0,
      winners[1]?.timeMs ?? 0,
      winners[2]?.timeMs ?? 0,
    ];
    const tx = admin ? await contract.adminResolve(...args) : await contract.resolve(...args);
    await tx.wait();
  }

  private async payMappedWinners(marketId: string): Promise<void> {
    for (const payout of this.payouts.get(marketId) ?? []) {
      if (payout.paidAt || !payout.hederaAccount || !payout.tinybars) continue;
      try {
        const txId = await this.sendPayout(payout);
        payout.paidAt = Date.now();
        payout.txId = txId;
      } catch (err) {
        console.warn("payout held for claim:", payout.userId, err instanceof Error ? err.message : err);
      }
    }
    this.persist();
  }

  private async sendPayout(payout: PayoutRecord): Promise<string | undefined> {
    if (!payout.hederaAccount || !payout.tinybars) return undefined;
    const { loadHederaConfig, hasHederaCredentials, transferTinybars } = await import("@stakefit/hedera");
    const hedera = loadHederaConfig();
    if (!hasHederaCredentials(hedera) || !this.config.payToAccount) return "local";
    await transferTinybars(hedera, this.config.payToAccount, payout.hederaAccount, payout.tinybars);
    return `hbar:${payout.hederaAccount}:${payout.tinybars}`;
  }

}

function mockSessions(markets: Market[]): ExerciseSession[] {
  const open = markets.find((market) => ["open", "grace", "resolving"].includes(market.status));
  const startMs = open
    ? Math.min(open.endMs, Math.max(open.startMs, Date.now() - 30_000))
    : Date.now() - 30_000;
  return [
    {
      id: `mock-50m-${startMs}`,
      displayName: "Demo 50m",
      exerciseType: "WALKING",
      startMs,
      endMs: startMs + 25_000,
      activeDurationMs: 22_000,
      distanceMillimeters: 58_000,
      steps: 72,
      deviceVersion: "Fitbit Air (mock)",
      lastSyncTime: new Date().toISOString(),
    },
  ];
}
