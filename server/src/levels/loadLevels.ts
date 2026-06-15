import type { Challenge, Condition } from "@take-time/shared";
import { rawLevels } from "./data.js";

const normalizeSegment = (segment: number) => segment - 1;

const normalizeCondition = (condition: Condition): Condition => {
  switch (condition.type) {
    case "min-cards":
    case "max-cards":
    case "exact-cards":
    case "sum-equals":
    case "sum-range":
    case "parity":
    case "segment-colors":
    case "all-distinct":
    case "placement-order":
      return { ...condition, segment: normalizeSegment(condition.segment) };
    case "non-decreasing":
    case "non-increasing":
      return { ...condition, segments: condition.segments.map(normalizeSegment) };
    case "adjacent-diff":
      return { ...condition, a: normalizeSegment(condition.a), b: normalizeSegment(condition.b) };
    case "all-nonempty":
    case "max-sum-each":
      return condition;
  }
};

export const loadLevels = (): Challenge[] =>
  rawLevels.map((level) => {
    if (level.segmentCount !== 6) throw new Error(`Invalid segment count for ${level.id}`);
    return {
      ...level,
      conditions: [
        ...level.conditions.map(normalizeCondition),
        ...(level.centerCap === null ? [] : ([{ type: "max-sum-each", value: level.centerCap }] as Condition[]))
      ]
    };
  });
