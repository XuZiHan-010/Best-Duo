import { describe, expect, it } from "vitest";
import { AttemptMemoryStore } from "../src/agent/memory/attemptMemoryStore.js";
import type { StrategyRule } from "../src/agent/memory/types.js";

const identity = (attemptId: string, levelRunId = "run-1", levelId = "level-01") => ({
  campaignId: "campaign-1",
  playSessionId: "session-1",
  levelRunId,
  levelId,
  attemptId
});

const publicRule = (id: string, strength: StrategyRule["strength"], sourceMessageIds: string[] = ["msg-1"]): StrategyRule => ({
  id,
  type: "segment_assignment",
  strength,
  targetSeatIds: ["A"],
  targetSegments: [5],
  parameters: {},
  sourceMessageIds
});

describe("AttemptMemoryStore", () => {
  it("shares public observations with every seat but keeps private observations per seat", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));

    store.recordObservation({
      attemptId: "attempt-1",
      phaseVersion: 1,
      turnVersion: 1,
      type: "chat",
      visibility: "public",
      sourceSeatId: "A",
      payload: { text: "区6我来" }
    });
    store.recordObservation({
      attemptId: "attempt-1",
      phaseVersion: 1,
      turnVersion: 1,
      type: "card_revealed",
      visibility: { seatId: "B" },
      payload: { cardId: "card-9" }
    });

    const forA = store.observationsFor("A");
    const forB = store.observationsFor("B");

    expect(forA).toHaveLength(1);
    expect(forA[0].type).toBe("chat");
    expect(forB).toHaveLength(2);
  });

  it("rejects observations for a stale attemptId", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));

    expect(() =>
      store.recordObservation({
        attemptId: "attempt-0",
        phaseVersion: 1,
        turnVersion: 1,
        type: "chat",
        visibility: "public",
        payload: {}
      })
    ).toThrow();
  });

  it("drops all previous private memory when a new attempt begins", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));
    store.setStrategyDraft("A", { rules: [publicRule("rule-1", "hard_commitment")], privatePlan: ["先占区6"] });
    store.lockStrategy("A");
    store.addBelief("A", {
      subject: "seat:B",
      hypothesis: "B 拿到大牌",
      confidence: 0.6,
      evidenceObservationIds: []
    });

    store.beginAttempt(identity("attempt-2"));

    expect(store.strategyFor("A")).toBeNull();
    expect(store.beliefsFor("A")).toHaveLength(0);
    expect(store.observationsFor("A")).toHaveLength(0);
  });

  it("keeps each seat's locked strategy and beliefs isolated from other seats", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));
    store.setStrategyDraft("A", { rules: [publicRule("rule-a", "strong_preference")], privatePlan: ["A 的私人计划"] });
    store.lockStrategy("A");
    store.setStrategyDraft("B", { rules: [publicRule("rule-b", "suggestion")], privatePlan: ["B 的私人计划"] });
    store.lockStrategy("B");

    const strategyA = store.strategyFor("A");
    const strategyB = store.strategyFor("B");

    expect(strategyA?.rules[0].id).toBe("rule-a");
    expect(strategyB?.rules[0].id).toBe("rule-b");
    expect(strategyA?.privatePlan).toEqual(["A 的私人计划"]);
    expect(JSON.stringify(strategyA)).not.toContain("B 的私人计划");
  });

  it("refuses to lock hard commitments that have no public source messages", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));
    store.setStrategyDraft("A", { rules: [publicRule("rule-1", "hard_commitment", [])], privatePlan: [] });

    expect(() => store.lockStrategy("A")).toThrow();
  });

  it("refuses shared facts without source observations", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));

    expect(() =>
      store.upsertFact({
        entityType: "commitment",
        entityId: "seat:A",
        attribute: "承诺",
        value: "区6 放大牌",
        certainty: "explicit",
        sourceObservationIds: []
      })
    ).toThrow();
  });

  it("generates a retry brief with only public strategy content", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));
    const source = store.recordObservation({
      attemptId: "attempt-1",
      phaseVersion: 1,
      turnVersion: 1,
      type: "chat",
      visibility: "public",
      sourceSeatId: "A",
      payload: { text: "我负责区6；纠正：不要在区1放大牌" }
    });
    store.upsertFact({
      entityType: "commitment",
      entityId: "seat:A",
      attribute: "承诺",
      value: "负责区6",
      certainty: "explicit",
      sourceObservationIds: [source.id]
    });
    store.upsertFact({
      entityType: "strategy_rule",
      entityId: "correction:1",
      attribute: "用户纠正",
      value: "不要在区1放大牌",
      certainty: "explicit",
      sourceObservationIds: [source.id]
    });
    store.setStrategyDraft("A", {
      rules: [
        publicRule("rule-public", "hard_commitment", ["msg-1"]),
        { ...publicRule("rule-private", "suggestion", []), parameters: { note: "私下猜测" } },
        publicRule("rule-open", "unresolved", ["msg-2"])
      ],
      privatePlan: ["不能进 brief 的私人计划"]
    });
    store.lockStrategy("A");

    const brief = store.finishAttempt({ passedSegments: [0, 1], failedSegments: [5] });

    expect(brief?.sourceAttemptId).toBe("attempt-1");
    expect(brief?.levelId).toBe("level-01");
    expect(brief?.passedSegments).toEqual([0, 1]);
    expect(brief?.failedSegments).toEqual([5]);
    expect(brief?.publicStrategySummary.map((rule) => rule.id)).toEqual(["rule-public"]);
    expect(brief?.publicCommitments).toEqual(["负责区6"]);
    expect(brief?.userCorrections).toEqual(["不要在区1放大牌"]);
    expect(brief?.lessons).toHaveLength(1);
    expect(brief?.unresolvedIssues.length).toBeGreaterThan(0);
    expect(JSON.stringify(brief)).not.toContain("私人计划");
  });

  it("exposes a seat-scoped read-only view without other seats' private memory", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));
    store.recordObservation({
      attemptId: "attempt-1",
      phaseVersion: 1,
      turnVersion: 1,
      type: "chat",
      visibility: "public",
      sourceSeatId: "A",
      payload: { text: "公开发言" }
    });
    store.recordObservation({
      attemptId: "attempt-1",
      phaseVersion: 1,
      turnVersion: 1,
      type: "card_revealed",
      visibility: { seatId: "A" },
      payload: { note: "A 的私有观察" }
    });
    store.recordObservation({
      attemptId: "attempt-1",
      phaseVersion: 1,
      turnVersion: 1,
      type: "card_revealed",
      visibility: { seatId: "B" },
      payload: { note: "B 的私有观察" }
    });
    store.setStrategyDraft("A", { rules: [], privatePlan: ["A 的私人计划"] });
    store.lockStrategy("A");
    store.setStrategyDraft("B", { rules: [], privatePlan: ["B 的私人计划"] });
    store.lockStrategy("B");

    const view = store.viewForSeat("A");
    const serialized = JSON.stringify(view);

    expect(serialized).toContain("公开发言");
    expect(serialized).toContain("A 的私有观察");
    expect(serialized).toContain("A 的私人计划");
    expect(serialized).not.toContain("B 的私有观察");
    expect(serialized).not.toContain("B 的私人计划");
  });

  it("returns copies from viewForSeat so mutations cannot reach the store", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));
    store.recordObservation({
      attemptId: "attempt-1",
      phaseVersion: 1,
      turnVersion: 1,
      type: "chat",
      visibility: "public",
      sourceSeatId: "A",
      payload: { text: "公开发言" }
    });
    store.setStrategyDraft("A", { rules: [publicRule("rule-a", "strong_preference")], privatePlan: ["原计划"] });
    store.lockStrategy("A");

    const view = store.viewForSeat("A");
    view.sharedObservations.length = 0;
    view.ownPrivateMemory.lockedSeatStrategy?.privatePlan.push("注入的计划");
    view.ownPrivateMemory.lockedSeatStrategy?.rules.push(publicRule("rule-injected", "hard_commitment"));

    expect(store.observationsFor("A")).toHaveLength(1);
    expect(store.strategyFor("A")?.privatePlan).toEqual(["原计划"]);
    expect(store.strategyFor("A")?.rules.map((rule) => rule.id)).toEqual(["rule-a"]);
  });

  it("feeds the retry brief only into a same-level retry attempt", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1", "run-1", "level-01"));
    store.setStrategyDraft("A", { rules: [publicRule("rule-1", "hard_commitment")], privatePlan: [] });
    store.lockStrategy("A");
    store.finishAttempt({ passedSegments: [], failedSegments: [5] });

    const retry = store.beginAttempt(identity("attempt-2", "run-1", "level-01"));
    expect(retry.shared.retryBriefInput?.sourceAttemptId).toBe("attempt-1");

    store.finishAttempt({ passedSegments: [], failedSegments: [4] });
    const nextLevel = store.beginAttempt(identity("attempt-3", "run-2", "level-02"));
    expect(nextLevel.shared.retryBriefInput).toBeUndefined();
  });

  it("records actions and commitments per seat and drops them when the seat is removed", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));
    store.recordOwnAction("A", { kind: "placement", payload: { segment: 5 }, appliedStrategyRuleIds: [] });
    const commitment = store.addPendingCommitment("A", {
      description: "负责区6",
      status: "pending",
      sourceMessageIds: ["msg-1"]
    });
    store.updatePendingCommitment("A", commitment.id, { status: "fulfilled", reason: "已落子" });

    expect(store.viewForSeat("A").ownPrivateMemory.ownActions).toHaveLength(1);
    expect(store.viewForSeat("A").ownPrivateMemory.pendingCommitments[0].status).toBe("fulfilled");

    store.dropSeat("A");
    expect(store.viewForSeat("A").ownPrivateMemory.ownActions).toHaveLength(0);
    expect(store.viewForSeat("A").ownPrivateMemory.pendingCommitments).toHaveLength(0);
  });

  it("clears current private memory and retry history when a play session ends", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt(identity("attempt-1"));
    store.finishAttempt({ passedSegments: [], failedSegments: [0] });

    store.clearSession();
    expect(store.currentAttempt()).toBeNull();

    const next = store.beginAttempt(identity("attempt-2"));
    expect(next.shared.retryBriefInput).toBeUndefined();
  });
});
