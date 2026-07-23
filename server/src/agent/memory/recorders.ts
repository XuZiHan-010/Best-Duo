import type { GameRoom } from "@take-time/shared";
import type { AttemptMemoryStore } from "./attemptMemoryStore.js";
import type { AgentObservation } from "./types.js";

type RoomObservationInput = Omit<AgentObservation, "id" | "createdAt" | "attemptId">;

// 所有写入携带 attemptId + phaseVersion + turnVersion；旧版本响应静默丢弃并记录结构化日志。
export const recordRoomObservation = (
  store: AttemptMemoryStore,
  room: GameRoom,
  input: RoomObservationInput
): AgentObservation | null => {
  const attemptId = room.identity.attemptId;
  if (!attemptId) return null;

  if (input.phaseVersion !== room.phaseVersion || input.turnVersion !== room.turnVersion) {
    console.warn(
      JSON.stringify({
        event: "memory:stale_observation_dropped",
        type: input.type,
        phaseVersion: input.phaseVersion,
        turnVersion: input.turnVersion,
        currentPhaseVersion: room.phaseVersion,
        currentTurnVersion: room.turnVersion
      })
    );
    return null;
  }

  if (store.currentAttempt()?.identity.attemptId !== attemptId) {
    console.warn(JSON.stringify({ event: "memory:attempt_mismatch_dropped", attemptId }));
    return null;
  }

  return store.recordObservation({ ...input, attemptId });
};
