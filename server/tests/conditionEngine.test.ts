import { describe, expect, it } from "vitest";
import type { CardColor, PlacedCard } from "@take-time/shared";
import { evaluateConditions } from "../src/levels/conditionEngine.js";

const card = (id: string, value: number, color: CardColor, placedAt: number): PlacedCard => ({
  id,
  owner: placedAt % 2 === 0 ? "A" : "B",
  value,
  color,
  revealed: false,
  placedAt
});

describe("conditionEngine", () => {
  it("evaluates count, sum, parity, monotonic, and diff conditions", () => {
    const placements = [
      [card("a", 1, "white", 1)],
      [card("b", 2, "black", 2), card("c", 3, "white", 3)],
      [card("d", 5, "black", 4)],
      [card("e", 5, "white", 5)],
      [card("f", 8, "black", 6)],
      [card("g", 8, "white", 7)]
    ];

    const result = evaluateConditions(placements, [
      { type: "all-nonempty" },
      { type: "min-cards", segment: 1, count: 2 },
      { type: "max-cards", segment: 5, count: 1 },
      { type: "exact-cards", segment: 0, count: 1 },
      { type: "sum-equals", segment: 2, value: 5 },
      { type: "sum-range", segment: 4, min: 7, max: 9 },
      { type: "parity", segment: 1, parity: "odd" },
      { type: "non-decreasing", segments: [0, 1, 2, 3, 4, 5] },
      { type: "adjacent-diff", a: 4, b: 5, maxDiff: 0 }
    ]);

    expect(result.pass).toBe(true);
    expect(result.segmentSums).toEqual([1, 5, 5, 5, 8, 8]);
    expect(result.conditions).toHaveLength(9);
  });

  it("evaluates placement order, segment colors, and distinct values", () => {
    const placements = [
      [card("third", 7, "white", 30)],
      [card("second", 4, "black", 20)],
      [card("first", 4, "black", 10), card("fourth", 9, "white", 40)],
      [],
      [],
      [card("sixth", 3, "black", 60), card("fifth", 3, "white", 50)]
    ];

    const result = evaluateConditions(placements, [
      { type: "placement-order", order: 1, segment: 2 },
      { type: "placement-order", order: 2, segment: 1 },
      { type: "segment-colors", segment: 2, black: 1, white: 1 },
      { type: "all-distinct", segment: 2 },
      { type: "all-distinct", segment: 5 }
    ]);

    expect(result.conditions.map((entry) => entry.pass)).toEqual([true, true, true, true, false]);
    expect(result.pass).toBe(false);
  });
});
