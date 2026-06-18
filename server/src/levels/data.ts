import type { Challenge } from "@take-time/shared";

// 牌池为全局固定的 24 张（白 1–12 + 黑 1–12），每局随机抽 12 张发牌，
// 见 server/src/game/deal.ts。关卡不再各自携带 deck。
export const rawLevels: Challenge[] = [
  {
    id: "level-01",
    name: "第 1 关 · 拾级而上",
    levelIndex: 1,
    difficulty: "★",
    segmentCount: 6,
    centerCap: "inf",
    playable: true,
    conditions: [],
    notes: "教学关：只使用加载器自动叠加的三条全局规则。"
  },
  {
    id: "level-02",
    name: "第 2 关 · 精打细算",
    levelIndex: 2,
    difficulty: "★",
    segmentCount: 6,
    centerCap: "inf",
    playable: true,
    conditions: [
      { type: "sum-range", segment: 3, min: 12, max: 16 },
      { type: "exact-cards", segment: 6, count: 3 }
    ],
    notes: "区段 3 总和落在 12–16，区段 6 恰好 3 张；可行性取决于随机抽到的 12 张牌。"
  },
  {
    id: "level-03",
    name: "第 3 关 · 黑白有序",
    levelIndex: 3,
    difficulty: "★",
    segmentCount: 6,
    centerCap: "inf",
    playable: true,
    conditions: [
      { type: "placement-order", order: 1, segment: 3 },
      { type: "placement-order", order: 2, segment: 2 },
      { type: "segment-colors", segment: 4, black: 1, white: 1 }
    ],
    notes: "前两张牌的落点被锁定：第 1 张进区段 3、第 2 张进区段 2；区段 4 恰好一黑一白。"
  },
  {
    id: "level-04",
    name: "第 4 关 · 各不相同",
    levelIndex: 4,
    difficulty: "★",
    segmentCount: 6,
    centerCap: null,
    playable: true,
    conditions: [
      { type: "sum-equals", segment: 2, value: 8 },
      { type: "all-distinct", segment: 6 }
    ],
    notes: "区段 2 总和恰好 8；区段 6 内各牌数值互不相同（不限张数）。可行性取决于随机抽到的 12 张牌。"
  },
  {
    id: "level-05",
    name: "第 5 关 · 偶数阶梯",
    levelIndex: 5,
    difficulty: "★",
    segmentCount: 6,
    centerCap: null,
    playable: true,
    conditions: [
      { type: "parity", segment: 3, parity: "even" },
      { type: "sum-range", segment: 5, min: 16, max: 20 },
      { type: "has-duplicate-value", segment: 6 }
    ],
    notes: "区段 3 总和为偶数；区段 5 总和在 16-20；区段 6 内至少有两张牌数值相同（不限张数）。"
  },
  {
    id: "level-06",
    name: "第 6 关 · 双锚点",
    levelIndex: 6,
    difficulty: "★",
    segmentCount: 6,
    centerCap: null,
    playable: true,
    conditions: [
      { type: "sum-equals", segment: 2, value: 9 },
      { type: "exact-cards", segment: 4, count: 2 },
      { type: "exact-cards", segment: 6, count: 3 },
      { type: "min-color-cards", segment: 6, color: "black", count: 1 },
      { type: "min-color-cards", segment: 6, color: "white", count: 1 }
    ],
    notes: "区段 2 总和恰好 9；区段 4 恰好 2 张；区段 6 恰好 3 张，且至少 1 黑 1 白。"
  },
  {
    id: "level-07",
    name: "第 7 关 · 黑白钟摆",
    levelIndex: 7,
    difficulty: "★★",
    segmentCount: 6,
    centerCap: null,
    playable: true,
    conditions: [
      { type: "segment-colors", segment: 3, black: 1, white: 1 },
      { type: "parity", segment: 5, parity: "odd" },
      { type: "sum-range", segment: 6, min: 22, max: 24 }
    ],
    notes: "区段 3 恰好 1 黑 1 白；区段 5 总和为奇数；区段 6 总和在 22-24。"
  },
  {
    id: "level-08",
    name: "第 8 关 · 白色刻度",
    levelIndex: 8,
    difficulty: "★★",
    segmentCount: 6,
    centerCap: null,
    playable: true,
    conditions: [
      { type: "sum-range", segment: 2, min: 8, max: 12 },
      { type: "adjacent-diff", a: 4, b: 5, maxDiff: 3 },
      { type: "min-color-cards", segment: 6, color: "white", count: 2 }
    ],
    notes: "区段 2 总和在 8-12；区段 4 与区段 5 总和差不超过 3；区段 6 至少 2 张白牌。"
  },
  {
    id: "level-09",
    name: "第 9 关 · 三色终点",
    levelIndex: 9,
    difficulty: "★★",
    segmentCount: 6,
    centerCap: null,
    playable: true,
    conditions: [
      { type: "sum-equals", segment: 1, value: 6 },
      { type: "exact-cards", segment: 6, count: 3 },
      { type: "all-distinct", segment: 6 },
      { type: "segment-colors", segment: 6, black: 2, white: 1 }
    ],
    notes: "区段 1 总和恰好 6；区段 6 恰好 3 张，数值互不相同，且为 2 黑 1 白。"
  },
  {
    id: "level-10",
    name: "第 10 关 · 三重刻度",
    levelIndex: 10,
    difficulty: "★★",
    segmentCount: 6,
    centerCap: null,
    playable: true,
    conditions: [
      { type: "sum-equals", segment: 2, value: 10 },
      { type: "parity", segment: 3, parity: "even" },
      { type: "segment-colors", segment: 4, black: 1, white: 1 },
      { type: "adjacent-diff", a: 5, b: 6, maxDiff: 4 }
    ],
    notes: "区段 2 总和恰好 10；区段 3 总和为偶数；区段 4 恰好 1 黑 1 白；区段 5 与区段 6 总和差不超过 4。"
  }
];
