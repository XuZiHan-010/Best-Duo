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
      { type: "sum-range", segment: 2, min: 12, max: 16 },
      { type: "exact-cards", segment: 6, count: 3 }
    ],
    notes: "区段 2 总和落在 12–16，区段 6 恰好 3 张；可行性取决于随机抽到的 12 张牌。"
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
  }
];
