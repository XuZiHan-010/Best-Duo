import type { CardColor, GameRoom, Phase, RevealResult, SeatId } from "@take-time/shared";
import { defaultSettings } from "../config.js";
import { buildTurnView } from "../agent/views.js";
import { applyHintDecision, applyPlacement } from "../game/actions.js";
import { beginPlacement, enterDiscussion } from "../game/phases.js";
import { enterResultAfterReveal, revealAndScore } from "../game/reveal.js";
import { createGameRoom, occupiedSeats, totalPlacedCards } from "../game/room.js";
import { loadLevels } from "../levels/loadLevels.js";
import type { EvalFixture } from "./fixtures.js";
import { createSeededRng } from "./rng.js";
import type { SeatPolicy, SeatPolicyDecision } from "./seatPolicies.js";
import { isPlacementProvablyLosing } from "../agent/safePolicy.js";
import { decideHintFromBelief, inferHiddenCardBeliefs } from "../agent/belief/valueBelief.js";
import {
  auditBeliefPhysicalConsistency,
  auditHintReasonableness,
  auditPlacementReasonableness,
  type ActualCardValue
} from "./reasonablenessAudit.js";

export interface RunnerDeps {
  createPolicy: (
    seatId: SeatId,
    policyName: string,
    context: { samplingRng: () => number; samplingSeed: string }
  ) => SeatPolicy;
}

export interface AttemptReport {
  pass: boolean;
  phase: Phase;
  revealResult: RevealResult | null;
  segmentSums: number[];
  totalPlacedCards: number;
  dealtHands: Partial<Record<SeatId, Array<{ value: number; color: CardColor }>>>;
  actions: Array<{ seatId: SeatId; cardId: string; segment: number; revealIntent: "yes" | "no" }>;
  audits: {
    reasonablePlacements: boolean[];
    reasonableHints: boolean[];
    consistentBeliefs: boolean[];
  };
}

export interface SingleStepReport {
  decision: SeatPolicyDecision;
  seatId: SeatId;
  totalPlacedCards: number;
  phase: Phase;
  provablyLosing: boolean;
  hintReasonable: boolean;
  beliefConsistent: boolean;
}

const seatOrder: SeatId[] = ["A", "B", "C", "D"];

// 不经 Socket，直接驱动动作层搭好一局到出牌阶段。
const setupPlacingRoom = (fixture: EvalFixture) => {
  const levels = loadLevels();
  const challenge = levels.find((level) => level.id === fixture.levelId);
  if (!challenge) throw new Error(`未知关卡：${fixture.levelId}`);

  const room = createGameRoom(
    { schemaVersion: 1, clearedLevels: [], settings: defaultSettings },
    levels
  );
  for (const seatId of seatOrder.slice(0, fixture.playerCount)) {
    const seat = room.seats.find((candidate) => candidate.id === seatId);
    if (!seat) throw new Error(`Missing seat ${seatId}`);
    seat.nick = `eval-${seatId}`;
    seat.connected = true;
  }

  room.phase = "levelSelect";
  enterDiscussion(room, challenge);
  beginPlacement(room, { dealRng: createSeededRng(fixture.dealSeed) });
  return room;
};

const buildPolicies = (fixture: EvalFixture, deps: RunnerDeps) => {
  const policies = new Map<SeatId, SeatPolicy>();
  for (const seatId of seatOrder.slice(0, fixture.playerCount)) {
    const samplingSeed = `${fixture.samplingSeed}:${seatId}`;
    policies.set(
      seatId,
      deps.createPolicy(seatId, fixture.seatPolicies[seatId] ?? "scripted", {
        samplingSeed,
        samplingRng: createSeededRng(samplingSeed)
      })
    );
  }
  return policies;
};

const policyFor = (policies: Map<SeatId, SeatPolicy>, seatId: SeatId): SeatPolicy => {
  const policy = policies.get(seatId);
  if (!policy) throw new Error(`座位 ${seatId} 没有配置 policy`);
  return policy;
};

const nextActor = (room: GameRoom): SeatId | null => {
  if (room.turn === "race") return occupiedSeats(room)[0]?.id ?? null;
  return room.turn;
};

const snapshotHands = (room: GameRoom): AttemptReport["dealtHands"] => {
  const hands: AttemptReport["dealtHands"] = {};
  for (const [seatId, cards] of Object.entries(room.hands)) {
    hands[seatId as SeatId] = cards.map((card) => ({ value: card.value, color: card.color }));
  }
  return hands;
};

const actualCardValues = (room: GameRoom): Map<string, ActualCardValue> =>
  new Map(
    [
      ...Object.values(room.hands).flat(),
      ...room.placements.flat()
    ].map((card) => [card.id, { id: card.id, value: card.value, color: card.color }])
  );

export const runAttempt = async (fixture: EvalFixture, deps: RunnerDeps): Promise<AttemptReport> => {
  const room = setupPlacingRoom(fixture);
  const policies = buildPolicies(fixture, deps);
  const dealtHands = snapshotHands(room);
  const actions: AttemptReport["actions"] = [];
  const audits: AttemptReport["audits"] = {
    reasonablePlacements: [],
    reasonableHints: [],
    consistentBeliefs: []
  };

  while (room.phase === "placing") {
    if (room.pendingHint) {
      const seatId = room.pendingHint.seatId;
      const decision = await policyFor(policies, seatId).decideHint(buildTurnView(room, seatId));
      applyHintDecision(room, seatId, decision);
      continue;
    }

    const actor = nextActor(room);
    if (!actor) break;

    const view = buildTurnView(room, actor);
    const decision = await policyFor(policies, actor).decideTurn(view);
    audits.reasonablePlacements.push(auditPlacementReasonableness(view, decision));
    audits.reasonableHints.push(auditHintReasonableness(view, decision));
    actions.push({ seatId: actor, ...decision });
    applyPlacement(room, actor, { cardId: decision.cardId, segment: decision.segment });
    audits.consistentBeliefs.push(
      ...auditBeliefPhysicalConsistency(buildTurnView(room, actor), actualCardValues(room))
    );
  }

  revealAndScore(room);
  enterResultAfterReveal(room);

  return {
    pass: room.revealResult?.pass ?? false,
    phase: room.phase,
    revealResult: room.revealResult,
    segmentSums: room.revealResult?.segmentSums ?? [],
    totalPlacedCards: totalPlacedCards(room),
    dealtHands,
    actions,
    audits
  };
};

export const runSingleStep = async (fixture: EvalFixture, deps: RunnerDeps): Promise<SingleStepReport> => {
  const room = setupPlacingRoom(fixture);
  const policies = buildPolicies(fixture, deps);

  const actor = nextActor(room);
  if (!actor) throw new Error("没有可行动的座位");

  const view = buildTurnView(room, actor);
  const decision = await policyFor(policies, actor).decideTurn(view);
  const provablyLosing = isPlacementProvablyLosing(view, decision.cardId, decision.segment);
  const hintReasonable =
    decision.revealIntent === "no" || decideHintFromBelief(view, decision.cardId, decision.segment) === "yes";
  applyPlacement(room, actor, { cardId: decision.cardId, segment: decision.segment });
  const beliefConsistent = inferHiddenCardBeliefs(buildTurnView(room, actor)).every(
    (belief) => belief.status !== "inconsistent"
  );

  return {
    decision,
    seatId: actor,
    totalPlacedCards: totalPlacedCards(room),
    phase: room.phase,
    provablyLosing,
    hintReasonable,
    beliefConsistent
  };
};
