import { randomUUID } from "node:crypto";
import type { SeatId } from "@take-time/shared";
import type { SeatMemoryView } from "./memory/attemptMemoryStore.js";
import type { StrategyRule } from "./memory/types.js";
import { publicRuleDraftSchema } from "./strategy/ruleSchemas.js";

const isSeatId = (value: string): value is SeatId =>
  value === "A" || value === "B" || value === "C" || value === "D";

// 策略收口失败（超时/取消/非法输出/Provider 错误）时的确定性兜底：
// 把讨论期实体管线确认为 explicit 的公开事实逐条翻译成 suggestion 强度的
// custom 规则（custom 无服务端解释器，与 planner 的强度封顶口径一致），
// 并保留可追溯的公开消息来源。不做任何推理或合成——模型不可用时兜底
// 必须完全可预测（2026-07-21 findings P0-2）。
export const buildPublicFactsFallback = (
  view: SeatMemoryView
): { rules: StrategyRule[]; privatePlan: string[] } => {
  const messageIdByObservationId = new Map<string, string>();
  for (const observation of view.sharedObservations) {
    if (observation.type !== "chat") continue;
    const messageId = (observation.payload as { messageId?: unknown })?.messageId;
    if (typeof messageId === "string") messageIdByObservationId.set(observation.id, messageId);
  }

  const rules: StrategyRule[] = [];
  for (const fact of view.sharedFacts) {
    if (fact.certainty !== "explicit") continue;
    const sourceMessageIds = fact.sourceObservationIds
      .map((id) => messageIdByObservationId.get(id))
      .filter((id): id is string => Boolean(id));
    // 兜底规则必须可追溯到公开消息；没有来源的事实不进入策略。
    if (sourceMessageIds.length === 0) continue;

    if (fact.entityType === "strategy_rule") {
      const parsed = publicRuleDraftSchema.safeParse(fact.value);
      if (parsed.success) {
        rules.push({
          ...parsed.data,
          id: randomUUID(),
          strength: parsed.data.strength === "unresolved" ? "unresolved" : "strong_preference",
          targetSegments: parsed.data.targetSegments.length > 0 ? parsed.data.targetSegments : undefined,
          sourceMessageIds
        });
        continue;
      }
    }

    const segment = fact.entityType === "segment" ? Number.parseInt(fact.entityId, 10) : Number.NaN;
    rules.push({
      id: randomUUID(),
      type: "custom",
      strength: "suggestion",
      targetSeatIds: fact.entityType === "seat" && isSeatId(fact.entityId) ? [fact.entityId] : [],
      ...(Number.isInteger(segment) && segment >= 0 && segment <= 5 ? { targetSegments: [segment] } : {}),
      parameters: {
        entityType: fact.entityType,
        entityId: fact.entityId,
        attribute: fact.attribute,
        value: fact.value
      },
      sourceMessageIds
    });
  }

  return {
    rules,
    privatePlan: rules.length > 0 ? ["策略收口失败，按讨论公开约定的事实兜底执行"] : []
  };
};
