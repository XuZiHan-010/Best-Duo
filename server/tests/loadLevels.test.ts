import { describe, expect, it } from "vitest";
import { loadLevels } from "../src/levels/loadLevels.js";

describe("loadLevels", () => {
  it("normalizes human segment numbers to zero-based runtime indexes", () => {
    const levels = loadLevels();
    const levelWithOrder = levels.find((level) => level.id === "level-03");

    expect(levelWithOrder?.centerCap).toBe("inf");
    expect(levelWithOrder?.conditions).toContainEqual({ type: "placement-order", order: 1, segment: 2 });
    expect(levelWithOrder?.conditions).toContainEqual({ type: "segment-colors", segment: 3, black: 1, white: 1 });
  });

  it("keeps level 2 range condition on S3 at runtime", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-02");

    expect(level?.conditions).toContainEqual({ type: "sum-range", segment: 2, min: 12, max: 16 });
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
