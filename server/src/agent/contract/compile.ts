import { createHash } from "node:crypto";
import type { DiscussionView, SeatId } from "@take-time/shared";
import type { StrategyRule } from "../memory/types.js";
import { publicRuleDraftSchema } from "../strategy/ruleSchemas.js";
import type { PublicClaim, PublicCoordinationContract } from "./types.js";

const semanticKey = (rule: Pick<StrategyRule, "type" | "targetSeatIds" | "targetSegments">): string =>
  JSON.stringify({
    type: rule.type,
    targetSeatIds: [...rule.targetSeatIds].sort(),
    // assignment 对同一座位只能有一个已确认主管集合；不同区段声明互相冲突。
    targetSegments:
      rule.type === "segment_assignment"
        ? "seat_assignment"
        : [...(rule.targetSegments ?? [])].sort((a, b) => a - b)
  });

const semanticValue = (rule: Pick<StrategyRule, "type" | "targetSegments" | "parameters">): string =>
  JSON.stringify({ targetSegments: rule.targetSegments ?? [], parameters: rule.parameters });

const stableId = (prefix: string, value: unknown): string =>
  `${prefix}-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;

export const compilePublicContract = (
  view: DiscussionView,
  previousRevision = 0
): PublicCoordinationContract => {
  const messageById = new Map(view.chat.map((message) => [message.id, message]));
  const candidates = (view.publicFacts ?? [])
    .filter((fact) => fact.entityType === "strategy_rule" && fact.certainty !== "conflicted")
    .flatMap((fact) => {
      const parsed = publicRuleDraftSchema.safeParse(fact.value);
      if (!parsed.success) return [];
      const sourceMessageIds = [...new Set([...fact.sourceMessageIds, ...parsed.data.sourceMessageIds])]
        .filter((id) => messageById.has(id));
      if (sourceMessageIds.length === 0) return [];
      const confirmedBySeatIds = sourceMessageIds
        .map((id) => messageById.get(id))
        .filter((message) => message?.kind === "human" && message.senderSeatId)
        .map((message) => message!.senderSeatId as SeatId);
      const confirmed = fact.attribute === "confirmed_rule" && confirmedBySeatIds.length > 0;
      const rule: StrategyRule = {
        ...parsed.data,
        id: stableId("rule", { factId: fact.id, rule: parsed.data }),
        strength: confirmed ? "hard_commitment" : parsed.data.strength === "unresolved" ? "unresolved" : "strong_preference",
        targetSegments: parsed.data.targetSegments.length > 0 ? parsed.data.targetSegments : undefined,
        sourceMessageIds
      };
      return [{ fact, rule, confirmedBySeatIds, confirmed }];
    });

  const valuesByKey = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const key = semanticKey(candidate.rule);
    const values = valuesByKey.get(key) ?? new Set<string>();
    values.add(semanticValue(candidate.rule));
    valuesByKey.set(key, values);
  }

  const claims: PublicClaim[] = candidates.map(({ rule, confirmedBySeatIds, confirmed }) => {
    const conflicted = (valuesByKey.get(semanticKey(rule))?.size ?? 0) > 1;
    const finalRule: StrategyRule = conflicted ? { ...rule, strength: "unresolved" } : rule;
    return {
      id: stableId("claim", { rule: finalRule, sources: finalRule.sourceMessageIds }),
      attemptId: view.attemptId,
      rule: finalRule,
      status: conflicted ? "conflicted" : confirmed ? "confirmed" : "proposed",
      confirmedBySeatIds: [...new Set(confirmedBySeatIds)],
      sourceMessageIds: [...finalRule.sourceMessageIds]
    };
  });

  const rules = claims.map((claim) => claim.rule);
  return {
    attemptId: view.attemptId,
    revision: previousRevision + 1,
    rules,
    claims,
    compiledAt: Date.now()
  };
};

export const contractRulesForSeat = (
  contract: PublicCoordinationContract,
  seatId: SeatId
): StrategyRule[] =>
  contract.rules
    .filter((rule) => rule.targetSeatIds.length === 0 || rule.targetSeatIds.includes(seatId))
    .map((rule) => structuredClone(rule));
