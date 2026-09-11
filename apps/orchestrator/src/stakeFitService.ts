import { randomBytes, createHash } from "node:crypto";
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
  marketStatusAt,
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
  deviceVersion?: string;
}

interface StoredResult {
  userId: string;
  timeMs: number;
  exerciseId: string;
}

interface Certificate {
  serial: string;
  cid?: string;
  marketId: string;
}

export class StakeFitService {
  readonly users = new Map<string, StakeUser>();
  readonly markets = new Map<string, Market>();
  readonly entries = new Map<string, MarketEntry[]>();
  readonly results = new Map<string, StoredResult[]>();
  readonly certificates = new Map<string, Certificate>();
  readonly oauthStates = new Map<string, number>();
  private localMarketSeq = 1;

  constructor(private readonly config: OrchestratorConfig) {}

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
    const sessions = await listAllExercises(client, { maxPages: 8 });
    user.exercises = sessions;
    user.lastSyncTime = devices[0]?.lastSyncTime ?? (sessions[0] ? new Date().toISOString() : user.lastSyncTime);
    user.deviceVersion =
      devices.find((d) => /air/i.test(d.deviceVersion ?? ""))?.deviceVersion ??
      devices[0]?.deviceVersion ??
      sessions[0]?.deviceVersion;
    for (const session of sessions) {
      session.deviceVersion = user.deviceVersion;
      session.lastSyncTime = user.lastSyncTime;
    }
    this.ingestOpenMarkets(user);
    return { sessions, lastSyncTime: user.lastSyncTime, devices: devices.map((d) => d.deviceVersion ?? d.name) };
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
        const inWindow = session.startMs >= market.startMs && session.startMs <= market.endMs;
        if (inWindow && session.distanceMillimeters >= catalog.millimeters) {
          qualifiedMarkets.push({ marketId: market.id, label: market.label, distanceId: market.distanceId });
        }
        const submitted = (this.results.get(market.id) ?? []).find((row) => row.exerciseId === session.id);
        if (submitted) resultMarketId = market.id;
      }
      return {
        ...session,
        qualifiedMarkets,
        resultMarketId,
        certificateSerial: [...this.certificates.entries()].find(([, cert]) => cert.marketId === resultMarketId)?.[0] === userId
          ? this.certificates.get(`${userId}:${resultMarketId}`)?.serial
          : this.certificates.get(`${userId}:${resultMarketId}`)?.serial,
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
    return {
      ...market,
      entries: entries.map((entry) => ({
        userId: entry.userId,
        hederaAccount: entry.hederaAccount,
        mine: entry.userId === viewerId,
      })),
      results: results.map((row) => ({
        userId: row.userId,
        exerciseId: row.exerciseId,
        timeMs: hideTimes && row.userId !== viewerId ? undefined : row.timeMs,
        hidden: hideTimes && row.userId !== viewerId,
      })),
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
    if (input.endMs <= input.startMs) throw new Error("end must be after start");
    const id = String(this.localMarketSeq++);
    const market: Market = {
      id,
      distanceId: catalog.id,
      label: catalog.label,
      startMs: input.startMs,
      endMs: input.endMs,
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
    await this.chainCreate(market);
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
    void this.chainRecordEntry(market, userId, hederaAccount, paymentRef);
    return entry;
  }

  markPaid(marketId: string, userId: string, hederaAccount: string): MarketEntry {
    return this.enter(marketId, userId, hederaAccount, `manual:${Date.now()}`);
  }

  ingestOpenMarkets(user: StakeUser): void {
    for (const market of this.markets.values()) {
      this.refreshStatus(market);
      if (!["open", "grace", "resolving"].includes(market.status)) continue;
      if (!(this.entries.get(market.id) ?? []).some((row) => row.userId === user.id)) continue;
      const scored = ingestWorkout({
        userId: user.id,
        distanceId: market.distanceId,
        startMs: market.startMs,
        endMs: market.endMs,
        sessions: user.exercises,
      });
      if (!scored.ok || scored.timeMs === undefined || !scored.exerciseId) continue;
      const list = this.results.get(market.id) ?? [];
      const prev = list.find((row) => row.userId === user.id);
      if (!prev || scored.timeMs < prev.timeMs) {
        const next = list.filter((row) => row.userId !== user.id);
        next.push({ userId: user.id, timeMs: scored.timeMs, exerciseId: scored.exerciseId });
        this.results.set(market.id, next);
        void this.chainSubmitResult(market, user.id, scored.timeMs, scored.exerciseId);
      }
    }
  }

  async resolveMarket(marketId: string, opts?: { admin?: boolean; seed?: bigint }): Promise<Market> {
    const market = this.getMarket(marketId);
    if (!market) throw new Error("market not found");
    if (market.status === "resolved") return market;
    for (const entry of this.entries.get(marketId) ?? []) {
      const user = this.users.get(entry.userId);
      if (user?.tokens) {
        try {
          await this.syncExercises(user.id);
        } catch {
          // Keep last cached sessions; resolve still runs.
        }
      }
    }
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
    market.status = "resolved";
    market.resolvedAt = Date.now();
    await this.chainResolve(market, opts?.admin ?? false);
    await this.payWinners(market);
    await this.logResolve(market);
    return market;
  }

  setWorldNullifier(userId: string, nullifier: string): void {
    const user = this.users.get(userId);
    if (user) user.worldNullifier = nullifier;
  }

  recordCertificate(userId: string, marketId: string, serial: string, cid?: string): void {
    this.certificates.set(`${userId}:${marketId}`, { serial, cid, marketId });
  }

  getCertificate(userId: string, marketId: string): Certificate | undefined {
    return this.certificates.get(`${userId}:${marketId}`);
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

  private async payWinners(market: Market): Promise<void> {
    const split = splitPot(market.potTinybars, market.houseBps, market.winners?.length ?? 0);
    const amounts = [split.firstTinybars, split.secondTinybars, split.thirdTinybars];
    try {
      const { loadHederaConfig, hasHederaCredentials, transferTinybars } = await import("@stakefit/hedera");
      const hedera = loadHederaConfig();
      if (!hasHederaCredentials(hedera) || !this.config.payToAccount) return;
      for (const [index, winner] of (market.winners ?? []).entries()) {
        const tiny = amounts[index] ?? 0;
        if (!tiny || !winner.hederaAccount) continue;
        await transferTinybars(hedera, this.config.payToAccount, winner.hederaAccount, tiny);
      }
    } catch {
      // Demo still shows on-chain resolution even if the merchant account is dry.
    }
  }

  private async logResolve(market: Market): Promise<void> {
    try {
      const { loadHederaConfig, makeClient, hasHederaCredentials, logAction } = await import("@stakefit/hedera");
      const hedera = loadHederaConfig();
      if (!hasHederaCredentials(hedera) || !hedera.auditTopicId) return;
      const client = makeClient(hedera);
      try {
        await logAction(client, hedera.auditTopicId, {
          type: "stakefit.resolve",
          marketId: market.id,
          winners: market.winners,
          potTinybars: market.potTinybars,
        });
      } finally {
        client.close();
      }
    } catch {
      // HCS is best-effort.
    }
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
