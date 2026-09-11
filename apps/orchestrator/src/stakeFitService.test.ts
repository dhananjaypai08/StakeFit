import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config";
import { StakeFitService } from "./stakeFitService";

test("demo heat: enter, mock sync, admin resolve top 1", async () => {
  const config = loadConfig({
    ...process.env,
    HEALTH_MOCK: "true",
    SCAN_SKIP_PAYMENT: "true",
    SESSION_SECRET: "test",
    ADMIN_EMAILS: "demo@stakefit.local",
  });
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
