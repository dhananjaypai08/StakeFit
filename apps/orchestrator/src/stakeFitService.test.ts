import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { localDayBounds, raceDayBounds } from "@stakefit/shared";
import { loadConfig } from "./config";
import { StakeFitService } from "./stakeFitService";

function isolatedEnv() {
  process.env.STAKEFIT_STATE_PATH = join(mkdtempSync(join(tmpdir(), "stakefit-")), "state.json");
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
