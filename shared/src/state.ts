import type { CardColor, Challenge, LevelSummary, RevealResult } from "./level.js";

export type SeatId = "A" | "B" | "C" | "D";
export type SeatKind = "human" | "agent";
export type Phase = "waiting" | "levelSelect" | "discussion" | "placing" | "reveal" | "result";
export type FailureReason = "rule-unmet" | "timeout" | "player-left" | null;
export type TimerHandle = ReturnType<typeof setTimeout>;

export interface Seat {
  id: SeatId;
  kind: SeatKind;
  nick: string | null;
  avatar?: string | null;
  agentId?: string;
  connected: boolean;
  socketId?: string;
  holdUntil?: number;
}

export interface RoomSettings {
  discussionMinutes: 5 | 10 | 15 | 20;
  thinkSeconds: 5 | 10 | 15 | 20 | 30;
  hintMarkerCount: 2 | 3 | 4;
  capacity: 2 | 3 | 4;
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

export interface GameRoom {
  stateVersion: number;
  capacity: 2 | 3 | 4;
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
}

export interface PublicRoomState {
  stateVersion: number;
  capacity: 2 | 3 | 4;
  seats: Omit<Seat, "socketId">[];
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
}
