import { describe, expect, it } from "vitest";
import type { CardColor, Condition, PlacedCard } from "@take-time/shared";
import { evaluateConditions } from "../src/levels/conditionEngine.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const card = (id: string, value: number, color: CardColor, placedAt: number, playOrder = placedAt): PlacedCard => ({
  id,
  owner: placedAt % 2 === 0 ? "A" : "B",
  value,
  color,
  revealed: false,
  placedAt,
  playOrder
});

describe("conditionEngine", () => {
  it("adds permanent global rules to every loaded level", () => {
    for (const level of loadLevels()) {
      expect(level.conditions).toContainEqual({ type: "non-decreasing", segments: [0, 1, 2, 3, 4, 5] });
      expect(level.conditions).toContainEqual({ type: "all-nonempty" });
      if (level.centerCap !== "inf") {
        expect(level.conditions).toContainEqual({ type: "max-sum-each", value: level.centerCap ?? 24 });
      } else {
        expect(level.conditions.some((condition) => condition.type === "max-sum-each")).toBe(false);
      }
    }
  });

  it("fails the permanent global rules for decreasing sums, empty segments, and sums above 24", () => {
    const globalRules: Condition[] = [
      { type: "non-decreasing", segments: [0, 1, 2, 3, 4, 5] },
      { type: "all-nonempty" },
      { type: "max-sum-each", value: 24 }
    ];

    const decreasing = evaluateConditions(
      [
        [card("a", 2, "white", 1)],
        [card("b", 1, "black", 2)],
        [card("c", 3, "white", 3)],
        [card("d", 4, "black", 4)],
        [card("e", 5, "white", 5)],
        [card("f", 6, "black", 6)]
      ],
      globalRules
    );
    expect(decreasing.conditions.find((entry) => entry.condition.type === "non-decreasing")?.pass).toBe(false);
    expect(decreasing.pass).toBe(false);

    const emptySegment = evaluateConditions(
      [
        [card("a", 1, "white", 1)],
        [],
        [card("c", 3, "white", 3)],
        [card("d", 4, "black", 4)],
        [card("e", 5, "white", 5)],
        [card("f", 6, "black", 6)]
      ],
      globalRules
    );
    expect(emptySegment.conditions.find((entry) => entry.condition.type === "all-nonempty")?.pass).toBe(false);
    expect(emptySegment.pass).toBe(false);

    const aboveCap = evaluateConditions(
      [
        [card("a", 1, "white", 1)],
        [card("b", 2, "black", 2)],
        [card("c", 3, "white", 3)],
        [card("d", 4, "black", 4)],
        [card("e", 5, "white", 5)],
        [card("f", 25, "black", 6)]
      ],
      globalRules
    );
    expect(aboveCap.conditions.find((entry) => entry.condition.type === "max-sum-each")?.pass).toBe(false);
    expect(aboveCap.pass).toBe(false);
  });

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

  it("uses stable play order instead of same-millisecond timestamps", () => {
    const placements = [
      [card("third", 7, "white", 1000, 3)],
      [card("second", 4, "black", 1000, 2)],
      [card("first", 4, "black", 1000, 1)],
      [],
      [],
      []
    ];

    const result = evaluateConditions(placements, [
      { type: "placement-order", order: 1, segment: 2 },
      { type: "placement-order", order: 2, segment: 1 },
      { type: "placement-order", order: 3, segment: 0 }
    ]);

    expect(result.pass).toBe(true);
  });
});
