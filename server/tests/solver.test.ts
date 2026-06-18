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

  it("rejects deals that cannot reach the final segment range required by level 03", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-03")!;
    expect(canSolveDeal(level, makeCards([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), ["A", "B"]).solvable).toBe(false);
  });

  it("finds a solution for level 5 with a duplicate-value target", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-05")!;
    expect(canSolveDeal(level, makeCards([1, 2, 3, 4, 5, 6, 5, 8, 9, 10, 11, 12]), ["A", "B"]).solvable).toBe(true);
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

  it("finds a solution for a later level with color minimums", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-08")!;
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

  it("finds a solution for level 11 with white-only and mixed-color constraints", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-11")!;
    const cards = makeCards([6, 2, 5, 1, 7, 3, 6, 2, 3, 5, 4, 7], [
      "black",
      "white",
      "white",
      "black",
      "white",
      "black",
      "white",
      "black",
      "white",
      "black",
      "white",
      "black"
    ]);

    expect(canSolveDeal(level, cards, ["A", "B"]).solvable).toBe(true);
  });

  it("finds a solution for level 12 with low values banned from odd segments", () => {
    const level = loadLevels().find((candidate) => candidate.id === "level-12")!;
    const cards = makeCards([4, 1, 1, 3, 6, 2, 2, 3, 8, 9, 5, 5]);

    expect(canSolveDeal(level, cards, ["A", "B"]).solvable).toBe(true);
  });
});
