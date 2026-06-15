import { describe, expect, it } from "vitest";
import type { CardColor } from "@take-time/shared";
import type { SolverCard } from "../src/game/solver.js";
import { canSolveDeal } from "../src/game/solver.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const makeCards = (values: number[], colors?: CardColor[]): SolverCard[] =>
  values.map((value, index) => ({
    id: `c${index}`,
    owner: index < 6 ? "A" : "B",
    value,
    color: colors?.[index] ?? (index % 2 === 0 ? "black" : "white")
  }));

describe("solver", () => {
  it("finds a solution for simple monotonic levels", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-01")!;
    expect(canSolveDeal(level, makeCards([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), ["A", "B"]).solvable).toBe(true);
  });

  it("rejects deals that cannot make the exact sum required by level 04", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-04")!;
    expect(canSolveDeal(level, makeCards([9, 9, 10, 10, 11, 11, 12, 12, 9, 10, 11, 12]), ["A", "B"]).solvable).toBe(false);
  });

  it("accepts deals that can satisfy order and color constraints", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-03")!;
    const cards = makeCards([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [
      "black",
      "white",
      "black",
      "white",
      "black",
      "white",
      "black",
      "white",
      "black",
      "white",
      "black",
      "white"
    ]);
    expect(canSolveDeal(level, cards, ["A", "B"]).solvable).toBe(true);
  });
});
