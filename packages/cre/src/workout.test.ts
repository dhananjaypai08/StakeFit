import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestWorkout } from "./workout";

test("CRE ingest emits only the best qualifying time", () => {
  const result = ingestWorkout({
    userId: "u1",
    distanceId: "50m",
    startMs: 1000,
    endMs: 5000,
    sessions: [
      {
        id: "short",
        displayName: "too short",
        exerciseType: "WALKING",
        startMs: 2000,
        endMs: 2500,
        activeDurationMs: 400,
        distanceMillimeters: 10_000,
      },
      {
        id: "win",
        displayName: "ok",
        exerciseType: "WALKING",
        startMs: 2100,
        endMs: 4000,
        activeDurationMs: 1800,
        distanceMillimeters: 60_000,
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.exerciseId, "win");
  assert.equal(result.timeMs, 1500);
});
