import { describe, expect, it } from "vitest";
import type {
  Condition,
  PublicHandCard,
  PublicPlacedCard,
  SeatId,
  TurnStrategyRuleView,
  TurnView
} from "@take-time/shared";
import { generateCandidates } from "../src/agent/candidates/index.js";
import { defaultSettings } from "../src/config.js";
import { createGameRoom } from "../src/game/room.js";
import { beginPlacement, enterDiscussion } from "../src/game/phases.js";
import { loadLevels } from "../src/levels/loadLevels.js";
import { buildTurnView } from "../src/agent/views.js";

const hcard = (id: string, color: "black" | "white", value: number): PublicHandCard =>
  ({ id, color, value }) as PublicHandCard;

const pcard = (id: string, color: "black" | "white", value: number): PublicPlacedCard => ({
  id,
  owner: "A",
  revealed: true,
  value,
  color,
  placedAt: 0,
  playOrder: 0
});

const emptyBoard = (): PublicPlacedCard[][] => [[], [], [], [], [], []];

const levelWith = (conditions: Condition[]): TurnView["level"] => ({
  id: "level-01",
  name: "L1",
  levelIndex: 1,
  difficulty: "★",
  centerCap: "inf",
  playable: true,
  conditions,
  notes: ""
});

const assignRule = (
  type: "segment_assignment" | "avoid_segment",
  seatId: SeatId,
  segment: number,
  strength: TurnStrategyRuleView["strength"] = "strong_preference"
): TurnStrategyRuleView => ({
  id: `${type}-${seatId}-${segment}`,
  type,
  strength,
  targetSeatIds: [seatId],
  targetSegments: [segment],
  parameters: {},
  sourceMessageIds: ["m1"]
});

const makeView = (over: Partial<TurnView>): TurnView =>
  ({
    seatId: "A",
    attemptId: "att",
    phaseVersion: 1,
    turnVersion: 1,
    phase: "placing",
    level: null,
    settings: { thinkSeconds: 10, hintMarkerCount: 4 },
    seats: [
      { id: "A", kind: "agent", nick: "AI" },
      { id: "B", kind: "human", nick: "P" }
    ],
    hand: [],
    placements: emptyBoard(),
    hintMarkers: {},
    turn: "A",
    pendingHint: null,
    playedCount: {},
    ...over
  }) as TurnView;

