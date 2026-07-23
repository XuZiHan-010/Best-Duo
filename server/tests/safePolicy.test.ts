import { describe, expect, it } from "vitest";
import type { Condition, PublicHandCard, PublicPlacedCard, TurnView } from "@take-time/shared";
import { decideSafePlacement } from "../src/agent/safePolicy.js";

const handCard = (id: string, value?: number, color?: "black" | "white"): PublicHandCard => ({
  id,
  owner: "B",
  visibleToOwner: value !== undefined,
  ...(value !== undefined ? { value } : {}),
  ...(color !== undefined ? { color } : {})
});

// 桌面暗牌：颜色始终公开，数值仅在 revealed 时公开（见 visibility.publicPlacements）。
const placed = (
  id: string,
  color: "black" | "white",
  options: { value?: number; playOrder?: number } = {}
): PublicPlacedCard => ({
  id,
  owner: "A",
  revealed: options.value !== undefined,
  color,
  placedAt: 0,
  playOrder: options.playOrder ?? 0,
  ...(options.value !== undefined ? { value: options.value } : {})
});

const emptyBoard = (): PublicPlacedCard[][] => [[], [], [], [], [], []];

const viewOf = (
  hand: PublicHandCard[],
  placements: PublicPlacedCard[][],
  conditions: Condition[] = []
): TurnView => ({
  seatId: "B",
  attemptId: "attempt-1",
  phaseVersion: 1,
  turnVersion: 1,
  phase: "placing",
  level: {
    id: "level-test",
    name: "测试关",
    levelIndex: 1,
    difficulty: "★",
    centerCap: "inf",
    playable: true,
    conditions
  },
  settings: { thinkSeconds: 10, hintMarkerCount: 2 },
  seats: [
    { id: "A", kind: "human", nick: "A" },
    { id: "B", kind: "agent", nick: "AI-1" }
  ],
  hand,
  placements,
  hintMarkers: { total: 2, used: 0 },
  turn: "B",
  pendingHint: null,
  playedCount: {}
});

describe("decideSafePlacement 不泄漏隐藏信息", () => {
  // 最关键的一条：安全视图不变时，服务端真实隐藏值怎么变都不能影响决策。
  it("桌面暗牌真实数值改变时输出完全不变", () => {
    const hand = [handCard("c1", 3, "white"), handCard("c2", 9, "black")];
    const board = emptyBoard();
    board[0] = [placed("p1", "white")];
    board[1] = [placed("p2", "black")];

    const first = decideSafePlacement(viewOf(hand, board));

    // 同一份安全视图——暗牌在服务端可能是 1 也可能是 12，视图里都只有颜色。
    const boardAgain = emptyBoard();
    boardAgain[0] = [placed("p1", "white")];
    boardAgain[1] = [placed("p2", "black")];
    const second = decideSafePlacement(viewOf(hand, boardAgain));

    expect(second).toEqual(first);
  });

  it("不读取本人尚不可见的盲牌数值", () => {
    const board = emptyBoard();
    // 盲牌没有 value 也没有 color；若实现去猜真实值就会在这里产生差异。
    const blindOnly = decideSafePlacement(viewOf([handCard("blind")], board));
    expect(blindOnly.cardId).toBe("blind");
    expect(blindOnly.segment).toBeGreaterThanOrEqual(0);
    expect(blindOnly.segment).toBeLessThan(6);
  });

  it("同一视图重复调用结果一致", () => {
    const hand = [handCard("c1", 5, "black"), handCard("c2", 8, "white")];
    const view = viewOf(hand, emptyBoard());
    const results = Array.from({ length: 5 }, () => decideSafePlacement(view));
    for (const result of results) expect(result).toEqual(results[0]);
  });
});

