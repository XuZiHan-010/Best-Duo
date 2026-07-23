import { describe, expect, it } from "vitest";
import type { Challenge, PlacedCard, ProgressState, SeatId } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { enterDiscussion } from "../src/game/phases.js";
import { revealAndScore } from "../src/game/reveal.js";
import { createGameRoom, softResetRoom } from "../src/game/room.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const makeChallenge = (id: string, levelIndex: number): Challenge => ({
  id,
  name: `测试关卡 ${id}`,
  levelIndex,
  difficulty: "★",
  segmentCount: 6,
  centerCap: "inf",
  playable: true,
  conditions: [{ type: "all-nonempty" }]
});

const makePlacedCard = (id: string, owner: SeatId, value: number): PlacedCard => ({
  id,
  owner,
  value,
  color: "white",
  revealed: false,
  placedAt: Date.now(),
  playOrder: 1
});

const makeRoomInLevelSelect = () => {
  const room = createGameRoom(progress, 4);
  room.phase = "levelSelect";
  return room;
};

describe("attempt identity lifecycle", () => {
  it("creates campaignId and playSessionId on room creation, with no active level run or attempt", () => {
    const room = createGameRoom(progress, 4);

    expect(room.identity.campaignId).toBeTruthy();
    expect(room.identity.playSessionId).toBeTruthy();
    expect(room.identity.levelRunId).toBeNull();
    expect(room.identity.attemptId).toBeNull();
  });

  it("starts a new attempt and a new level run when entering discussion for a level", () => {
    const room = makeRoomInLevelSelect();
    enterDiscussion(room, makeChallenge("level-01", 0));

    expect(room.identity.attemptId).toBeTruthy();
    expect(room.identity.levelRunId).toBeTruthy();
  });

  it("keeps levelRunId but issues a new attemptId when retrying the same level", () => {
    const room = makeRoomInLevelSelect();
    const challenge = makeChallenge("level-01", 0);
    enterDiscussion(room, challenge);
    const firstAttemptId = room.identity.attemptId;
    const firstLevelRunId = room.identity.levelRunId;

    room.phase = "result";
    enterDiscussion(room, challenge);

    expect(room.identity.attemptId).toBeTruthy();
    expect(room.identity.attemptId).not.toBe(firstAttemptId);
    expect(room.identity.levelRunId).toBe(firstLevelRunId);
  });

  it("opens a new level run when switching to a different level", () => {
    const room = makeRoomInLevelSelect();
    enterDiscussion(room, makeChallenge("level-01", 0));
    const firstLevelRunId = room.identity.levelRunId;

    room.phase = "result";
    enterDiscussion(room, makeChallenge("level-02", 1));

    expect(room.identity.levelRunId).toBeTruthy();
    expect(room.identity.levelRunId).not.toBe(firstLevelRunId);
  });

  it("closes the level run after a winning reveal so replaying the same level starts a new run", () => {
    const room = makeRoomInLevelSelect();
    const challenge = makeChallenge("level-01", 0);
    enterDiscussion(room, challenge);
    const firstLevelRunId = room.identity.levelRunId;

    room.placements = Array.from({ length: 6 }, (_unused, index) => [
      makePlacedCard(`card-${index}`, "A", index + 1)
    ]);
    revealAndScore(room);
    expect(room.revealResult?.pass).toBe(true);
    expect(room.identity.levelRunId).toBeNull();

    room.phase = "result";
    enterDiscussion(room, challenge);
    expect(room.identity.levelRunId).toBeTruthy();
    expect(room.identity.levelRunId).not.toBe(firstLevelRunId);
  });

  it("keeps the level run open after a failing reveal", () => {
    const room = makeRoomInLevelSelect();
    enterDiscussion(room, makeChallenge("level-01", 0));
    const firstLevelRunId = room.identity.levelRunId;

    room.placements = Array.from({ length: 6 }, (_unused, index) =>
      index === 0 ? [] : [makePlacedCard(`card-${index}`, "A", index + 1)]
    );
    revealAndScore(room);
    expect(room.revealResult?.pass).toBe(false);
    expect(room.identity.levelRunId).toBe(firstLevelRunId);
  });

  it("closes the level run and rotates playSessionId on soft reset", () => {
    const room = makeRoomInLevelSelect();
    enterDiscussion(room, makeChallenge("level-01", 0));

    softResetRoom(room);

    expect(room.identity.levelRunId).toBeNull();
    expect(room.identity.attemptId).toBeNull();
    expect(room.identity.campaignId).toBeTruthy();
  });
});
