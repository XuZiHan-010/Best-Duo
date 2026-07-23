import { describe, expect, it } from "vitest";
import type { Condition, HandCard, PublicHandCard, PublicPlacedCard, SeatId, TurnView } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { MockModelClient } from "../src/agent/modelClient.js";
import { AgentOrchestrator } from "../src/agent/orchestrator.js";
import { isPlacementProvablyLosing } from "../src/agent/safePolicy.js";
import { AgentTelemetry } from "../src/agent/telemetry.js";
import { TurnCoordinator } from "../src/agent/turnCoordinator.js";
import { beginPlacement, enterDiscussion } from "../src/game/phases.js";
import { createGameRoom } from "../src/game/room.js";
import { loadLevels } from "../src/levels/loadLevels.js";
import type { ProgressState } from "@take-time/shared";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const handCard = (id: string, value?: number, color?: "black" | "white"): PublicHandCard => ({
  id,
  owner: "B",
  visibleToOwner: value !== undefined,
  ...(value !== undefined ? { value } : {}),
  ...(color !== undefined ? { color } : {})
});

const emptyBoard = (): PublicPlacedCard[][] => [[], [], [], [], [], []];

const viewOf = (
  hand: PublicHandCard[],
  placements: PublicPlacedCard[][],
  conditions: Condition[] = []
): TurnView => ({
  seatId: "B",
  attemptId: "attempt-1",
  phaseVersion: 1,
  turnVersion: 1,
  phase: "placing",
  level: {
    id: "level-test",
    name: "测试关",
    levelIndex: 1,
    difficulty: "★",
    centerCap: "inf",
    playable: true,
    conditions
  },
  settings: { thinkSeconds: 10, hintMarkerCount: 2 },
  seats: [
    { id: "A", kind: "human", nick: "A" },
    { id: "B", kind: "agent", nick: "AI-1" }
  ],
  hand,
  placements,
  hintMarkers: { total: 2, used: 0 },
  turn: "B",
  pendingHint: null,
  playedCount: {}
});

// 护栏用的严格判定：只剪严格可证必输的动作，绝不误杀正常好棋
// （2026-07-21 findings P0-2：最小安全护栏）。
describe("isPlacementProvablyLosing 严格性", () => {
  it("非递减不误杀早期落子：空的后段未来仍可收牌", () => {
    // 首手把 5 放区 0：区 1-5 皆空，但后续还有 11 张牌可放进后段，
    // 无法严格证明非递减必然失败。
    const view = viewOf([handCard("c1", 5, "white")], emptyBoard(), [
      { type: "non-decreasing", segments: [0, 1, 2, 3, 4, 5] }
    ]);
    expect(isPlacementProvablyLosing(view, "c1", 0)).toBe(false);
  });

  it("颜色上限违规可严格证明：黑牌放进只收白牌的区段", () => {
    const view = viewOf([handCard("c1", 5, "black")], emptyBoard(), [
      { type: "segment-colors", segment: 0, black: 0, white: 1 }
    ]);
    expect(isPlacementProvablyLosing(view, "c1", 0)).toBe(true);
  });

  it("残局非递减仍可严格证明：剩余牌数不足以翻案", () => {
    // 已放 11 张，本手是第 12 张（remainingAfterMove=0）：
    // 把 9 放区 4 而区 5 只有已知的 3，后续无牌可补，必输可证。
    const board = emptyBoard();
    board[0] = [placedCard("p1", 1)];
    board[1] = [placedCard("p2", 1)];
    board[2] = [placedCard("p3", 2)];
    board[3] = [placedCard("p4", 2), placedCard("p5", 1), placedCard("p6", 1)];
    board[4] = [placedCard("p7", 3), placedCard("p8", 1)];
    board[5] = [placedCard("p9", 3), placedCard("p10", 1), placedCard("p11", 1)];
    const view = viewOf([handCard("c1", 9, "black")], board, [
      { type: "non-decreasing", segments: [0, 1, 2, 3, 4, 5] }
    ]);
    expect(isPlacementProvablyLosing(view, "c1", 4)).toBe(true);
  });
});

const placedCard = (id: string, value: number): PublicPlacedCard => ({
  id,
  owner: "A",
  revealed: true,
  color: "white",
  placedAt: 0,
  playOrder: 0,
  value
});

const quietTelemetry = () => new AgentTelemetry(() => {});

const serverCard = (id: string, value: number, color: "black" | "white", owner: SeatId): HandCard => ({
  id,
  owner,
  value,
  color,
  initiallyVisibleToOwner: true,
  visibleToOwner: true
});

describe("TurnCoordinator 模型输出安全护栏", () => {
  it("正常模型返回可证必输动作时被安全候选替换", async () => {
    const levels = loadLevels();
    const room = createGameRoom(progress, 4);
    for (const seatId of ["A", "B"] as const) {
      const seat = room.seats.find((candidate) => candidate.id === seatId)!;
      seat.nick = seatId;
      seat.connected = true;
    }
    room.phase = "levelSelect";
    enterDiscussion(room, levels[0]);
    beginPlacement(room);
    room.turn = "A";
    // 确定性手牌：level-01 的区 1（索引 0）只收 1 张白牌，黑牌放区 0 严格必输。
    room.hands.A = [serverCard("black-5", 5, "black", "A"), serverCard("white-2", 2, "white", "A")];

    const telemetry = quietTelemetry();
    const orchestrator = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({ cardId: "black-5", segment: 0, revealIntent: "yes" })
      })),
      telemetry
    });
    const coordinator = new TurnCoordinator(orchestrator, { telemetry, pacing: { enabled: false } });

    const placement = await coordinator.decidePlacement(room, "A");
    expect(placement).not.toBeNull();
    // 模型的必输动作必须被替换成安全候选。
    expect(placement).not.toEqual({ cardId: "black-5", segment: 0 });
  });
});