describe("generateCandidates", () => {
  it("朝正向条件评分：需要 1 白的 S1，白牌进 S1 排第一，黑进 S1 被剪", () => {
    const view = makeView({
      hand: [hcard("w1", "white", 4), hcard("b1", "black", 5)],
      level: levelWith([{ type: "segment-colors", segment: 0, black: 0, white: 1 }])
    });
    const result = generateCandidates(view);

    expect(result.ranked.length).toBeGreaterThan(0);
    expect(result.ranked[0]).toMatchObject({ cardId: "w1", segment: 0 });
    // 黑牌进 S0（要求 0 黑）可证必输 → 不出现在候选里
    expect(result.ranked.some((c) => c.cardId === "b1" && c.segment === 0)).toBe(false);
  });

  it("消费 segment_assignment：本座位被指派 S4 时，S4 候选排到最前", () => {
    const view = makeView({
      hand: [hcard("w1", "white", 4), hcard("w2", "white", 5)],
      level: levelWith([]),
      memory: {
        lockedSeatStrategy: { version: 1, rules: [assignRule("segment_assignment", "A", 3)], privatePlan: [] },
        ownActions: [],
        pendingCommitments: []
      } as unknown as TurnView["memory"]
    });
    const result = generateCandidates(view);
    expect(result.ranked[0]!.segment).toBe(3);
    expect(result.ranked[0]!.appliedRuleIds).toContain("segment_assignment-A-3");
  });

  it("消费 avoid_segment：被要求避让 S2 时，S2 候选被压到最后或过滤", () => {
    const view = makeView({
      hand: [hcard("w1", "white", 4)],
      level: levelWith([]),
      memory: {
        lockedSeatStrategy: { version: 1, rules: [assignRule("avoid_segment", "A", 1)], privatePlan: [] },
        ownActions: [],
        pendingCommitments: []
      } as unknown as TurnView["memory"]
    });
    const result = generateCandidates(view);
    const avoidRank = result.ranked.findIndex((c) => c.segment === 1);
    // 避让区段不应排在第一
    expect(result.ranked[0]!.segment).not.toBe(1);
    if (avoidRank >= 0) expect(avoidRank).toBeGreaterThan(0);
  });

  it("topK 确定性：同一 view 两次调用结果完全一致，topK = ranked 前 K", () => {
    const view = makeView({
      hand: [hcard("w1", "white", 4), hcard("b1", "black", 5)],
      level: levelWith([{ type: "exact-cards", segment: 5, count: 3 }])
    });
    const a = generateCandidates(view, { topK: 3 });
    const b = generateCandidates(view, { topK: 3 });
    expect(a).toEqual(b);
    expect(a.topK.length).toBeLessThanOrEqual(3);
    expect(a.topK[0]).toMatchObject({ cardId: a.ranked[0]!.cardId, segment: a.ranked[0]!.segment });
  });

  it("盲牌（无数值）不崩、被正常纳入候选", () => {
    const blind = { id: "x1", color: "white" } as PublicHandCard; // value undefined
    const view = makeView({ hand: [blind], level: levelWith([]) });
    const result = generateCandidates(view);
    expect(result.ranked.length).toBeGreaterThan(0);
    expect(result.ranked.every((c) => c.cardId === "x1")).toBe(true);
  });

  it("始终返回非空 ranked（供兜底用候选#1）", () => {
    const view = makeView({ hand: [hcard("w1", "white", 4)], level: levelWith([]) });
    const result = generateCandidates(view);
    expect(result.ranked[0]).toBeDefined();
    expect(result.evaluatorVersion).toBe("m9.3-v3-belief");
  });

  it("硬 avoid 与唯一可执行动作冲突时恢复候选并结构化记录 relax", () => {
    const rule = assignRule("avoid_segment", "A", 1, "hard_commitment");
    const view = makeView({
      hand: [hcard("w1", "white", 4)],
      level: levelWith([{ type: "placement-order", order: 1, segment: 1 }]),
      memory: {
        lockedSeatStrategy: { version: 1, rules: [rule], privatePlan: [] },
        ownActions: [],
        pendingCommitments: []
      } as unknown as TurnView["memory"]
    });

    const result = generateCandidates(view);
    expect(result.ranked[0]).toMatchObject({ cardId: "w1", segment: 1 });
    expect(result.relaxedRuleIds).toEqual([rule.id]);
  });

  it("类型与运行时都拒绝把含真实隐藏信息的 GameRoom 传入公开入口", () => {
    const room = createGameRoom({ schemaVersion: 1, clearedLevels: [], settings: defaultSettings }, 4);
    // @ts-expect-error 候选入口的公开类型只允许 TurnView。
    expect(() => generateCandidates(room)).toThrowError("generateCandidates 只接受经过遮蔽的 TurnView");
  });

  it("服务器隐藏真值变化但 TurnView 不变时，候选集合、分数与 top-K 完全不变", () => {
    const room = createGameRoom({ schemaVersion: 1, clearedLevels: [], settings: defaultSettings }, 4);
    for (const seatId of ["A", "B"] as const) {
      const seat = room.seats.find((candidate) => candidate.id === seatId)!;
      seat.nick = seatId;
      seat.connected = true;
    }
    room.phase = "levelSelect";
    enterDiscussion(room, loadLevels()[0]);
    beginPlacement(room);
    room.turn = "A";

    const beforeView = buildTurnView(room, "A");
    const before = generateCandidates(beforeView);
    for (const card of room.hands.B ?? []) card.value = card.value === 12 ? 1 : card.value + 1;
    for (const card of room.hands.A?.filter((candidate) => !candidate.visibleToOwner) ?? []) {
      card.value = card.value === 12 ? 1 : card.value + 1;
    }
    const afterView = buildTurnView(room, "A");

    expect(afterView).toEqual(beforeView);
    expect(generateCandidates(afterView)).toEqual(before);
  });

  it("用合法信念估计共享区段总和并选择补位牌", () => {
    const board = emptyBoard();
    board[0] = [{
      id: "teammate-hidden",
      owner: "B",
      revealed: false,
      color: "black",
      placedAt: 1,
      playOrder: 1
    }];
    const view = makeView({
      hand: [hcard("small", "white", 3), hcard("large", "white", 9)],
      placements: board,
      level: levelWith([{ type: "sum-equals", segment: 0, value: 10 }])
    });

    const result = generateCandidates(view);
    expect(result.ranked[0]).toMatchObject({ cardId: "small", segment: 0 });
    expect(result.ranked[0]?.components.some((component) => component.source === "condition:sum-equals")).toBe(true);
  });

  it("可能世界采样只消费 TurnView，并在固定 seed 下给出相同排序", () => {
    const room = createGameRoom({ schemaVersion: 1, clearedLevels: [], settings: defaultSettings }, 4);
    for (const seatId of ["A", "B"] as const) {
      const seat = room.seats.find((candidate) => candidate.id === seatId)!;
      seat.nick = seatId;
      seat.connected = true;
    }
    room.phase = "levelSelect";
    enterDiscussion(room, loadLevels()[0]);
    beginPlacement(room);
    room.turn = "A";
    const view = buildTurnView(room, "A");
    const config = {
      sampling: { enabled: true, seed: "fixed", worldCount: 2, maxCandidates: 2, maxMs: 30 }
    };
    const left = generateCandidates(view, config);
    const right = generateCandidates(view, config);
    expect(left.ranked.map(({ cardId, segment, score }) => ({ cardId, segment, score }))).toEqual(
      right.ranked.map(({ cardId, segment, score }) => ({ cardId, segment, score }))
    );
    expect(left.sampling).toMatchObject({ version: "possible-worlds-v2-deterministic", generatedWorlds: 2 });
  });
});
