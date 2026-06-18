import { describe, expect, it } from "vitest";
import { loadLevels } from "../src/levels/loadLevels.js";

describe("loadLevels", () => {
  it("keeps level 1 exact white card condition at runtime", () => {
    const levels = loadLevels();
    const level = levels.find((candidate) => candidate.id === "level-01");

    expect(level?.centerCap).toBe("inf");
    expect(level?.conditions).toContainEqual({ type: "segment-colors", segment: 0, black: 0, white: 1 });
    expect(level?.conditions).toContainEqual({ type: "exact-cards", segment: 5, count: 3 });
  });

  it("keeps level 2 sum range and card count conditions at runtime", () => {
    const levels = loadLevels();
    const level = levels.find((candidate) => candidate.id === "level-02");

    expect(level?.centerCap).toBe("inf");
    expect(level?.conditions).toContainEqual({ type: "sum-range", segment: 2, min: 8, max: 12 });
    expect(level?.conditions).toContainEqual({ type: "exact-cards", segment: 3, count: 3 });
  });

  it("keeps level 3 order and infinite cap conditions at runtime", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-03");

    expect(level?.centerCap).toBe("inf");
    expect(level?.conditions).toContainEqual({ type: "sum-range", segment: 5, min: 20, max: 30 });
    expect(level?.conditions).toContainEqual({ type: "placement-order", order: 1, segment: 2 });
    expect(level?.conditions).toContainEqual({ type: "placement-order", order: 2, segment: 1 });
    expect(level?.conditions.some((condition) => condition.type === "max-sum-each")).toBe(false);
  });

  it("keeps level 4 closest and color conditions at runtime", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-04");

    expect(level?.centerCap).toBeNull();
    expect(level?.conditions).toContainEqual({ type: "closest-to-value", segment: 0, value: 6 });
    expect(level?.conditions).toContainEqual({ type: "segment-colors", segment: 3, black: 1, white: 1 });
    expect(level?.conditions).toContainEqual({ type: "max-sum-each", value: 24 });
  });

  it("normalizes color minimum conditions for later levels", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-08");

    expect(level?.conditions).toContainEqual({ type: "min-color-cards", segment: 5, color: "white", count: 2 });
  });

  it("normalizes duplicate value conditions for level 5", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-05");

    expect(level?.conditions).toContainEqual({ type: "has-duplicate-value", segment: 5 });
  });

  it("normalizes level 11 color and card-count constraints", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-11");

    expect(level?.difficulty).toBe("★★★");
    expect(level?.conditions).toContainEqual({ type: "closest-to-value", segment: 0, value: 6 });
    expect(level?.conditions).toContainEqual({ type: "min-color-cards", segment: 1, color: "white", count: 2 });
    expect(level?.conditions).toContainEqual({ type: "max-color-cards", segment: 1, color: "black", count: 0 });
    expect(level?.conditions).toContainEqual({ type: "min-color-cards", segment: 3, color: "black", count: 1 });
    expect(level?.conditions).toContainEqual({ type: "min-color-cards", segment: 3, color: "white", count: 1 });
    expect(level?.conditions).toContainEqual({ type: "exact-cards", segment: 5, count: 2 });
    expect(level?.conditions).toContainEqual({ type: "max-sum-each", value: 24 });
  });

  it("normalizes level 12 forbidden value constraints", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-12");

    expect(level?.difficulty).toBe("★★★");
    expect(level?.conditions).toContainEqual({ type: "forbidden-values", segment: 0, values: [1, 2, 3] });
    expect(level?.conditions).toContainEqual({ type: "forbidden-values", segment: 2, values: [1, 2, 3] });
    expect(level?.conditions).toContainEqual({ type: "forbidden-values", segment: 4, values: [1, 2, 3] });
    expect(level?.conditions).toContainEqual({ type: "max-sum-each", value: 24 });
  });

  it("derives each permanent global rule exactly once", () => {
    for (const level of loadLevels()) {
      const globalRuleKeys = level.conditions
        .filter(
          (condition) =>
            condition.type === "all-nonempty" ||
            condition.type === "max-sum-each" ||
            (condition.type === "non-decreasing" &&
              condition.segments.length === 6 &&
              condition.segments.every((segment, index) => segment === index))
        )
        .map((condition) => JSON.stringify(condition));

      expect(new Set(globalRuleKeys).size).toBe(globalRuleKeys.length);
    }
  });

  it("keeps an explicit infinite center cap free of max-sum rules", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-01");

    expect(level?.centerCap).toBe("inf");
    expect(level?.conditions.some((condition) => condition.type === "max-sum-each")).toBe(false);
  });
});
