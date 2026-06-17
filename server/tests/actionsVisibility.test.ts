import { describe, expect, it, vi } from "vitest";
import type { ProgressState, Seat } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { applyHintDecision, applyPlacement } from "../src/game/actions.js";
import { continueTurnOrHandoff } from "../src/game/handoff.js";
import { beginPlacement, enterDiscussion } from "../src/game/phases.js";
import { createGameRoom } from "../src/game/room.js";
import { privateHandForSeat, publicRoomState } from "../src/game/visibility.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const occupiedSeat = (id: "A" | "B", nick: string): Seat => ({
  id,
  kind: "human",
  nick,
  connected: true
});

const makePlacingRoom = () => {
  const room = createGameRoom(progress, 4);
  room.seats = [occupiedSeat("A", "Alice"), occupiedSeat("B", "Bob")];
  room.phase = "levelSelect";
  enterDiscussion(room, loadLevels()[0]);
  beginPlacement(room);
  return room;
};

describe("actions and visibility", () => {
  it("deals two-player hands with owner-only blind card visibility", () => {
    const room = makePlacingRoom();
    const hand = privateHandForSeat(room, "A");

    expect(hand).toHaveLength(6);
    expect(hand.map((card) => card.value !== undefined)).toEqual([false, true, true, true, true, false]);
    expect(hand.map((card) => card.color !== undefined)).toEqual([false, true, true, true, true, false]);
  });

  it("hides placed cards until a hint marker reveals them", () => {
    const room = makePlacingRoom();
    const cardId = room.hands.A![0].id;

    applyPlacement(room, "A", { cardId, segment: 0 });
    expect(publicRoomState(room).placements[0][0]).not.toHaveProperty("value");
    expect(publicRoomState(room).placements[0][0]).not.toHaveProperty("color");

    applyHintDecision(room, "A", "yes");
    expect(publicRoomState(room).placements[0][0].value).toBeDefined();
    expect(publicRoomState(room).placements[0][0].color).toBeDefined();
    expect(room.hintMarkers.used).toBe(1);
    expect(room.turn).toBe("B");
  });

  it("reveals remaining blind cards only after both players have played two cards", () => {
    const room = makePlacingRoom();

    applyPlacement(room, "A", { cardId: room.hands.A![0].id, segment: 0 });
    applyHintDecision(room, "A", "no");
    applyPlacement(room, "B", { cardId: room.hands.B![0].id, segment: 1 });
    applyHintDecision(room, "B", "no");
    applyPlacement(room, "A", { cardId: room.hands.A![0].id, segment: 2 });
    applyHintDecision(room, "A", "no");

    expect(privateHandForSeat(room, "A").some((card) => card.value === undefined || card.color === undefined)).toBe(true);
    expect(privateHandForSeat(room, "B").some((card) => card.value === undefined || card.color === undefined)).toBe(true);

    applyPlacement(room, "B", { cardId: room.hands.B![0].id, segment: 3 });

    expect(privateHandForSeat(room, "A").every((card) => card.value !== undefined && card.color !== undefined)).toBe(true);
    expect(privateHandForSeat(room, "B").every((card) => card.value !== undefined && card.color !== undefined)).toBe(true);
  });

  it("does not randomly hand off a disconnected player's turn", async () => {
    const room = makePlacingRoom();
    room.seats[1].connected = false;

    applyPlacement(room, "A", { cardId: room.hands.A![0].id, segment: 0 });
    applyHintDecision(room, "A", "no");
    expect(room.turn).toBe("B");

    const afterRevealIfNeeded = vi.fn().mockResolvedValue(undefined);
    const startTurnTimer = vi.fn();
    await continueTurnOrHandoff(room, { afterRevealIfNeeded, startTurnTimer });

    expect(room.placements.flat()).toHaveLength(1);
    expect(room.placements.flat().some((card) => card.owner === "B")).toBe(false);
    expect(room.pendingHint).toBeNull();
    expect(room.turn).toBe("B");
    expect(afterRevealIfNeeded).toHaveBeenCalledTimes(1);
    expect(startTurnTimer).toHaveBeenCalledTimes(1);
  });
});
