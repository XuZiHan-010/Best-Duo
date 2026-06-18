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
    case "min-color-cards":
    case "all-distinct":
    case "has-duplicate-value":
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

const globalConditionsForLevel = (level: Challenge): Condition[] => {
  const centerCap = level.centerCap as number | "inf" | null;
  return [
    { type: "non-decreasing", segments: [0, 1, 2, 3, 4, 5] },
    { type: "all-nonempty" },
    ...(centerCap === "inf" ? [] : ([{ type: "max-sum-each", value: centerCap ?? 24 }] as Condition[]))
  ];
};

const sameCondition = (a: Condition, b: Condition): boolean => JSON.stringify(a) === JSON.stringify(b);

const appendMissingGlobalConditions = (conditions: Condition[], level: Challenge): Condition[] => {
  const next = [...conditions];
  for (const condition of globalConditionsForLevel(level)) {
    if (!next.some((existing) => sameCondition(existing, condition))) next.push(condition);
  }
  return next;
};

export const loadLevels = (): Challenge[] =>
  rawLevels.map((level) => {
    if (level.segmentCount !== 6) throw new Error(`Invalid segment count for ${level.id}`);
    return {
      ...level,
      conditions: appendMissingGlobalConditions(level.conditions.map(normalizeCondition), level)
    };
  });
