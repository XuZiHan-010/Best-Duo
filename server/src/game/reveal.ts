import type { GameRoom } from "@take-time/shared";
import { evaluateConditions } from "../levels/conditionEngine.js";
import { closeLevelRun } from "./identity.js";

export const revealAndScore = (room: GameRoom) => {
  if (!room.currentChallenge) throw new Error("No challenge selected");
  room.phase = "reveal";
  room.phaseVersion += 1;
  for (const segment of room.placements) {
    for (const card of segment) {
      card.revealed = true;
    }
  }

  room.revealResult = evaluateConditions(room.placements, room.currentChallenge.conditions);
  room.failureReason = room.revealResult.pass ? null : "rule-unmet";
  if (room.revealResult.pass) closeLevelRun(room.identity);
};

export const enterResultAfterReveal = (room: GameRoom) => {
  if (room.phase !== "reveal") return;
  room.phase = "result";
  room.phaseVersion += 1;
  room.timer = null;
};

export const failByTimeout = (room: GameRoom) => {
  room.phase = "result";
  room.failureReason = "timeout";
  room.revealResult = null;
  room.phaseVersion += 1;
  room.timer = null;
};

export const failByPlayerLeft = (room: GameRoom) => {
  room.phase = "result";
  room.failureReason = "player-left";
  room.revealResult = null;
  room.phaseVersion += 1;
  room.timer = null;
};
