import type {
  AgentSeatInfo,
  Challenge,
  DiscussionView,
  GameRoom,
  LevelSummary,
  PublicPlacedCard,
  SeatId,
  SegmentKnowledge,
  TurnView
} from "@take-time/shared";
import { chatForCurrentAttempt } from "../game/chat.js";
import { privateHandForSeat, publicPlacements } from "../game/visibility.js";
import type { AttemptMemoryStore } from "./memory/attemptMemoryStore.js";
import { deriveTurnState } from "./memory/derivedState.js";
import { inferHiddenCardBeliefs } from "./belief/valueBelief.js";

const levelSummaryOf = (challenge: Challenge | null): LevelSummary | null =>
  challenge
    ? {
        id: challenge.id,
        name: challenge.name,
        levelIndex: challenge.levelIndex,
        difficulty: challenge.difficulty,
        centerCap: challenge.centerCap,
        playable: challenge.playable,
        conditions: challenge.conditions,
        ...(challenge.notes ? { notes: challenge.notes } : {})
      }
    : null;

const seatInfos = (room: GameRoom): AgentSeatInfo[] =>
  room.seats
    .filter((seat) => Boolean(seat.nick))
    .map((seat) => ({ id: seat.id, kind: seat.kind, nick: seat.nick }));

const requireAttemptId = (room: GameRoom): string => {
  const attemptId = room.identity.attemptId;
  if (!attemptId) throw new Error("当前没有进行中的 attempt");
  return attemptId;
};

// 实体与 RetryBrief 的受控注入：只在 store 的当前 attempt 与房间一致时生效，
// 且一律经由座位级只读投影读取（ACR-06 口径）。
const memoryContextFor = (
  room: GameRoom,
  seatId: SeatId,
  memory: AttemptMemoryStore
): Pick<DiscussionView, "publicFacts" | "retryBrief"> => {
  if (memory.currentAttempt()?.identity.attemptId !== room.identity.attemptId) return {};
  const seatView = memory.viewForSeat(seatId);

  const messageIdByObservationId = new Map<string, string>();
  for (const observation of seatView.sharedObservations) {
    if (observation.type !== "chat") continue;
    const messageId = (observation.payload as { messageId?: unknown })?.messageId;
    if (typeof messageId === "string") messageIdByObservationId.set(observation.id, messageId);
  }

  const publicFacts = seatView.sharedFacts.map((fact) => ({
    id: fact.id,
    entityType: fact.entityType,
    entityId: fact.entityId,
    attribute: fact.attribute,
    value: fact.value,
    certainty: fact.certainty,
    sourceObservationIds: [...fact.sourceObservationIds],
    sourceMessageIds: fact.sourceObservationIds
      .map((id) => messageIdByObservationId.get(id))
      .filter((id): id is string => Boolean(id))
  }));

  return {
    publicFacts,
    ...(seatView.retryBriefInput ? { retryBrief: seatView.retryBriefInput } : {})
  };
};

export const buildDiscussionView = (
  room: GameRoom,
  seatId: SeatId,
  memory?: AttemptMemoryStore,
  excludedMessageIds: ReadonlySet<string> = new Set()
): DiscussionView => ({
  seatId,
  attemptId: requireAttemptId(room),
  levelRunId: room.identity.levelRunId,
  phase: room.phase,
  level: levelSummaryOf(room.currentChallenge),
  settings: {
    discussionMinutes: room.settings.discussionMinutes,
    thinkSeconds: room.settings.thinkSeconds,
    hintMarkerCount: room.settings.hintMarkerCount
  },
  seats: seatInfos(room),
  chat: chatForCurrentAttempt(room).filter((message) => !excludedMessageIds.has(message.id)),
  timer: room.timer,
  ...(memory ? memoryContextFor(room, seatId, memory) : {})
});

// 每段公开派生统计（P1-3）：输入必须是已按可见性遮蔽的公开投影
// （publicPlacements），绝不接收服务端原始 placements——隐藏数值在
// 公开投影里根本不存在，此函数天然无法泄露真实总和。
const MIN_CARD_VALUE = 1;
const MAX_CARD_VALUE = 12;

export const segmentKnowledgeOf = (placements: PublicPlacedCard[][]): SegmentKnowledge[] =>
  Array.from({ length: 6 }, (_, segment) => {
    const cards = placements[segment] ?? [];
    let revealedSum = 0;
    let hiddenCount = 0;
    let blackCount = 0;
    let whiteCount = 0;
    for (const card of cards) {
      if (typeof card.value === "number") revealedSum += card.value;
      else hiddenCount += 1;
      if (card.color === "black") blackCount += 1;
      else if (card.color === "white") whiteCount += 1;
    }
    return {
      count: cards.length,
      revealedSum,
      hiddenCount,
      blackCount,
      whiteCount,
      sumLowerBound: revealedSum + hiddenCount * MIN_CARD_VALUE,
      sumUpperBound: revealedSum + hiddenCount * MAX_CARD_VALUE
    };
  });

export const buildTurnView = (room: GameRoom, seatId: SeatId, memory?: AttemptMemoryStore): TurnView => {
  const view: TurnView = ({
  seatId,
  attemptId: requireAttemptId(room),
  phaseVersion: room.phaseVersion,
  turnVersion: room.turnVersion,
  phase: room.phase,
  level: levelSummaryOf(room.currentChallenge),
  settings: {
    thinkSeconds: room.settings.thinkSeconds,
    hintMarkerCount: room.settings.hintMarkerCount
  },
  seats: seatInfos(room),
  hand: privateHandForSeat(room, seatId),
  ...(() => {
    const placements = publicPlacements(room);
    return { placements, segmentKnowledge: segmentKnowledgeOf(placements) };
  })(),
  hintMarkers: room.hintMarkers,
  turn: room.turn,
  pendingHint: room.pendingHint,
  playedCount: room.playedCount,
  ...(memory?.currentAttempt()?.identity.attemptId === room.identity.attemptId
    ? (() => {
        const privateMemory = memory.viewForSeat(seatId).ownPrivateMemory;
        const locked = privateMemory.lockedSeatStrategy;
        return {
          memory: {
            lockedSeatStrategy: locked
              ? { version: locked.version, rules: structuredClone(locked.rules), privatePlan: [...locked.privatePlan] }
              : null,
            ownActions: privateMemory.ownActions.map((action) => ({
              kind: action.kind,
              payload: structuredClone(action.payload),
              appliedStrategyRuleIds: [...action.appliedStrategyRuleIds]
            })),
            currentBeliefs: [...privateMemory.entityBeliefs, ...privateMemory.currentBeliefs].map((belief) => ({
              subject: belief.subject,
              hypothesis: belief.hypothesis,
              confidence: belief.confidence,
              evidenceObservationIds: [...belief.evidenceObservationIds]
            })),
            pendingCommitments: privateMemory.pendingCommitments.map((commitment) => ({
              id: commitment.id,
              ruleId: commitment.ruleId,
              description: commitment.description,
              status: commitment.status,
              ...(commitment.reason ? { reason: commitment.reason } : {}),
              sourceMessageIds: [...commitment.sourceMessageIds]
            }))
          }
        };
      })()
    : {})
  });
  if (view.memory) {
    view.memory.derivedState = deriveTurnState(view);
    view.memory.valueBeliefs = inferHiddenCardBeliefs(view);
  }
  return view;
};
