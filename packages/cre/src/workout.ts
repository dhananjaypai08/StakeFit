import { bestQualifying } from "@stakefit/health";
import type { DistanceId, ExerciseSession, QualifyingResult } from "@stakefit/shared";

export interface WorkoutIngestInput {
  userId: string;
  distanceId: DistanceId;
  startMs: number;
  endMs: number;
  sessions: ExerciseSession[];
}

/**
 * Runtime mirror of the confidential CRE handler. Inside a real TEE this would
 * fetch the Google Health token via getSecret and only emit the scored time.
 */
export function ingestWorkout(input: WorkoutIngestInput): QualifyingResult & { userId: string } {
  const result = bestQualifying(input.sessions, input.distanceId, {
    startMs: input.startMs,
    endMs: input.endMs,
  });
  return { ...result, userId: input.userId };
}
