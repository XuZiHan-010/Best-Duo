import type { CardColor, Challenge, SeatId, TurnView } from "@take-time/shared";
import { canCompleteSampledDeal, type FixedCardPlacement, type SolverCard } from "../../game/solver.js";
import type { CandidateAction } from "./types.js";

export const SAMPLING_VERSION = "possible-worlds-v2-deterministic";
// maxMs 只用于把运行预算映射为确定性的搜索节点数及记录实际耗时。
// 排序结果绝不能由机器负载或 performance.now() 的采样时机决定。
const SEARCH_NODES_PER_MS = 4_000;

interface CardSlot {
  id: string;
  owner: SeatId;
  color?: CardColor;
  value?: number;
}

export interface SamplingOptions {
  seed: string;
  worldCount: number;
  maxCandidates: number;
  maxMs: number;
}

export interface SamplingEvaluation {
  rates: Map<string, number>;
  requestedWorlds: number;
  generatedWorlds: number;
  evaluatedCandidates: number;
  evaluations: number;
  budgetExceeded: boolean;
  elapsedMs: number;
}

const actionKey = (action: CandidateAction) => `${action.cardId}:${action.segment}`;

const assertSafeTurnView = (view: TurnView): void => {
  const raw = view as unknown as Record<string, unknown>;
  if ("hands" in raw || "deck" in raw || !Array.isArray(raw.hand) || !Array.isArray(raw.placements)) {
    throw new TypeError("隐藏信息采样只接受经过遮蔽的 TurnView");
  }
};

const hashSeed = (seed: string): number => {
  let value = 2166136261;
  for (const char of seed) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
};

const createRng = (seed: string) => {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const slotsOf = (view: TurnView): CardSlot[] => {
  const slots: CardSlot[] = [];
  for (const segment of view.placements) {
    for (const card of segment) {
      slots.push({ id: card.id, owner: card.owner, color: card.color, value: card.value });
    }
  }
  for (const card of view.hand) {
    slots.push({ id: card.id, owner: card.owner, color: card.color, value: card.value });
  }

  const handSize = 12 / view.seats.length;
  for (const seat of view.seats) {
    if (seat.id === view.seatId) continue;
    const remaining = handSize - (view.playedCount[seat.id] ?? 0);
    for (let index = 0; index < remaining; index += 1) {
      slots.push({ id: `sample-hidden-${seat.id}-${index}`, owner: seat.id });
    }
  }
  if (slots.length !== 12) throw new Error(`TurnView 无法重建 12 张牌的可能世界：${slots.length}`);
  return slots;
};

const sampleWorld = (slots: CardSlot[], rng: () => number): SolverCard[] | null => {
  const pool: Array<{ value: number; color: CardColor }> = [];
  for (const color of ["white", "black"] as const) {
    for (let value = 1; value <= 12; value += 1) pool.push({ color, value });
  }

  const ordered = [...slots].sort((left, right) => {
    const specificity = (slot: CardSlot) => (slot.value !== undefined ? 2 : slot.color !== undefined ? 1 : 0);
    return specificity(right) - specificity(left) || left.id.localeCompare(right.id);
  });
  const result: SolverCard[] = [];
  for (const slot of ordered) {
    const matching = pool
      .map((card, index) => ({ card, index }))
      .filter(({ card }) =>
        (slot.color === undefined || card.color === slot.color) &&
        (slot.value === undefined || card.value === slot.value)
      );
    if (matching.length === 0) return null;
    const selected = matching[Math.floor(rng() * matching.length)]!;
    pool.splice(selected.index, 1);
    result.push({ id: slot.id, owner: slot.owner, ...selected.card });
  }
  return result;
};

const challengeOf = (view: TurnView): Challenge | null =>
  view.level ? { ...view.level, segmentCount: 6 } : null;

export const evaluatePossibleWorlds = (
  view: TurnView,
  candidates: CandidateAction[],
  options: SamplingOptions
): SamplingEvaluation => {
  assertSafeTurnView(view);
  const startedAt = performance.now();
  const challenge = challengeOf(view);
  const rates = new Map<string, number>();
  if (!challenge || candidates.length === 0 || options.worldCount <= 0 || options.maxCandidates <= 0) {
    return {
      rates,
      requestedWorlds: options.worldCount,
      generatedWorlds: 0,
      evaluatedCandidates: 0,
      evaluations: 0,
      budgetExceeded: false,
      elapsedMs: performance.now() - startedAt
    };
  }

  const slots = slotsOf(view);
  const worlds: SolverCard[][] = [];
  for (let index = 0; index < options.worldCount; index += 1) {
    const world = sampleWorld(slots, createRng(`${options.seed}:world:${index}`));
    if (world) worlds.push(world);
  }

  const fixedPublic: FixedCardPlacement[] = [];
  view.placements.forEach((segment, segmentIndex) => {
    segment.forEach((card) => fixedPublic.push({ cardId: card.id, segment: segmentIndex }));
  });
  const seatIds = view.seats.map((seat) => seat.id);
  let evaluations = 0;
  let evaluatedCandidates = 0;
  let budgetExceeded = false;
  const candidateBatch = candidates.slice(0, options.maxCandidates);
  const plannedEvaluations = Math.max(1, worlds.length * candidateBatch.length);
  const maxNodesPerEvaluation = Math.max(
    1,
    Math.floor((Math.max(0, options.maxMs) * SEARCH_NODES_PER_MS) / plannedEvaluations)
  );
  for (const candidate of candidateBatch) {
    let successes = 0;
    let samples = 0;
    for (const world of worlds) {
      evaluations += 1;
      const fixed = [...fixedPublic, { cardId: candidate.cardId, segment: candidate.segment }];
      const result = canCompleteSampledDeal(challenge, world, seatIds, fixed, {
        maxNodes: maxNodesPerEvaluation
      });
      if (result.budgetExceeded) {
        budgetExceeded = true;
        continue;
      }
      samples += 1;
      if (result.solvable) {
        successes += 1;
      }
    }
    if (samples > 0) {
      rates.set(actionKey(candidate), successes / samples);
      evaluatedCandidates += 1;
    }
  }

  const elapsedMs = performance.now() - startedAt;
  return {
    rates,
    requestedWorlds: options.worldCount,
    generatedWorlds: worlds.length,
    evaluatedCandidates,
    evaluations,
    // 实际耗时超出目标只作为 telemetry 告警；候选贡献由固定节点预算决定，
    // 因此相同 view + seed 在不同机器负载下仍得到相同排序。
    budgetExceeded: budgetExceeded || elapsedMs > Math.max(0, options.maxMs),
    elapsedMs
  };
};

export const samplingActionKey = actionKey;
