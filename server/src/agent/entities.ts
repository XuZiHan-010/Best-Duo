import { z } from "zod";
import type { SeatId } from "@take-time/shared";
import type { AttemptMemoryStore } from "./memory/attemptMemoryStore.js";
import type { MemoryFact } from "./memory/types.js";

// 模型只提出结构化实体候选；服务端负责 schema、可见性与来源校验。
const entityCandidateSchema = z.object({
  entityType: z.enum(["seat", "segment", "commitment", "strategy_rule"]),
  entityId: z.string().min(1),
  attribute: z.string().min(1),
  value: z.unknown(),
  certainty: z.enum(["explicit", "inferred"]),
  sourceObservationIds: z.array(z.string()).min(1)
});

export type EntityCandidate = z.infer<typeof entityCandidateSchema>;

export interface EntityIngestResult {
  accepted: MemoryFact[];
  rejected: Array<{ candidate: unknown; reason: string }>;
}

export const ingestEntityCandidates = (
  store: AttemptMemoryStore,
  proposerSeatId: SeatId,
  candidates: unknown[]
): EntityIngestResult => {
  const result: EntityIngestResult = { accepted: [], rejected: [] };
  const attempt = store.currentAttempt();
  if (!attempt) {
    return {
      accepted: [],
      rejected: candidates.map((candidate) => ({ candidate, reason: "no_active_attempt" }))
    };
  }

  const publicObservationIds = new Set(attempt.shared.observations.map((observation) => observation.id));

  for (const raw of candidates) {
    const parsed = entityCandidateSchema.safeParse(raw);
    if (!parsed.success) {
      result.rejected.push({ candidate: raw, reason: "schema_invalid" });
      continue;
    }
    const candidate = parsed.data;

    // 私有推断不得回写共享事实：所有来源必须是当前 attempt 的公开 observation。
    const nonPublicSource = candidate.sourceObservationIds.find((id) => !publicObservationIds.has(id));
    if (nonPublicSource !== undefined) {
      result.rejected.push({ candidate: raw, reason: `source_not_public:${nonPublicSource}` });
      continue;
    }

    const conflicting = store
      .sharedFacts()
      .filter(
        (fact) =>
          fact.entityType === candidate.entityType &&
          fact.entityId === candidate.entityId &&
          fact.attribute === candidate.attribute &&
          JSON.stringify(fact.value) !== JSON.stringify(candidate.value)
      );

    const fact = store.upsertFact({
      ...candidate,
      // 含义冲突时双方都标记 conflicted，不静默选择其中一条。
      certainty: conflicting.length > 0 ? "conflicted" : candidate.certainty
    });
    for (const previous of conflicting) {
      previous.certainty = "conflicted";
    }
    result.accepted.push(fact);
  }

  console.log(
    JSON.stringify({
      event: "memory:entities_ingested",
      proposerSeatId,
      accepted: result.accepted.length,
      rejected: result.rejected.length
    })
  );
  return result;
};
