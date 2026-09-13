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
  localDayBounds,
  looksLikeCivilDay,
  marketStatusAt,
  raceDayBounds,
  scoreDistanceTimeMs,
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
  timeZone?: string;
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
    this.remapChainIdentities();
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

  sessionUser(id?: string): StakeUser | undefined {
    if (!id) return undefined;
    const user = this.users.get(id);
    if (!user) return undefined;
    if (this.config.healthMock) return user;
    if (user.tokens?.accessToken) return user;
    return undefined;
  }

  async refreshViewerIfStale(userId: string, maxAgeMs = 45_000): Promise<void> {
    const user = this.sessionUser(userId);
    if (!user) return;
    if (user.fetchedAt && Date.now() - user.fetchedAt < maxAgeMs) {
      this.ingestOpenMarkets(user);
      return;
    }
    await this.syncExercises(user.id);
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
    this.remapChainIdentities();
  }

  async syncExercises(userId: string): Promise<{ sessions: ExerciseSession[]; lastSyncTime?: string; devices: string[] }> {
    const user = this.users.get(userId);
    if (!user) throw new Error("not signed in");
    if (this.config.healthMock) {
      user.exercises = mockSessions(this.listMarkets());
      user.lastSyncTime = new Date().toISOString();
      user.fetchedAt = Date.now();
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

  rememberTimeZone(userId: string, timeZone?: string): void {
    const zone = timeZone?.trim();
    if (!zone) return;
    const user = this.users.get(userId);
    if (user) user.timeZone = zone;
  }

  history(userId: string, timeZone?: string, now = Date.now()): HistoryRow[] {
    const user = this.users.get(userId);
    if (!user) return [];
    const zone = timeZone || user.timeZone;
    return user.exercises.map((session) => {
      const qualifiedMarkets: HistoryRow["qualifiedMarkets"] = [];
      let resultMarketId: string | undefined;
      for (const market of this.markets.values()) {
        const catalog = catalogById(market.distanceId);
        if (!catalog) continue;
        const day = raceDayBounds(market, now, zone || market.timeZone);
        const inWindow = session.startMs >= day.startMs && session.startMs <= day.endMs;
        const submitted = (this.results.get(market.id) ?? []).find((row) => row.exerciseId === session.id);
        const entered = this.hasEntered(market.id, userId);
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

  publicView(market: Market, viewerId?: string, timeZone?: string, now = Date.now()) {
    if (viewerId) {
      this.rememberTimeZone(viewerId, timeZone);
      const user = this.users.get(viewerId);
      if (user) this.ingestOpenMarkets(user, timeZone, now);
    }
    const entries = this.entries.get(market.id) ?? [];
    const results = this.results.get(market.id) ?? [];
    const hideTimes = market.hidden && market.status !== "resolved";
    const catalog = catalogById(market.distanceId);
    return {
      ...market,
      entries: entries.map((entry) => ({
        userId: this.realUserId(entry.userId),
        hederaAccount: entry.hederaAccount,
        paymentRef: viewerId && this.sameRunner(entry.userId, viewerId) ? entry.paymentRef : undefined,
        paidAt: viewerId && this.sameRunner(entry.userId, viewerId) ? entry.paidAt : undefined,
        mine: Boolean(viewerId && this.sameRunner(entry.userId, viewerId)),
      })),
      results: results.map((row) => ({
        userId: this.realUserId(row.userId),
        exerciseId: row.exerciseId,
        timeMs: hideTimes && !(viewerId && this.sameRunner(row.userId, viewerId)) ? undefined : row.timeMs,
        hidden: hideTimes && !(viewerId && this.sameRunner(row.userId, viewerId)),
        scoredBy: row.scoredBy,
      })),
      yours: viewerId
        ? this.viewerQualify(
            market,
            viewerId,
            catalog?.millimeters ?? 0,
            catalog?.label ?? "the distance",
            timeZone || market.timeZone,
            now,
          )
        : undefined,
      partners: this.partners(viewerId ? this.users.get(viewerId) : undefined),
      noWinner: market.status === "resolved" && !(market.winners?.length),
      payouts: (this.payouts.get(market.id) ?? []).map((row) => ({
        userId: row.userId,
        rank: row.rank,
        tinybars: row.tinybars,
        paid: Boolean(row.paidAt),
        hederaAccount: row.hederaAccount,
        mine: Boolean(viewerId && this.sameRunner(row.userId, viewerId)),
      })),
      entered: viewerId ? this.hasEntered(market.id, viewerId) : false,
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
    const payout = (this.payouts.get(marketId) ?? []).find((row) => this.sameRunner(row.userId, userId));
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
    const payout = (this.payouts.get(market.id) ?? []).find((row) => this.sameRunner(row.userId, userId));
    const cert = this.getCertificate(userId, market.id);
    return {
      label: market.label,
      displayName: session?.displayName ?? "Run",
      startMs: session?.startMs ?? market.startMs,
      distanceMillimeters: session?.distanceMillimeters ?? 0,
      timeMs: result.timeMs,
      heartRateBpm: session?.heartRateBpm,
      caloriesKcal: session?.caloriesKcal,
      rank: payout?.rank ?? market.winners?.find((row) => this.sameRunner(row.userId, userId))?.rank,
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

  private sessionForResult(viewerId: string, exerciseId?: string, timeMs?: number) {
    const user = this.users.get(viewerId);
    if (!user) return undefined;
    if (exerciseId) {
      const exact = user.exercises.find((row) => row.id === exerciseId);
      if (exact) return exact;
    }
    if (timeMs) {
      const exactTime = user.exercises.find((row) => row.activeDurationMs === timeMs);
      if (exactTime) return exactTime;
      for (const catalog of DISTANCE_CATALOG) {
        const paced = user.exercises.find((row) => scoreDistanceTimeMs(row, catalog.millimeters) === timeMs);
        if (paced) return paced;
      }
    }
    return undefined;
  }

  private scoreReason(
    session: { displayName?: string; distanceMillimeters?: number; activeDurationMs?: number } | undefined,
    catalogMm: number,
    distanceLabel: string,
    timeMs?: number,
  ): string {
    if (!session?.distanceMillimeters || !session.activeDurationMs || !catalogMm || !timeMs) {
      return `This is the ${distanceLabel} time from your Fitbit session.`;
    }
    const sessionM = Math.round(session.distanceMillimeters / 1000);
    const catalogM = Math.round(catalogMm / 1000);
    const race = clockText(timeMs);
    const full = clockText(session.activeDurationMs);
    if (session.distanceMillimeters > catalogMm * 1.15) {
      return `${race} is ${distanceLabel} at the pace of that ${sessionM} m session. The session ran ${full}, so ${full} × ${catalogM} ÷ ${sessionM} = ${race}. The full session time is not the race time.`;
    }
    return `${race} is your ${sessionM} m ${session.displayName || "session"} timed over ${distanceLabel}.`;
  }

  private viewerQualify(
    market: Market,
    viewerId: string,
    needMm: number,
    distanceLabel: string,
    timeZone?: string,
    now = Date.now(),
  ): {
    status: string;
    note: string;
    timeMs?: number;
    exerciseId?: string;
    displayName?: string;
    startMs?: number;
    distanceMillimeters?: number;
    sessionDurationMs?: number;
    nearest?: { startMs: number; name: string; distanceMillimeters: number };
  } {
    const day = raceDayBounds(market, now, timeZone);
    const result = this.getResult(market.id, viewerId);
    const resultSession = result ? this.sessionForResult(viewerId, result.exerciseId, result.timeMs) : undefined;
    const resultOnDay =
      result &&
      (!resultSession || (resultSession.startMs >= day.startMs && resultSession.startMs <= day.endMs));
    if (result && resultOnDay) {
      const session = resultSession;
      const paced = session && needMm ? scoreDistanceTimeMs(session, needMm) : 0;
      return {
        status: "counted",
        note: this.scoreReason(session, needMm, distanceLabel, paced || result.timeMs),
        timeMs: paced || result.timeMs,
        exerciseId: result.exerciseId,
        displayName: session?.displayName,
        startMs: session?.startMs,
        distanceMillimeters: session?.distanceMillimeters,
        sessionDurationMs: session?.activeDurationMs,
      };
    }
    const user = this.users.get(viewerId);
    if (!user) {
      return { status: "none", note: `Fastest Fitbit time today that covered ${distanceLabel}.` };
    }
    const inDay = user.exercises.filter((session) => session.startMs >= day.startMs && session.startMs <= day.endMs);
    const covered = inDay.filter((session) => session.distanceMillimeters >= needMm && session.activeDurationMs > 0);
    if (covered.length) {
      const best = covered.reduce((a, b) => {
        const aTime = scoreDistanceTimeMs(a, needMm);
        const bTime = scoreDistanceTimeMs(b, needMm);
        return aTime > 0 && (bTime <= 0 || aTime < bTime) ? a : b;
      });
      return {
        status: "ready",
        note: this.scoreReason(best, needMm, distanceLabel, scoreDistanceTimeMs(best, needMm)),
        timeMs: scoreDistanceTimeMs(best, needMm),
        exerciseId: best.id,
        displayName: best.displayName,
        startMs: best.startMs,
        distanceMillimeters: best.distanceMillimeters,
        sessionDurationMs: best.activeDurationMs,
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
    timeZone?: string;
  }): Promise<Market> {
    const catalog = catalogById(input.distanceId);
    if (!catalog) throw new Error("distance is not in the catalog");
    const zone = input.timeZone?.trim();
    const day = zone
      ? localDayBounds(input.startMs || Date.now(), zone)
      : looksLikeCivilDay(input.startMs, input.endMs)
        ? { startMs: input.startMs, endMs: input.endMs }
        : localDayBounds(input.startMs || Date.now());
    const id = await this.requireChainId(day, catalog.id, input);
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
      timeZone: zone,
    };
    this.markets.set(id, this.refreshStatus(market));
    this.entries.set(id, []);
    this.results.set(id, []);
    void this.logHcs({
      type: "stakefit.market",
      marketId: id,
      distanceId: catalog.id,
      startMs: day.startMs,
      endMs: day.endMs,
      graceSec: input.graceSec,
      hidden: input.hidden,
      houseBps: input.houseBps,
      entryTinybars: input.entryTinybars,
      timeZone: zone,
    });
    return market;
  }

  enter(marketId: string, userId: string, hederaAccount: string, paymentRef: string): MarketEntry {
    const market = this.getMarket(marketId);
    if (!market) throw new Error("market not found");
    if (market.status === "resolved") throw new Error("market already resolved");
    const existing = (this.entries.get(marketId) ?? []).find((row) => this.sameRunner(row.userId, userId));
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
      await this.hydrateFromChain();
      await this.syncEnteredUsers();
      await this.resolveEndedMarkets();
    };
    void tick();
    setInterval(() => void tick(), intervalMs);
  }

  async hydrateFromChain(): Promise<void> {
    try {
      await this.hydrateContract();
    } catch (err) {
      console.warn("contract hydrate skipped:", err instanceof Error ? err.message : err);
    }
    try {
      await this.hydrateHcs();
    } catch (err) {
      console.warn("HCS hydrate skipped:", err instanceof Error ? err.message : err);
    }
    this.remapChainIdentities();
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
      for (const user of this.users.values()) {
        if (this.sessionUser(user.id)) userIds.add(user.id);
      }
      for (const market of this.markets.values()) {
        this.refreshStatus(market);
        if (!["scheduled", "open", "grace"].includes(market.status)) continue;
        for (const entry of this.entries.get(market.id) ?? []) {
          const live = this.sessionUser(this.realUserId(entry.userId));
          if (live) userIds.add(live.id);
        }
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

  ingestOpenMarkets(user: StakeUser, timeZone?: string, now = Date.now()): void {
    const zone = timeZone || user.timeZone;
    for (const market of this.markets.values()) {
      this.refreshStatus(market);
      if (!["open", "grace", "resolving"].includes(market.status)) continue;
      if (!this.hasEntered(market.id, user.id)) continue;
      const day = raceDayBounds(market, now, zone);
      this.dropResultsOutsideDay(market, day);
      const scored = ingestWorkout({
        userId: user.id,
        distanceId: market.distanceId,
        startMs: day.startMs,
        endMs: day.endMs,
        sessions: user.exercises,
      });
      if (!scored.ok || scored.timeMs === undefined || !scored.exerciseId) continue;
      this.applyCreScore(market.id, user.id, scored.timeMs, scored.exerciseId, now, zone);
    }
  }

  applyCreScore(
    marketId: string,
    userId: string,
    timeMs: number,
    exerciseId: string,
    now = Date.now(),
    timeZone?: string,
  ): boolean {
    const market = this.getMarket(marketId);
    if (!market) throw new Error("market not found");
    this.refreshStatus(market);
    if (!["open", "grace", "resolving"].includes(market.status)) throw new Error("race is not accepting times");
    if (!this.hasEntered(marketId, userId)) {
      throw new Error("user has not entered");
    }
    const user = this.users.get(userId);
    const day = raceDayBounds(market, now, timeZone || user?.timeZone || market.timeZone);
    const session = this.sessionForResult(userId, exerciseId, timeMs);
    if (session && (session.startMs < day.startMs || session.startMs > day.endMs)) return false;
    const list = this.results.get(marketId) ?? [];
    const prev = list.find((row) => this.sameRunner(row.userId, userId));
    const prevSession = prev ? this.sessionForResult(userId, prev.exerciseId, prev.timeMs) : undefined;
    const prevOnDay =
      prev && (!prevSession || (prevSession.startMs >= day.startMs && prevSession.startMs <= day.endMs));
    if (prev && prevOnDay && timeMs >= prev.timeMs) return false;
    const next = list.filter((row) => !this.sameRunner(row.userId, userId));
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
        const day = raceDayBounds(market, Date.now(), market.timeZone);
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
    return (
      this.certificates.get(`${userId}:${marketId}`) ??
      this.certificates.get(`${this.realUserId(userId)}:${marketId}`) ??
      this.certificates.get(`${this.evmUser(userId)}:${marketId}`)
    );
  }

  async claimPayout(marketId: string, userId: string, hederaAccount: string): Promise<PayoutRecord> {
    const market = this.getMarket(marketId);
    if (!market) throw new Error("market not found");
    if (market.status !== "resolved") throw new Error("this race has not resolved yet");
    const list = this.payouts.get(marketId) ?? [];
    const payout = list.find((row) => this.sameRunner(row.userId, userId));
    if (!payout) throw new Error("no prize is held for your account on this race");
    if (!hederaAccount) throw new Error("connect HashPack, then claim again");
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
    return (this.results.get(marketId) ?? []).find((row) => this.sameRunner(row.userId, userId));
  }

  evmUser(userId: string): string {
    if (userId.startsWith("0x") && userId.length === 42) return ethers.getAddress(userId);
    return ethers.getAddress(`0x${ethers.id(userId).slice(26)}`);
  }

  sameRunner(stored: string, userId: string): boolean {
    if (stored === userId) return true;
    try {
      return this.evmUser(stored).toLowerCase() === this.evmUser(userId).toLowerCase();
    } catch {
      return stored.replace(/^evm:/i, "").toLowerCase() === userId.toLowerCase();
    }
  }

  private hasEntered(marketId: string, userId: string): boolean {
    return (this.entries.get(marketId) ?? []).some((row) => this.sameRunner(row.userId, userId));
  }

  private realUserId(id: string): string {
    if (this.users.has(id)) return id;
    for (const user of this.users.values()) {
      if (this.sameRunner(id, user.id)) return user.id;
    }
    return id;
  }

  private remapChainIdentities(): void {
    for (const [marketId, list] of this.entries) {
      this.entries.set(
        marketId,
        list.map((row) => ({
          ...row,
          userId: this.realUserId(row.userId),
          hederaAccount: row.hederaAccount || this.users.get(this.realUserId(row.userId))?.hederaAccount || "",
        })),
      );
    }
    for (const [marketId, list] of this.results) {
      this.results.set(marketId, list.map((row) => ({ ...row, userId: this.realUserId(row.userId) })));
    }
    for (const [marketId, list] of this.payouts) {
      this.payouts.set(
        marketId,
        list.map((row) => ({
          ...row,
          userId: this.realUserId(row.userId),
          hederaAccount: row.hederaAccount || this.users.get(this.realUserId(row.userId))?.hederaAccount,
        })),
      );
    }
    for (const market of this.markets.values()) {
      if (!market.winners) continue;
      market.winners = market.winners.map((row) => ({
        ...row,
        userId: this.realUserId(row.userId),
        hederaAccount: row.hederaAccount || this.users.get(this.realUserId(row.userId))?.hederaAccount || "",
      }));
    }
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

  private decodeDistance(value: string): DistanceId {
    try {
      const text = ethers.decodeBytes32String(value).replace(/\0/g, "");
      if (catalogById(text)) return text as DistanceId;
    } catch {
      /* hex from The Graph */
    }
    try {
      const raw = value.startsWith("0x") ? ethers.toUtf8String(value).replace(/\0/g, "") : value;
      return (catalogById(raw)?.id ?? "50m") as DistanceId;
    } catch {
      return "50m";
    }
  }

  private rememberUser(userId: string, extra?: Partial<StakeUser>): StakeUser {
    const existing = this.users.get(userId);
    if (existing) {
      Object.assign(existing, extra);
      return existing;
    }
    const user: StakeUser = { id: userId, email: extra?.email ?? "", exercises: extra?.exercises ?? [], ...extra };
    this.users.set(userId, user);
    return user;
  }

  private putMarket(market: Market): void {
    this.markets.set(market.id, this.refreshStatus(market));
    if (!this.entries.has(market.id)) this.entries.set(market.id, []);
    if (!this.results.has(market.id)) this.results.set(market.id, []);
  }

  private async hydrateContract(): Promise<void> {
    const contract = this.reader();
    if (!contract) return;
    const next = Number(await contract.nextMarketId());
    for (let id = 1; id < next; id += 1) {
      const row = await contract.markets(id);
      const distanceId = this.decodeDistance(row.distanceId as string);
      const catalog = catalogById(distanceId);
      const entryCount = Number(row.entryCount);
      const market: Market = {
        id: String(id),
        distanceId,
        label: catalog?.label ?? distanceId,
        startMs: Number(row.startTs) * 1000,
        endMs: Number(row.endTs) * 1000,
        graceSec: Number(row.graceSec),
        hidden: Boolean(row.hidden),
        houseBps: Number(row.houseBps),
        entryTinybars: Number(row.entryTinybars),
        status: row.resolved ? "resolved" : "open",
        entryCount,
        potTinybars: entryCount * Number(row.entryTinybars),
        vrfSeed: row.vrfSeed ? String(row.vrfSeed) : undefined,
        createdAt: Number(row.startTs) * 1000,
        resolvedAt: row.resolved ? Date.now() : undefined,
      };
      if (row.resolved) {
        const places = [
          { addr: row.first as string, timeMs: Number(row.firstTimeMs) },
          { addr: row.second as string, timeMs: Number(row.secondTimeMs) },
          { addr: row.third as string, timeMs: Number(row.thirdTimeMs) },
        ].filter((place) => place.addr && place.addr !== ethers.ZeroAddress);
        market.winners = places.map((place, index) => ({
          userId: place.addr,
          hederaAccount: this.users.get(place.addr)?.hederaAccount ?? "",
          timeMs: place.timeMs,
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
      }
      this.putMarket(market);
    }
    await this.hydrateContractLogs(contract);
  }

  private async hydrateContractLogs(contract: ethers.Contract): Promise<void> {
    const fromBlock = Number(process.env.SEPOLIA_FROM_BLOCK ?? 0);
    const entered = await contract.queryFilter(contract.filters.Entered(), fromBlock);
    for (const log of entered) {
      const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;
      const marketId = String(parsed.args.marketId);
      const user = String(parsed.args.user);
      const list = this.entries.get(marketId) ?? [];
      if (list.some((row) => this.sameRunner(row.userId, user))) continue;
      list.push({
        marketId,
        userId: user,
        hederaAccount: "",
        paymentRef: String(parsed.args.paymentRef),
        paidAt: Date.now(),
      });
      this.entries.set(marketId, list);
      const onchain = await contract.entries(marketId, user);
      if (onchain.hasResult) {
        const results = this.results.get(marketId) ?? [];
        if (!results.some((row) => this.sameRunner(row.userId, user))) {
          results.push({
            userId: user,
            timeMs: Number(onchain.timeMs),
            exerciseId: String(onchain.exerciseId),
            scoredBy: "cre",
          });
          this.results.set(marketId, results);
        }
      }
    }
  }

  private async hydrateHcs(): Promise<void> {
    const topic = process.env.HCS_AUDIT_TOPIC_ID;
    if (!topic) return;
    let url: string | undefined =
      `https://testnet.mirrornode.hedera.com/api/v1/topics/${topic}/messages?limit=100&order=asc`;
    while (url) {
      const res = await fetch(url);
      if (!res.ok) break;
      const body = (await res.json()) as {
        messages?: Array<{ message: string }>;
        links?: { next?: string };
      };
      for (const row of body.messages ?? []) {
        const decoded = Buffer.from(row.message, "base64").toString("utf8");
        try {
          this.applyHcs(JSON.parse(decoded) as Record<string, unknown>);
        } catch {
          /* ignore */
        }
      }
      url = body.links?.next ? `https://testnet.mirrornode.hedera.com${body.links.next}` : undefined;
    }
  }

  private applyHcs(entry: Record<string, unknown>): void {
    const type = String(entry.type ?? "");
    const marketId = String(entry.marketId ?? "");
    const userId = String(entry.userId ?? "");
    if (type === "stakefit.market" && marketId) {
      const zone = typeof entry.timeZone === "string" ? entry.timeZone.trim() : "";
      const existing = this.markets.get(marketId);
      if (existing) {
        if (zone) existing.timeZone = zone;
      } else {
        const distanceId = (catalogById(String(entry.distanceId ?? ""))?.id ?? "50m") as DistanceId;
        const catalog = catalogById(distanceId);
        this.putMarket({
          id: marketId,
          distanceId,
          label: catalog?.label ?? distanceId,
          startMs: Number(entry.startMs ?? 0),
          endMs: Number(entry.endMs ?? 0),
          graceSec: Number(entry.graceSec ?? 900),
          hidden: Boolean(entry.hidden),
          houseBps: Number(entry.houseBps ?? 1000),
          entryTinybars: Number(entry.entryTinybars ?? 0),
          status: "scheduled",
          entryCount: 0,
          potTinybars: 0,
          createdAt: Number(entry.startMs ?? Date.now()),
          timeZone: zone || undefined,
        });
      }
    }
    if (type === "stakefit.enter" && marketId && userId) {
      this.rememberUser(userId, { hederaAccount: String(entry.hederaAccount ?? "") });
      const list = this.entries.get(marketId) ?? [];
      const next = list.filter((row) => !this.sameRunner(row.userId, userId));
      next.push({
        marketId,
        userId,
        hederaAccount: String(entry.hederaAccount ?? ""),
        paymentRef: String(entry.paymentRef ?? ""),
        paidAt: Number(entry.at ?? Date.now()),
      });
      this.entries.set(marketId, next);
      const market = this.markets.get(marketId);
      if (market) {
        market.entryCount = next.length;
        market.potTinybars = next.length * market.entryTinybars;
      }
    }
    if (type === "stakefit.result" && marketId && userId) {
      const list = this.results.get(marketId) ?? [];
      const next = list.filter((row) => !this.sameRunner(row.userId, userId));
      next.push({
        userId,
        timeMs: Number(entry.timeMs ?? 0),
        exerciseId: String(entry.exerciseId ?? ""),
        scoredBy: "cre",
      });
      this.results.set(marketId, next);
    }
    if (type === "stakefit.certificate" && marketId && userId) {
      this.recordCertificate(userId, marketId, String(entry.serial ?? ""), entry.cid ? String(entry.cid) : undefined, {
        txId: entry.txId ? String(entry.txId) : undefined,
      });
    }
    if (type === "stakefit.resolve" && marketId) {
      const market = this.markets.get(marketId);
      const winners = Array.isArray(entry.winners) ? entry.winners : [];
      if (market && winners.length) {
        market.winners = winners.map((row, index) => {
          const winner = row as { userId?: string; hederaAccount?: string; timeMs?: number; rank?: number };
          const id = String(winner.userId ?? "");
          if (id) this.rememberUser(id, { hederaAccount: winner.hederaAccount });
          return {
            userId: id,
            hederaAccount: String(winner.hederaAccount ?? ""),
            timeMs: Number(winner.timeMs ?? 0),
            rank: (winner.rank ?? index + 1) as 1 | 2 | 3,
          };
        });
        market.status = "resolved";
        market.resolvedAt = Number(entry.at ?? Date.now());
        market.potTinybars = Number(entry.potTinybars ?? market.potTinybars);
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
      }
    }
    if (type === "stakefit.payout" && marketId && userId) {
      const list = this.payouts.get(marketId) ?? [];
      const payout = list.find((row) => this.sameRunner(row.userId, userId));
      if (payout) {
        payout.hederaAccount = String(entry.hederaAccount ?? payout.hederaAccount ?? "");
        payout.txId = String(entry.txId ?? "");
        payout.paidAt = Number(entry.at ?? Date.now());
      }
    }
  }

  private persist(): void {
    /* Race state is Sepolia + Hedera HCS. Google tokens stay in process memory. */
  }

  private restore(): void {
    /* Hydrated from the market contract and HCS after boot. */
  }

  private clampToRaceDay(market: Market): boolean {
    if (market.status === "resolved") return false;
    const day = raceDayBounds(market, Date.now(), market.timeZone);
    if (day.startMs === market.startMs && day.endMs === market.endMs) return false;
    market.startMs = day.startMs;
    market.endMs = day.endMs;
    return true;
  }

  private dropResultsOutsideDay(market: Market, day: { startMs: number; endMs: number }): void {
    const rows = this.results.get(market.id) ?? [];
    this.results.set(
      market.id,
      rows.filter((row) => {
        const session = this.sessionForResult(row.userId, row.exerciseId, row.timeMs);
        return !session || (session.startMs >= day.startMs && session.startMs <= day.endMs);
      }),
    );
  }

  private dropResultsOutsideRaceDay(): void {
    for (const market of this.markets.values()) {
      this.dropResultsOutsideDay(market, raceDayBounds(market, Date.now(), market.timeZone));
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

  private reader() {
    if (!this.config.sepoliaRpcUrl || !this.config.marketRegistryAddress) return undefined;
    const provider = new ethers.JsonRpcProvider(this.config.sepoliaRpcUrl);
    return new ethers.Contract(this.config.marketRegistryAddress, STAKEFIT_MARKET_ABI, provider);
  }

  private contract() {
    if (this.config.healthMock) return undefined;
    const signer = this.signer();
    if (!signer || !this.config.marketRegistryAddress) return undefined;
    return new ethers.Contract(this.config.marketRegistryAddress, STAKEFIT_MARKET_ABI, signer);
  }

  private async requireChainId(
    day: { startMs: number; endMs: number },
    distanceId: DistanceId,
    input: { graceSec: number; hidden: boolean; houseBps: number; entryTinybars: number },
  ): Promise<string> {
    if (this.config.healthMock) return String(this.localMarketSeq++);
    if (!this.contract()) {
      throw new Error(
        "Races live on Sepolia StakeFitMarket. Set MARKET_REGISTRY_ADDRESS, SEPOLIA_RPC_URL, and DEPLOYER_PRIVATE_KEY.",
      );
    }
    return this.chainCreateId(day, distanceId, input);
  }

  private async chainCreateId(
    day: { startMs: number; endMs: number },
    distanceId: DistanceId,
    input: { graceSec: number; hidden: boolean; houseBps: number; entryTinybars: number },
  ): Promise<string> {
    const contract = this.contract();
    if (!contract) return String(this.localMarketSeq++);
    const tx = await contract.createMarket(
      ethers.encodeBytes32String(distanceId),
      Math.floor(day.startMs / 1000),
      Math.floor(day.endMs / 1000),
      input.graceSec,
      input.hidden,
      input.houseBps,
      input.entryTinybars,
    );
    const receipt = await tx.wait();
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "MarketCreated") return String(parsed.args.marketId);
      } catch {
        /* next log */
      }
    }
    return String((await contract.nextMarketId()) - 1n);
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
    try {
      const txId = await transferTinybars(hedera, this.config.payToAccount, payout.hederaAccount, payout.tinybars);
      return txId ?? `hbar:${payout.hederaAccount}:${payout.tinybars}`;
    } catch (err) {
      throw new Error(`payout to ${payout.hederaAccount} failed: ${payoutHint(err)}`);
    }
  }

}

/** Turn a Hedera SDK error into something a runner can act on. */
function payoutHint(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/INSUFFICIENT_(PAYER_|ACCOUNT_)?BALANCE/i.test(raw)) return "the prize account is out of testnet HBAR, ask the host to top it up";
  if (/INVALID_ACCOUNT_ID|ACCOUNT_DELETED/i.test(raw)) return "that Hedera account id is not valid, reconnect HashPack";
  if (/ACCOUNT_ID_DOES_NOT_EXIST/i.test(raw)) return "that Hedera account does not exist on this network, switch HashPack to testnet";
  if (/timed out|timeout|ETIMEDOUT|ECONNRESET/i.test(raw)) return "the Hedera network did not answer in time, try again";
  return raw;
}

/** Same clock the UI shows: `18s` or `1:12`. */
function clockText(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return min === 0 ? `${sec}s` : `${min}:${String(rem).padStart(2, "0")}`;
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
