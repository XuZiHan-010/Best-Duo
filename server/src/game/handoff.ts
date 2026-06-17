import type { GameRoom } from "@take-time/shared";

interface HandoffOptions {
  afterRevealIfNeeded: () => Promise<void>;
  startTurnTimer: () => void;
}

export const continueTurnOrHandoff = async (room: GameRoom, options: HandoffOptions) => {
  await options.afterRevealIfNeeded();
  if (room.phase === "placing" && !room.pendingHint) {
    options.startTurnTimer();
  }
};
