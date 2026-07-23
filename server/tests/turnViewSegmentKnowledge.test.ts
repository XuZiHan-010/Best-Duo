import { describe, expect, it } from "vitest";
import type { PlacedCard, ProgressState } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { buildTurnView } from "../src/agent/views.js";
import { beginPlacement, enterDiscussion } from "../src/game/phases.js";
import { createGameRoom } from "../src/game/room.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const placedCard = (
  id: string,
  value: number,
  color: "black" | "white",
  revealed: boolean
): PlacedCard => ({
  id,
  owner: "A",
  value,
  color,
  revealed,
  placedAt: 0,
  playOrder: 1
});

// P1-3（2026-07-21 findings）：TurnView 提供只含公开信息的每段派生统计，
// 减轻模型自行累加的负担；绝不泄露暗牌真实数值或真实总和。
describe("TurnView segmentKnowledge", () => {
  const makeRoom = () => {
    const room = createGameRoom(structuredClone(progress), loadLevels());
    for (const seatId of ["A", "B"] as const) {
      const seat = room.seats.find((candidate) => candidate.id === seatId)!;
      seat.nick = seatId;
      seat.connected = true;
    }
    room.phase = "levelSelect";
    enterDiscussion(room, loadLevels()[0]);
    beginPlacement(room);
    return room;
  };

  it("derives per-segment public stats with bounds", () => {
    const room = makeRoom();
    room.placements = [[], [], [], [], [], []];
    // 区 2：一张已翻开的白 5 + 一张未翻开的黑 9（数值应被遮蔽）。
    room.placements[2] = [placedCard("w5", 5, "white", true), placedCard("b9", 9, "black", false)];

    const view = buildTurnView(room, "A");

    expect(view.segmentKnowledge).toHaveLength(6);
    expect(view.segmentKnowledge?.[2]).toEqual({
      count: 2,
      revealedSum: 5,
      hiddenCount: 1,
      blackCount: 1,
      whiteCount: 1,
      sumLowerBound: 6,
      sumUpperBound: 17
    });
    expect(view.segmentKnowledge?.[0]).toEqual({
      count: 0,
      revealedSum: 0,
      hiddenCount: 0,
      blackCount: 0,
      whiteCount: 0,
      sumLowerBound: 0,
      sumUpperBound: 0
    });
  });

  it("never exposes the true hidden sum", () => {
    const room = makeRoom();
    room.placements = [[], [], [], [], [], []];
    room.placements[3] = [placedCard("w5", 5, "white", true), placedCard("b9", 9, "black", false)];

    const view = buildTurnView(room, "A");
    const knowledge = view.segmentKnowledge?.[3];
    // 真实总和 14 不得出现在任何派生字段里。
    expect(knowledge?.revealedSum).toBe(5);
    expect(Object.values(knowledge ?? {})).not.toContain(14);
  });
});
