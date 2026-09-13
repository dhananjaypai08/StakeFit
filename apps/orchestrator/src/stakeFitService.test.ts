import assert from "node:assert/strict";
import { test } from "node:test";
import { localDayBounds, raceDayBounds } from "@stakefit/shared";
import { loadConfig } from "./config";
import { StakeFitService } from "./stakeFitService";

function isolatedEnv() {
  return {
    ...process.env,
    HEALTH_MOCK: "true",
    SCAN_SKIP_PAYMENT: "true",
    SESSION_SECRET: "test",
    ADMIN_EMAILS: "demo@stakefit.local",
  };
}

test("demo heat: enter, mock sync, admin resolve top 1", async () => {
  const config = loadConfig(isolatedEnv());
  const service = new StakeFitService(config);
  const user = service.upsertDevUser();
  const now = Date.now();
  const market = await service.createMarket({
    distanceId: "50m",
    startMs: now - 60_000,
    endMs: now + 60_000,
    graceSec: 900,
    hidden: true,
    houseBps: 1000,
    entryTinybars: 10_000,
  });
  service.enter(market.id, user.id, "0.0.1234", "skipped");
  await service.syncExercises(user.id);
  const view = service.publicView(market, "other-user");
  assert.equal(view.results[0]?.hidden, true);
  const mine = service.publicView(market, user.id);
  assert.equal(mine.results[0]?.hidden, false);
  assert.ok((mine.results[0]?.timeMs ?? 0) > 0);
  const resolved = await service.resolveMarket(market.id, { admin: true });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.winners?.[0]?.userId, user.id);
});

test("enter scores an already-synced session without another sync click", async () => {
  const service = testService();
  const user = service.upsertDevUser();
  const now = Date.now();
  const market = await service.createMarket({
    distanceId: "50m",
    startMs: now,
    endMs: now + 60_000,
    graceSec: 900,
    hidden: true,
    houseBps: 1000,
    entryTinybars: 10_000,
  });
  user.exercises = [
    {
      id: "already-there",
      displayName: "Walk",
      exerciseType: "WALKING",
      startMs: now - 20_000,
      endMs: now - 5_000,
      activeDurationMs: 18_000,
      distanceMillimeters: 80_000,
    },
  ];
  service.enter(market.id, user.id, "0.0.1234", "skipped");
  const mine = service.publicView(market, user.id);
  assert.equal(mine.yours?.timeMs, 18_000);
  assert.equal(mine.results[0]?.timeMs, 18_000);
});

test("opening a race refreshes a stale Fitbit pull", async () => {
  const service = testService();
  const user = service.upsertDevUser();
  const now = Date.now();
  const market = await service.createMarket({
    distanceId: "50m",
    startMs: now,
    endMs: now + 60_000,
    graceSec: 900,
    hidden: true,
    houseBps: 1000,
    entryTinybars: 10_000,
  });
  service.enter(market.id, user.id, "0.0.1234", "skipped");
  user.fetchedAt = Date.now() - 120_000;
  await service.refreshViewerIfStale(user.id);
  const mine = service.publicView(market, user.id);
  assert.ok((mine.yours?.timeMs ?? 0) > 0);
});

test("Kolkata morning does not include the previous IST calendar day", () => {
  const now = Date.parse("2026-09-12T19:00:00.000Z");
  const day = localDayBounds(now, "Asia/Kolkata");
  const yesterday = Date.parse("2026-09-12T12:00:00+05:30");
  const today = Date.parse("2026-09-13T00:10:00+05:30");
  assert.ok(today >= day.startMs && today <= day.endMs);
  assert.ok(yesterday < day.startMs);
});

test("open UTC-stored race scores only today in Kolkata", async () => {
  const service = testService();
  const user = service.upsertDevUser();
  const now = Date.parse("2026-09-12T19:00:00.000Z");
  const market = await service.createMarket({
    distanceId: "50m",
    startMs: Date.parse("2026-09-12T00:00:00.000Z"),
    endMs: Date.parse("2026-09-12T23:59:59.999Z"),
    graceSec: 900,
    hidden: true,
    houseBps: 1000,
    entryTinybars: 10_000,
  });
  user.exercises = [
    {
      id: "yesterday-ist",
      displayName: "Yesterday",
      exerciseType: "WALKING",
      startMs: Date.parse("2026-09-12T12:00:00+05:30"),
      endMs: Date.parse("2026-09-12T12:20:00+05:30"),
      activeDurationMs: 20_000,
      distanceMillimeters: 80_000,
    },
    {
      id: "today-ist",
      displayName: "Today",
      exerciseType: "WALKING",
      startMs: Date.parse("2026-09-13T00:10:00+05:30"),
      endMs: Date.parse("2026-09-13T00:20:00+05:30"),
      activeDurationMs: 15_000,
      distanceMillimeters: 80_000,
    },
  ];
  service.enter(market.id, user.id, "0.0.1234", "skipped");
  const mine = service.publicView(market, user.id, "Asia/Kolkata", now);
  assert.equal(mine.yours?.exerciseId, "today-ist");
  assert.equal(mine.yours?.timeMs, 15_000);
});

