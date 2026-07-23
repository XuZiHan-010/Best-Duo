import { describe, expect, it } from "vitest";
import type { ProgressState } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { AttemptMemoryStore } from "../src/agent/memory/attemptMemoryStore.js";
import { recordRoomObservation } from "../src/agent/memory/recorders.js";
import { ingestEntityCandidates } from "../src/agent/entities.js";
import { enterDiscussion } from "../src/game/phases.js";
import { createGameRoom } from "../src/game/room.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const makeStoreAndRoom = () => {
  const room = createGameRoom(progress, 4);
  room.phase = "levelSelect";
  enterDiscussion(room, loadLevels()[0]);

  const store = new AttemptMemoryStore();
  store.beginAttempt({
    campaignId: room.identity.campaignId,
    playSessionId: room.identity.playSessionId,
    levelRunId: room.identity.levelRunId ?? "run-x",
    levelId: loadLevels()[0].id,
    attemptId: room.identity.attemptId ?? "attempt-x"
  });
  return { room, store };
};

describe("observation recorders", () => {
  it("records an observation stamped with current attempt and versions", () => {
    const { room, store } = makeStoreAndRoom();

    const observation = recordRoomObservation(store, room, {
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "chat",
      visibility: "public",
      sourceSeatId: "A",
      payload: { text: "hello" }
    });

    expect(observation).not.toBeNull();
    expect(observation?.attemptId).toBe(room.identity.attemptId);
    expect(store.observationsFor("B")).toHaveLength(1);
  });

  it("silently drops writes carrying stale phase or turn versions", () => {
    const { room, store } = makeStoreAndRoom();
    const staleVersion = room.phaseVersion;
    room.phaseVersion += 1;

    const observation = recordRoomObservation(store, room, {
      phaseVersion: staleVersion,
      turnVersion: room.turnVersion,
      type: "chat",
      visibility: "public",
      payload: {}
    });

    expect(observation).toBeNull();
    expect(store.observationsFor("A")).toHaveLength(0);
  });
});

describe("entity validation pipeline", () => {
  it("accepts candidates whose sources are existing public observations", () => {
    const { room, store } = makeStoreAndRoom();
    const observation = recordRoomObservation(store, room, {
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "chat",
      visibility: "public",
      sourceSeatId: "A",
      payload: { text: "我负责区6" }
    });

    const result = ingestEntityCandidates(store, "B", [
      {
        entityType: "commitment",
        entityId: "seat:A",
        attribute: "responsibility",
        value: "区6",
        certainty: "explicit",
        sourceObservationIds: [observation?.id]
      }
    ]);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(store.sharedFacts()).toHaveLength(1);
  });

  it("rejects candidates citing private or unknown observations", () => {
    const { room, store } = makeStoreAndRoom();
    const privateObservation = recordRoomObservation(store, room, {
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "card_revealed",
      visibility: { seatId: "B" },
      payload: { cardId: "card-1" }
    });

    const result = ingestEntityCandidates(store, "B", [
      {
        entityType: "seat",
        entityId: "seat:B",
        attribute: "hand-quality",
        value: "很好",
        certainty: "inferred",
        sourceObservationIds: [privateObservation?.id]
      },
      {
        entityType: "seat",
        entityId: "seat:C",
        attribute: "mood",
        value: "unknown",
        certainty: "inferred",
        sourceObservationIds: ["nonexistent-id"]
      }
    ]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
    expect(store.sharedFacts()).toHaveLength(0);
  });

  it("marks both facts conflicted when two sources disagree instead of silently picking one", () => {
    const { room, store } = makeStoreAndRoom();
    const first = recordRoomObservation(store, room, {
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "chat",
      visibility: "public",
      sourceSeatId: "A",
      payload: { text: "区6 放三张" }
    });
    const second = recordRoomObservation(store, room, {
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "chat",
      visibility: "public",
      sourceSeatId: "B",
      payload: { text: "区6 放两张" }
    });

    ingestEntityCandidates(store, "C", [
      {
        entityType: "segment",
        entityId: "segment:5",
        attribute: "target-count",
        value: 3,
        certainty: "explicit",
        sourceObservationIds: [first?.id]
      }
    ]);
    const result = ingestEntityCandidates(store, "C", [
      {
        entityType: "segment",
        entityId: "segment:5",
        attribute: "target-count",
        value: 2,
        certainty: "explicit",
        sourceObservationIds: [second?.id]
      }
    ]);

    expect(result.accepted).toHaveLength(1);
    const facts = store.sharedFacts().filter((fact) => fact.entityId === "segment:5");
    expect(facts).toHaveLength(2);
    expect(facts.every((fact) => fact.certainty === "conflicted")).toBe(true);
  });

  it("rejects malformed candidates", () => {
    const { store } = makeStoreAndRoom();

    const result = ingestEntityCandidates(store, "A", [{ entityType: "nonsense" }, "not-an-object"]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
  });
});
