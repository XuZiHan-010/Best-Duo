import { describe, expect, it } from "vitest";
import {
  evaluateAgreementFulfillment,
  type Condition,
  type PublicPlacedCard,
  type RevealResult
} from "@take-time/shared";

const card = (id: string, color: "black" | "white", value: number): PublicPlacedCard => ({
  id,
  owner: "A",
  revealed: true,
  value,
  color,
  placedAt: 0,
  playOrder: 0
});

const emptyBoard = (): PublicPlacedCard[][] => [[], [], [], [], [], []];

const reveal = (conditions: { condition: Condition; pass: boolean }[]): RevealResult => ({
  pass: conditions.every((entry) => entry.pass),
  segmentSums: [0, 0, 0, 0, 0, 0],
  segmentCounts: [0, 0, 0, 0, 0, 0],
  conditions: conditions.map((entry) => ({ ...entry, message: "" }))
});

describe("evaluateAgreementFulfillment", () => {
  it("目标区段专属条件全过 → met，带真实终局构成", () => {
    const board = emptyBoard();
    board[0] = [card("c1", "white", 4)];
    const result = evaluateAgreementFulfillment(
      { targetSegments: [0] },
      board,
      reveal([{ condition: { type: "segment-colors", segment: 0, black: 0, white: 1 }, pass: true }])
    );
    expect(result.verdict).toBe("met");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      segment: 0,
      met: true,
      composition: { count: 1, black: 0, white: 1, sum: 4 }
    });
    expect(result.segments[0]!.requirements).toHaveLength(1);
    expect(result.segments[0]!.requirements[0]!.pass).toBe(true);
  });

  it("颜色不达标 → unmet", () => {
    const board = emptyBoard();
    board[0] = [card("c1", "black", 4)];
    const result = evaluateAgreementFulfillment(
      { targetSegments: [0] },
      board,
      reveal([{ condition: { type: "segment-colors", segment: 0, black: 0, white: 1 }, pass: false }])
    );
    expect(result.verdict).toBe("unmet");
    expect(result.segments[0]!.met).toBe(false);
    expect(result.segments[0]!.composition).toMatchObject({ black: 1, white: 0 });
    expect(result.segments[0]!.requirements[0]!.pass).toBe(false);
  });

  it("张数不达标 → unmet", () => {
    const board = emptyBoard();
    board[5] = [card("c1", "white", 2), card("c2", "black", 3)];
    const result = evaluateAgreementFulfillment(
      { targetSegments: [5] },
      board,
      reveal([{ condition: { type: "exact-cards", segment: 5, count: 3 }, pass: false }])
    );
    expect(result.verdict).toBe("unmet");
    expect(result.segments[0]!.met).toBe(false);
    expect(result.segments[0]!.composition).toMatchObject({ count: 2, sum: 5 });
  });

  it("无目标区段 → no-target（缺省与空数组都算）", () => {
    const missing = evaluateAgreementFulfillment({}, emptyBoard(), reveal([]));
    expect(missing.verdict).toBe("no-target");
    expect(missing.segments).toHaveLength(0);

    const empty = evaluateAgreementFulfillment({ targetSegments: [] }, emptyBoard(), reveal([]));
    expect(empty.verdict).toBe("no-target");
  });

  it("目标区段无专属条件 → met（仅受全局规则约束）", () => {
    const board = emptyBoard();
    board[2] = [card("c1", "white", 5)];
    const result = evaluateAgreementFulfillment(
      { targetSegments: [2] },
      board,
      reveal([
        { condition: { type: "all-nonempty" }, pass: true },
        { condition: { type: "exact-cards", segment: 5, count: 3 }, pass: false }
      ])
    );
    expect(result.verdict).toBe("met");
    expect(result.segments[0]!.requirements).toHaveLength(0);
    expect(result.segments[0]!.met).toBe(true);
  });

  it("跨区段规则失败 → 记入 spanningIssues 但不翻转 met", () => {
    const board = emptyBoard();
    board[1] = [card("c1", "white", 3)];
    const result = evaluateAgreementFulfillment(
      { targetSegments: [1] },
      board,
      reveal([
        { condition: { type: "min-cards", segment: 1, count: 1 }, pass: true },
        { condition: { type: "non-decreasing", segments: [0, 1, 2, 3, 4, 5] }, pass: false }
      ])
    );
    expect(result.verdict).toBe("met");
    expect(result.segments[0]!.met).toBe(true);
    expect(result.segments[0]!.spanningIssues).toHaveLength(1);
    expect(result.segments[0]!.spanningIssues[0]!.type).toBe("non-decreasing");
  });

  it("多目标区段，一段过一段不过 → unmet", () => {
    const board = emptyBoard();
    board[0] = [card("c1", "white", 4)];
    board[5] = [card("c2", "black", 6)];
    const result = evaluateAgreementFulfillment(
      { targetSegments: [0, 5] },
      board,
      reveal([
        { condition: { type: "segment-colors", segment: 0, black: 0, white: 1 }, pass: true },
        { condition: { type: "exact-cards", segment: 5, count: 3 }, pass: false }
      ])
    );
    expect(result.verdict).toBe("unmet");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]!.met).toBe(true);
    expect(result.segments[1]!.met).toBe(false);
  });
});
