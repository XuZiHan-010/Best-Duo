export type CardColor = "white" | "black";

export interface Card {
  value: number;
  color: CardColor;
}

export type Condition =
  | { type: "all-nonempty" }
  | { type: "min-cards"; segment: number; count: number }
  | { type: "max-cards"; segment: number; count: number }
  | { type: "exact-cards"; segment: number; count: number }
  | { type: "sum-equals"; segment: number; value: number }
  | { type: "sum-range"; segment: number; min: number; max: number }
  | { type: "parity"; segment: number; parity: "odd" | "even" }
  | { type: "closest-to-value"; segment: number; value: number }
  | { type: "non-decreasing"; segments: number[] }
  | { type: "non-increasing"; segments: number[] }
  | { type: "adjacent-diff"; a: number; b: number; maxDiff: number }
  | { type: "placement-order"; order: number; segment: number }
  | { type: "segment-colors"; segment: number; black: number; white: number }
  | { type: "min-color-cards"; segment: number; color: CardColor; count: number }
  | { type: "max-color-cards"; segment: number; color: CardColor; count: number }
  | { type: "forbidden-values"; segment: number; values: number[] }
  | { type: "all-distinct"; segment: number }
  | { type: "has-duplicate-value"; segment: number }
  | { type: "max-sum-each"; value: number };

export interface Challenge {
  id: string;
  name: string;
  levelIndex: number;
  difficulty: string;
  segmentCount: 6;
  centerCap: number | "inf" | null;
  playable: boolean;
  conditions: Condition[];
  notes?: string;
}

export type LevelSummary = Pick<
  Challenge,
  "id" | "name" | "levelIndex" | "difficulty" | "centerCap" | "playable" | "conditions" | "notes"
>;

export interface ConditionResult {
  condition: Condition;
  pass: boolean;
  message: string;
}

export interface RevealResult {
  pass: boolean;
  segmentSums: number[];
  segmentCounts: number[];
  conditions: ConditionResult[];
}