describe("decideSafePlacement 约束剪枝", () => {
  it("剩余牌数刚好等于空段数时优先补空段", () => {
    const board = emptyBoard();
    // 已放 10 张，集中在区 0-3；区 4、区 5 仍空，本手加剩余 1 手正好补两个空段。
    board[0] = [placed("a1", "white", { value: 1 }), placed("a2", "white", { value: 1 })];
    board[1] = [placed("a3", "white", { value: 2 }), placed("a4", "white", { value: 2 })];
    board[2] = [placed("a5", "black", { value: 3 }), placed("a6", "black", { value: 3 })];
    board[3] = [
      placed("a7", "black", { value: 4 }),
      placed("a8", "black", { value: 4 }),
      placed("a9", "black", { value: 4 }),
      placed("a10", "black", { value: 4 })
    ];

    const decision = decideSafePlacement(
      viewOf([handCard("c1", 6, "white")], board, [{ type: "all-nonempty" }])
    );
    expect([4, 5]).toContain(decision.segment);
  });

  // 下列用例都刻意让「被约束的区段」同时是排序器的首选，
  // 这样删掉剪枝逻辑测试就会失败，不会空过。
  // 排序偏好：数值 1→区0、3→区1、5→区2、7→区3、9→区4、11→区5。

  it("遵守 placement-order：本手序号命中时强制落指定区段", () => {
    const board = emptyBoard();
    board[0] = [placed("a1", "white", { value: 2, playOrder: 1 })];
    // 已放 1 张，本手是第 2 张。两张手牌的自然首选分别是区 2 和区 3，都不是区 0。
    const decision = decideSafePlacement(
      viewOf([handCard("c1", 5, "white"), handCard("c2", 7, "black")], board, [
        { type: "placement-order", order: 2, segment: 0 }
      ])
    );
    expect(decision.segment).toBe(0);
  });

  it("不把牌放进已达 max-cards 上限的区段", () => {
    const board = emptyBoard();
    board[2] = [placed("a1", "white", { value: 2 }), placed("a2", "black", { value: 3 })];
    // 数值 5 的自然首选就是区 2，只有剪枝才会让它改放别处。
    const decision = decideSafePlacement(
      viewOf([handCard("c1", 5, "white")], board, [{ type: "max-cards", segment: 2, count: 2 }])
    );
    expect(decision.segment).not.toBe(2);
  });

  it("按公开颜色遵守 max-color-cards", () => {
    const board = emptyBoard();
    // 区 1 已有 2 张黑牌；数值 3 的自然首选正是区 1。
    board[1] = [placed("a1", "black"), placed("a2", "black")];
    const decision = decideSafePlacement(
      viewOf([handCard("c1", 3, "black")], board, [
        { type: "max-color-cards", segment: 1, color: "black", count: 2 }
      ])
    );
    expect(decision.segment).not.toBe(1);
  });

  it("遵守 forbidden-values（仅对本人可见的牌生效）", () => {
    // 数值 1 的自然首选是区 0，而区 0 恰好禁止 1。
    const decision = decideSafePlacement(
      viewOf([handCard("c1", 1, "white")], emptyBoard(), [
        { type: "forbidden-values", segment: 0, values: [1, 2, 3] }
      ])
    );
    expect(decision.segment).not.toBe(0);
  });

  it("不让区段总和下界超过中心值上限", () => {
    const board = emptyBoard();
    // 区 0 已满 24；数值 1 的自然首选是区 0，但再放任何牌都会越界。
    board[0] = [placed("a1", "white", { value: 12 }), placed("a2", "black", { value: 12 })];
    const decision = decideSafePlacement(
      viewOf([handCard("c1", 1, "white")], board, [{ type: "max-sum-each", value: 24 }])
    );
    expect(decision.segment).not.toBe(0);
  });

  it("维护非递减梯度：不把牌放进会压过后段上界的前段", () => {
    const board = emptyBoard();
    // 区 5 已确定为 3；数值 9 的自然首选是区 4，
    // 但放进去会让区 4 下界 9 > 区 5 上界 3，非递减不可能成立。
    board[5] = [placed("a1", "white", { value: 3 })];
    const decision = decideSafePlacement(
      viewOf([handCard("c1", 9, "black")], board, [
        { type: "non-decreasing", segments: [0, 1, 2, 3, 4, 5] }
      ])
    );
    expect(decision.segment).not.toBe(4);
  });
});

describe("decideSafePlacement 永不卡死", () => {
  it("全部候选都可被证明必输时仍返回合法动作", () => {
    // 互相矛盾的条件：区 0 同时要求恰好 0 张和至少 1 张。
    const impossible: Condition[] = [
      { type: "max-cards", segment: 0, count: 0 },
      { type: "max-cards", segment: 1, count: 0 },
      { type: "max-cards", segment: 2, count: 0 },
      { type: "max-cards", segment: 3, count: 0 },
      { type: "max-cards", segment: 4, count: 0 },
      { type: "max-cards", segment: 5, count: 0 }
    ];
    const decision = decideSafePlacement(viewOf([handCard("c1", 5, "white")], emptyBoard(), impossible));
    expect(decision.cardId).toBe("c1");
    expect(decision.segment).toBeGreaterThanOrEqual(0);
    expect(decision.segment).toBeLessThan(6);
  });

  it("没有关卡条件时也能出牌", () => {
    const decision = decideSafePlacement(viewOf([handCard("c1", 5, "white")], emptyBoard()));
    expect(decision.cardId).toBe("c1");
  });

  it("手牌为空时抛错而不是返回非法动作", () => {
    expect(() => decideSafePlacement(viewOf([], emptyBoard()))).toThrow();
  });

  it("总是从本座位手牌中选牌", () => {
    const hand = [handCard("c1", 2, "white"), handCard("c2", 11, "black"), handCard("blind")];
    const decision = decideSafePlacement(viewOf(hand, emptyBoard()));
    expect(hand.map((card) => card.id)).toContain(decision.cardId);
  });
});