test("createMarket with Kolkata after UTC midnight is today in IST", async () => {
  const service = testService();
  const now = Date.parse("2026-09-12T19:00:00.000Z");
  const market = await service.createMarket({
    distanceId: "50m",
    startMs: now,
    endMs: now + 60_000,
    graceSec: 900,
    hidden: true,
    houseBps: 1000,
    entryTinybars: 10_000,
    timeZone: "Asia/Kolkata",
  });
  const day = localDayBounds(now, "Asia/Kolkata");
  assert.equal(market.startMs, day.startMs);
  assert.equal(market.endMs, day.endMs);
  assert.equal(market.timeZone, "Asia/Kolkata");
});

test("wide race windows score only the local calendar day", () => {
  const now = Date.parse("2026-09-12T08:00:00");
  const day = raceDayBounds(
    { startMs: now - 16 * 24 * 60 * 60_000, endMs: now + 2 * 60 * 60_000 },
    now,
  );
  const expected = localDayBounds(now);
  assert.equal(day.startMs, expected.startMs);
  assert.equal(day.endMs, expected.endMs);
});

function testService() {
  return new StakeFitService(loadConfig(isolatedEnv()));
}

test("admin create snaps the race to that calendar day", async () => {
  const service = testService();
  const past = Date.now() - 16 * 24 * 60 * 60_000;
  const market = await service.createMarket({
    distanceId: "50m",
    startMs: past,
    endMs: Date.now() + 2 * 60 * 60_000,
    graceSec: 900,
    hidden: true,
    houseBps: 1000,
    entryTinybars: 10_000,
  });
  const day = localDayBounds(past);
  assert.equal(market.startMs, day.startMs);
  assert.equal(market.endMs, day.endMs);
});

test("race explains when there is no session that day and points at the nearest one", async () => {
  const service = testService();
  const user = service.upsertDevUser();
  const market = await service.createMarket({
    distanceId: "50m",
    startMs: Date.now(),
    endMs: Date.now() + 60_000,
    graceSec: 900,
    hidden: true,
    houseBps: 1000,
    entryTinybars: 10_000,
  });
  const nearbyStart = Date.now() - 2 * 24 * 60 * 60_000;
  user.exercises = [
    {
      id: "near-walk",
      displayName: "Walk",
      exerciseType: "WALKING",
      startMs: nearbyStart,
      endMs: nearbyStart + 20 * 60_000,
      activeDurationMs: 20 * 60_000,
      distanceMillimeters: 1_540_000,
    },
  ];
  const view = service.publicView(market, user.id);
  assert.equal(view.yours?.status, "none");
  assert.match(view.yours?.note ?? "", /No Fitbit session started on this day/);
  assert.equal(view.yours?.nearest?.name, "Walk");
  assert.equal(view.yours?.nearest?.distanceMillimeters, 1_540_000);
});

test("admin can resolve a market with no entries", async () => {
  const service = testService();
  const market = await service.createMarket({
    distanceId: "5k",
    startMs: Date.now(),
    endMs: Date.now() + 60_000,
    graceSec: 900,
    hidden: true,
    houseBps: 1000,
    entryTinybars: 10_000,
  });
  const resolved = await service.resolveMarket(market.id, { admin: true });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.entryCount, 0);
  assert.equal(resolved.winners?.length ?? 0, 0);
});

test("resolve with no times reports no winner", async () => {
  const service = testService();
  const market = await service.createMarket({
    distanceId: "50m",
    startMs: Date.now(),
    endMs: Date.now() + 60_000,
    graceSec: 900,
    hidden: true,
    houseBps: 1000,
    entryTinybars: 10_000,
  });
  const resolved = await service.resolveMarket(market.id, { admin: true });
  const view = service.publicView(resolved);
  assert.equal(view.noWinner, true);
  assert.equal(view.winners?.length ?? 0, 0);
});

test("mock demo user is a signed-in Health user", () => {
  const service = testService();
  const user = service.upsertDevUser();
  assert.equal(service.sessionUser(user.id)?.id, user.id);
});

test("HCS stub without Google tokens is not a signed-in Health user", () => {
  const service = new StakeFitService(
    loadConfig({
      ...isolatedEnv(),
      HEALTH_MOCK: "false",
    }),
  );
  service.users.set("google-123", { id: "google-123", email: "", exercises: [] });
  assert.equal(service.sessionUser("google-123"), undefined);
  service.users.set("google-123", {
    id: "google-123",
    email: "runner@example.com",
    name: "Runner",
    exercises: [],
    tokens: { accessToken: "ya29.live", expiresAt: Date.now() + 60_000 },
  });
  const live = service.sessionUser("google-123");
  assert.equal(live?.email, "runner@example.com");
});

test("createMarket refuses a local id when Sepolia is not configured", async () => {
  const service = new StakeFitService(
    loadConfig({
      ...isolatedEnv(),
      HEALTH_MOCK: "false",
      MARKET_REGISTRY_ADDRESS: "",
      SEPOLIA_RPC_URL: "",
      DEPLOYER_PRIVATE_KEY: "",
    }),
  );
  await assert.rejects(
    () =>
      service.createMarket({
        distanceId: "50m",
        startMs: Date.now(),
        endMs: Date.now() + 60_000,
        graceSec: 900,
        hidden: true,
        houseBps: 1000,
        entryTinybars: 10_000,
      }),
    /Races live on Sepolia/,
  );
});
