import { randomUUID } from "node:crypto";
import type { RoomIdentity } from "@take-time/shared";

export const createRoomIdentity = (): RoomIdentity => ({
  campaignId: randomUUID(),
  playSessionId: randomUUID(),
  levelRunId: null,
  levelRunLevelId: null,
  attemptId: null
});

// 每次进入讨论都生成新 attemptId；仅同关连续重试沿用 levelRunId。
export const beginAttemptIdentity = (identity: RoomIdentity, levelId: string) => {
  if (!identity.levelRunId || identity.levelRunLevelId !== levelId) {
    identity.levelRunId = randomUUID();
    identity.levelRunLevelId = levelId;
  }
  identity.attemptId = randomUUID();
};

// 通关、改选其他关卡或明确重新开始时关闭当前 levelRun。
export const closeLevelRun = (identity: RoomIdentity) => {
  identity.levelRunId = null;
  identity.levelRunLevelId = null;
};

export const resetSessionIdentity = (identity: RoomIdentity) => {
  closeLevelRun(identity);
  identity.attemptId = null;
  identity.playSessionId = randomUUID();
};
