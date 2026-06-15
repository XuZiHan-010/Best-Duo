import type { Challenge, GameRoom } from "@take-time/shared";
import { dealHands } from "./deal.js";
import { resetRoundState } from "./room.js";

export const enterLevelSelect = (room: GameRoom) => {
  if (room.phase !== "waiting") throw new Error("Game can only start from waiting");
  room.phase = "levelSelect";
  room.phaseVersion += 1;
};

export const enterDiscussion = (room: GameRoom, challenge: Challenge) => {
  if (!["levelSelect", "result"].includes(room.phase)) throw new Error("Cannot select a level now");
  resetRoundState(room);
  room.currentLevelIndex = challenge.levelIndex;
  room.currentChallenge = challenge;
  room.chat = [];
  room.phase = "discussion";
};

export const beginPlacement = (room: GameRoom) => {
  if (room.phase !== "discussion") throw new Error("Cannot begin placement now");
  resetRoundState(room);
  room.phase = "placing";
  room.turn = "race";
  room.hintMarkers = {
    total: room.settings.hintMarkerCount,
    used: 0
  };
  dealHands(room);
};
