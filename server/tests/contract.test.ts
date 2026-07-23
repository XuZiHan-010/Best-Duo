import { describe, expect, it } from "vitest";
import type { DiscussionView } from "@take-time/shared";
import { compilePublicContract, contractRulesForSeat } from "../src/agent/contract/compile.js";

const rule = (target = 0) => ({
  type: "segment_assignment" as const,
  strength: "strong_preference" as const,
  targetSeatIds: ["B" as const],
  targetSegments: [target],
  parameters: {},
  sourceMessageIds: []
});

const view = (facts: DiscussionView["publicFacts"]): DiscussionView => ({
  seatId: "B",
  attemptId: "attempt-1",
  levelRunId: "run-1",
  phase: "discussion",
  level: null,
  settings: { discussionMinutes: 5, thinkSeconds: 10, hintMarkerCount: 3 },
  seats: [
    { id: "A", kind: "human", nick: "A" },
    { id: "B", kind: "agent", nick: "AI" }
  ],
  chat: [
    { id: "m-summary", attemptId: "attempt-1", senderSeatId: "B", kind: "agent", nick: "AI", text: "策略摘要", ts: 1 },
    { id: "m-confirm", attemptId: "attempt-1", senderSeatId: "A", kind: "human", nick: "A", text: "确认", ts: 2 }
  ],
  timer: null,
  publicFacts: facts
});

const fact = (
  id: string,
  attribute: "proposed_rule" | "confirmed_rule",
  value: unknown,
  sourceMessageIds: string[]
): NonNullable<DiscussionView["publicFacts"]>[number] => ({
  id,
  entityType: "strategy_rule",
  entityId: id,
  attribute,
  value,
  certainty: "explicit",
  sourceObservationIds: [`o-${id}`],
  sourceMessageIds
});

describe("public coordination contract", () => {
  it("keeps an unconfirmed summary soft and promotes a human-confirmed rule to hard", () => {
    const proposed = compilePublicContract(view([fact("f1", "proposed_rule", rule(), ["m-summary"])]));
    expect(proposed.rules[0]?.strength).toBe("strong_preference");

    const confirmed = compilePublicContract(
      view([fact("f2", "confirmed_rule", rule(), ["m-summary", "m-confirm"])]),
      proposed.revision
    );
    expect(confirmed.revision).toBe(2);
    expect(confirmed.claims[0]).toMatchObject({ status: "confirmed", confirmedBySeatIds: ["A"] });
    expect(confirmed.rules[0]?.strength).toBe("hard_commitment");
    expect(contractRulesForSeat(confirmed, "B")).toHaveLength(1);
    expect(contractRulesForSeat(confirmed, "A")).toHaveLength(0);
  });

  it("marks conflicting semantic claims unresolved instead of producing hard rules", () => {
    const contract = compilePublicContract(
      view([
        fact("f1", "confirmed_rule", rule(0), ["m-summary", "m-confirm"]),
        fact("f2", "confirmed_rule", rule(1), ["m-summary", "m-confirm"])
      ])
    );
    expect(contract.claims.every((claim) => claim.status === "conflicted")).toBe(true);
    expect(contract.rules.every((candidate) => candidate.strength === "unresolved")).toBe(true);
  });
});
