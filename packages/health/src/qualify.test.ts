import assert from "node:assert/strict";
import { test } from "node:test";
import { splitPot } from "@stakefit/shared";
import { bestQualifying, parseDurationMs, qualifySession, rankWithTies } from "./qualify";
import { toSession } from "./client";

const window = { startMs: 1_000_000, endMs: 2_000_000 };

function session(partial: Partial<Parameters<typeof qualifySession>[0]>) {
  return {
    id: "ex-1",
    displayName: "Run",
    exerciseType: "RUNNING",
    startMs: 1_100_000,
    endMs: 1_200_000,
    activeDurationMs: 90_000,
    distanceMillimeters: 60_000,
    ...partial,
  };
}

test("50m qualifies when distance and window match", () => {
  const result = qualifySession(session({}), "50m", window);
  assert.equal(result.ok, true);
  assert.equal(result.timeMs, 90_000);
});

test("rejects a session that starts outside the heat", () => {
  const result = qualifySession(session({ startMs: 500_000 }), "50m", window);
  assert.equal(result.ok, false);
});

test("rejects a 5k attempt that is only 4.8km", () => {
  const result = qualifySession(session({ distanceMillimeters: 4_800_000 }), "5k", window);
  assert.equal(result.ok, false);
});

test("bestQualifying picks the fastest qualifying time", () => {
  const result = bestQualifying(
    [
      session({ id: "slow", activeDurationMs: 120_000, distanceMillimeters: 80_000 }),
      session({ id: "fast", activeDurationMs: 70_000, distanceMillimeters: 80_000 }),
      session({ id: "short", activeDurationMs: 10_000, distanceMillimeters: 10_000 }),
    ],
    "50m",
    window,
  );
  assert.equal(result.ok, true);
  assert.equal(result.exerciseId, "fast");
  assert.equal(result.timeMs, 70_000);
});

test("parseDurationMs reads Health API Duration strings", () => {
  assert.equal(parseDurationMs("1800s", 0), 1_800_000);
  assert.equal(parseDurationMs("90.5s", 0), 90_500);
});

test("toSession maps the documented exercise data point", () => {
  const mapped = toSession({
    name: "users/me/dataTypes/exercise/dataPoints/morning-trail-run-123456",
    exercise: {
      interval: { startTime: "2026-04-20T08:00:00Z", endTime: "2026-04-20T08:35:00Z" },
      exerciseType: "RUNNING",
      displayName: "Morning Trail Run",
      activeDuration: "1800s",
      metricsSummary: { distanceMillimeters: 5_000_000, steps: "6200" },
      exerciseMetadata: { hasGps: true },
    },
  });
  assert.equal(mapped.id, "morning-trail-run-123456");
  assert.equal(mapped.displayName, "Morning Trail Run");
  assert.equal(mapped.distanceMillimeters, 5_000_000);
  assert.equal(mapped.activeDurationMs, 1_800_000);
});

test("toSession turns TREADMILL_WALK into a readable name", () => {
  const mapped = toSession({
    name: "users/me/dataTypes/exercise/dataPoints/tm-1",
    exercise: {
      interval: { startTime: "2026-08-23T19:45:12Z", endTime: "2026-08-23T20:00:18Z" },
      exerciseType: "TREADMILL_WALK",
      activeDuration: "906s",
      metricsSummary: { distanceMillimeters: 530_000 },
    },
  });
  assert.equal(mapped.displayName, "Treadmill Walk");
});

test("toSession keeps distance empty when Fitbit sent no millimeters", () => {
  const mapped = toSession({
    name: "users/me/dataTypes/exercise/dataPoints/walk-no-mm",
    exercise: {
      interval: { startTime: "2026-09-07T20:00:00Z", endTime: "2026-09-07T20:20:00Z" },
      exerciseType: "WALKING",
      activeDuration: "1200s",
      metricsSummary: { steps: "2000", caloriesKcal: 140 },
    },
  });
  assert.equal(mapped.distanceMillimeters, 0);
  assert.equal(mapped.caloriesKcal, 140);
});

test("splitPot is 50/30/20 after the house cut; leftover ranks go to the house", () => {
  const three = splitPot(100_000, 1000, 3);
  assert.equal(three.houseTinybars, 10_000);
  assert.equal(three.firstTinybars, 45_000);
  assert.equal(three.secondTinybars, 27_000);
  assert.equal(three.thirdTinybars, 18_000);
  const one = splitPot(100_000, 1000, 1);
  assert.equal(one.firstTinybars, 45_000);
  assert.equal(one.secondTinybars, 0);
  assert.equal(one.houseTinybars, 55_000);
});

test("rankWithTies uses the VRF seed only when times match", () => {
  const ranked = rankWithTies(
    [
      { userId: "b", timeMs: 100 },
      { userId: "a", timeMs: 100 },
      { userId: "c", timeMs: 90 },
    ],
    7n,
  );
  assert.equal(ranked[0].userId, "c");
  assert.deepEqual(
    new Set(ranked.slice(1).map((row) => row.userId)),
    new Set(["a", "b"]),
  );
});
