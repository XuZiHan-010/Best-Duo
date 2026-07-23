import type { CardColor, Challenge, LevelSummary, RevealResult } from "./level.js";

export type SeatId = "A" | "B" | "C" | "D";
export type SeatKind = "human" | "agent";
export type PlayerCount = 2 | 3 | 4;
export type Phase = "waiting" | "levelSelect" | "discussion" | "placing" | "reveal" | "result";
export type FailureReason = "rule-unmet" | "timeout" | "player-left" | null;
export type TimerHandle = ReturnType<typeof setTimeout>;

export interface Seat {
  id: SeatId;
  kind: SeatKind;
  nick: string | null;
  avatar?: string | null;
  agentId?: string;
  /** 服务端内部账号主键；PublicSeat 白名单不会下发。 */
  playerId?: string;
  connected: boolean;
  socketId?: string;
  holdUntil?: number;
}

// 公共座位白名单：新增 Seat 字段默认不下发，必须在这里显式加入才会广播。
export interface PublicSeat {
  id: SeatId;
  kind: SeatKind;
  nick: string | null;
  avatar?: string | null;
  agentId?: string;
  connected: boolean;
}

export interface RoomSettings {
  discussionMinutes: 5 | 10 | 15 | 20;
  thinkSeconds: 10 | 15 | 20 | 25 | 30;
  hintMarkerCount: 2 | 3 | 4;
  capacity: PlayerCount;
}

export interface ProgressState {
  schemaVersion: 1;
  clearedLevels: number[];
  settings: RoomSettings;
}

export interface HandCard {
  id: string;
  owner: SeatId;
  value: number;
  color: CardColor;
  initiallyVisibleToOwner: boolean;
  visibleToOwner: boolean;
}

export interface PublicHandCard {
  id: string;
  owner: SeatId;
  visibleToOwner: boolean;
  value?: number;
  color?: CardColor;
}

export interface PlacedCard {
  id: string;
  owner: SeatId;
  value: number;
  color: CardColor;
  revealed: boolean;
  placedAt: number;
  playOrder: number;
}

export interface PublicPlacedCard {
  id: string;
  owner: SeatId;
  revealed: boolean;
  value?: number;
  color?: CardColor;
  placedAt: number;
  playOrder: number;
}

export interface HintMarkers {
  total: number;
  used: number;
}

export interface PendingHint {
  seatId: SeatId;
  cardId: string;
  segment: number;
  deadline: number;
}

export interface ChatMessage {
  id: string;
  attemptId: string;
  senderSeatId: SeatId;
  kind: SeatKind;
  nick: string;
  text: string;
  ts: number;
}

export interface TimerState {
  kind: "levelSelect" | "discussion" | "turn" | "hint" | "reveal";
  deadline: number;
}

export interface TimerHandles {
  levelSelect?: TimerHandle;
  discussion?: TimerHandle;
  turn?: TimerHandle;
  hint?: TimerHandle;
  reveal?: TimerHandle;
  hostStart?: TimerHandle;
}

export interface RoomIdentity {
  campaignId: string;
  playSessionId: string;
  levelRunId: string | null;
  levelRunLevelId: string | null;
  attemptId: string | null;
}

export type PublicAgentRuleStrength = "hard_commitment" | "strong_preference" | "suggestion" | "unresolved";

export interface PublicAgentStrategyRule {
  id: string;
  type: string;
  strength: PublicAgentRuleStrength;
  targetSeatIds: SeatId[];
  targetSegments?: number[];
}

export interface PublicAgentDecision {
  source: "model" | "candidate" | "fallback";
  fallbackReason?: string;
  appliedStrategyRuleIds: string[];
  relaxedStrategyRuleIds: string[];
  at: number;
}

export interface PublicAgentSeatState {
  seatId: SeatId;
  strategyVersion: number;
  // 策略来源可观察：model=模型收口成功；public_facts_fallback=收口失败后
  // 由公开讨论事实确定性派生；unavailable=收口失败且无可派生事实。
  strategySource?: "model" | "public_facts_fallback" | "unavailable";
  strategyRules: PublicAgentStrategyRule[];
  lastDecision?: PublicAgentDecision;
}

export interface PublicAgentReview {
  sourceAttemptId: string;
  passedSegments: number[];
  failedSegments: number[];
  lessons: string[];
  unresolvedIssues: string[];
  contractOutcomes?: Array<{
    ruleId: string;
    status: "fulfilled" | "impossible" | "relaxed";
    reason: string;
  }>;
}

export interface PublicAgentState {
  seats: PublicAgentSeatState[];
  review: PublicAgentReview | null;
  contract?: {
    revision: number;
    rules: PublicAgentStrategyRule[];
  };
  // discussion → placing 转换期间为 true：服务端正在收口 Agent 策略。
  // 前端据此显示“正在整理讨论策略…”，状态唯一来源是服务端（多标签页/重连一致）。
  strategyFinalizing?: boolean;
}

export interface GameRoom {
  stateVersion: number;
  identity: RoomIdentity;
  capacity: PlayerCount;
  seats: Seat[];
  ready: Partial<Record<SeatId, boolean>>;
  host: SeatId | null;
  phase: Phase;
  phaseVersion: number;
  turnVersion: number;
  settings: RoomSettings;
  progress: ProgressState;
  levelSummaries: LevelSummary[];
  currentLevelIndex: number | null;
  currentChallenge: Challenge | null;
  hands: Partial<Record<SeatId, HandCard[]>>;
  playedCount: Partial<Record<SeatId, number>>;
  placements: PlacedCard[][];
  hintMarkers: HintMarkers;
  turn: "race" | SeatId | null;
  pendingHint: PendingHint | null;
  chat: ChatMessage[];
  timer: TimerState | null;
  timers: TimerHandles;
  revealResult: RevealResult | null;
  failureReason: FailureReason;
  /** 只含公开讨论可追溯策略和决策来源，不含私有计划、belief 或手牌。 */
  agentState: PublicAgentState;
}

export interface PublicRoomState {
  stateVersion: number;
  capacity: PlayerCount;
  seats: PublicSeat[];
  ready: Partial<Record<SeatId, boolean>>;
  host: SeatId | null;
  phase: Phase;
  settings: RoomSettings;
  progress: Pick<ProgressState, "clearedLevels" | "schemaVersion">;
  levelSummaries: LevelSummary[];
  currentLevelIndex: number | null;
  currentChallenge: Challenge | null;
  placements: PublicPlacedCard[][];
  hintMarkers: HintMarkers;
  turn: "race" | SeatId | null;
  pendingHint: PendingHint | null;
  chat: ChatMessage[];
  timer: TimerState | null;
  revealResult: RevealResult | null;
  failureReason: FailureReason;
  agentState: PublicAgentState;
}

export const handSizeForPlayerCount = (playerCount: PlayerCount): number => {
  switch (playerCount) {
    case 2:
      return 6;
    case 3:
      return 4;
    case 4:
      return 3;
  }
};
