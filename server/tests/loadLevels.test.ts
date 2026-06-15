import { describe, expect, it } from "vitest";
import { loadLevels } from "../src/levels/loadLevels.js";

describe("loadLevels", () => {
  it("normalizes human segment numbers to zero-based runtime indexes", () => {
    const levels = loadLevels();
    const levelWithOrder = levels.find((level) => level.id === "level-03");

    expect(levelWithOrder?.centerCap).toBeNull();
    expect(levelWithOrder?.conditions).toContainEqual({ type: "placement-order", order: 1, segment: 2 });
    expect(levelWithOrder?.conditions).toContainEqual({ type: "segment-colors", segment: 3, black: 1, white: 1 });
  });
});
