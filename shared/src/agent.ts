import type { CardPlacePayload, HintDecidePayload } from "./events.js";
import type { LevelSummary } from "./level.js";
import type {
  ChatMessage,
  HintMarkers,
  PendingHint,
  Phase,
  PublicHandCard,
  PublicPlacedCard,
  PublicRoomState,
  RoomSettings,
  SeatId,
  SeatKind,
  TimerState
} from "./state.js";

export interface AgentRoomView {
  seatId: SeatId;
  room: PublicRoomState;
  hand: PublicHandCard[];
}

export interface AgentSeatInfo {
  id: SeatId;
  kind: SeatKind;
  nick: string | null;
}

// 公开实体事实的模型 context 投影：来源同时给出 observation id 与聊天消息 id。
export interface DiscussionFactView {
  id: string;
  entityType: "seat" | "segment" | "commitment" | "strategy_rule";
  entityId: string;
  attribute: string;
  value: unknown;
  certainty: "explicit" | "inferred" | "conflicted";
  sourceObservationIds: string[];
  sourceMessageIds: string[];
}

// 同关重试摘要的模型 context 投影：只含公开信息。
export interface DiscussionRetryBrief {
  sourceAttemptId: string;
  failureReason?: "rule-unmet" | "timeout" | "player-left";
  publicStrategySummary: Array<{
    id: string;
    type: string;
    strength: string;
    targetSeatIds: string[];
    targetSegments?: number[];
    parameters: Record<string, unknown>;
    sourceMessageIds: string[];
  }>;
  publicCommitments: string[];
  passedSegments: number[];
  failedSegments: number[];
  lessons: Array<{ description: string; confidence: number; sourceIds: string[] }>;
  unresolvedIssues: string[];
  userCorrections: string[];
}

// 讨论视图：类型上不存在任何手牌字段，序列化结果不可能包含手牌。
export interface DiscussionView {
  seatId: SeatId;
  attemptId: string;
  levelRunId: string | null;
  phase: Phase;
  level: LevelSummary | null;
  settings: Pick<RoomSettings, "discussionMinutes" | "thinkSeconds" | "hintMarkerCount">;
  seats: AgentSeatInfo[];
  chat: ChatMessage[];
  timer: TimerState | null;
  // 以下两项仅在提供 memory store 且 attempt 匹配时注入。
  publicFacts?: DiscussionFactView[];
  retryBrief?: DiscussionRetryBrief;
}

// 出牌视图：只含本座位遮蔽后的手牌与公开桌面信息。
export interface TurnView {
  seatId: SeatId;
  attemptId: string;
  phaseVersion: number;
  turnVersion: number;
  phase: Phase;
  level: LevelSummary | null;
  settings: Pick<RoomSettings, "thinkSeconds" | "hintMarkerCount">;
  seats: AgentSeatInfo[];
  hand: PublicHandCard[];
  placements: PublicPlacedCard[][];
  // 每段公开派生统计（P1-3）：只从公开投影计算，含未知牌的保守区间。
  // 命名刻意用 Knowledge/bounds 而非 sums，杜绝将来误接服务端真实总和。
  segmentKnowledge?: SegmentKnowledge[];
  hintMarkers: HintMarkers;
  turn: "race" | SeatId | null;
  pendingHint: PendingHint | null;
  playedCount: Partial<Record<SeatId, number>>;
  // 只包含本座位的策略与私人 memory 投影；不得包含其他座位的私有内容。
  memory?: TurnMemoryContext;
}

// 单个区段的公开统计：revealedSum 只累加已公开数值；
// sumLower/UpperBound 是“当前已放牌”的保守区间（未知牌按 1..12），
// 不含未来还会放入的牌，也绝不含隐藏牌真实数值。
export interface SegmentKnowledge {
  count: number;
  revealedSum: number;
  hiddenCount: number;
  blackCount: number;
  whiteCount: number;
  sumLowerBound: number;
  sumUpperBound: number;
}

export interface TurnStrategyRuleView {
  id: string;
  type: "segment_assignment" | "avoid_segment" | "value_band" | "color_allocation" | "card_property_preference" | "placement_order" | "reserve_capacity" | "hint_policy" | "custom";
  strength: "hard_commitment" | "strong_preference" | "suggestion" | "unresolved";
  targetSeatIds: SeatId[];
  targetSegments?: number[];
  parameters: Record<string, unknown>;
  sourceMessageIds: string[];
}

export interface TurnMemoryContext {
  lockedSeatStrategy: {
    version: number;
    rules: TurnStrategyRuleView[];
    privatePlan: string[];
  } | null;
  ownActions: Array<{
    kind: "placement" | "hint" | "chat";
    payload: unknown;
    appliedStrategyRuleIds: string[];
  }>;
  currentBeliefs: Array<{
    subject: string;
    hypothesis: string;
    confidence: number;
    evidenceObservationIds: string[];
  }>;
  // 当前回合从本座位合法可见信息派生的牌值信念。possibleValues 是物理
  // 可能值；successCompatibleValues 仅表示“若该区段最终满足关卡条件”时
  // 仍兼容的值，二者不得混用。
  valueBeliefs?: TurnValueBelief[];
  pendingCommitments: Array<{
    id: string;
    ruleId: string;
    description: string;
    status: "pending" | "fulfilled" | "impossible" | "relaxed";
    reason?: string;
    sourceMessageIds: string[];
  }>;
  derivedState?: {
    conditions: Array<{
      index: number;
      status: "satisfied" | "still_possible" | "impossible";
      reason: string;
    }>;
    commitments: Array<{
      ruleId: string;
      status: "pending" | "fulfilled" | "impossible" | "relaxed";
      reason?: string;
    }>;
  };
}

export interface TurnValueBelief {
  version: string;
  cardId: string;
  owner: SeatId;
  segment: number;
  color: "white" | "black";
  status: "known" | "estimated" | "inconsistent";
  possibleValues: number[];
  successCompatibleValues: number[];
  expected: number;
  confidence: number;
  evidence: Array<"deck" | "own_memory" | "level_condition" | "seat_strategy">;
}

export interface PlayerAgent {
  decidePlacement(view: AgentRoomView): Promise<CardPlacePayload>;
  decideHint(view: AgentRoomView): Promise<HintDecidePayload["decision"]>;
  // 讨论决策只接受不含手牌的 DiscussionView。
  decideDiscussion(view: DiscussionView): Promise<{ message: string } | null>;
}
