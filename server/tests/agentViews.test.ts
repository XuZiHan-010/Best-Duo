import { describe, expect, it } from "vitest";
import type { PlayerCount, ProgressState, SeatId } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { AttemptMemoryStore } from "../src/agent/memory/attemptMemoryStore.js";
import { buildDiscussionView, buildTurnView } from "../src/agent/views.js";
import { appendChatMessage } from "../src/game/chat.js";
import { applyPlacement } from "../src/game/actions.js";
import { beginPlacement, enterDiscussion } from "../src/game/phases.js";
import { createGameRoom } from "../src/game/room.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const seatIds: SeatId[] = ["A", "B", "C", "D"];

const occupySeat = (room: ReturnType<typeof createGameRoom>, seatId: SeatId) => {
  const seat = room.seats.find((candidate) => candidate.id === seatId);
  if (!seat) throw new Error(`Missing seat ${seatId}`);
  seat.nick = seatId;
  seat.connected = true;
};

const makeDiscussionRoom = (playerCount: PlayerCount = 2) => {
  const room = createGameRoom(progress, 4);
  for (const seatId of seatIds.slice(0, playerCount)) occupySeat(room, seatId);
  room.phase = "levelSelect";
  enterDiscussion(room, loadLevels()[0]);
  return room;
};

const makePlacingRoom = (playerCount: PlayerCount = 2) => {
  const room = makeDiscussionRoom(playerCount);
  beginPlacement(room);
  return room;
};

