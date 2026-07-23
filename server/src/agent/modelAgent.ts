import type { GameRoom, SeatId } from "@take-time/shared";
import type { PlayerAgent } from "./PlayerAgent.js";
import type { TurnCoordinator } from "./turnCoordinator.js";

// 由 TurnCoordinator 驱动的座位 Agent：出牌 + hint 消费同一次 TurnDecision。
// 讨论发言由 AgentRuntime 的 DiscussionCoordinator 调度，不走 registry 路径。
// stale/被取消的决策抛错交给 handoff——其版本校验会静默放弃，不产生 fallback 落子。
export const createModelSeatAgent = (
  room: GameRoom,
  seatId: SeatId,
  coordinator: TurnCoordinator
): PlayerAgent => ({
  async decidePlacement() {
    const decision = await coordinator.decidePlacement(room, seatId);
    if (!decision) throw new Error("stale turn decision discarded");
    return decision;
  },

  async decideHint() {
    return coordinator.decideHint(room, seatId);
  },

  async decideDiscussion() {
    return null;
  }
});
