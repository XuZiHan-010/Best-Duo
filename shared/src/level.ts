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
  | { type: "non-decreasing"; segments: number[] }
  | { type: "non-increasing"; segments: number[] }
  | { type: "adjacent-diff"; a: number; b: number; maxDiff: number }
  // 第 N 张打出的牌必须落在某区段（order 为 1 起的出牌序号）。
  | { type: "placement-order"; order: number; segment: number }
  // 某区段恰好包含 black 张黑牌与 white 张白牌。
  | { type: "segment-colors"; segment: number; black: number; white: number }
  // 某区段至少包含 count 张指定颜色的牌。
  | { type: "min-color-cards"; segment: number; color: CardColor; count: number }
  // 某区段内所有牌的数值互不相同（不限张数）。
  | { type: "all-distinct"; segment: number }
  // 某区段内至少存在两张数值相同的牌（不限张数）。
  | { type: "has-duplicate-value"; segment: number }
  | { type: "max-sum-each"; value: number };

export interface Challenge {
  id: string;
  name: string;
  levelIndex: number;
  difficulty: string;
  segmentCount: 6;
  // 每区段总和上限（时钟中心值）。number = 该上限；null/省略 = 官方默认 24；"inf" = ∞（无上限，教学关用）。
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
