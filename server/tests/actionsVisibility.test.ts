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
  it("public seats only expose whitelisted fields and never leak credentials", () => {
    const room = makePlacingRoom();
    room.seats[0].socketId = "socket-secret";
    room.seats[1].holdUntil = Date.now() + 60_000;

    const allowedKeys = new Set(["id", "kind", "nick", "avatar", "agentId", "connected"]);
    const publicSeats = publicRoomState(room).seats;

    for (const seat of publicSeats) {
      for (const key of Object.keys(seat)) {
        expect(allowedKeys.has(key), `PublicSeat 泄漏了字段 ${key}`).toBe(true);
      }
    }

    const serialized = JSON.stringify(publicRoomState(room));
    expect(serialized).not.toContain("socketId");
    expect(serialized).not.toContain("holdUntil");
    expect(serialized).not.toContain("playerId");
    expect(serialized.toLowerCase()).not.toContain("token");
    expect(serialized).not.toContain("isAdmin");
  });

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

    // 压线的这一手先结算提示窗口，剩余盲牌在 hint 决策完成前保持不可见。
    expect(room.pendingHint?.seatId).toBe("B");
    expect(privateHandForSeat(room, "A").some((card) => card.value === undefined || card.color === undefined)).toBe(true);
    expect(privateHandForSeat(room, "B").some((card) => card.value === undefined || card.color === undefined)).toBe(true);

    applyHintDecision(room, "B", "no");

    expect(privateHandForSeat(room, "A").every((card) => card.value !== undefined && card.color !== undefined)).toBe(true);
    expect(privateHandForSeat(room, "B").every((card) => card.value !== undefined && card.color !== undefined)).toBe(true);
  });

  it("reveals remaining blind cards at placement when no hint window opens", () => {
    const room = makePlacingRoom();

    applyPlacement(room, "A", { cardId: room.hands.A![0].id, segment: 0 });
    applyHintDecision(room, "A", "no");
    applyPlacement(room, "B", { cardId: room.hands.B![0].id, segment: 1 });
    applyHintDecision(room, "B", "no");
    applyPlacement(room, "A", { cardId: room.hands.A![0].id, segment: 2 });
    applyHintDecision(room, "A", "no");

    room.hintMarkers.used = room.hintMarkers.total;
    applyPlacement(room, "B", { cardId: room.hands.B![0].id, segment: 3 });

    expect(room.pendingHint).toBeNull();
    expect(privateHandForSeat(room, "A").every((card) => card.value !== undefined && card.color !== undefined)).toBe(true);
    expect(privateHandForSeat(room, "B").every((card) => card.value !== undefined && card.color !== undefined)).toBe(true);
  });

  it("hint window deadline follows the room's thinkSeconds setting", () => {
    const room = makePlacingRoom();
    room.settings.thinkSeconds = 30;

    const before = Date.now();
    applyPlacement(room, "A", { cardId: room.hands.A![0].id, segment: 0 });

    expect(room.pendingHint?.deadline).toBeGreaterThanOrEqual(before + 30_000);
    expect(room.pendingHint?.deadline).toBeLessThanOrEqual(Date.now() + 30_000);
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
    // Agent 回合开始一次，处理完其 hint 后切回真人再开始一次。
    expect(startTurnTimer).toHaveBeenCalledTimes(2);
  });
  it("lets an agent win the opening race and cancels the other race contenders", async () => {
    const room = makePlacingRoom(3);
    const agentSeat = room.seats.find((seat) => seat.id === "C");
    if (!agentSeat) throw new Error("Missing agent seat");
    agentSeat.kind = "agent";
    agentSeat.agentId = "agent-c";

    const agentRegistry = new InMemoryAgentRegistry();
    agentRegistry.register("agent-c", createScriptedAgent());
    const afterRevealIfNeeded = vi.fn().mockResolvedValue(undefined);
    const startTurnTimer = vi.fn();
    const onRaceWinner = vi.fn();

    await continueTurnOrHandoff(room, {
      afterRevealIfNeeded,
      startTurnTimer,
      agentRegistry,
      onRaceWinner,
      raceDelay: async () => undefined
    });

    expect(room.placements.flat()).toHaveLength(1);
    expect(room.placements.flat()[0]?.owner).toBe("C");
    expect(room.pendingHint).toBeNull();
    expect(room.turn).toBe("A");
    expect(onRaceWinner).toHaveBeenCalledWith("C");
    expect(startTurnTimer).toHaveBeenCalledTimes(2);
  });
  it("does not start a delayed race loser's decision after another agent has already won", async () => {
    const room = makePlacingRoom(4);
    const registry = new InMemoryAgentRegistry();
    let releaseDelayedLoser!: () => void;
    const delayedLoser = new Promise<void>((resolve) => {
      releaseDelayedLoser = resolve;
    });
    const decideC = vi.fn(async () => ({ cardId: room.hands.C![0].id, segment: 1 }));
    const decideD = vi.fn(async () => ({ cardId: room.hands.D![0].id, segment: 2 }));

    for (const seatId of ["C", "D"] as const) {
      const seat = room.seats.find((candidate) => candidate.id === seatId)!;
      seat.kind = "agent";
      seat.agentId = `agent-${seatId.toLowerCase()}`;
      registry.register(seat.agentId, {
        decidePlacement: seatId === "C" ? decideC : decideD,
        async decideHint() {
          return "no";
        },
        async decideDiscussion() {
          return null;
        }
      });
    }

    await continueTurnOrHandoff(room, {
      afterRevealIfNeeded: async () => {},
      startTurnTimer: () => {},
      agentRegistry: registry,
      raceDelay: async (seatId) => {
        if (seatId === "C") await delayedLoser;
      }
    });

    expect(decideD).toHaveBeenCalledTimes(1);
    expect(room.placements.flat()).toHaveLength(1);
    expect(room.placements.flat()[0]?.owner).toBe("D");

    releaseDelayedLoser();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(decideC).not.toHaveBeenCalled();
  });
  it("coalesces duplicate handoff triggers while an agent decision is in flight", async () => {
    const room = makePlacingRoom(3);
    const agentSeat = room.seats.find((seat) => seat.id === "C");
    if (!agentSeat) throw new Error("Missing agent seat");
    agentSeat.kind = "agent";
    agentSeat.agentId = "agent-c";
    room.turn = "C";

    let releaseDecision!: (decision: { cardId: string; segment: number }) => void;
    const decidePlacement = vi.fn(
      () => new Promise<{ cardId: string; segment: number }>((resolve) => (releaseDecision = resolve))
    );
    const agentRegistry = new InMemoryAgentRegistry();
    agentRegistry.register("agent-c", {
      decidePlacement,
      async decideHint() {
        return "no";
      },
      async decideDiscussion() {
        return null;
      }
    });
    const afterRevealIfNeeded = vi.fn().mockResolvedValue(undefined);
    const startTurnTimer = vi.fn();
    const options = { afterRevealIfNeeded, startTurnTimer, agentRegistry };

    const first = continueTurnOrHandoff(room, options);
    const duplicate = continueTurnOrHandoff(room, options);
    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(decidePlacement).toHaveBeenCalledTimes(1));

    releaseDecision({ cardId: room.hands.C![0].id, segment: 2 });
    await first;

    expect(decidePlacement).toHaveBeenCalledTimes(1);
    expect(room.placements.flat()).toHaveLength(1);
    expect(startTurnTimer).toHaveBeenCalledTimes(2);
  });
  it("silently drops a race decision when a human places first", async () => {
    const room = makePlacingRoom(3);
    const agentSeat = room.seats.find((seat) => seat.id === "C");
    if (!agentSeat) throw new Error("Missing agent seat");
    agentSeat.kind = "agent";
    agentSeat.agentId = "agent-c";

    let releaseDecision!: (decision: { cardId: string; segment: number }) => void;
    const decidePlacement = vi.fn(
      () => new Promise<{ cardId: string; segment: number }>((resolve) => (releaseDecision = resolve))
    );
    const agentRegistry = new InMemoryAgentRegistry();
    agentRegistry.register("agent-c", {
      decidePlacement,
      async decideHint() {
        return "no";
      },
      async decideDiscussion() {
        return null;
      }
    });
    const startTurnTimer = vi.fn();
    const handoff = continueTurnOrHandoff(room, {
      afterRevealIfNeeded: vi.fn().mockResolvedValue(undefined),
      startTurnTimer,
      agentRegistry,
      raceDelay: async () => undefined
    });
    await vi.waitFor(() => expect(decidePlacement).toHaveBeenCalledTimes(1));

    const agentCardId = room.hands.C![0].id;
    applyPlacement(room, "A", { cardId: room.hands.A![0].id, segment: 0 });
    releaseDecision({ cardId: agentCardId, segment: 1 });
    await handoff;

    expect(room.placements.flat()).toHaveLength(1);
    expect(room.placements.flat()[0]?.owner).toBe("A");
    expect(room.pendingHint?.seatId).toBe("A");
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