describe("agent views", () => {
  it("builds a discussion view scoped to the current attempt without any hand data", () => {
    const room = makeDiscussionRoom();
    appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "区6我来放大牌" });
    room.chat.push({
      id: "stale",
      attemptId: "old-attempt",
      senderSeatId: "B",
      kind: "human",
      nick: "B",
      text: "旧消息",
      ts: Date.now()
    });

    const view = buildDiscussionView(room, "B");

    expect(view.seatId).toBe("B");
    expect(view.attemptId).toBe(room.identity.attemptId);
    expect(view.chat).toHaveLength(1);
    expect(view.chat[0].text).toBe("区6我来放大牌");
    expect(view.level?.id).toBe(loadLevels()[0].id);
    expect("hand" in view).toBe(false);
  });

  it("never serializes hand card values into the discussion view even when hands exist", () => {
    const room = makePlacingRoom();
    const allHandValues = Object.values(room.hands).flatMap((hand) => hand.map((card) => card.id));

    const serialized = JSON.stringify(buildDiscussionView(room, "A"));

    expect(serialized).not.toContain('"hand"');
    for (const cardId of allHandValues) {
      expect(serialized).not.toContain(cardId);
    }
  });

  it("builds a turn view with only the seat's own masked hand", () => {
    const room = makePlacingRoom();

    const view = buildTurnView(room, "A");

    expect(view.seatId).toBe("A");
    expect(view.attemptId).toBe(room.identity.attemptId);
    expect(view.phaseVersion).toBe(room.phaseVersion);
    expect(view.turnVersion).toBe(room.turnVersion);
    expect(view.hand).toHaveLength(6);
    // 双人局盲牌：首尾两张自己不可见数值。
    expect(view.hand.map((card) => card.value !== undefined)).toEqual([false, true, true, true, true, false]);

    const serialized = JSON.stringify(view);
    for (const card of room.hands.B ?? []) {
      expect(serialized).not.toContain(card.id);
    }
  });

  it("injects public facts and the retry brief into the discussion view when memory is provided", () => {
    const room = makeDiscussionRoom();
    const levelId = loadLevels()[0].id;
    const store = new AttemptMemoryStore();

    // 上一 attempt 失败并生成 brief；当前 attempt 同 run 同关，继承该 brief。
    store.beginAttempt({
      campaignId: room.identity.campaignId,
      playSessionId: room.identity.playSessionId,
      levelRunId: room.identity.levelRunId!,
      levelId,
      attemptId: "previous-attempt"
    });
    store.finishAttempt({ passedSegments: [0], failedSegments: [5], failureReason: "rule-unmet" });
    store.beginAttempt({
      campaignId: room.identity.campaignId,
      playSessionId: room.identity.playSessionId,
      levelRunId: room.identity.levelRunId!,
      levelId,
      attemptId: room.identity.attemptId!
    });

    const message = appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "区6我来" });
    const observation = store.recordObservation({
      attemptId: room.identity.attemptId!,
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "chat",
      visibility: "public",
      sourceSeatId: "A",
      payload: { messageId: message.id, text: message.text }
    });
    store.upsertFact({
      entityType: "commitment",
      entityId: "seat:A",
      attribute: "承诺",
      value: "区6 放大牌",
      certainty: "explicit",
      sourceObservationIds: [observation.id]
    });

    const view = buildDiscussionView(room, "B", store);

    expect(view.publicFacts).toHaveLength(1);
    expect(view.publicFacts?.[0].entityId).toBe("seat:A");
    expect(view.publicFacts?.[0].sourceMessageIds).toEqual([message.id]);
    expect(view.retryBrief?.sourceAttemptId).toBe("previous-attempt");
    expect(view.retryBrief?.failureReason).toBe("rule-unmet");
    expect(view.retryBrief?.failedSegments).toEqual([5]);
  });

  it("omits memory context when the store is on a different attempt", () => {
    const room = makeDiscussionRoom();
    const store = new AttemptMemoryStore();
    store.beginAttempt({
      campaignId: room.identity.campaignId,
      playSessionId: room.identity.playSessionId,
      levelRunId: room.identity.levelRunId!,
      levelId: loadLevels()[0].id,
      attemptId: "some-other-attempt"
    });

    const view = buildDiscussionView(room, "B", store);

    expect(view.publicFacts).toBeUndefined();
    expect(view.retryBrief).toBeUndefined();
  });

  it("masks unrevealed table card values in the turn view", () => {
    const room = makePlacingRoom();
    const card = room.hands.A?.find((candidate) => candidate.visibleToOwner);
    if (!card) throw new Error("expected a visible card");
    room.turn = "A";
    applyPlacement(room, "A", { cardId: card.id, segment: 0 });

    const view = buildTurnView(room, "B");
    const placed = view.placements[0][0];

    expect(placed.color).toBeDefined();
    expect(placed.value).toBeUndefined();
  });

  it("injects only the current seat's locked strategy and private memory into TurnView", () => {
    const room = makePlacingRoom();
    const store = new AttemptMemoryStore();
    store.beginAttempt({
      campaignId: room.identity.campaignId,
      playSessionId: room.identity.playSessionId,
      levelRunId: room.identity.levelRunId!,
      levelId: room.currentChallenge!.id,
      attemptId: room.identity.attemptId!
    });
    const ruleFor = (id: string, seatId: SeatId) => ({
      id,
      type: "segment_assignment" as const,
      strength: "suggestion" as const,
      targetSeatIds: [seatId],
      targetSegments: [0],
      parameters: {},
      sourceMessageIds: []
    });
    store.setStrategyDraft("A", { rules: [ruleFor("rule-a", "A")], privatePlan: ["A-private-plan"] });
    store.lockStrategy("A");
    store.setStrategyDraft("B", { rules: [ruleFor("rule-b", "B")], privatePlan: ["B-private-plan"] });
    store.lockStrategy("B");
    store.addBelief("A", {
      subject: "segment-1",
      hypothesis: "A-only-belief",
      confidence: 0.7,
      evidenceObservationIds: []
    });
    store.addBelief("B", {
      subject: "segment-2",
      hypothesis: "B-secret-belief",
      confidence: 0.8,
      evidenceObservationIds: []
    });

    const view = buildTurnView(room, "A", store);
    const serialized = JSON.stringify(view);

    expect(view.memory?.lockedSeatStrategy?.rules.map((rule) => rule.id)).toEqual(["rule-a"]);
    expect(view.memory?.lockedSeatStrategy?.privatePlan).toEqual(["A-private-plan"]);
    expect(serialized).toContain("A-only-belief");
    expect(serialized).not.toContain("rule-b");
    expect(serialized).not.toContain("B-private-plan");
    expect(serialized).not.toContain("B-secret-belief");
  });
});
