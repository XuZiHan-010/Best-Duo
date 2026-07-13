import { describe, expect, it, vi } from "vitest";
import type { PlayerCount, ProgressState, SeatId } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { InMemoryAgentRegistry } from "../src/agent/registry.js";
import { createScriptedAgent } from "../src/agent/scriptedAgent.js";
import { applyHintDecision, applyPlacement } from "../src/game/actions.js";
import { continueTurnOrHandoff } from "../src/game/handoff.js";
import { beginPlacement, enterDiscussion } from "../src/game/phases.js";
import { canStartGame, createGameRoom } from "../src/game/room.js";
import { privateHandForSeat, publicRoomState } from "../src/game/visibility.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const seatIds: SeatId[] = ["A", "B", "C", "D"];

const occupySeat = (room: ReturnType<typeof createGameRoom>, seatId: SeatId, nick = seatId) => {
  const seat = room.seats.find((candidate) => candidate.id === seatId);
  if (!seat) throw new Error(`Missing seat ${seatId}`);
  seat.nick = nick;
  seat.connected = true;
};

const makePlacingRoom = (playerCount: PlayerCount = 2) => {
  const room = createGameRoom(progress, 4);
  for (const seatId of seatIds.slice(0, playerCount)) occupySeat(room, seatId);
  room.phase = "levelSelect";
  enterDiscussion(room, loadLevels()[0]);
  beginPlacement(room);
  return room;
};

describe("actions and visibility", () => {
  it("starts with four seats but can start once two connected humans are ready", () => {
    const room = createGameRoom(progress, 4);

    expect(room.capacity).toBe(4);
    expect(room.seats).toHaveLength(4);
    expect(canStartGame(room)).toBe(false);

    occupySeat(room, "A", "Alice");
    room.ready.A = true;
    expect(canStartGame(room)).toBe(false);

    occupySeat(room, "B", "Bob");
    expect(canStartGame(room)).toBe(false);

    room.ready.B = true;
    expect(canStartGame(room)).toBe(true);
  });

  it("deals two-player hands by occupied count even in a four-seat room", () => {
    const room = makePlacingRoom();
    const hand = privateHandForSeat(room, "A");

    expect(room.seats).toHaveLength(4);
    expect(room.hands.A).toHaveLength(6);
    expect(room.hands.B).toHaveLength(6);
    expect(room.hands.C).toBeUndefined();
    expect(room.hands.D).toBeUndefined();
    expect(hand.map((card) => card.value !== undefined)).toEqual([false, true, true, true, true, false]);
    expect(hand.map((card) => card.color !== undefined)).toEqual([false, true, true, true, true, false]);
  });

  it("deals three- and four-player hands with full owner visibility", () => {
    for (const playerCount of [3, 4] as const) {
      const room = makePlacingRoom(playerCount);
      const expectedHandSize = playerCount === 3 ? 4 : 3;

      for (const seatId of seatIds.slice(0, playerCount)) {
        expect(room.hands[seatId]).toHaveLength(expectedHandSize);
        expect(privateHandForSeat(room, seatId).every((card) => card.value !== undefined && card.color !== undefined)).toBe(true);
      }

      for (const seatId of seatIds.slice(playerCount)) {
        expect(room.hands[seatId]).toBeUndefined();
      }
    }
  });

  it("shows placed card color but hides value until a hint marker reveals it", () => {
    const room = makePlacingRoom();
    const cardId = room.hands.A![0].id;

    applyPlacement(room, "A", { cardId, segment: 0 });
    expect(publicRoomState(room).placements[0][0]).not.toHaveProperty("value");
    expect(publicRoomState(room).placements[0][0].color).toBeDefined();

    applyHintDecision(room, "A", "yes");
    expect(publicRoomState(room).placements[0][0].value).toBeDefined();
    expect(publicRoomState(room).placements[0][0].color).toBeDefined();
    expect(room.hintMarkers.used).toBe(1);
    expect(room.turn).toBe("B");
  });

  it("reveals remaining blind cards only after both two-player seats have played two cards", () => {
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

  it("continues the turn without a hint prompt when no hint markers remain", () => {
    const room = makePlacingRoom();
    room.hintMarkers.used = room.hintMarkers.total;

    applyPlacement(room, "A", { cardId: room.hands.A![0].id, segment: 0 });

    expect(room.pendingHint).toBeNull();
    expect(room.turn).toBe("B");
  });

  it("hands off an agent turn through the action layer and falls back to a human turn timer", async () => {
    const room = makePlacingRoom(3);
    const agentSeat = room.seats.find((seat) => seat.id === "C");
    if (!agentSeat) throw new Error("Missing agent seat");
    agentSeat.kind = "agent";
    agentSeat.agentId = "agent-c";
    room.turn = "C";

    const agentRegistry = new InMemoryAgentRegistry();
    agentRegistry.register("agent-c", createScriptedAgent());
    const afterRevealIfNeeded = vi.fn().mockResolvedValue(undefined);
    const startTurnTimer = vi.fn();

    await continueTurnOrHandoff(room, { afterRevealIfNeeded, startTurnTimer, agentRegistry });

    expect(room.placements.flat().some((card) => card.owner === "C")).toBe(true);
    expect(room.pendingHint).toBeNull();
    expect(room.turn).toBe("A");
    expect(startTurnTimer).toHaveBeenCalledTimes(1);
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
